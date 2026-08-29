import mongoose, { Schema, Document, Types } from 'mongoose';
import bcrypt from 'bcrypt';

// A single per-project role override — this is NOT its own collection.
// It's a sub-shape that lives embedded inside the projectRoles array below.
export interface IProjectRole {
  projectId: Types.ObjectId;
  role: string; // e.g. 'manager' — kept as a plain string rather than a strict
                // enum here, since project-level role names may evolve
                // independently of the fixed org-level role enum below.
}

export interface IUser extends Document {
  organizationId: Types.ObjectId;
  email: string;
  passwordHash: string;
  name: string;
  role: 'owner' | 'admin' | 'member' | 'client';
  projectRoles: IProjectRole[];
  createdAt: Date;
  updatedAt: Date;
  // CONCEPT: jwt-auth-design — comparePassword is an instance method
  // (available on any User document fetched from the DB) that wraps
  // bcrypt.compare(), so callers (authService) never handle raw password
  // comparison logic themselves — they just call user.comparePassword(...).
  comparePassword(candidatePassword: string): Promise<boolean>;
}

// Defined as its own Schema (rather than an inline object) so it can be
// reused cleanly and so Mongoose treats each array entry as a proper
// sub-document with its own validation.
const projectRoleSchema = new Schema<IProjectRole>(
  {
    projectId: {
      type: Schema.Types.ObjectId,
      ref: 'Project',
      required: true,
    },
    role: {
      type: String,
      required: true,
    },
  },
  { _id: false } // sub-documents get their own _id by default; we don't need one here
);

const userSchema = new Schema<IUser>(
  {
    organizationId: {
      type: Schema.Types.ObjectId,
      ref: 'Organization',
      required: true,
      index: true, // every tenant-scoped query filters by this — index it
    },
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },
    passwordHash: {
      type: String,
      required: true,
      // CONCEPT: jwt-auth-design. select: false means passwordHash is
      // EXCLUDED from query results by default — e.g. User.find() will
      // never accidentally include it in an API response. It only comes
      // back when a query explicitly asks for it via .select('+passwordHash'),
      // which authService.login does deliberately, since it needs the hash
      // to verify the submitted password.
      select: false,
    },
    name: {
      type: String,
      required: true,
      trim: true,
    },
    role: {
      type: String,
      enum: ['owner', 'admin', 'member', 'client'],
      required: true,
      default: 'member',
    },
    projectRoles: {
      type: [projectRoleSchema],
      default: [], // every user starts with no overrides — matches Sara's
                   // example in the worked-example doc
    },
  },
  {
    timestamps: true,
  }
);

// CONCEPT: jwt-auth-design (bcrypt hashing). A Mongoose "pre-save hook" —
// runs automatically every time a User document is about to be saved.
// FLOW: only re-hashes the password if it was actually modified in this
// save (isModified check) — otherwise, updating an unrelated field like
// `name` would re-hash the ALREADY-hashed value every time, corrupting it.
userSchema.pre('save', async function (next) {
  if (!this.isModified('passwordHash')) {
    return next();
  }

  // bcrypt.hash's second argument is the "salt rounds" (cost factor) —
  // 10 is a common, reasonable default balancing security and login
  // request latency. Each increment roughly doubles the hashing time.
  const saltRounds = 10;
  this.passwordHash = await bcrypt.hash(this.passwordHash, saltRounds);
  next();
});

// CONCEPT: jwt-auth-design — bcrypt.compare() re-hashes the candidate
// password with the SAME salt embedded in the stored hash and compares
// the results. This is why a plain `===` string comparison never works
// for bcrypt hashes (see the concept notes, common mistake #4) — the
// stored hash isn't something you can "match" directly, it has to be
// verified through bcrypt's own comparison function.
userSchema.methods.comparePassword = async function (candidatePassword: string): Promise<boolean> {
  return bcrypt.compare(candidatePassword, this.passwordHash);
};

export default mongoose.model<IUser>('User', userSchema);