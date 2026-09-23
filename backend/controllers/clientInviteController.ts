import { Response } from 'express';
import { TenantScopedRequest } from '../middleware/scopeToTenant.js';
import { catchAsync } from '../lib/catchAsync.js';
import { sendSuccess } from '../lib/response.js';
import { inviteClientSchema } from '../validators/clientInviteValidators.js';
import * as clientInviteService from '../services/clientInviteService.js';

// FLOW: POST /projects/:projectId/client-invites
//   → scopeToTenant confirms req.tenantId
//   → requireRole('owner', 'admin') — restricted at the route level
//     (see routes/clientInviteRoutes.ts), NOT checked in this controller
export const inviteClient = catchAsync(async (req: TenantScopedRequest, res: Response) => {
  const input = inviteClientSchema.parse(req.body);
  const { user, project } = await clientInviteService.inviteClient(req.tenantId!, req.params.projectId, input);

  sendSuccess(
    res,
    {
      message: `Invitation sent to ${user.email} for project "${project.name}"`,
      client: { id: user._id, email: user.email, name: user.name },
    },
    201
  );
});