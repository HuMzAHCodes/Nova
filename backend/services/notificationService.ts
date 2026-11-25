import { Types } from 'mongoose';
import Notification, { NotificationType } from '../models/Notification.js';
import User from '../models/User.js';
import ClientAccess from '../models/ClientAccess.js';
import { AppError } from '../lib/AppError.js';
import { getIO } from '../lib/socket.js';
import { PaginationQuery } from '../validators/paginationValidators.js';

// CONCEPT: notifications (see docs/concepts/notifications).

interface NotificationDraft {
  tenantId: string;
  recipientIds: Array<string | Types.ObjectId>;
  type: NotificationType;
  message: string;
  projectId?: Types.ObjectId | string;
  taskId?: Types.ObjectId | string;
}

// The name of the private socket room of one user. The id always comes from
// the verified token (see lib/socket.ts), never from the client.
export const userRoomName = (userId: string | Types.ObjectId) => `user:${userId}`;

// Creates one stored notification per recipient and pushes each live.
//
// RULE: this function NEVER throws. A notification is a side effect of the
// real action (approving, assigning); if saving or pushing it fails, the
// real action must still succeed. Failures are logged instead.
//
// TENANT SAFETY: recipient ids may come from client input (task assignees),
// so only users that belong to the organization receive anything.
export async function createNotifications(draft: NotificationDraft): Promise<void> {
  try {
    const uniqueRecipientIds = [...new Set(draft.recipientIds.map(String))];
    if (uniqueRecipientIds.length === 0) return;

    const validRecipients = await User.find({
      _id: { $in: uniqueRecipientIds },
      organizationId: draft.tenantId,
    }).select('_id');
    if (validRecipients.length === 0) return;

    const savedNotifications = await Notification.insertMany(
      validRecipients.map((recipient) => ({
        organizationId: draft.tenantId,
        userId: recipient._id,
        type: draft.type,
        message: draft.message,
        projectId: draft.projectId,
        taskId: draft.taskId,
      }))
    );

    // Saved first, pushed second: a live event never announces something
    // that is not stored. A push failure (for example the socket server is
    // not running) is separate from, and must not undo, the saved record.
    try {
      const io = getIO();
      for (const notification of savedNotifications) {
        io.to(userRoomName(notification.userId)).emit('notification:new', {
          id: notification._id,
          type: notification.type,
          message: notification.message,
          projectId: notification.projectId,
          taskId: notification.taskId,
          createdAt: notification.createdAt,
        });
      }
    } catch (pushError) {
      console.error('Notification push failed:', pushError);
    }
  } catch (error) {
    console.error('Creating notifications failed:', error);
  }
}

// Recipients of a deliverable decision: the task assignees plus every owner
// and admin of the organization.
export async function notifyDeliverableDecision(
  tenantId: string,
  task: { _id: Types.ObjectId; projectId: Types.ObjectId; title: string; assignedTo: Types.ObjectId[] },
  decision: 'approved' | 'rejected'
): Promise<void> {
  try {
    const managers = await User.find({ organizationId: tenantId, role: { $in: ['owner', 'admin'] } }).select('_id');
    await createNotifications({
      tenantId,
      recipientIds: [...task.assignedTo, ...managers.map((manager) => manager._id)],
      type: decision === 'approved' ? 'deliverable_approved' : 'deliverable_rejected',
      message: `A client ${decision} "${task.title}"`,
      projectId: task.projectId,
      taskId: task._id,
    });
  } catch (error) {
    console.error('Notifying about a deliverable decision failed:', error);
  }
}

// Told to the owner and admins when an invited client sets their password for
// the first time.
export async function notifyClientJoined(tenantId: string, client: { name: string }): Promise<void> {
  try {
    const managers = await User.find({ organizationId: tenantId, role: { $in: ['owner', 'admin'] } }).select('_id');
    await createNotifications({
      tenantId,
      recipientIds: managers.map((manager) => manager._id),
      type: 'client_joined',
      message: `${client.name} accepted their invite and set a password`,
    });
  } catch (error) {
    console.error('Notifying about an accepted invite failed:', error);
  }
}

// CONCEPT: mentions. One dedicated notification per mentioned person. The text
// is generic and never contains the comment body. Never throws.
export async function notifyMentions(
  tenantId: string,
  task: { _id: Types.ObjectId; projectId: Types.ObjectId; title: string },
  mentionedIds: string[]
): Promise<void> {
  if (mentionedIds.length === 0) return;
  await createNotifications({
    tenantId,
    recipientIds: mentionedIds,
    type: 'comment_mention',
    message: `You were mentioned in a comment on "${task.title}"`,
    projectId: task.projectId,
    taskId: task._id,
  });
}

