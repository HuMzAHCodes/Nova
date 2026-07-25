import mongoose, { Schema, Document, Types } from 'mongoose';

// Minimal version for now — Week 3 (Core PM) will expand this with status,
// description, dates, etc. Added now only so Organization/User/ClientAccess
// have a real collection to reference via `ref: 'Project'`.
export interface IProject extends Document {
  organizationId: Types.ObjectId;
  name: string;
  createdAt: Date;
  updatedAt: Date;
}

const projectSchema = new Schema<IProject>(
  {
    organizationId: {
      type: Schema.Types.ObjectId,
      ref: 'Organization',
      required: true,
      index: true,
    },
    name: {
      type: String,
      required: true,
      trim: true,
    },
  },
  {
    timestamps: true,
  }
);

export default mongoose.model<IProject>('Project', projectSchema);