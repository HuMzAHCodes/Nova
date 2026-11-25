import { Server, Socket } from 'socket.io';
import http from 'http';
import { verifyAccessToken } from './jwt.js';
import User from '../models/User.js';
import Project from '../models/Project.js';
import ClientAccess from '../models/ClientAccess.js';
import Session from '../models/Session.js';
import { createInMemoryPresenceStore, visibleEntriesFor, PresenceStore } from './presence.js';

let io: Server | null = null;

// CONCEPT: presence. Room names for the two audiences of a project. The
// ordinary room holds staff and granted clients; the staff room holds staff
// only (the same room comment events use for internal comments).
const projectRoom = (projectId: string) => `project:${projectId}`;
const projectStaffRoom = (projectId: string) => `project:${projectId}:staff`;

// CONCEPT: presence. A client's arrival or departure is announced to staff
// only (other clients must never learn who else is a client); a staff
// member's is announced to everyone in the project.
const presenceAudienceRoom = (projectId: string, role: string) =>
  role === 'client' ? projectStaffRoom(projectId) : projectRoom(projectId);

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
  // CONCEPT: presence. One store per server; in-memory today, Redis later.
  const presenceStore: PresenceStore = createInMemoryPresenceStore();

  io.use(async (socket, next) => {
    const token = socket.handshake.auth?.token;
    if (!token) {
      return next(new Error('Authentication required'));
    }

    try {
      const payload = verifyAccessToken(token);
      // CONCEPT: sessions-and-token-revocation. Same rule as the HTTP
      // middleware: a valid signature is not enough, the session must exist.
      const sessionExists = await Session.exists({
        _id: payload.sessionId,
        userId: payload.userId,
        expiresAt: { $gt: new Date() },
      });
      if (!sessionExists) {
        return next(new Error('Invalid or expired token'));
      }
      socket.data.user = {
        _id: payload.userId,
        organizationId: payload.organizationId,
        role: payload.role,
      };
      socket.data.sessionId = payload.sessionId;
      next();
    } catch {
      next(new Error('Invalid or expired token'));
    }
  });

  io.on('connection', (socket: Socket) => {
    // CONCEPT: notifications. Every connection joins ONE private room named
    // after the user, using the id from the VERIFIED token. There is no
    // client event for joining it, so nothing the client sends can put it
    // in someone else's room (unlike joinProject, which takes a
    // client-supplied id and therefore needs an access check).
    socket.join(`user:${socket.data.user._id}`);

    // CONCEPT: sessions-and-token-revocation. One room per session, so ending
    // a session can close exactly the sockets that belong to it.
    socket.join(`session:${socket.data.sessionId}`);

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
          // CONCEPT: comments. Staff (not clients) also join the staff-only room
          // of the project; comment events are emitted there so a client who
          // shares the ordinary project room never receives them.
          if (socket.data.user.role !== 'client') {
            socket.join(`project:${projectId}:staff`);
          }
          await announceArrival(socket, projectId);
        }
      } catch (error) {
        console.error('joinProject failed:', error);
      }
    });

    // CONCEPT: presence. When the connection ends, every project this
    // socket had joined loses one socket; a person whose LAST socket just
    // went is announced as offline.
    socket.on('disconnect', async () => {
      const joinedProjects: Set<string> = socket.data.presenceProjects ?? new Set<string>();
      for (const projectId of joinedProjects) {
        try {
          const departed = await presenceStore.remove(projectId, socket.data.user._id, socket.id);
          if (departed) {
            io?.to(presenceAudienceRoom(projectId, departed.role)).emit('presence:update', {
              projectId,
              status: 'offline',
              user: departed,
            });
          }
        } catch (error) {
          console.error('presence removal failed:', error);
        }
      }
    });

    // CONCEPT: presence. Runs after a successful join. A failure here is
    // logged and ignored: presence is a bonus and must never undo the join.
    async function announceArrival(arrivingSocket: Socket, projectId: string) {
      try {
        const person = await User.findById(arrivingSocket.data.user._id).select('name');
        if (!person) return;
        const entry = {
          _id: String(person._id),
          name: person.name,
          role: arrivingSocket.data.user.role as string,
        };

        const joined: Set<string> = arrivingSocket.data.presenceProjects ?? new Set<string>();
        joined.add(projectId);
        arrivingSocket.data.presenceProjects = joined;
        // The socket may have closed while the lookup was running.
        if (arrivingSocket.disconnected) {
          await presenceStore.remove(projectId, entry._id, arrivingSocket.id);
          return;
        }

        const becamePresent = await presenceStore.add(projectId, entry, arrivingSocket.id);
        if (becamePresent) {
          arrivingSocket.to(presenceAudienceRoom(projectId, entry.role)).emit('presence:update', {
            projectId,
            status: 'online',
            user: entry,
          });
        }
        const everyone = await presenceStore.list(projectId);
        arrivingSocket.emit('presence:list', {
          projectId,
          users: visibleEntriesFor(entry, everyone),
        });
      } catch (error) {
        console.error('presence announcement failed:', error);
      }
    }
  });

  return io;
}

// CONCEPT: sessions-and-token-revocation. Closes every live socket that
// belongs to any of these sessions. Called after sessions are deleted
// (logout, log out everywhere, password reset, detected replay). Does nothing
// when Socket.io is not running (for example in tests that only use HTTP).
export function disconnectSessions(sessionIds: string[]): void {
  if (!io || sessionIds.length === 0) return;
  io.in(sessionIds.map((sessionId) => `session:${sessionId}`)).disconnectSockets(true);
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
//   2. Within the organization, Owner and Admin may join any project.
//   3. A Client may join only a project they hold a ClientAccess grant for
//      (CONCEPT: socketio-client-events). A grant of any permission is
//      enough, because receiving an update is the same as being able to view.
//   4. Everyone else needs a per-project role on that specific project.
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

  if (user.role === 'client') {
    const grant = await ClientAccess.exists({
      userId: user._id,
      organizationId: user.organizationId,
      projectId,
    });
    return grant !== null;
  }

  const fullUser = await User.findById(user._id);
  if (!fullUser) return false;

  return fullUser.projectRoles.some((pr) => String(pr.projectId) === projectId);
}
