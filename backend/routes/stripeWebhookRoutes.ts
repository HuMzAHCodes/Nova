import { Router } from 'express';
import express from 'express';
import { handleStripeWebhook } from '../controllers/billingController.js';

const router = Router();

// express.raw(), NOT express.json() — signature verification needs the
// exact raw request bytes. See stripe-billing concept notes.
router.post('/', express.raw({ type: 'application/json' }), handleStripeWebhook);

export default router;