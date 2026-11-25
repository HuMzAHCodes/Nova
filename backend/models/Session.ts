import mongoose, { Schema, Document, Types } from 'mongoose';

// CONCEPT: sessions-and-token-revocation. One document per signed-in device.
// The access token carries this document's id; the authentication middleware
// checks the document still exists, so deleting it ends the session at once.
// The refresh token is rotated on every use and only the HASH of the current
// one is stored (like passwords and reset tokens, the plain value is never
// kept).
export interface ISession extends Document {
  userId: Types.ObjectId;
  organizationId: Types.ObjectId;
  refreshTokenHash: string; // hash of the CURRENT refresh token only
  expiresAt: Date; // when the current refresh token expires
  createdAt: Date;
  updatedAt: Date;
}

const sessionSchema = new Schema<ISession>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    organizationId: { type: Schema.Types.ObjectId, ref: 'Organization', required: true },
    refreshTokenHash: { type: String, required: true },
    expiresAt: { type: Date, required: true },
  },
  { timestamps: true }
);

// MongoDB removes a session automatically once expiresAt has passed (the
// cleanup runs about once a minute, so the middleware also checks expiresAt
// itself instead of trusting the cleanup to be instant).
sessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export default mongoose.model<ISession>('Session', sessionSchema);
