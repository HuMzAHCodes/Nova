import Stripe from 'stripe';
import stripe from '../config/stripe.js';
import env from '../config/env.js';
import Organization from '../models/Organization.js';
import { AppError } from '../lib/AppError.js';

const TIER_PRICE_IDS: Record<'pro' | 'business', string> = {
  pro: env.STRIPE_PRICE_ID_PRO,
  business: env.STRIPE_PRICE_ID_BUSINESS,
};

type OrganizationStatus = 'active' | 'canceled' | 'past_due';

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
// Stripe's hosted portal, so no billing-management UI is needed on our side.
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

// Stripe sends the customer as an ID string, an expanded object, or null
// depending on the event. We only ever need the ID.
function extractCustomerId(
  customer: string | Stripe.Customer | Stripe.DeletedCustomer | null
): string | null {
  if (!customer) return null;
  return typeof customer === 'string' ? customer : customer.id;
}

// CONCEPT: lapsed-payment-access-restriction. Stripe has more subscription
// statuses than our schema stores. Map each one onto our three values, or
// return null to leave the stored status unchanged. Saving an unmapped
// status would fail the schema enum and turn a webhook into a 500.
function mapStripeStatus(status: Stripe.Subscription.Status): OrganizationStatus | null {
  switch (status) {
    case 'active':
    case 'trialing':
      return 'active';
    case 'past_due':
    case 'unpaid':
      return 'past_due';
    case 'canceled':
    case 'incomplete_expired':
      return 'canceled';
    default:
      return null; // incomplete, paused: no change
  }
}

// CONCEPT: stripe-billing. Stripe is the source of truth. This function is
// the ONLY place subscriptionTier/subscriptionStatus are ever written, and
// it only runs in response to a verified webhook event, never a direct
// client action. See the concept notes for why.
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
      const customerId = extractCustomerId(subscription.customer);
      const status = mapStripeStatus(subscription.status);
      if (!customerId || !status) break;

      await Organization.findOneAndUpdate({ stripeCustomerId: customerId }, { subscriptionStatus: status });
      break;
    }

    case 'customer.subscription.deleted': {
      const subscription = event.data.object as Stripe.Subscription;
      const customerId = extractCustomerId(subscription.customer);
      if (!customerId) break;

      await Organization.findOneAndUpdate(
        { stripeCustomerId: customerId },
        { subscriptionTier: 'free', subscriptionStatus: 'canceled' }
      );
      break;
    }

    // CONCEPT: lapsed-payment-access-restriction. A failed renewal marks the
    // organization past_due (restricted immediately via getEffectiveTier);
    // a successful payment restores it to active. The stored tier is never
    // changed here, so recovery is automatic. Invoices carry no organizationId
    // metadata, so we look the organization up by stripeCustomerId.
    case 'invoice.payment_failed':
    case 'invoice.paid': {
      const invoice = event.data.object as Stripe.Invoice;
      const customerId = extractCustomerId(invoice.customer);
      if (!customerId) break;

      const status: OrganizationStatus = event.type === 'invoice.paid' ? 'active' : 'past_due';
      await Organization.findOneAndUpdate({ stripeCustomerId: customerId }, { subscriptionStatus: status });
      break;
    }

    default:
      // Unhandled event types are ignored deliberately. Stripe sends many
      // event types; only reacting to the ones we've designed for keeps
      // this handler focused rather than silently mishandling events we
      // haven't thought through.
      break;
  }
}