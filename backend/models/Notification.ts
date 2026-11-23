import mongoose, { Schema, Document, Types } from 'mongoose';

// CONCEPT: notifications (see docs/concepts/notifications). One document
// per recipient: a small stored message addressed to a single user.
// Saving it is the source of truth; the live socket push is a bonus.
export type NotificationType = 'deliverable_approved' | 'deliverable_rejected' | 'task_assigned' | 'client_joined' | 'comment_added';

export interface INotification extends Document {
  organizationId: Types.ObjectId;
  userId: Types.ObjectId; // the recipient
  type: NotificationType;
  message: string;
  projectId?: Types.ObjectId;
  taskId?: Types.ObjectId;
  readAt?: Date; // absent means unread
  createdAt: Date;
  updatedAt: Date;
}

// Read notifications are deleted 30 days after they were read.
const READ_NOTIFICATION_LIFETIME_SECONDS = 60 * 60 * 24 * 30;

const notificationSchema = new Schema<INotification>(
  {
    organizationId: {
      type: Schema.Types.ObjectId,
      ref: 'Organization',
      required: true,
    },
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    type: {
      type: String,
      enum: ['deliverable_approved', 'deliverable_rejected', 'task_assigned', 'client_joined', 'comment_added'],
      required: true,
    },
    message: {
      type: String,
      required: true,
    },
    projectId: {
      type: Schema.Types.ObjectId,
      ref: 'Project',
    },
    taskId: {
      type: Schema.Types.ObjectId,
      ref: 'Task',
    },
    readAt: {
      type: Date,
    },
  },
  { timestamps: true }
);

// Serves the list ("my notifications, newest first") and the unread count.
notificationSchema.index({ userId: 1, organizationId: 1, createdAt: -1 });

// TTL index on readAt, NOT on createdAt: MongoDB only expires documents
// that actually have this field, so unread notifications are never deleted.
notificationSchema.index({ readAt: 1 }, { expireAfterSeconds: READ_NOTIFICATION_LIFETIME_SECONDS });

export default mongoose.model<INotification>('Notification', notificationSchema);
