import mongoose, { Schema, Document, Types } from 'mongoose';

export interface IOrganization extends Document {
  name: string;
  slug: string;
  ownerId: Types.ObjectId;
  subscriptionTier: 'free' | 'pro' | 'business';
  // CONCEPT: stripe-billing. Both optional/undefined until the org's
  // first Checkout Session actually completes — a free-tier org that
  // never subscribed has neither of these set.
  stripeCustomerId?: string;
  subscriptionStatus?: 'active' | 'canceled' | 'past_due';
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
      unique: true,
      lowercase: true,
      trim: true,
    },
    ownerId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    subscriptionTier: {
      type: String,
      enum: ['free', 'pro', 'business'],
      default: 'free',
    },
    stripeCustomerId: {
      type: String,
    },
    subscriptionStatus: {
      type: String,
      enum: ['active', 'canceled', 'past_due'],
    },
  },
  {
    timestamps: true,
  }
);

export default mongoose.model<IOrganization>('Organization', organizationSchema);