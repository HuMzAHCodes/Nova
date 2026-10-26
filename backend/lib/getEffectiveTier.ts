import { IOrganization } from '../models/Organization.js';

// CONCEPT: lapsed-payment-access-restriction. subscriptionTier records what
// the organization BOUGHT; this function answers what it may do RIGHT NOW.
// A past_due or canceled organization is treated as Free for access checks,
// but the stored tier is never touched, so recovery needs no restore logic.
// A missing subscriptionStatus (a free org that never subscribed) is NOT
// treated as lapsed.
export function getEffectiveTier(
  organization: Pick<IOrganization, 'subscriptionTier' | 'subscriptionStatus'>
): IOrganization['subscriptionTier'] {
  if (organization.subscriptionStatus === 'past_due' || organization.subscriptionStatus === 'canceled') {
    return 'free';
  }
  return organization.subscriptionTier;
}