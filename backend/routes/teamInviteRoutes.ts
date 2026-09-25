import { Router } from 'express';
import { scopeToTenant } from '../middleware/scopeToTenant.js';
import { requireRole } from '../middleware/requireRole.js';
import { inviteTeamMemberHandler } from '../controllers/teamInviteController.js';

const router = Router({ mergeParams: true });

// Owner-only — see team-member-invite concept notes on why invite
// permission isn't opened up to Admins yet (privilege-escalation shape).
router.post('/organizations/:orgId/team/invite', scopeToTenant, requireRole('owner'), inviteTeamMemberHandler);

export default router;