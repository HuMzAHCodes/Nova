import mongoose, { Schema, Document } from 'mongoose';

export interface IProcessedStripeEvent extends Document {
  eventId: string;
  createdAt: Date;
}

// CONCEPT: webhook-idempotency. One document per Stripe event we have
// claimed. The UNIQUE index on eventId is the atomic lock: when two copies
// of the same event arrive together, the database lets exactly one insert
// succeed and rejects the other with duplicate-key error 11000.
//
// The createdAt field carries a TTL index (expires), so MongoDB deletes
// records after 30 days on its own. Stripe retries for a few days at most,
// so 30 days is far longer than needed and keeps the collection bounded.
const processedStripeEventSchema = new Schema<IProcessedStripeEvent>({
  eventId: {
    type: String,
    required: true,
    unique: true,
  },
  createdAt: {
    type: Date,
    default: Date.now,
    expires: 60 * 60 * 24 * 30,
  },
});

export default mongoose.model<IProcessedStripeEvent>('ProcessedStripeEvent', processedStripeEventSchema);
