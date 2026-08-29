import { Request, Response, NextFunction } from 'express';
import { verifyAccessToken } from '../lib/jwt.js';
import { TenantScopedRequest } from './scopeToTenant.js';

// CONCEPT: jwt-auth-design (see docs/concepts/jwt-auth-design). This is
// the middleware that finally makes req.user REAL — every other
// middleware/controller built so far (scopeToTenant, scopeToClientProject,
// every existing controller) has been reading req.user as a placeholder;
// this is the one piece that actually populates it, from a verified JWT.
//
// FLOW: must run BEFORE scopeToTenant on every protected route.
//   1. Reads the access token from the Authorization header
//      (format: "Authorization: Bearer <token>")
//   2. Verifies it (signature + expiry, both checked in one call —
//      see lib/jwt.ts) — throws if either check fails
//   3. Populates req.user with the decoded payload
//   4. scopeToTenant (registered after this) then reads req.user.organizationId
//      exactly as it already does today — no changes needed there.
export function authenticate(req: TenantScopedRequest, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ success: false, error: 'No access token provided' });
    return;
  }

  const token = authHeader.split(' ')[1];

  try {
    const payload = verifyAccessToken(token);
    // Populate req.user with exactly the shape scopeToTenant already
    // expects (see middleware/scopeToTenant.ts's TenantScopedRequest
    // interface) — _id, organizationId, role.
    req.user = {
      _id: payload.userId,
      organizationId: payload.organizationId,
      role: payload.role,
    };
    next();
  } catch (err) {
    // jwt.verify() throws for BOTH an invalid signature (tampered/forged
    // token) and an expired token — either way, the client's response is
    // the same: reject with 401, prompting the frontend to attempt a
    // silent refresh via /auth/refresh.
    res.status(401).json({ success: false, error: 'Invalid or expired access token' });
  }
}