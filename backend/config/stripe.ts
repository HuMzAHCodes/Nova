import Stripe from 'stripe';
import env from './env.js';

// A single, reused Stripe client instance — every service function
// imports this rather than constructing its own client.
const stripe = new Stripe(env.STRIPE_SECRET_KEY);

export default stripe;