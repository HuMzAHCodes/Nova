import { createAdapter } from '@socket.io/redis-adapter';
import type { Redis } from 'ioredis';
import { getRedisClient, createRedisSubscriber } from './redis.js';
import env from '../config/env.js';

// CONCEPT: socketio-redis-adapter. Makes several Socket.io servers act as
// one. Every emit is also published through Redis pub/sub, every server
// listens, and each delivers the event to its own sockets in the target
// room. The rest of the app does not change: io.to(room).emit(...) simply
// reaches sockets on every server.
//
// Two Redis connections are needed, because a connection that has
// subscribed can do nothing else:
//   - the publisher: the app's ordinary shared client (fail-fast)
//   - the subscriber: a second connection that only listens

export interface RedisAdapterHandle {
  // Passed to io.adapter(...).
  adapterConstructor: ReturnType<typeof createAdapter>;
  // Closes the subscriber connection (the publisher belongs to the app).
  close(): Promise<void>;
}

// Wraps the publisher so that a failed PUBLISH is logged instead of becoming
// an unhandled rejection. The adapter calls publish() without waiting for or
// catching the result; with Redis down that rejection would crash the
// process. This is what makes the adapter fail open: the event is still
// delivered to the sockets on this server, only the other servers miss it.
function withFailOpenPublish(publisher: Redis): Redis {
  return new Proxy(publisher, {
    get(target, property) {
      if (property === 'publish') {
        return async (...args: Parameters<Redis['publish']>) => {
          try {
            return await target.publish(...args);
          } catch (error) {
            console.warn(`Socket.io adapter could not publish: ${(error as Error).message}`);
            return 0;
          }
        };
      }
      const value = Reflect.get(target, property, target);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}

export function createRedisAdapterHandle(publisher: Redis, subscriber: Redis): RedisAdapterHandle {
  return {
    adapterConstructor: createAdapter(withFailOpenPublish(publisher), subscriber),
    async close() {
      subscriber.disconnect();
    },
  };
}

// What the app uses: an adapter when REDIS_URL is set, none otherwise (one
// server needs nothing else).
export function createDefaultRedisAdapterHandle(): RedisAdapterHandle | null {
  const publisher = getRedisClient();
  if (!publisher || !env.REDIS_URL) return null;
  return createRedisAdapterHandle(publisher, createRedisSubscriber(env.REDIS_URL));
}
