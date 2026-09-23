import { Router } from 'express';
import { scopeToTenant } from '../middleware/scopeToTenant.js';
import { requireRole } from '../middleware/requireRole.js';
import { inviteClient } from '../controllers/clientInviteController.js';

// CONCEPT: client-portal-backend (client invite flow). This is an
// INTERNAL route (uses requireRole, not scopeToClientProject) — it's how
// an Owner/Admin grants a Client access, not something a Client calls
// themselves. Deliberately restricted to Owner/Admin only, not
// Managers-via-override — inviting external parties is sensitive enough
// to keep at the org-level role check, per the concept doc.
const router = Router();

router.post('/projects/:projectId/client-invites', scopeToTenant, requireRole('owner', 'admin'), inviteClient);

export default router;