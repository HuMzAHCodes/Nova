import mongoose from 'mongoose';
import env from './env.js';

// Connects to MongoDB using the already-validated MONGODB_URI from env.ts.
// This function is called once, at server startup, before the app starts
// accepting any requests — see server.ts.
export async function connectDB(): Promise<void> {
  try {
    await mongoose.connect(env.MONGODB_URI);
    console.log(' MongoDB connected');
  } catch (err) {
    // TypeScript types `err` as `unknown` in a catch block by default (not `Error`),
    // so we narrow it with `instanceof Error` before safely reading `.message`.
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error(' MongoDB connection failed:', message);

    // Deliberately crash the process if the DB connection fails at startup.
    // A backend with no working database is useless — better to fail loudly
    // and immediately than to run in a broken half-alive state that only
    // errors later, request by request, in confusing ways.
    process.exit(1);
  }
}

/**
 * ─────────────────────────────────────────────────────────────
 * CONCEPT SUMMARY (for anyone reading this file)
 * ─────────────────────────────────────────────────────────────
 * What this file does:
 *   Establishes the single MongoDB connection Nova's backend uses,
 *   using Mongoose as the ODM (Object-Document Mapper) layer on
 *   top of the raw MongoDB driver.
 *
 * Why it's a separate file from server.ts:
 *   Keeps "how we connect to the database" isolated from "how we
 *   start the HTTP server" — two different concerns, two different
 *   reasons to change. This also makes it trivial to swap out or
 *   mock the DB connection in tests later without touching server.ts.
 *
 * Why we exit the process on failure:
 *   There's no safe way to serve API requests without a database
 *   connection in this app — every real feature touches MongoDB.
 *   Crashing immediately at startup is far easier to notice and
 *   debug than allowing the server to run and fail unpredictably
 *   on the first request that hits the database.
 *
 * See docs/concepts/env-config-and-folder-structure.md and its
 * -notes.md companion for the full reasoning behind this structure.
 * ─────────────────────────────────────────────────────────────
 */