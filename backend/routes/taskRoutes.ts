import { Router } from 'express';
import { scopeToTenant } from '../middleware/scopeToTenant.js';
import { requireRole } from '../middleware/requireRole.js';
import { requireProjectRole } from '../middleware/requireProjectRole.js';
import { resolveProjectIdFromTask } from '../middleware/resolveProjectIdFromTask.js';
import { createTask, listTasks, getTask, updateTask, deleteTask } from '../controllers/taskController.js';

// CONCEPT: task-model-design — every route here reuses the EXACT SAME
// requireProjectRole middleware already built for Project routes. No new
// permission-checking code exists anywhere for Task — this router is the
// concrete proof that the "Task inherits Project's permissions" design
// decision required zero new authorization logic to implement. The only
// new piece is resolveProjectIdFromTask, a small bridge (not a
// permission check itself) needed because flattened task routes don't
// carry :projectId directly — see that file's comments.

const router = Router();

// Creating/listing tasks are actions on an EXISTING, project-nested
// route — :projectId is already in the URL here, so requireProjectRole
// works exactly as it does for Project routes, no resolver needed.
router.post('/projects/:projectId/tasks', scopeToTenant, requireProjectRole('owner', 'admin', 'manager'), createTask);
router.get('/projects/:projectId/tasks', scopeToTenant, requireRole('owner', 'admin', 'member'), listTasks);

// Flattened routes (no :projectId in the path) — per rest-crud-design's
// one-level-of-nesting rule. Reading a single task: any org member can
// view it, matching getProject's permission level — no resolver needed
// here since requireRole doesn't look at :projectId at all.
router.get('/tasks/:taskId', scopeToTenant, requireRole('owner', 'admin', 'member'), getTask);

// Updating/deleting a task DOES need requireProjectRole (an org-level
// Admin, or a Manager override on the task's OWN project, should be able
// to act on it) — resolveProjectIdFromTask runs first to look up the
// task and inject its projectId into req.params, so requireProjectRole
// can then run completely unchanged.
router.patch(
  '/tasks/:taskId',
  scopeToTenant,
  resolveProjectIdFromTask,
  requireProjectRole('owner', 'admin', 'manager'),
  updateTask
);
router.delete(
  '/tasks/:taskId',
  scopeToTenant,
  resolveProjectIdFromTask,
  requireProjectRole('owner', 'admin'),
  deleteTask
);

export default router;