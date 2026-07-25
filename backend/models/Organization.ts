import mongoose, { Schema, Document, Types } from 'mongoose';

// TypeScript interface describing the shape of an Organization document.
// Extending mongoose.Document gives us Mongoose's built-in fields (_id, etc.)
// alongside our own fields, so TypeScript knows the full shape everywhere
// this type is used.
export interface IOrganization extends Document {
  name: string;
  slug: string;
  ownerId: Types.ObjectId;
  subscriptionTier: 'free' | 'pro' | 'business';
  createdAt: Date;
  updatedAt: Date;
}

const organizationSchema = new Schema<IOrganization>(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },
    slug: {
      type: String,
      required: true,
      unique: true, // enforced at the database level via a unique index
      lowercase: true,
      trim: true,
    },
    ownerId: {
      type: Schema.Types.ObjectId,
      ref: 'User', // tells Mongoose this references a document in the User collection
      required: true,
    },
    subscriptionTier: {
      type: String,
      enum: ['free', 'pro', 'business'],
      default: 'free',
    },
  },
  {
    // Automatically adds and maintains createdAt / updatedAt fields —
    // no need to set them manually anywhere.
    timestamps: true,
  }
);

// mongoose.model() registers this schema under the name 'Organization',
// which is also what other schemas' `ref: 'Organization'` fields point to.
export default mongoose.model<IOrganization>('Organization', organizationSchema);