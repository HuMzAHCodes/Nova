import { Router } from 'express';
import { scopeToTenant } from '../middleware/scopeToTenant.js';
import {
  createProject,
  listProjects,
  getProject,
  updateProject,
  deleteProject,
} from '../controllers/projectController.js';

const router = Router();

// These two routes are nested under /organizations/:orgId (see how this
// router gets mounted in app.ts) — scopeToTenant checks :orgId against
// req.tenantId for both.
router.post('/organizations/:orgId/projects', scopeToTenant, createProject);
router.get('/organizations/:orgId/projects', scopeToTenant, listProjects);

// These three are flattened (no :orgId in the path) — see rest-crud-design
// concept for why. scopeToTenant still runs (every protected route needs
// it to establish req.tenantId from the JWT), it just has no :orgId to
// cross-check here; tenant safety is instead enforced inside
// projectService (every query filters by organizationId too).
router.get('/projects/:projectId', scopeToTenant, getProject);
router.patch('/projects/:projectId', scopeToTenant, updateProject);
router.delete('/projects/:projectId', scopeToTenant, deleteProject);

export default router;