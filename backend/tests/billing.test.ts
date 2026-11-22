import { describe, it, expect } from 'vitest';
import Stripe from 'stripe';
import { api, bearer, makeTenant } from './helpers.js';
import Organization from '../models/Organization.js';
import ProcessedStripeEvent from '../models/ProcessedStripeEvent.js';
import mongoose from 'mongoose';

const stripe = new Stripe('sk_test_fake');

// Sends a correctly signed event, exactly as Stripe would.
function sendEvent(event: object, secret = 'whsec_fake') {
  const payload = JSON.stringify(event);
  const header = stripe.webhooks.generateTestHeaderString({ payload, secret });
  return api().post('/api/webhooks/stripe').set('stripe-signature', header).set('Content-Type', 'application/json').send(payload);
}

const checkoutEvent = (id: string, organizationId: string, tier: string) => ({
  id,
  object: 'event',
  type: 'checkout.session.completed',
  data: { object: { metadata: { organizationId, tier } } },
});

describe('billing webhook', () => {
  it('rejects a missing or wrong signature and changes nothing', async () => {
    const { orgId } = await makeTenant('free');
    expect((await api().post('/api/webhooks/stripe').set('Content-Type', 'application/json').send('{}')).status).toBe(400);
    const bad = await sendEvent(checkoutEvent('evt_bad', orgId, 'pro'), 'whsec_wrong');
    expect(bad.status).toBe(400);
    expect((await Organization.findById(orgId))?.subscriptionTier).toBe('free');
  });

  it('a verified checkout event upgrades the organization', async () => {
    const { orgId } = await makeTenant('free');
    const res = await sendEvent(checkoutEvent('evt_1', orgId, 'pro'));
    expect(res.status).toBe(200);
    const org = await Organization.findById(orgId);
    expect(org?.subscriptionTier).toBe('pro');
    expect(org?.subscriptionStatus).toBe('active');
  });

  it('the same event delivered twice is applied once', async () => {
    const { orgId } = await makeTenant('free');
    await sendEvent(checkoutEvent('evt_dup', orgId, 'pro'));
    // someone downgrades in between; a replay must not undo that
    await Organization.updateOne({ _id: orgId }, { subscriptionTier: 'free' });
    const replay = await sendEvent(checkoutEvent('evt_dup', orgId, 'pro'));
    expect(replay.status).toBe(200);
    expect((await Organization.findById(orgId))?.subscriptionTier).toBe('free');
    expect(await ProcessedStripeEvent.countDocuments({ eventId: 'evt_dup' })).toBe(1);
  });

  it('a failed payment lowers the effective limits without changing the stored tier', async () => {
    const { owner, org, orgId } = await makeTenant('pro');
    await Organization.updateOne({ _id: org._id }, { stripeCustomerId: 'cus_1' });
    const res = await sendEvent({
      id: 'evt_fail',
      object: 'event',
      type: 'invoice.payment_failed',
      data: { object: { customer: 'cus_1' } },
    });
    expect(res.status).toBe(200);
    const fresh = await Organization.findById(orgId);
    expect(fresh?.subscriptionTier).toBe('pro');
    expect(fresh?.subscriptionStatus).toBe('past_due');
    // free-tier project limit (3) now applies
    for (let i = 0; i < 3; i++) {
      await api().post(`/api/organizations/${orgId}/projects`).set(bearer(owner)).send({ name: `P${i}` });
    }
    expect((await api().post(`/api/organizations/${orgId}/projects`).set(bearer(owner)).send({ name: 'P4' })).status).toBe(403);
  });

  it('a subscription deletion moves the organization to free', async () => {
    const { org, orgId } = await makeTenant('business');
    await Organization.updateOne({ _id: org._id }, { stripeCustomerId: 'cus_2' });
    await sendEvent({ id: 'evt_del', object: 'event', type: 'customer.subscription.deleted', data: { object: { customer: 'cus_2' } } });
    const fresh = await Organization.findById(orgId);
    expect(fresh?.subscriptionTier).toBe('free');
    expect(fresh?.subscriptionStatus).toBe('canceled');
  });
});

// CONCEPT: webhook-idempotency (KL-10). A claim records that an event is
// being handled; it must not hide an event whose handling never finished.
describe('KL-10: webhook claims survive a crash', () => {
  const STALE_MINUTES = 10; // well past the take-over window

  it('a finished event is marked done', async () => {
    const { orgId } = await makeTenant('free');
    await sendEvent(checkoutEvent('evt_done', orgId, 'pro'));
    const claim = await ProcessedStripeEvent.findOne({ eventId: 'evt_done' });
    expect(claim?.status).toBe('done');
  });

  it('an old unfinished claim (crashed handler) is taken over and the event is applied', async () => {
    const { orgId } = await makeTenant('free');
    await ProcessedStripeEvent.collection.insertOne({
      eventId: 'evt_crashed',
      status: 'processing',
      claimedAt: new Date(Date.now() - STALE_MINUTES * 60 * 1000),
      createdAt: new Date(),
    });
    const res = await sendEvent(checkoutEvent('evt_crashed', orgId, 'pro'));
    expect(res.status).toBe(200);
    expect((await Organization.findById(orgId))?.subscriptionTier).toBe('pro');
    expect((await ProcessedStripeEvent.findOne({ eventId: 'evt_crashed' }))?.status).toBe('done');
  });

  it('a fresh unfinished claim (another delivery in flight) is not applied twice: answers 409 so Stripe retries', async () => {
    const { orgId } = await makeTenant('free');
    await ProcessedStripeEvent.collection.insertOne({
      eventId: 'evt_inflight',
      status: 'processing',
      claimedAt: new Date(),
      createdAt: new Date(),
    });
    const res = await sendEvent(checkoutEvent('evt_inflight', orgId, 'pro'));
    expect(res.status).toBe(409);
    expect((await Organization.findById(orgId))?.subscriptionTier).toBe('free');
  });

  it('a claim from before the status field existed counts as done', async () => {
    const { orgId } = await makeTenant('free');
    await ProcessedStripeEvent.collection.insertOne({ eventId: 'evt_legacy', createdAt: new Date() });
    const res = await sendEvent(checkoutEvent('evt_legacy', orgId, 'pro'));
    expect(res.status).toBe(200);
    expect((await Organization.findById(orgId))?.subscriptionTier).toBe('free');
  });

  it('a handler that fails releases its claim so the retry is processed', async () => {
    // a checkout event for an organization ID that is not a valid ObjectId makes the handler throw
    const res = await sendEvent(checkoutEvent('evt_fails', 'not-an-object-id', 'pro'));
    expect(res.status).toBe(400);
    expect(await ProcessedStripeEvent.countDocuments({ eventId: 'evt_fails' })).toBe(0);
    expect(mongoose.connection.readyState).toBe(1);
  });
});
