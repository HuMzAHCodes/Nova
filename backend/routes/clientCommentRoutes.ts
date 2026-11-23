import { Router } from 'express';
import { scopeToTenant } from '../middleware/scopeToTenant.js';
import { requireRole } from '../middleware/requireRole.js';
import {
  createClientComment,
  listComments,
  listMentionableUsers,
  updateComment,
  deleteComment,
} from '../controllers/commentController.js';

// CONCEPT: comment-visibility. Client endpoints, mounted under /api/client.
// requireRole('client') matters here: the older client routes let staff
// through, but these must be used by clients only. Whether a client may touch
// a given task or comment (a deliverable of a project they hold a grant for,
// shared comments only, their own comments for edit and delete) is decided in
// commentService, in one place shared with the staff endpoints.
const router = Router();

router.post('/tasks/:taskId/comments', scopeToTenant, requireRole('client'), createClientComment);
router.get('/tasks/:taskId/comments', scopeToTenant, requireRole('client'), listComments);
router.get('/projects/:projectId/mentionable', scopeToTenant, requireRole('client'), listMentionableUsers);
router.patch('/comments/:commentId', scopeToTenant, requireRole('client'), updateComment);
router.delete('/comments/:commentId', scopeToTenant, requireRole('client'), deleteComment);

export default router;
