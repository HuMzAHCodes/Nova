import mongoose, { Schema, Document, Types } from 'mongoose';

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
      // No `select: false` yet — we'll revisit this in the auth concept (Week 2),
      // since passwordHash should typically be excluded from default query
      // results and only pulled in explicitly during login.
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

export default mongoose.model<IUser>('User', userSchema);