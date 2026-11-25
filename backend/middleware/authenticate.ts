import { Response, NextFunction } from 'express';
import { verifyAccessToken } from '../lib/jwt.js';
import { TenantScopedRequest } from './scopeToTenant.js';
import Session from '../models/Session.js';

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
//
// CONCEPT: sessions-and-token-revocation. A valid signature is not enough any
// more: the token names a Session record, and the request is refused unless
// that record still exists, belongs to the same user and has not expired.
// This one indexed read per request is what lets logout take effect at once.
export async function authenticate(req: TenantScopedRequest, res: Response, next: NextFunction): Promise<void> {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ success: false, error: 'No access token provided' });
    return;
  }

  const token = authHeader.split(' ')[1];

  try {
    const payload = verifyAccessToken(token);
    const sessionExists = await Session.exists({
      _id: payload.sessionId,
      userId: payload.userId,
      expiresAt: { $gt: new Date() },
    });
    if (!sessionExists) {
      res.status(401).json({ success: false, error: 'Invalid or expired access token' });
      return;
    }
    // Populate req.user with exactly the shape scopeToTenant already
    // expects (see middleware/scopeToTenant.ts's TenantScopedRequest
    // interface) — _id, organizationId, role.
    req.user = {
      _id: payload.userId,
      organizationId: payload.organizationId,
      role: payload.role,
    };
    next();
  } catch {
    // jwt.verify() throws for BOTH an invalid signature (tampered/forged
    // token) and an expired token — either way, the client's response is
    // the same: reject with 401, prompting the frontend to attempt a
    // silent refresh via /auth/refresh.
    res.status(401).json({ success: false, error: 'Invalid or expired access token' });
  }
}