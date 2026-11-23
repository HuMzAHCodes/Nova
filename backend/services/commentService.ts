import { Types } from 'mongoose';
import Comment, { IComment } from '../models/Comment.js';
import Task, { ITask } from '../models/Task.js';
import ClientAccess from '../models/ClientAccess.js';
import { AppError } from '../lib/AppError.js';
import { getIO } from '../lib/socket.js';
import { CreateCommentInput, UpdateCommentInput, ThreadQuery } from '../validators/commentValidators.js';
import { notifyNewComment } from './notificationService.js';

// CONCEPT: comments + comment-visibility (see docs/concepts/comments and
// docs/concepts/comment-visibility). Every function takes the organization id
// (from the token) and filters by it, the same tenant-safety pattern as
// taskService. The visibility rules live HERE, in one place, so a new
// endpoint cannot forget them.

type Visibility = 'internal' | 'shared';

interface Actor {
  userId: string;
  role: string; // owner, admin, member or client
}

const isClient = (actor: Actor) => actor.role === 'client';

// THE shared filter. Staff may read both kinds; a client may read only shared
// comments. Every read of comments goes through this function.
function visibleVisibilities(actor: Actor): Visibility[] {
  return isClient(actor) ? ['shared'] : ['internal', 'shared'];
}

// Does this client hold a grant (any permission) on the project?
async function clientHasGrant(tenantId: string, userId: string, projectId: Types.ObjectId | string) {
  const grant = await ClientAccess.exists({ userId, organizationId: tenantId, projectId });
  return grant !== null;
}

// Finds the task for the actor, or answers 404. A missing task, another
// organization's task, and (for a client) a task that is not a deliverable or
// whose project they hold no grant for all give the same answer.
async function loadTaskForActor(tenantId: string, taskId: string, actor: Actor): Promise<ITask> {
  const task = await Task.findOne({ _id: taskId, organizationId: tenantId });
  if (!task) {
    throw new AppError(404, 'Task not found');
  }
  if (isClient(actor)) {
    const mayView = task.isDeliverable && (await clientHasGrant(tenantId, actor.userId, task.projectId));
    if (!mayView) {
      throw new AppError(404, 'Task not found');
    }
  }
  return task;
}

// Names of the rooms. Shared events go to the ordinary project room (staff
// and granted clients are both in it). Internal events go ONLY to the
// staff-only room, which clients can never join.
const projectRoomName = (projectId: string | Types.ObjectId) => `project:${projectId}`;
export const staffRoomName = (projectId: string | Types.ObjectId) => `project:${projectId}:staff`;

// What the caller sees in events and responses. Notification text is separate
// and never contains the body.
function toPayload(comment: IComment) {
  return {
    _id: comment._id,
    taskId: comment.taskId,
    projectId: comment.projectId,
    authorId: comment.authorId,
    authorRole: comment.authorRole,
    visibility: comment.visibility,
    body: comment.body,
    editedAt: comment.editedAt,
    createdAt: comment.createdAt,
  };
}

// A live push is a bonus, never a requirement: if the socket server is not
// running or the emit fails, the saved comment stands.
function emitForVisibility(
  projectId: string | Types.ObjectId,
  visibility: Visibility,
  eventName: string,
  payload: unknown
) {
  try {
    const room = visibility === 'shared' ? projectRoomName(projectId) : staffRoomName(projectId);
    getIO().to(room).emit(eventName, payload);
  } catch (error) {
    console.error(`Emitting ${eventName} failed:`, error);
  }
}

export async function create(tenantId: string, taskId: string, actor: Actor, input: CreateCommentInput) {
  const task = await loadTaskForActor(tenantId, taskId, actor);

  // CONCEPT: comment-visibility. A client comment is always shared. Staff
  // choose, defaulting to internal, and a task that is not a deliverable is
  // invisible to clients, so comments on it are always internal.
  let visibility: Visibility = 'internal';
  if (isClient(actor)) {
    visibility = 'shared';
  } else if (task.isDeliverable && input.visibility === 'shared') {
    visibility = 'shared';
  }

  // People who already commented on this task, read BEFORE this comment is
  // saved. The notification step decides who may actually be told.
  const earlierCommenterIds = await Comment.distinct('authorId', { organizationId: tenantId, taskId: task._id });

  const comment = await Comment.create({
    organizationId: tenantId,
    projectId: task.projectId,
    taskId: task._id,
    authorId: actor.userId,
    authorRole: isClient(actor) ? 'client' : 'staff',
    visibility,
    body: input.body,
  });

  emitForVisibility(task.projectId, visibility, 'comment:created', toPayload(comment));
  await notifyNewComment(
    tenantId,
    task,
    { id: actor.userId, role: isClient(actor) ? 'client' : 'staff' },
    visibility,
    earlierCommenterIds
  );

  return toPayload(comment);
}

export async function listForTask(tenantId: string, taskId: string, actor: Actor, query: ThreadQuery) {
  await loadTaskForActor(tenantId, taskId, actor);

  const { page, limit } = query;
  // The visibility filter applies to the list AND to the total, so a client
  // never learns how many internal comments exist.
  const filter = { organizationId: tenantId, taskId, visibility: { $in: visibleVisibilities(actor) } };
  const [comments, total] = await Promise.all([
    Comment.find(filter)
      .sort({ createdAt: 1 })
      .skip((page - 1) * limit)
      .limit(limit),
    Comment.countDocuments(filter),
  ]);

  return {
    comments: comments.map(toPayload),
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
  };
}

// Finds a comment the actor wrote. Someone else's comment, including for an
// admin, answers 404 so comment ids cannot be probed. A client who has lost
// their grant is treated as if the comment does not exist.
async function findOwnComment(tenantId: string, commentId: string, actor: Actor): Promise<IComment> {
  const comment = await Comment.findOne({ _id: commentId, organizationId: tenantId, authorId: actor.userId });
  if (!comment) {
    throw new AppError(404, 'Comment not found');
  }
  if (isClient(actor) && !(await clientHasGrant(tenantId, actor.userId, comment.projectId))) {
    throw new AppError(404, 'Comment not found');
  }
  return comment;
}

// Only the author may edit (admins moderate by deleting). Only the body can
// change: visibility is fixed at creation, so old text is never exposed.
export async function update(tenantId: string, commentId: string, actor: Actor, input: UpdateCommentInput) {
  const comment = await findOwnComment(tenantId, commentId, actor);

  comment.body = input.body;
  comment.editedAt = new Date();
  await comment.save();

  emitForVisibility(comment.projectId, comment.visibility, 'comment:updated', toPayload(comment));
  return toPayload(comment);
}

// The author may delete; so may an owner or admin (moderation).
export async function remove(tenantId: string, commentId: string, actor: Actor) {
  const isModerator = actor.role === 'owner' || actor.role === 'admin';

  let comment: IComment | null;
  if (isModerator) {
    comment = await Comment.findOne({ _id: commentId, organizationId: tenantId });
    if (!comment) {
      throw new AppError(404, 'Comment not found');
    }
  } else {
    comment = await findOwnComment(tenantId, commentId, actor);
  }

  await Comment.deleteOne({ _id: comment._id });

  emitForVisibility(comment.projectId, comment.visibility, 'comment:deleted', {
    _id: comment._id,
    taskId: comment.taskId,
    projectId: comment.projectId,
  });
}
