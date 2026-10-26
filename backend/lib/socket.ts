import { Server, Socket } from 'socket.io';
import http from 'http';
import { verifyAccessToken } from './jwt.js';
import User from '../models/User.js';
import Project from '../models/Project.js';

let io: Server | null = null;

// A MongoDB ObjectId is a 24-character hex string. Checked before any
// database query so a malformed, client-supplied value can never reach
// Mongoose and throw a cast error inside an event handler.
const OBJECT_ID_PATTERN = /^[0-9a-fA-F]{24}$/;

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
    //
    // The whole handler is wrapped in try/catch: an error thrown inside
    // an async event handler is an unhandled promise rejection, which
    // can take the whole server process down. A failed join simply
    // means the client does not get the room.
    socket.on('joinProject', async (projectId: string) => {
      try {
        const hasAccess = await userHasProjectAccess(socket.data.user, projectId);
        if (hasAccess) {
          socket.join(`project:${projectId}`);
        }
      } catch (error) {
        console.error('joinProject failed:', error);
      }
    });
  });

  return io;
}

// CONCEPT: socketio-realtime-deliverables. Lets service-layer code (e.g.
// taskService.approveDeliverable) emit events without importing the
// Socket.io setup logic directly — a thin accessor, not a new place
// business logic lives.
export function getIO(): Server {
  if (!io) {
    throw new Error('Socket.io has not been initialized yet');
  }
  return io;
}

// CONCEPT: socketio-realtime-deliverables (tenant isolation). Two layers,
// in this order:
//   1. The project must exist INSIDE the caller's own organization. This
//      applies to every role. Without it, an Owner or Admin of one
//      organization could join the room of a project in another
//      organization just by knowing its ID and receive that tenant's events.
//   2. Within the organization, Owner and Admin may join any project;
//      everyone else needs a per-project role on that specific project.
//
// NOTE: the second layer mirrors requireProjectRole's fast-path/slow-path
// shape, but is written separately because Express middleware cannot be
// reused inside a Socket.io event handler. Keep the two in sync if that
// logic ever changes.
async function userHasProjectAccess(
  user: { _id: string; organizationId: string; role: string },
  projectId: string
): Promise<boolean> {
  if (typeof projectId !== 'string' || !OBJECT_ID_PATTERN.test(projectId)) {
    return false;
  }

  const projectInOwnOrganization = await Project.exists({
    _id: projectId,
    organizationId: user.organizationId,
  });
  if (!projectInOwnOrganization) {
    return false;
  }

  if (user.role === 'owner' || user.role === 'admin') {
    return true; // org-level roles have access to every project in their org
  }

  const fullUser = await User.findById(user._id);
  if (!fullUser) return false;

  return fullUser.projectRoles.some((pr) => String(pr.projectId) === projectId);
}
