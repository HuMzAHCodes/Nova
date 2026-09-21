import mongoose, { Schema, Document, Types } from 'mongoose';

// CONCEPT: task-model-design (see docs/concepts/task-model-design).
export interface ITask extends Document {
  organizationId: Types.ObjectId;
  projectId: Types.ObjectId;
  title: string;
  description?: string;
  status: 'todo' | 'in_progress' | 'blocked' | 'done';
  assignedTo: Types.ObjectId[]; // ARRAY — multi-assignee, not a single ref.
                                // See concept notes for the query/indexing
                                // implications of this choice.
  dueDate?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const taskSchema = new Schema<ITask>(
  {
    // Denormalized directly onto Task even though it's derivable via
    // projectId → Organization — same reasoning as the original
    // multi-tenancy design (see multi-tenancy-and-architecture concept):
    // faster tenant-scoped queries, defense-in-depth if the projectId
    // relationship is ever wrong.
    organizationId: {
      type: Schema.Types.ObjectId,
      ref: 'Organization',
      required: true,
      index: true,
    },
    projectId: {
      type: Schema.Types.ObjectId,
      ref: 'Project',
      required: true,
      index: true,
    },
    title: {
      type: String,
      required: true,
      trim: true,
    },
    description: {
      type: String,
      trim: true,
    },
    status: {
      type: String,
      enum: ['todo', 'in_progress', 'blocked', 'done'],
      default: 'todo',
    },
    // Mongoose automatically creates a multi-key index on an array field
    // referenced this way — this is what keeps "find all tasks assigned
    // to user X" efficient without scanning every task's full array.
    assignedTo: {
      type: [Schema.Types.ObjectId],
      ref: 'User',
      default: [],
      index: true,
    },
    dueDate: {
      type: Date,
    },
  },
  {
    timestamps: true,
  }
);

// CONCEPT: task-model-design — no separate permission fields or role logic
// live on this schema at all. Task fully inherits access control from its
// parent Project via requireProjectRole, applied at the ROUTE level (see
// routes/taskRoutes.ts) — not modeled here in the schema.

export default mongoose.model<ITask>('Task', taskSchema);