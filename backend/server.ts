import app from './app.js';
import env from './config/env.js';
import { connectDB } from './config/db.js';

// This is the only file in the entire backend that actually starts a live
// server (calls app.listen()). Every other file — app.ts, config/, routes/,
// etc. — only builds pieces; this file is where they're assembled and run.
async function startServer(): Promise<void> {
  // Connect to MongoDB first, and wait for it to succeed before accepting
  // any HTTP traffic. If this fails, connectDB() itself calls process.exit(1),
  // so startServer() never reaches app.listen() with a broken DB connection.
  await connectDB();

  // Number(env.PORT) — env.PORT is validated as a numeric *string* in env.ts
  // (since all environment variables arrive as strings), so it's converted
  // to an actual number here, right where Express needs it.
  app.listen(Number(env.PORT), () => {
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
 *   starts the HTTP server — in that order, deliberately.
 *
 * Why order matters here:
 *   Starting the server before the DB is connected would let it
 *   accept requests it can't actually fulfill (anything touching
 *   the database would fail unpredictably). Waiting for connectDB()
 *   to succeed first guarantees the server never claims to be
 *   "up" while it's actually only half-ready.
 *
 * Why this file is thin:
 *   It deliberately contains no business logic, no route handling,
 *   nothing beyond "connect, then listen." Everything it needs
 *   (the built app, the validated config, the DB connector) is
 *   imported from elsewhere — this file's only job is orchestration.
 *
 * See docs/concepts/env-config-and-folder-structure.md and its
 * -notes.md companion for the full reasoning behind the
 * app.ts / server.ts split.
 * ─────────────────────────────────────────────────────────────
 */