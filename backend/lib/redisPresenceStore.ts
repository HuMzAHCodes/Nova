import { randomUUID } from 'crypto';
import type { Redis } from 'ioredis';
import type { PresenceEntry, PresenceStore } from './presence.js';

// CONCEPT: redis-presence-store. The presence store from lib/presence.ts,
// kept in Redis so that several server instances share one picture of who
// is present, instead of each server knowing only its own sockets.
//
// Layout in Redis, per project P and person U:
//   presence:P:users        hash   person id -> the person (name, role) as JSON
//   presence:P:u:U          set    one member per open socket: "serverId:socketId"
//   presence:server:SERVER  string a heartbeat: exists while that server is alive
//
// A person is present while their set has at least one member whose server
// is alive. Everything that must be decided atomically (who was FIRST, who
// was LAST) runs as a Lua script inside Redis. Without that, two tabs of the
// same person joining at the same moment on two servers could each see "the
// other one is already there" and nobody would be announced.

const KEY_PREFIX = 'presence:';
const SERVER_KEY_PREFIX = `${KEY_PREFIX}server:`;

const usersKey = (projectId: string) => `${KEY_PREFIX}${projectId}:users`;
const socketsKeyPrefix = (projectId: string) => `${KEY_PREFIX}${projectId}:u:`;
const socketsKey = (projectId: string, userId: string) => `${socketsKeyPrefix(projectId)}${userId}`;

// Shared by every script: removes the sockets of servers that are no longer
// alive from one person's set. A server that crashed never sent "leave" for
// its sockets; its heartbeat key expires, and this is where its sockets are
// noticed and dropped. Members look like "serverId:socketId".
const PURGE_DEAD_SOCKETS_FUNCTION = `
local function purgeDeadSockets(setKey, serverKeyPrefix)
  local members = redis.call('SMEMBERS', setKey)
  for _, member in ipairs(members) do
    local serverId = string.match(member, '^([^:]+):')
    if (not serverId) or redis.call('EXISTS', serverKeyPrefix .. serverId) == 0 then
      redis.call('SREM', setKey, member)
    end
  end
end
`;

// KEYS[1] = users hash, KEYS[2] = this person's socket set
// ARGV[1] = "serverId:socketId", ARGV[2] = person JSON, ARGV[3] = person id,
// ARGV[4] = server key prefix, ARGV[5] = this server's id, ARGV[6] = heartbeat ttl (ms)
// Returns 1 when the person was NOT present before (first socket), else 0.
const ADD_SCRIPT = `
${PURGE_DEAD_SOCKETS_FUNCTION}
-- Refresh our own heartbeat, so a server that is busy never looks dead.
redis.call('SET', ARGV[4] .. ARGV[5], '1', 'PX', ARGV[6])
purgeDeadSockets(KEYS[2], ARGV[4])
local socketsBefore = redis.call('SCARD', KEYS[2])
redis.call('SADD', KEYS[2], ARGV[1])
redis.call('HSET', KEYS[1], ARGV[3], ARGV[2])
if socketsBefore == 0 then
  return 1
end
return 0
`;

// KEYS[1] = users hash, KEYS[2] = this person's socket set
// ARGV[1] = "serverId:socketId", ARGV[2] = person id, ARGV[3] = server key prefix
// Returns the person's JSON when this was their LAST socket, else nil.
const REMOVE_SCRIPT = `
${PURGE_DEAD_SOCKETS_FUNCTION}
redis.call('SREM', KEYS[2], ARGV[1])
purgeDeadSockets(KEYS[2], ARGV[3])
if redis.call('SCARD', KEYS[2]) == 0 then
  local person = redis.call('HGET', KEYS[1], ARGV[2])
  redis.call('HDEL', KEYS[1], ARGV[2])
  return person
end
return false
`;

// KEYS[1] = users hash
// ARGV[1] = prefix of the per-person socket sets, ARGV[2] = server key prefix
// Returns the JSON of every person who still has a live socket.
const LIST_SCRIPT = `
${PURGE_DEAD_SOCKETS_FUNCTION}
local present = {}
local everyone = redis.call('HGETALL', KEYS[1])
for index = 1, #everyone, 2 do
  local personId = everyone[index]
  local setKey = ARGV[1] .. personId
  purgeDeadSockets(setKey, ARGV[2])
  if redis.call('SCARD', setKey) == 0 then
    redis.call('HDEL', KEYS[1], personId)
  else
    table.insert(present, everyone[index + 1])
  end
end
return present
`;

