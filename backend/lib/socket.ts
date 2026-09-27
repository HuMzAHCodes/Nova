import { Server, Socket } from 'socket.io';
import http from 'http';
import { verifyAccessToken } from './jwt.js';
import User from '../models/User.js';

let io: Server | null = null;

// CONCEPT: socketio-realtime-deliverables. Called once from server.ts,
// after the shared http.Server is created — see the concept notes on
// why Socket.io must attach to the SAME http.Server Express uses.
export function initializeSocket(httpServer: http.Server): Server {
  io = new Server(httpServer, {
    cors: { origin: true, credentials: true },
  });

  // CONCEPT: socketio-realtime-deliverables. Verified ONCE per
  // connection here, not per event — a WebSocket connection is
  // long-lived and stateful, unlike a REST request. See concept notes
  // for why re-verifying on every event would be redundant.
  io.use((socket, next) => {
    const token = socket.handshake.auth?.token;
    if (!token) {
      return next(new Error('Authentication required'));
    }

    try {
      const payload = verifyAccessToken(token);
      socket.data.user = {
        _id: payload.userId,
        organizationId: payload.organizationId,
        role: payload.role,
      };
      next();
    } catch {
      next(new Error('Invalid or expired token'));
    }
  });

  io.on('connection', (socket: Socket) => {
    // CONCEPT: socketio-realtime-deliverables. A client-declared room
    // name is never trusted at face value — this mirrors the same kind
    // of project-level authorization requireProjectRole enforces on
    // REST routes, just invoked manually here since Socket.io custom
    // events don't have Express-style route middleware.
    socket.on('joinProject', async (projectId: string) => {
      const hasAccess = await userHasProjectAccess(socket.data.user, projectId);
      if (hasAccess) {
        socket.join(`project:${projectId}`);
      }
    });
  });

  return io;
}

// CONCEPT: socketio-realtime-deliverables. Lets service-layer code (e.g.
// clientService.approveDeliverable) emit events without importing the
// Socket.io setup logic directly — a thin accessor, not a new place
// business logic lives.
export function getIO(): Server {
  if (!io) {
    throw new Error('Socket.io has not been initialized yet');
  }
  return io;
}

// NOTE: this mirrors requireProjectRole's fast-path/slow-path shape
// (org-level role check, then per-project override lookup) — but is
// written fresh here since Express middleware can't be reused directly
// inside a Socket.io event handler. Worth double-checking this against
// your actual requireProjectRole.ts to keep the two in sync if that
// logic ever changes.
async function userHasProjectAccess(
  user: { _id: string; organizationId: string; role: string },
  projectId: string
): Promise<boolean> {
  if (user.role === 'owner' || user.role === 'admin') {
    return true; // org-level roles have access to every project in their org
  }

  const fullUser = await User.findById(user._id);
  if (!fullUser) return false;

  return fullUser.projectRoles.some((pr) => String(pr.projectId) === projectId);
}