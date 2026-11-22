import mongoose, { Schema, Document } from 'mongoose';

export type ProcessedStripeEventStatus = 'processing' | 'done';

export interface IProcessedStripeEvent extends Document {
  eventId: string;
  // 'processing': claimed, handler not finished (or crashed).
  // 'done': handler finished. A document written before this field existed
  // has no status and is treated as done.
  status?: ProcessedStripeEventStatus;
  // When the current claim was taken. Used to tell a crashed handler (old
  // claim) from one that is still running (fresh claim).
  claimedAt?: Date;
  createdAt: Date;
}

// CONCEPT: webhook-idempotency. One document per Stripe event we have
// claimed. The UNIQUE index on eventId is the atomic lock: when two copies
// of the same event arrive together, the database lets exactly one insert
// succeed and rejects the other with duplicate-key error 11000.
//
// CONCEPT: webhook-idempotency (crash safety, KL-10). A claim alone cannot
// tell "handled" from "handling started and the process died". So a claim
// carries a status and a timestamp: 'processing' until the handler
// finishes, then 'done'. A 'processing' claim older than the take-over
// window is treated as a crashed handler and may be taken over.
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
  status: {
    type: String,
    enum: ['processing', 'done'],
  },
  claimedAt: {
    type: Date,
  },
  createdAt: {
    type: Date,
    default: Date.now,
    expires: 60 * 60 * 24 * 30,
  },
});

export default mongoose.model<IProcessedStripeEvent>('ProcessedStripeEvent', processedStripeEventSchema);
