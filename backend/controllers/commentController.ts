import { Response } from 'express';
import { TenantScopedRequest } from '../middleware/scopeToTenant.js';
import { catchAsync } from '../lib/catchAsync.js';
import { sendSuccess } from '../lib/response.js';
import { createCommentSchema, updateCommentSchema, threadQuerySchema } from '../validators/commentValidators.js';
import * as commentService from '../services/commentService.js';

// CONCEPT: comments. The author is always the signed-in user; no author,
// organization or project id is ever read from the request body.
const actorFrom = (req: TenantScopedRequest) => ({ userId: req.user!._id, role: req.user!.role });

// FLOW: POST /api/tasks/:taskId/comments
export const createComment = catchAsync(async (req: TenantScopedRequest, res: Response) => {
  const input = createCommentSchema.parse(req.body);
  const comment = await commentService.create(req.tenantId!, req.params.taskId, actorFrom(req), input);
  sendSuccess(res, { comment }, 201);
});

// FLOW: GET /api/tasks/:taskId/comments?page=&limit=
export const listComments = catchAsync(async (req: TenantScopedRequest, res: Response) => {
  const query = threadQuerySchema.parse(req.query);
  const { comments, pagination } = await commentService.listForTask(req.tenantId!, req.params.taskId, query);
  res.status(200).json({ success: true, data: { comments }, pagination });
});

// FLOW: PATCH /api/comments/:commentId
export const updateComment = catchAsync(async (req: TenantScopedRequest, res: Response) => {
  const input = updateCommentSchema.parse(req.body);
  const comment = await commentService.update(req.tenantId!, req.params.commentId, actorFrom(req), input);
  sendSuccess(res, { comment });
});

// FLOW: DELETE /api/comments/:commentId
export const deleteComment = catchAsync(async (req: TenantScopedRequest, res: Response) => {
  await commentService.remove(req.tenantId!, req.params.commentId, actorFrom(req));
  sendSuccess(res, null, 204);
});
