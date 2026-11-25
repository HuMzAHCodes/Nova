import type { Redis } from 'ioredis';
import type { ClientRateLimitInfo, Options, Store } from 'express-rate-limit';

// CONCEPT: redis-rate-limiting. A counter store for express-rate-limit that
// keeps its counts in Redis instead of in the server's memory, so every
// server instance shares one count and a restart does not reset it.
//
// One key per client (for example "rl:login:ip:1.2.3.4"). The key holds a
// number and has an expiry equal to the window, so Redis deletes it when
// the window is over and nothing needs cleaning up.

// Runs inside Redis as ONE atomic step (one command for the app, and no
// other request can run between its lines):
//   1. add 1 to the counter (INCR creates it at 1 when it does not exist)
//   2. if the counter was just created, give it its expiry
//   3. return the new count and the milliseconds left before it expires
// Doing the expiry in the same step matters: with two separate commands, a
// crash between them would leave a counter that never expires, and that
// client would stay blocked forever.
const INCREMENT_SCRIPT = `
local hits = redis.call('INCR', KEYS[1])
if hits == 1 then
  redis.call('PEXPIRE', KEYS[1], ARGV[1])
end
local millisecondsLeft = redis.call('PTTL', KEYS[1])
return { hits, millisecondsLeft }
`;

// Lowers the counter by one, but only if it still exists. Without the check,
// DECR on an expired key would create a counter at -1 with no expiry.
const DECREMENT_SCRIPT = `
if redis.call('EXISTS', KEYS[1]) == 1 then
  return redis.call('DECR', KEYS[1])
end
return 0
`;

export class RedisRateLimitStore implements Store {
  // Different limiters must not share counters, so each one gets a prefix.
  private readonly keyPrefix: string;
  private windowMilliseconds = 60 * 1000;

  constructor(
    private readonly redisClient: Redis,
    keyPrefix: string,
  ) {
    this.keyPrefix = keyPrefix;
  }

  // express-rate-limit calls this once with the limiter's options; the
  // window length is what the counter's expiry has to match.
  init(options: Options): void {
    this.windowMilliseconds = options.windowMs;
  }

  private redisKey(clientKey: string): string {
    return `${this.keyPrefix}${clientKey}`;
  }

  async increment(clientKey: string): Promise<ClientRateLimitInfo> {
    const reply = (await this.redisClient.eval(
      INCREMENT_SCRIPT,
      1,
      this.redisKey(clientKey),
      String(this.windowMilliseconds),
    )) as [number, number];
    const [totalHits, millisecondsLeft] = reply;
    // PTTL is negative only in a rare race (the key vanished right after the
    // increment); fall back to a full window rather than a time in the past.
    const remaining = millisecondsLeft > 0 ? millisecondsLeft : this.windowMilliseconds;
    return { totalHits, resetTime: new Date(Date.now() + remaining) };
  }

  // Called by express-rate-limit for successful logins when the limiter is
  // configured with skipSuccessfulRequests.
  async decrement(clientKey: string): Promise<void> {
    await this.redisClient.eval(DECREMENT_SCRIPT, 1, this.redisKey(clientKey));
  }

  async resetKey(clientKey: string): Promise<void> {
    await this.redisClient.del(this.redisKey(clientKey));
  }
}
