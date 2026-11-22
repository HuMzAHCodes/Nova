import { Router } from 'express';
import { scopeToTenant } from '../middleware/scopeToTenant.js';
import { requireRole } from '../middleware/requireRole.js';
import { getOrganization, updateOrganization } from '../controllers/organizationController.js';

// CONCEPT: route files contain ONLY path → middleware → controller wiring
// (see BACKEND_PRACTICES.md). No logic of any kind lives here.
//
// CONCEPT: RBAC middleware (see docs/concepts/rbac-middleware) — every
// route's full middleware chain is spelled out explicitly here, rather
// than hidden behind a bundled composite like requireOrgAdmin. See the
// concept notes for why: explicitness over convenience, matching the
// rest of this codebase's style.

const router = Router();


// VIEWING org details: any authenticated member of the org (owner,
// admin, or member — Client still excluded) can see basic org info like
// name and subscription tier. Only scopeToTenant's org-ID-mismatch check
// applies here — no role restriction beyond "you belong to this org."
router.get('/:orgId', scopeToTenant, requireRole('owner', 'admin', 'member'), getOrganization);

// EDITING org settings (the name only; billing fields are never editable
// here, see billing-field-protection) is Owner/Admin only —
// a regular Member can see the settings but not change them.
router.patch('/:orgId', scopeToTenant, requireRole('owner', 'admin'), updateOrganization);

export default router;