export interface RedisPresenceStoreOptions {
  // Identifies this server in the heartbeat. A random id by default.
  serverId?: string;
  // How long the heartbeat key lives without a refresh, in milliseconds.
  serverTtlMs?: number;
  // How often the heartbeat is refreshed, in milliseconds.
  heartbeatIntervalMs?: number;
}

// The store plus the two things the socket code does not need but tests and
// shutdown do.
export interface RedisPresenceStore extends PresenceStore {
  readonly serverId: string;
  // Stops the heartbeat and removes this server's heartbeat key, so the
  // people connected through this server disappear at once.
  close(): Promise<void>;
}

// Leaves that could not be recorded because Redis was unreachable. They are
// retried on every heartbeat; without that the person would stay "present"
// forever, because this server (and so its heartbeat) is still alive.
interface PendingRemoval {
  projectId: string;
  userId: string;
  socketId: string;
}
const MAX_PENDING_REMOVALS = 1000;

export function createRedisPresenceStore(
  redisClient: Redis,
  options: RedisPresenceStoreOptions = {},
): RedisPresenceStore {
  const serverId = options.serverId ?? randomUUID();
  const serverTtlMs = options.serverTtlMs ?? 60_000;
  const heartbeatIntervalMs = options.heartbeatIntervalMs ?? 30_000;
  const pendingRemovals: PendingRemoval[] = [];

  async function removeFromRedis(projectId: string, userId: string, socketId: string): Promise<PresenceEntry | null> {
    const reply = (await redisClient.eval(
      REMOVE_SCRIPT,
      2,
      usersKey(projectId),
      socketsKey(projectId, userId),
      `${serverId}:${socketId}`,
      userId,
      SERVER_KEY_PREFIX,
    )) as string | null;
    return reply ? (JSON.parse(reply) as PresenceEntry) : null;
  }

  // One heartbeat: refresh our key, then retry the leaves that failed.
  // Never throws: a failing heartbeat just tries again at the next tick.
  async function heartbeat(): Promise<void> {
    try {
      await redisClient.set(`${SERVER_KEY_PREFIX}${serverId}`, '1', 'PX', serverTtlMs);
      const toRetry = pendingRemovals.splice(0, pendingRemovals.length);
      for (const removal of toRetry) {
        try {
          await removeFromRedis(removal.projectId, removal.userId, removal.socketId);
        } catch {
          pendingRemovals.push(removal);
        }
      }
    } catch (error) {
      console.warn(`Presence heartbeat failed: ${(error as Error).message}`);
    }
  }

  // No beat at creation: the connection may not be ready yet, and add()
  // refreshes the heartbeat anyway. The first scheduled beat comes after one
  // interval. The timer must never keep the process alive on its own.
  const heartbeatTimer = setInterval(() => void heartbeat(), heartbeatIntervalMs);
  heartbeatTimer.unref();

  return {
    serverId,

    // Fail open on all three operations: a Redis problem makes presence go
    // quiet (nobody announced, an empty list); it never breaks a join.
    async add(projectId, entry, socketId) {
      try {
        const reply = await redisClient.eval(
          ADD_SCRIPT,
          2,
          usersKey(projectId),
          socketsKey(projectId, entry._id),
          `${serverId}:${socketId}`,
          JSON.stringify(entry),
          entry._id,
          SERVER_KEY_PREFIX,
          serverId,
          String(serverTtlMs),
        );
        return reply === 1;
      } catch (error) {
        console.warn(`Presence add failed: ${(error as Error).message}`);
        return false;
      }
    },

    async remove(projectId, userId, socketId) {
      try {
        return await removeFromRedis(projectId, userId, socketId);
      } catch (error) {
        console.warn(`Presence remove failed, will retry: ${(error as Error).message}`);
        if (pendingRemovals.length < MAX_PENDING_REMOVALS) {
          pendingRemovals.push({ projectId, userId, socketId });
        }
        return null;
      }
    },

    async list(projectId) {
      try {
        const replies = (await redisClient.eval(
          LIST_SCRIPT,
          1,
          usersKey(projectId),
          socketsKeyPrefix(projectId),
          SERVER_KEY_PREFIX,
        )) as string[];
        return replies.map((reply) => JSON.parse(reply) as PresenceEntry);
      } catch (error) {
        console.warn(`Presence list failed: ${(error as Error).message}`);
        return [];
      }
    },

    async close() {
      clearInterval(heartbeatTimer);
      try {
        await redisClient.del(`${SERVER_KEY_PREFIX}${serverId}`);
      } catch {
        // Redis is unreachable: the key expires by itself within the ttl.
      }
    },
  };
}
