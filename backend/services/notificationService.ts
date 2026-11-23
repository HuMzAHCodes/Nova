import { Types } from 'mongoose';
import Notification, { NotificationType } from '../models/Notification.js';
import User from '../models/User.js';
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
export async function listForUser(tenantId: string, userId: string, query: PaginationQuery, unreadOnly: boolean) {
  const { page, limit } = query;
  const skip = (page - 1) * limit;
  const filter = {
    organizationId: tenantId,
    userId,
    ...(unreadOnly ? { readAt: { $exists: false } } : {}),
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
