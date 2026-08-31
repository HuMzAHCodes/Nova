import { Router } from 'express';
import { scopeToTenant } from '../middleware/scopeToTenant.js';
import { requireRole } from '../middleware/requireRole.js';
import { requireProjectRole } from '../middleware/requireProjectRole.js';
import {
  createProject,
  listProjects,
  getProject,
  updateProject,
  deleteProject,
} from '../controllers/projectController.js';

const router = Router();

// Creating a project and listing all projects in an org are ORG-level
// actions (not scoped to one existing project yet), so requireRole is
// the right check here — requireProjectRole wouldn't make sense since
// there's no specific :projectId to check an override against.
router.post('/organizations/:orgId/projects', scopeToTenant, requireRole('owner', 'admin'), createProject);
router.get('/organizations/:orgId/projects', scopeToTenant, requireRole('owner', 'admin', 'member'), listProjects);

// Reading a single project: any org member can view it (no override
// needed to just look).
router.get('/projects/:projectId', scopeToTenant, requireRole('owner', 'admin', 'member'), getProject);

// Updating/deleting a SPECIFIC project: this is exactly the case
// requireProjectRole exists for — an org-level Admin can always do this,
// but so can a plain Member who holds a 'manager' override on THIS
// specific project (e.g. Aisha on Redesign, per the worked example in
// the concept notes), even though her org-level role alone wouldn't
// qualify her.
router.patch('/projects/:projectId', scopeToTenant, requireProjectRole('owner', 'admin', 'manager'), updateProject);
router.delete('/projects/:projectId', scopeToTenant, requireProjectRole('owner', 'admin'), deleteProject);

export default router;