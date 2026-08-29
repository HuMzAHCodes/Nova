import { Router } from 'express';
import { register, login, refresh, logout } from '../controllers/authController.js';
import { loginRateLimit } from '../middleware/loginRateLimit.js';

// CONCEPT: route files contain ONLY path → middleware → controller wiring
// (see BACKEND_PRACTICES.md). None of these routes use `authenticate` or
// `scopeToTenant` — that's deliberate: a user hitting /auth/login isn't
// authenticated YET, that's the whole point of this endpoint existing.

const router = Router();

router.post('/register', register);

// loginRateLimit is applied ONLY here, not on register/refresh/logout —
// see docs/concepts/jwt-auth-design for why login specifically is the
// highest-value target for brute-force/credential-stuffing attacks.
router.post('/login', loginRateLimit, login);

router.post('/refresh', refresh);
router.post('/logout', logout);

export default router;