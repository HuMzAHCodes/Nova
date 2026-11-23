import { Types } from 'mongoose';
import Comment, { IComment } from '../models/Comment.js';
import Task from '../models/Task.js';
import { AppError } from '../lib/AppError.js';
import { getIO } from '../lib/socket.js';
import { CreateCommentInput, UpdateCommentInput, ThreadQuery } from '../validators/commentValidators.js';
import { notifyNewComment } from './notificationService.js';

// CONCEPT: comments (see docs/concepts/comments). Every function takes the
// organization id (from the token) and filters by it, the same tenant-safety
// pattern as taskService.

interface Actor {
  userId: string;
  role: string; // owner, admin or member in this step; clients arrive with visibility
}

// Name of the staff-only room of a project. Comments are sent here only, so a
// client who joined the ordinary project room never receives them.
export const staffRoomName = (projectId: string | Types.ObjectId) => `project:${projectId}:staff`;

// What the client sees in events and responses.
function toPayload(comment: IComment) {
  return {
    _id: comment._id,
    taskId: comment.taskId,
    projectId: comment.projectId,
    authorId: comment.authorId,
    authorRole: comment.authorRole,
    body: comment.body,
    editedAt: comment.editedAt,
    createdAt: comment.createdAt,
  };
}

// A live push is a bonus, never a requirement: if the socket server is not
// running or the emit fails, the saved comment stands.
function emitToStaffRoom(projectId: string | Types.ObjectId, eventName: string, payload: unknown) {
  try {
    getIO().to(staffRoomName(projectId)).emit(eventName, payload);
  } catch (error) {
    console.error(`Emitting ${eventName} failed:`, error);
  }
}

export async function create(tenantId: string, taskId: string, actor: Actor, input: CreateCommentInput) {
  // A task of another organization and a missing task give the same 404.
  const task = await Task.findOne({ _id: taskId, organizationId: tenantId });
  if (!task) {
    throw new AppError(404, 'Task not found');
  }

  // People who already commented on this task, read BEFORE this comment is
  // saved so the author of the new comment is excluded below anyway.
  const earlierCommenterIds = await Comment.distinct('authorId', { organizationId: tenantId, taskId: task._id });

  const comment = await Comment.create({
    organizationId: tenantId,
    projectId: task.projectId,
    taskId: task._id,
    authorId: actor.userId,
    authorRole: 'staff',
    body: input.body,
  });

  emitToStaffRoom(task.projectId, 'comment:created', toPayload(comment));
  await notifyNewComment(tenantId, task, actor.userId, earlierCommenterIds);

  return toPayload(comment);
}

export async function listForTask(tenantId: string, taskId: string, query: ThreadQuery) {
  const task = await Task.exists({ _id: taskId, organizationId: tenantId });
  if (!task) {
    throw new AppError(404, 'Task not found');
  }

  const { page, limit } = query;
  const filter = { organizationId: tenantId, taskId };
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

// Only the author may edit. Someone else's comment, including for an admin,
// answers 404 so comment ids cannot be probed (admins moderate by deleting).
export async function update(tenantId: string, commentId: string, actor: Actor, input: UpdateCommentInput) {
  const comment = await Comment.findOneAndUpdate(
    { _id: commentId, organizationId: tenantId, authorId: actor.userId },
    { $set: { body: input.body, editedAt: new Date() } },
    { new: true, runValidators: true }
  );
  if (!comment) {
    throw new AppError(404, 'Comment not found');
  }

  emitToStaffRoom(comment.projectId, 'comment:updated', toPayload(comment));
  return toPayload(comment);
}

// The author, or an owner or admin (moderation), may delete.
export async function remove(tenantId: string, commentId: string, actor: Actor) {
  const isModerator = actor.role === 'owner' || actor.role === 'admin';
  const comment = await Comment.findOneAndDelete({
    _id: commentId,
    organizationId: tenantId,
    ...(isModerator ? {} : { authorId: actor.userId }),
  });
  if (!comment) {
    throw new AppError(404, 'Comment not found');
  }

  emitToStaffRoom(comment.projectId, 'comment:deleted', {
    _id: comment._id,
    taskId: comment.taskId,
    projectId: comment.projectId,
  });
}
