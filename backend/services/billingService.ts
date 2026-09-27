import Stripe from 'stripe';
import stripe from '../config/stripe.js';
import env from '../config/env.js';
import Organization from '../models/Organization.js';
import { AppError } from '../lib/AppError.js';

const TIER_PRICE_IDS: Record<'pro' | 'business', string> = {
  pro: env.STRIPE_PRICE_ID_PRO,
  business: env.STRIPE_PRICE_ID_BUSINESS,
};

// FLOW: called by billingController.createCheckoutSessionHandler,
// Owner-only. Creates (or reuses) a Stripe Customer for this
// organization, then a Checkout Session for the requested tier's Price.
export async function createCheckoutSession(organizationId: string, tier: 'pro' | 'business'): Promise<string> {
  const organization = await Organization.findById(organizationId);
  if (!organization) {
    throw new AppError(404, 'Organization not found');
  }

  let customerId = organization.stripeCustomerId;
  if (!customerId) {
    const customer = await stripe.customers.create({
      name: organization.name,
      metadata: { organizationId: String(organization._id) },
    });
    customerId = customer.id;
    organization.stripeCustomerId = customerId;
    await organization.save();
  }

  const session = await stripe.checkout.sessions.create({
    mode: 'subscription',
    customer: customerId,
    line_items: [{ price: TIER_PRICE_IDS[tier], quantity: 1 }],
    success_url: `${env.FRONTEND_URL}/billing/success`,
    cancel_url: `${env.FRONTEND_URL}/billing/cancel`,
    metadata: { organizationId: String(organization._id), tier },
  });

  if (!session.url) {
    throw new AppError(500, 'Failed to create Stripe checkout session');
  }

  return session.url;
}

// FLOW: called by billingController.createPortalSessionHandler,
// Owner-only. Lets a subscriber manage/cancel their own subscription via
// Stripe's hosted portal — no billing-management UI needed on our side.
export async function createPortalSession(organizationId: string): Promise<string> {
  const organization = await Organization.findById(organizationId);
  if (!organization || !organization.stripeCustomerId) {
    throw new AppError(400, 'This organization has no billing account yet');
  }

  const portalSession = await stripe.billingPortal.sessions.create({
    customer: organization.stripeCustomerId,
    return_url: `${env.FRONTEND_URL}/billing`,
  });

  return portalSession.url;
}

// CONCEPT: stripe-billing. Stripe is the source of truth — this function
// is the ONLY place subscriptionTier/subscriptionStatus are ever
// written, and it only runs in response to a verified webhook event,
// never a direct client action. See the concept notes for why.
export async function handleWebhookEvent(event: Stripe.Event): Promise<void> {
  switch (event.type) {
    case 'checkout.session.completed': {
      const session = event.data.object as Stripe.Checkout.Session;
      const organizationId = session.metadata?.organizationId;
      const tier = session.metadata?.tier as 'pro' | 'business' | undefined;
      if (!organizationId || !tier) break;

      await Organization.findByIdAndUpdate(organizationId, {
        subscriptionTier: tier,
        subscriptionStatus: 'active',
      });
      break;
    }

    case 'customer.subscription.updated': {
      const subscription = event.data.object as Stripe.Subscription;
      const organization = await Organization.findOne({ stripeCustomerId: subscription.customer as string });
      if (!organization) break;

      organization.subscriptionStatus = subscription.status as 'active' | 'canceled' | 'past_due';
      await organization.save();
      break;
    }

    case 'customer.subscription.deleted': {
      const subscription = event.data.object as Stripe.Subscription;
      const organization = await Organization.findOne({ stripeCustomerId: subscription.customer as string });
      if (!organization) break;

      organization.subscriptionTier = 'free';
      organization.subscriptionStatus = 'canceled';
      await organization.save();
      break;
    }

    default:
      // Unhandled event types are ignored deliberately — Stripe sends
      // many event types; only reacting to the ones we've designed for
      // keeps this handler focused rather than silently mishandling
      // events we haven't thought through.
      break;
  }
}