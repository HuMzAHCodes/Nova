import { Redis } from 'ioredis';
import env from '../config/env.js';

// CONCEPT: redis-rate-limiting. One shared Redis connection for the whole
// app. Redis is OPTIONAL: when REDIS_URL is not set, getRedisClient()
// returns null and every feature that can use Redis keeps its in-memory
// version (one server, nothing to install).
//
// Fail open: the client is configured so that, when Redis is unreachable,
// commands fail IMMEDIATELY instead of waiting in a queue. The callers
// (rate limiter, later the presence store) catch that error and carry on
// without Redis, so a Redis outage never takes login down with it.

let sharedClient: Redis | null = null;

// Builds a client with the fail-fast settings. Exported so tests can create
// their own clients (pointing at a test Redis, or at a dead port).
export function createRedisClient(url: string): Redis {
  return withErrorLogging(
    new Redis(url, {
      // Do not queue commands while disconnected: reject them at once.
      enableOfflineQueue: false,
      // Do not retry one command many times; the caller decides what to do.
      maxRetriesPerRequest: 1,
      connectTimeout: 5000,
      // Reconnect in the background: 200 ms, 400 ms, ... up to 5 s apart.
      retryStrategy: reconnectDelay,
    }),
  );
}

// CONCEPT: socketio-redis-adapter. The connection that listens for events
// from the other servers. It is the opposite of the fail-fast client: its
// SUBSCRIBE commands must wait in a queue until the connection is ready
// (and be retried after a reconnect), because the adapter sends them once
// at startup and never again. ioredis re-subscribes by itself after a
// reconnect.
export function createRedisSubscriber(url: string): Redis {
  return withErrorLogging(
    new Redis(url, {
      enableOfflineQueue: true,
      maxRetriesPerRequest: null,
      connectTimeout: 5000,
      retryStrategy: reconnectDelay,
    }),
  );
}

const reconnectDelay = (attempt: number): number => Math.min(attempt * 200, 5000);

// Without an 'error' listener Node treats a connection error as an
// uncaught exception and crashes the process. Logging it is enough:
// reconnecting happens by itself.
function withErrorLogging(client: Redis): Redis {
  client.on('error', (error: Error) => {
    console.warn(`Redis connection problem: ${error.message}`);
  });
  return client;
}

// The one client the app uses, created on first use. Returns null when
// REDIS_URL is not set (an empty value counts as not set).
export function getRedisClient(): Redis | null {
  if (!env.REDIS_URL) return null;
  if (!sharedClient) sharedClient = createRedisClient(env.REDIS_URL);
  return sharedClient;
}
