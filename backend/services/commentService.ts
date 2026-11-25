import { Types } from 'mongoose';
import Comment, { IComment } from '../models/Comment.js';
import Task, { ITask } from '../models/Task.js';
import ClientAccess from '../models/ClientAccess.js';
import User from '../models/User.js';
import Project from '../models/Project.js';
import { AppError } from '../lib/AppError.js';
import { getIO } from '../lib/socket.js';
import { CreateCommentInput, UpdateCommentInput, ThreadQuery } from '../validators/commentValidators.js';
import { notifyNewComment, notifyMentions } from './notificationService.js';

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

// CONCEPT: mentions. Checks every mentioned id against the rules and returns
// the cleaned list. An invalid id rejects the WHOLE request (400), never
// silently dropped, because the author believes that person was alerted.
//   - The author themselves is ignored (no self-notification), not an error.
//   - Staff may mention any owner, admin or member of the organization, and a
//     client only in a SHARED comment and only while that client holds a grant
//     on the project.
//   - A client may mention owners and admins only.
// One query per kind, comparing counts to the number of unique ids (the same
// technique as assignee validation).
async function resolveMentions(
  tenantId: string,
  actor: Actor,
  projectId: Types.ObjectId | string,
  visibility: Visibility,
  mentionIds: string[]
): Promise<string[]> {
  const uniqueIds = [...new Set(mentionIds)].filter((id) => id !== actor.userId);
  if (uniqueIds.length === 0) return [];

  const candidates = await User.find({ _id: { $in: uniqueIds }, organizationId: tenantId }).select('role');

  let grantedClientIds = new Set<string>();
  const clientCandidateIds = candidates.filter((user) => user.role === 'client').map((user) => String(user._id));
  if (!isClient(actor) && visibility === 'shared' && clientCandidateIds.length > 0) {
    const grants = await ClientAccess.find({
      userId: { $in: clientCandidateIds },
      organizationId: tenantId,
      projectId,
    }).select('userId');
    grantedClientIds = new Set(grants.map((grant) => String(grant.userId)));
  }

  const validCount = candidates.filter((user) => {
    if (isClient(actor)) return user.role === 'owner' || user.role === 'admin';
    if (user.role === 'client') return grantedClientIds.has(String(user._id));
    return true; // owner, admin or member of this organization
  }).length;

  if (validCount !== uniqueIds.length) {
    throw new AppError(400, 'One or more mentioned users cannot be mentioned in this comment');
  }
  return uniqueIds;
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
    mentions: comment.mentions,
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

  // Mentions are validated BEFORE anything is saved.
  const mentionedIds = await resolveMentions(tenantId, actor, task.projectId, visibility, input.mentions);

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
    mentions: mentionedIds,
    body: input.body,
  });

  emitForVisibility(task.projectId, visibility, 'comment:created', toPayload(comment));
  await notifyNewComment(
    tenantId,
    task,
    { id: actor.userId, role: isClient(actor) ? 'client' : 'staff' },
    visibility,
    earlierCommenterIds,
    mentionedIds
  );

  return toPayload(comment);
}

export async function listForTask(tenantId: string, taskId: string, actor: Actor, query: ThreadQuery) {
  await loadTaskForActor(tenantId, taskId, actor);

  const { page, limit, since } = query;
  // The visibility filter applies to the list AND to the total, so a client
  // never learns how many internal comments exist. It is part of the same
  // filter object as "since", so catching up can never widen what is visible.
  //
  // CONCEPT: reconnect-handling. With "since", a comment counts as new when it
  // was created OR edited after that time (strictly after). Deleted comments
  // cannot be reported this way; a client that needs to notice deletions
  // refetches the whole thread.
  const filter = {
    organizationId: tenantId,
    taskId,
    visibility: { $in: visibleVisibilities(actor) },
    ...(since ? { $or: [{ createdAt: { $gt: since } }, { editedAt: { $gt: since } }] } : {}),
  };
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

  // CONCEPT: mentions. Sending a list replaces it, validated with the same
  // rules and the comment's own (fixed) visibility; only people NEWLY added
  // are notified. Leaving the list out changes nothing.
  let newlyMentionedIds: string[] = [];
  if (input.mentions !== undefined) {
    const validated = await resolveMentions(tenantId, actor, comment.projectId, comment.visibility, input.mentions);
    const previous = new Set(comment.mentions.map(String));
    newlyMentionedIds = validated.filter((id) => !previous.has(id));
    comment.mentions = validated.map((id) => new Types.ObjectId(id));
  }

  comment.body = input.body;
  comment.editedAt = new Date();
  await comment.save();

  emitForVisibility(comment.projectId, comment.visibility, 'comment:updated', toPayload(comment));

  if (newlyMentionedIds.length > 0) {
    const task = await Task.findOne({ _id: comment.taskId, organizationId: tenantId });
    if (task) {
      await notifyMentions(tenantId, task, newlyMentionedIds);
    }
  }
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

// CONCEPT: mentions. The people the frontend offers when typing "@". Only id,
// name and role are returned, never email or anything else.
//   - Staff: the owners, admins and members of the organization, plus the
//     clients granted on this project.
//   - A client: only the owners and admins (and only for a project they hold
//     a grant for).
export async function listMentionable(tenantId: string, projectId: string, actor: Actor) {
  const projectInOrganization = await Project.exists({ _id: projectId, organizationId: tenantId });
  if (!projectInOrganization) {
    throw new AppError(404, 'Project not found');
  }

  let users;
  if (isClient(actor)) {
    if (!(await clientHasGrant(tenantId, actor.userId, projectId))) {
      throw new AppError(404, 'Project not found');
    }
    users = await User.find({ organizationId: tenantId, role: { $in: ['owner', 'admin'] } }).select('name role');
  } else {
    const grants = await ClientAccess.find({ organizationId: tenantId, projectId }).select('userId');
    users = await User.find({
      organizationId: tenantId,
      $or: [
        { role: { $in: ['owner', 'admin', 'member'] } },
        { role: 'client', _id: { $in: grants.map((grant) => grant.userId) } },
      ],
    }).select('name role');
  }

  return users.map((user) => ({ _id: user._id, name: user.name, role: user.role }));
}
