import dotenv from 'dotenv';
import Stripe from 'stripe';

// Standalone setup script, run by hand whenever a fresh Stripe sandbox is
// created (sandboxes expire after 7 days). It creates the Pro and Business
// monthly prices in whichever sandbox STRIPE_SECRET_KEY points at, then
// prints the lines to paste into .env.
//
// This file deliberately does NOT import config/env.ts. The env schema
// requires the price IDs to exist before the app will boot, and this script
// is what creates them, so it reads STRIPE_SECRET_KEY straight from
// process.env instead.
dotenv.config();

interface TierToCreate {
  envVar: string;
  productName: string;
  unitAmountCents: number;
}

const TIERS: TierToCreate[] = [
  { envVar: 'STRIPE_PRICE_ID_PRO', productName: 'Nova Pro', unitAmountCents: 1900 },
  { envVar: 'STRIPE_PRICE_ID_BUSINESS', productName: 'Nova Business', unitAmountCents: 4900 },
];

async function main(): Promise<void> {
  const secretKey = process.env.STRIPE_SECRET_KEY;
  if (!secretKey) {
    console.error('STRIPE_SECRET_KEY is not set in .env');
    process.exit(1);
  }

  const stripe = new Stripe(secretKey);

  console.log('Creating prices in the Stripe sandbox...');
  console.log('');

  for (const tier of TIERS) {
    const price = await stripe.prices.create({
      unit_amount: tier.unitAmountCents,
      currency: 'usd',
      recurring: { interval: 'month' },
      product_data: { name: tier.productName },
    });

    // Printed rather than written into .env automatically, so a script
    // can never silently overwrite a file that holds secrets.
    console.log(`${tier.envVar}=${price.id}`);
  }

  console.log('');
  console.log('Paste the lines above into backend/.env, then restart the server.');
}

main().catch((err: unknown) => {
  console.error('Failed to create Stripe prices:', err);
  process.exit(1);
});