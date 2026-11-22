import { Router } from 'express';
import { scopeToTenant } from '../middleware/scopeToTenant.js';
import {
  listNotifications,
  getUnreadCount,
  markNotificationRead,
  markAllNotificationsRead,
} from '../controllers/notificationController.js';

// CONCEPT: notifications. Every signed-in user (including clients) has
// their own notifications, so there is no role check here: the data is
// scoped to the caller by userId and organizationId instead.
const router = Router();

router.get('/', scopeToTenant, listNotifications);
router.get('/unread-count', scopeToTenant, getUnreadCount);
// Fixed paths come before the parameterized one.
router.patch('/read-all', scopeToTenant, markAllNotificationsRead);
router.patch('/:notificationId/read', scopeToTenant, markNotificationRead);

export default router;
