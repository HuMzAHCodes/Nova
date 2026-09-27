import { Request, Response } from 'express';
import Stripe from 'stripe';
import { catchAsync } from '../lib/catchAsync.js';
import { sendSuccess } from '../lib/response.js';
import { AppError } from '../lib/AppError.js';
import { TenantScopedRequest } from '../middleware/scopeToTenant.js';
import stripe from '../config/stripe.js';
import env from '../config/env.js';
import { createCheckoutSessionSchema } from '../validators/billingValidators.js';
import { createCheckoutSession, createPortalSession, handleWebhookEvent } from '../services/billingService.js';

export const createCheckoutSessionHandler = catchAsync(async (req: TenantScopedRequest, res: Response) => {
  const { tier } = createCheckoutSessionSchema.parse(req.body);
  const url = await createCheckoutSession(req.user!.organizationId, tier);
  sendSuccess(res, { url });
});

export const createPortalSessionHandler = catchAsync(async (req: TenantScopedRequest, res: Response) => {
  const url = await createPortalSession(req.user!.organizationId);
  sendSuccess(res, { url });
});

// CONCEPT: stripe-billing. req.body here is a raw Buffer, not parsed
// JSON — see routes/stripeWebhookRoutes.ts and app.ts for why this route
// specifically bypasses express.json(). Signature verification needs
// those exact raw bytes.
export const handleStripeWebhook = catchAsync(async (req: Request, res: Response) => {
  const signature = req.headers['stripe-signature'];
  if (!signature) {
    throw new AppError(400, 'Missing Stripe signature header');
  }

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(req.body, signature, env.STRIPE_WEBHOOK_SECRET);
  } catch {
    throw new AppError(400, 'Invalid Stripe webhook signature');
  }

  await handleWebhookEvent(event);

  res.status(200).json({ received: true });
});