// CONCEPT: comments + comment-visibility. A new comment tells the task's
// assignees and the people who already commented on it, except the author.
// When the author is a client, the owners and admins are told as well (they
// may otherwise never learn the client wrote). Who may be told is then
// filtered by visibility:
//   - an INTERNAL comment never notifies a client;
//   - a SHARED comment notifies a client only while they still hold a grant
//     on the project.
// The text is generic and never contains the comment body.
export async function notifyNewComment(
  tenantId: string,
  task: { _id: Types.ObjectId; projectId: Types.ObjectId; title: string; assignedTo: Types.ObjectId[] },
  author: { id: string; role: 'staff' | 'client' },
  visibility: 'internal' | 'shared',
  earlierCommenterIds: Array<string | Types.ObjectId>,
  mentionedIds: string[] = []
): Promise<void> {
  try {
    // CONCEPT: mentions. Mentioned people get their own, dedicated notification
    // (already validated by the comment service). They are removed from the
    // normal list below so nobody is told twice about one comment.
    await notifyMentions(tenantId, task, mentionedIds);
    const alreadyMentioned = new Set(mentionedIds);

    const managerIds =
      author.role === 'client'
        ? (await User.find({ organizationId: tenantId, role: { $in: ['owner', 'admin'] } }).select('_id')).map(
            (manager) => manager._id
          )
        : [];

    const candidateIds = [...new Set([...task.assignedTo, ...earlierCommenterIds, ...managerIds].map(String))].filter(
      (id) => id !== author.id && !alreadyMentioned.has(id)
    );
    if (candidateIds.length === 0) return;

    const candidates = await User.find({ _id: { $in: candidateIds }, organizationId: tenantId }).select('_id role');
    const staffIds = candidates.filter((user) => user.role !== 'client').map((user) => String(user._id));
    const clientIds = candidates.filter((user) => user.role === 'client').map((user) => String(user._id));

    let allowedClientIds: string[] = [];
    if (visibility === 'shared' && clientIds.length > 0) {
      const grants = await ClientAccess.find({
        userId: { $in: clientIds },
        organizationId: tenantId,
        projectId: task.projectId,
      }).select('userId');
      allowedClientIds = grants.map((grant) => String(grant.userId));
    }

    await createNotifications({
      tenantId,
      recipientIds: [...staffIds, ...allowedClientIds],
      type: 'comment_added',
      message: `New comment on "${task.title}"`,
      projectId: task.projectId,
      taskId: task._id,
    });
  } catch (error) {
    console.error('Notifying about a new comment failed:', error);
  }
}

// Notifies only people who were ADDED to assignedTo, never the person who
// made the change, so editing other fields or re-sending the same list
// notifies nobody.
export async function notifyNewAssignees(
  tenantId: string,
  task: { _id: Types.ObjectId; projectId: Types.ObjectId; title: string; assignedTo: Types.ObjectId[] },
  previousAssigneeIds: Array<string | Types.ObjectId>,
  actorId: string
): Promise<void> {
  const previous = new Set(previousAssigneeIds.map(String));
  const newlyAdded = task.assignedTo.map(String).filter((id) => !previous.has(id) && id !== actorId);

  await createNotifications({
    tenantId,
    recipientIds: newlyAdded,
    type: 'task_assigned',
    message: `You were assigned to "${task.title}"`,
    projectId: task.projectId,
    taskId: task._id,
  });
}

// Every query below filters by BOTH userId and organizationId, both taken
// from the verified token, never from the URL or body.
export async function listForUser(
  tenantId: string,
  userId: string,
  query: PaginationQuery,
  unreadOnly: boolean,
  since?: Date
) {
  const { page, limit } = query;
  const skip = (page - 1) * limit;
  const filter = {
    organizationId: tenantId,
    userId,
    ...(unreadOnly ? { readAt: { $exists: false } } : {}),
    // CONCEPT: reconnect-handling. Only notifications created after this time.
    ...(since ? { createdAt: { $gt: since } } : {}),
  };

  const [notifications, total] = await Promise.all([
    Notification.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit),
    Notification.countDocuments(filter),
  ]);

  return { notifications, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } };
}

export async function countUnread(tenantId: string, userId: string): Promise<number> {
  return Notification.countDocuments({ organizationId: tenantId, userId, readAt: { $exists: false } });
}

// Someone else's notification and a missing one both answer 404, so ids
// cannot be probed.
export async function markRead(tenantId: string, userId: string, notificationId: string) {
  const notification = await Notification.findOneAndUpdate(
    { _id: notificationId, organizationId: tenantId, userId },
    { $set: { readAt: new Date() } },
    { new: true }
  );
  if (!notification) {
    throw new AppError(404, 'Notification not found');
  }
  return notification;
}

export async function markAllRead(tenantId: string, userId: string): Promise<number> {
  const result = await Notification.updateMany(
    { organizationId: tenantId, userId, readAt: { $exists: false } },
    { $set: { readAt: new Date() } }
  );
  return result.modifiedCount;
}
