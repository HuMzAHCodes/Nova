export type SubscriptionTier = 'free' | 'pro' | 'business';
export type LimitedResource = 'projects' | 'clients' | 'teamMembers';

interface TierLimits {
  projects: number;
  clients: number;
  teamMembers: number;
}

// CONCEPT: usage-limits-tier-gating. The single source of truth for
// every tier's caps — no limit number is hardcoded anywhere else.
// Infinity represents "unlimited" as data, not a large sentinel number
// — see the concept notes for why that distinction matters.
export const SUBSCRIPTION_LIMITS: Record<SubscriptionTier, TierLimits> = {
  free: {
    projects: 3,
    clients: 2,
    teamMembers: 2, // includes the Owner — see concept notes
  },
  pro: {
    projects: 15,
    clients: 10,
    teamMembers: 8,
  },
  business: {
    projects: Infinity,
    clients: Infinity,
    teamMembers: Infinity,
  },
};