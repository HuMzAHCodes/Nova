import { Router } from 'express';
import { scopeToTenant } from '../middleware/scopeToTenant.js';
import { requireRole } from '../middleware/requireRole.js';
import { createCheckoutSessionHandler, createPortalSessionHandler } from '../controllers/billingController.js';

const router = Router({ mergeParams: true });

router.post('/organizations/:orgId/billing/checkout-session', scopeToTenant, requireRole('owner'), createCheckoutSessionHandler);
router.post('/organizations/:orgId/billing/portal-session', scopeToTenant, requireRole('owner'), createPortalSessionHandler);

export default router;