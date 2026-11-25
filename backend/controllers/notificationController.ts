import { Response } from 'express';
import { TenantScopedRequest } from '../middleware/scopeToTenant.js';
import { catchAsync } from '../lib/catchAsync.js';
import { sendSuccess } from '../lib/response.js';
import { paginationQuerySchema, sinceSchema } from '../validators/paginationValidators.js';
import * as notificationService from '../services/notificationService.js';

// CONCEPT: notifications. Every handler uses the user id and organization
// id from the verified token; nothing identifying the owner of a
// notification is ever read from the URL or the body.

// FLOW: GET /api/notifications?page=&limit=&unread=true&since=
export const listNotifications = catchAsync(async (req: TenantScopedRequest, res: Response) => {
  const query = paginationQuerySchema.parse(req.query);
  const unreadOnly = req.query.unread === 'true';
  // CONCEPT: reconnect-handling. Optional catch-up time; invalid values answer 400.
  const since = sinceSchema.parse(req.query.since);
  const { notifications, pagination } = await notificationService.listForUser(
    req.tenantId!,
    req.user!._id,
    query,
    unreadOnly,
    since
  );
  res.status(200).json({ success: true, data: { notifications }, pagination });
});

export const getUnreadCount = catchAsync(async (req: TenantScopedRequest, res: Response) => {
  const count = await notificationService.countUnread(req.tenantId!, req.user!._id);
  sendSuccess(res, { count });
});

export const markNotificationRead = catchAsync(async (req: TenantScopedRequest, res: Response) => {
  const notification = await notificationService.markRead(req.tenantId!, req.user!._id, req.params.notificationId);
  sendSuccess(res, { notification });
});

export const markAllNotificationsRead = catchAsync(async (req: TenantScopedRequest, res: Response) => {
  const updatedCount = await notificationService.markAllRead(req.tenantId!, req.user!._id);
  sendSuccess(res, { updatedCount });
});
