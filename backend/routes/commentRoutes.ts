import { Router } from 'express';
import { scopeToTenant } from '../middleware/scopeToTenant.js';
import { requireRole } from '../middleware/requireRole.js';
import {
  createComment,
  listComments,
  updateComment,
  deleteComment,
  listMentionableUsers,
} from '../controllers/commentController.js';

// CONCEPT: comments. Staff endpoints. Any member of the organization may read
// and write comments on its tasks (the same level as reading a task). Who may
// edit or delete a specific comment is decided in the service, because it
// depends on the comment's author. Client endpoints arrive with the
// visibility step.
const router = Router();

router.post('/tasks/:taskId/comments', scopeToTenant, requireRole('owner', 'admin', 'member'), createComment);
router.get('/tasks/:taskId/comments', scopeToTenant, requireRole('owner', 'admin', 'member'), listComments);
router.get('/projects/:projectId/mentionable', scopeToTenant, requireRole('owner', 'admin', 'member'), listMentionableUsers);
router.patch('/comments/:commentId', scopeToTenant, requireRole('owner', 'admin', 'member'), updateComment);
router.delete('/comments/:commentId', scopeToTenant, requireRole('owner', 'admin', 'member'), deleteComment);

export default router;
