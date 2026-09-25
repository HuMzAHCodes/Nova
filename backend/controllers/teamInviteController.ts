import { Response } from 'express';
import { catchAsync } from '../lib/catchAsync.js';
import { sendSuccess } from '../lib/response.js';
import { TenantScopedRequest } from '../middleware/scopeToTenant.js';
import { teamInviteSchema } from '../validators/teamInviteValidators.js';
import { inviteTeamMember } from '../services/teamInviteService.js';

export const inviteTeamMemberHandler = catchAsync(async (req: TenantScopedRequest, res: Response) => {
  const input = teamInviteSchema.parse(req.body);
  const user = await inviteTeamMember(req.user!.organizationId, input);
  sendSuccess(res, { user }, 201);
});