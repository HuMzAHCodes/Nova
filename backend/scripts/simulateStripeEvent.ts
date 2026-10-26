import 'dotenv/config';
import Stripe from 'stripe';

// Testing tool: builds a Stripe-shaped webhook event for an EXISTING customer,
// signs it with the real STRIPE_WEBHOOK_SECRET, and posts it to the local
// server. The server handles it exactly like a real delivery (signature
// check, idempotency claim, handler), so billing state transitions can be
// tested for a specific organization without waiting for Stripe.
//
// Usage (from the backend folder):
//   npx tsx scripts/simulateStripeEvent.ts <eventType> <customerId> [status]
//
// Examples:
//   npx tsx scripts/simulateStripeEvent.ts invoice.payment_failed cus_XXXX
//   npx tsx scripts/simulateStripeEvent.ts invoice.paid cus_XXXX
//   npx tsx scripts/simulateStripeEvent.ts customer.subscription.deleted cus_XXXX
//   npx tsx scripts/simulateStripeEvent.ts customer.subscription.updated cus_XXXX past_due
//
// Standalone on purpose: it does not import config/env.ts, so it never
// depends on the full set of server environment variables.

async function main(): Promise<void> {
  const [eventType, customerId, status] = process.argv.slice(2);

  if (!eventType || !customerId) {
    console.error('Usage: npx tsx scripts/simulateStripeEvent.ts <eventType> <customerId> [status]');
    process.exit(1);
  }

  const secretKey = process.env.STRIPE_SECRET_KEY;
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secretKey || !webhookSecret) {
    console.error('STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET must be set in .env');
    process.exit(1);
  }

  // The client is only used to build the signature header; no API call is made.
  const stripe = new Stripe(secretKey);

  // A unique ID per run, so the idempotency check treats each run as a new event.
  const eventId = `evt_sim_${Date.now()}`;

  const payload = JSON.stringify({
    id: eventId,
    object: 'event',
    type: eventType,
    data: {
      object: {
        customer: customerId,
        ...(status ? { status } : {}),
      },
    },
  });

  const signature = stripe.webhooks.generateTestHeaderString({
    payload,
    secret: webhookSecret,
  });

  const port = process.env.PORT ?? '5000';
  const url = `http://localhost:${port}/api/webhooks/stripe`;

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Stripe-Signature': signature,
    },
    body: payload,
  });

  console.log(`${eventType} (${eventId}) -> ${response.status} ${await response.text()}`);
}

main().catch((error) => {
  console.error('Simulation failed:', error);
  process.exit(1);
});
