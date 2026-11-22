import { vi, describe, it, expect, beforeEach } from 'vitest';
import { api, bearer, makeTenant, makeUser } from './helpers.js';
import Organization from '../models/Organization.js';

// The real Stripe client would call the network. This file replaces it with
// recording fakes, so it can check what Nova asks Stripe for and what it
// does with the answers.
const stripeFake = vi.hoisted(() => ({
  customers: { create: vi.fn() },
  checkout: { sessions: { create: vi.fn() } },
  billingPortal: { sessions: { create: vi.fn() } },
  webhooks: { constructEvent: vi.fn() },
}));
vi.mock('../config/stripe.js', () => ({ default: stripeFake }));

beforeEach(() => {
  stripeFake.customers.create.mockResolvedValue({ id: 'cus_new' });
  stripeFake.checkout.sessions.create.mockResolvedValue({ url: 'https://checkout.example/session' });
  stripeFake.billingPortal.sessions.create.mockResolvedValue({ url: 'https://portal.example/session' });
});

// CONCEPT: stripe-billing. KL-14: the portal-session endpoint was never exercised.
describe('KL-14: portal session', () => {
  it('returns the portal URL for an organization that has a billing account', async () => {
    const { owner, org, orgId } = await makeTenant('pro');
    await Organization.updateOne({ _id: org._id }, { stripeCustomerId: 'cus_existing' });
    const res = await api().post(`/api/organizations/${orgId}/billing/portal-session`).set(bearer(owner));
    expect(res.status).toBe(200);
    expect(res.body.data.url).toBe('https://portal.example/session');
    expect(stripeFake.billingPortal.sessions.create).toHaveBeenCalledWith({
      customer: 'cus_existing',
      return_url: 'http://localhost:3000/billing',
    });
  });

  it('answers 400 when the organization has never started a checkout', async () => {
    const { owner, orgId } = await makeTenant('free');
    const res = await api().post(`/api/organizations/${orgId}/billing/portal-session`).set(bearer(owner));
    expect(res.status).toBe(400);
    expect(stripeFake.billingPortal.sessions.create).not.toHaveBeenCalled();
  });

  it('is owner-only', async () => {
    const { org, orgId } = await makeTenant('pro');
    const admin = await makeUser(org._id, 'admin');
    const res = await api().post(`/api/organizations/${orgId}/billing/portal-session`).set(bearer(admin));
    expect(res.status).toBe(403);
  });
});

describe('checkout session', () => {
  it('creates a Stripe customer once, stores it, and sends the tier and organization as metadata', async () => {
    const { owner, orgId } = await makeTenant('free');
    const first = await api().post(`/api/organizations/${orgId}/billing/checkout-session`).set(bearer(owner)).send({ tier: 'pro' });
    expect(first.status).toBe(200);
    expect(first.body.data.url).toBe('https://checkout.example/session');
    expect((await Organization.findById(orgId))?.stripeCustomerId).toBe('cus_new');
    expect(stripeFake.checkout.sessions.create).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: 'subscription',
        customer: 'cus_new',
        line_items: [{ price: 'price_fake_pro', quantity: 1 }],
        metadata: { organizationId: orgId, tier: 'pro' },
      })
    );

    await api().post(`/api/organizations/${orgId}/billing/checkout-session`).set(bearer(owner)).send({ tier: 'business' });
    expect(stripeFake.customers.create).toHaveBeenCalledTimes(1); // customer reused
  });

  it('does not change the plan: only the webhook does', async () => {
    const { owner, orgId } = await makeTenant('free');
    await api().post(`/api/organizations/${orgId}/billing/checkout-session`).set(bearer(owner)).send({ tier: 'business' });
    expect((await Organization.findById(orgId))?.subscriptionTier).toBe('free');
  });

  it('rejects an unknown tier with 400', async () => {
    const { owner, orgId } = await makeTenant('free');
    const res = await api().post(`/api/organizations/${orgId}/billing/checkout-session`).set(bearer(owner)).send({ tier: 'enterprise' });
    expect(res.status).toBe(400);
    expect(stripeFake.checkout.sessions.create).not.toHaveBeenCalled();
  });

  it('is owner-only', async () => {
    const { org, orgId } = await makeTenant('free');
    const member = await makeUser(org._id, 'member');
    const res = await api().post(`/api/organizations/${orgId}/billing/checkout-session`).set(bearer(member)).send({ tier: 'pro' });
    expect(res.status).toBe(403);
  });
});
