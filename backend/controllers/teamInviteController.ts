import { Response } from 'express';
import { catchAsync } from '../lib/catchAsync.js';
import { sendSuccess } from '../lib/response.js';
import { TenantScopedRequest } from '../middleware/scopeToTenant.js';
import { teamInviteSchema } from '../validators/teamInviteValidators.js';
import { inviteTeamMember } from '../services/teamInviteService.js';

export const inviteTeamMemberHandler = catchAsync(async (req: TenantScopedRequest, res: Response) => {
  const input = teamInviteSchema.parse(req.body);
  const user = await inviteTeamMember(req.user!.organizationId, input);
  // CONCEPT: response-shaping. Only named, public fields leave the API. The
  // service returns the whole User document (hash and token fields included),
  // so the controller picks what the caller may see instead of sending it all.
  sendSuccess(res, { user: { id: user._id, email: user.email, name: user.name, role: user.role } }, 201);
});