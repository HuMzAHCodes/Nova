import request from 'supertest';
import mongoose from 'mongoose';
import app from '../app.js';
import Organization from '../models/Organization.js';
import User from '../models/User.js';
import Project from '../models/Project.js';
import { signAccessToken } from '../lib/jwt.js';
import * as email from '../lib/email.js';

export const api = () => request(app);

export const mocks = {
  teamInvite: () => email.sendTeamInviteEmail as unknown as import('vitest').Mock,
  clientInvite: () => email.sendClientInviteEmail as unknown as import('vitest').Mock,
  verification: () => email.sendVerificationEmail as unknown as import('vitest').Mock,
  passwordReset: () => email.sendPasswordResetEmail as unknown as import('vitest').Mock,
};

let counter = 0;
const next = () => ++counter;

export async function makeOrg(tier: 'free' | 'pro' | 'business' = 'business') {
  const n = next();
  return Organization.create({
    name: `Org ${n}`,
    slug: `org-${n}`,
    ownerId: new mongoose.Types.ObjectId(),
    subscriptionTier: tier,
    ...(tier !== 'free' ? { subscriptionStatus: 'active' } : {}),
  });
}

export async function makeUser(
  organizationId: unknown,
  role: 'owner' | 'admin' | 'member' | 'client',
  email_?: string
) {
  const n = next();
  const user = await User.create({
    organizationId,
    email: email_ ?? `user${n}@example.com`,
    passwordHash: 'Password123!',
    name: `User ${n}`,
    role,
    emailVerified: true,
  });
  return user;
}

export function tokenFor(user: { _id: unknown; organizationId: unknown; role: string }) {
  return signAccessToken({
    userId: String(user._id),
    organizationId: String(user.organizationId),
    role: user.role,
  });
}

export const bearer = (user: Parameters<typeof tokenFor>[0]) => ({
  Authorization: `Bearer ${tokenFor(user)}`,
});

// An organization with an owner, ready to use.
export async function makeTenant(tier: 'free' | 'pro' | 'business' = 'business') {
  const org = await makeOrg(tier);
  const owner = await makeUser(org._id, 'owner');
  org.ownerId = owner._id as mongoose.Types.ObjectId;
  await org.save();
  return { org, owner, orgId: String(org._id) };
}

export async function makeProject(organizationId: unknown, name = 'Project') {
  return Project.create({ organizationId, name });
}
