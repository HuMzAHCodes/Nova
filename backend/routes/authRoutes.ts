import { Router } from 'express';
import {
  register,
  login,
  refresh,
  logout,
  verifyEmail,
  requestPasswordReset,
  resetPassword,
} from '../controllers/authController.js';
import { loginRateLimit } from '../middleware/loginRateLimit.js';

// CONCEPT: route files contain ONLY path → middleware → controller wiring
// (see BACKEND_PRACTICES.md). None of these routes use `authenticate` or
// `scopeToTenant` — a user hitting any of these isn't authenticated YET,
// that's the whole point of this router existing.

const router = Router();

router.post('/register', register);

// loginRateLimit is applied ONLY here, not on the other routes — see
// docs/concepts/jwt-auth-design for why login specifically is the
// highest-value target for brute-force/credential-stuffing attacks.
router.post('/login', loginRateLimit, login);

router.post('/refresh', refresh);
router.post('/logout', logout);

// CONCEPT: email-verification-password-reset.
router.post('/verify-email', verifyEmail);
router.post('/forgot-password', requestPasswordReset);
router.post('/reset-password', resetPassword);

export default router;