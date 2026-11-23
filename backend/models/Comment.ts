import mongoose, { Schema, Document, Types } from 'mongoose';

// CONCEPT: comments (see docs/concepts/comments). A small stored message on
// one task, written by one user. Organization, project and task ids are
// copied from the task on the server; the client never supplies them.
export interface IComment extends Document {
  organizationId: Types.ObjectId;
  projectId: Types.ObjectId;
  taskId: Types.ObjectId;
  authorId: Types.ObjectId;
  authorRole: 'staff' | 'client';
  // CONCEPT: comment-visibility. internal = staff only, shared = staff and the
  // clients who may see the deliverable. Fixed when the comment is created.
  visibility: 'internal' | 'shared';
  body: string;
  editedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const commentSchema = new Schema<IComment>(
  {
    organizationId: {
      type: Schema.Types.ObjectId,
      ref: 'Organization',
      required: true,
    },
    projectId: {
      type: Schema.Types.ObjectId,
      ref: 'Project',
      required: true,
    },
    taskId: {
      type: Schema.Types.ObjectId,
      ref: 'Task',
      required: true,
    },
    authorId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    // Set by the server from the author's role, so a thread can show who
    // wrote what without extra lookups.
    authorRole: {
      type: String,
      enum: ['staff', 'client'],
      required: true,
    },
    // Defaults to the SAFE side: a comment whose visibility was never set is
    // internal. Never changed after creation (see commentService.update).
    visibility: {
      type: String,
      enum: ['internal', 'shared'],
      default: 'internal',
      required: true,
    },
    // Plain text only (no HTML), 1 to 2000 characters. Also checked by the
    // request validators; the limits here are the last line of defence.
    body: {
      type: String,
      required: true,
      trim: true,
      minlength: 1,
      maxlength: 2000,
    },
    editedAt: {
      type: Date,
    },
  },
  { timestamps: true }
);

// Serves the thread of one task, oldest first.
commentSchema.index({ taskId: 1, organizationId: 1, createdAt: 1 });

export default mongoose.model<IComment>('Comment', commentSchema);
