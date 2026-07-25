import mongoose, { Schema, Document, Types } from 'mongoose';

export interface IClientAccess extends Document {
  userId: Types.ObjectId;
  organizationId: Types.ObjectId;
  projectId: Types.ObjectId;
  permissions: string[];
  createdAt: Date;
  updatedAt: Date;
}

const clientAccessSchema = new Schema<IClientAccess>(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
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
      index: true, // supports "all clients with access to Project X" queries
    },
    permissions: {
      type: [String],
      // A fixed, explicit allow-list rather than an open role string —
      // see the concept doc for why this is deliberate: Client capabilities
      // should never silently expand just because a role name's meaning
      // grew elsewhere in the app.
      enum: ['view', 'approve'],
      default: ['view'],
    },
  },
  {
    timestamps: true,
  }
);

// Prevents the same client user from having two separate ClientAccess
// documents for the same project — enforced at the database level.
clientAccessSchema.index({ userId: 1, projectId: 1 }, { unique: true });

export default mongoose.model<IClientAccess>('ClientAccess', clientAccessSchema);