import { Router } from 'express';
import { scopeToTenant } from '../middleware/scopeToTenant.js';
import { createOrganization, getOrganization, updateOrganization } from '../controllers/organizationController.js';

// CONCEPT: route files contain ONLY path → middleware → controller wiring
// (see BACKEND_PRACTICES.md). No logic of any kind lives here.

const router = Router();

// POST /api/organizations — no :orgId in the path yet (nothing to scope
// to — this is the endpoint that CREATES a new organization), so
// scopeToTenant here would fail since there's no existing org to match.
// Once real auth exists (Week 2), this route will instead need its own
// "authenticated but not yet org-scoped" check — flagged for revisiting then.
router.post('/', createOrganization);

// Routes below all include :orgId — scopeToTenant checks req.tenantId
// against it before the controller ever runs.
router.get('/:orgId', scopeToTenant, getOrganization);
router.patch('/:orgId', scopeToTenant, updateOrganization);

export default router;