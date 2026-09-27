import http from 'http';
import app from './app.js';
import env from './config/env.js';
import { connectDB } from './config/db.js';
import { initializeSocket } from './lib/socket.js';

// This is the only file in the entire backend that actually starts a live
// server (calls httpServer.listen()). Every other file — app.ts, config/, routes/,
// etc. — only builds pieces; this file is where they're assembled and run.
async function startServer(): Promise<void> {
  // Connect to MongoDB first, and wait for it to succeed before accepting
  // any HTTP traffic. If this fails, connectDB() itself calls process.exit(1),
  // so startServer() never reaches httpServer.listen() with a broken DB connection.
  await connectDB();

  // CONCEPT: socketio-realtime-deliverables. An explicit http.Server is
  // created here instead of relying on app.listen() to create one
  // implicitly — Socket.io needs to attach to the SAME server instance
  // Express uses, not a separate one. See the concept notes for why
  // building the server this way, rather than calling app.listen()
  // directly, is required once Socket.io is in the picture.
  const httpServer = http.createServer(app);
  initializeSocket(httpServer);

  // Number(env.PORT) — env.PORT is validated as a numeric *string* in env.ts
  // (since all environment variables arrive as strings), so it's converted
  // to an actual number here, right where the server needs it.
  httpServer.listen(Number(env.PORT), () => {
    console.log(`Nova backend running on port ${env.PORT} [${env.NODE_ENV}]`);
  });
}

// Actually invokes the function above. Nothing above this line runs on its own —
// without this call, startServer would just be a defined-but-never-executed function.
startServer();

/**
 * ─────────────────────────────────────────────────────────────
 * CONCEPT SUMMARY (for anyone reading this file)
 * ─────────────────────────────────────────────────────────────
 * What this file does:
 *   The entrypoint of the backend. Connects to the database, then
 *   starts the HTTP server (with Socket.io attached to it) — in
 *   that order, deliberately.
 *
 * Why order matters here:
 *   Starting the server before the DB is connected would let it
 *   accept requests it can't actually fulfill (anything touching
 *   the database would fail unpredictably). Waiting for connectDB()
 *   to succeed first guarantees the server never claims to be
 *   "up" while it's actually only half-ready.
 *
 * Why an explicit http.Server now exists:
 *   Socket.io must attach to the exact same underlying server
 *   Express uses to handle HTTP requests — see
 *   docs/concepts/socketio-realtime-deliverables for why calling
 *   app.listen() (which creates its own hidden http.Server) would
 *   leave Socket.io with nothing to attach to.
 *
 * Why this file is thin:
 *   It deliberately contains no business logic, no route handling,
 *   nothing beyond "connect, then listen." Everything it needs
 *   (the built app, the validated config, the DB connector, the
 *   socket initializer) is imported from elsewhere — this file's
 *   only job is orchestration.
 *
 * See docs/concepts/env-config-and-folder-structure.md and its
 * -notes.md companion for the full reasoning behind the
 * app.ts / server.ts split.
 * ─────────────────────────────────────────────────────────────
 */