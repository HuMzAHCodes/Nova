import { vi, beforeAll, afterAll, beforeEach } from 'vitest';
import mongoose from 'mongoose';

// CONCEPT: automated-testing. Real email is never sent: every send*
// function is replaced by a spy, so tests can read the token that would
// have been emailed.
vi.mock('../lib/email.js', () => ({
  sendVerificationEmail: vi.fn().mockResolvedValue(undefined),
  sendPasswordResetEmail: vi.fn().mockResolvedValue(undefined),
  sendClientInviteEmail: vi.fn().mockResolvedValue(undefined),
  sendTeamInviteEmail: vi.fn().mockResolvedValue(undefined),
}));

// The login limiter counts per IP; every test request comes from the same
// IP, so it is replaced by a pass-through.
vi.mock('../middleware/loginRateLimit.js', () => ({
  loginRateLimit: (_req: unknown, _res: unknown, next: () => void) => next(),
}));

let memoryServer: { stop: () => Promise<boolean>; getUri: () => string } | null = null;

beforeAll(async () => {
  let uri = process.env.TEST_MONGODB_URI;
  if (!uri) {
    // Default on a normal machine: an in-memory MongoDB, nothing to install.
    const { MongoMemoryServer } = await import('mongodb-memory-server');
    memoryServer = await MongoMemoryServer.create();
    uri = memoryServer.getUri();
  }
  // Safety: never run destructive tests against a hosted database.
  if (uri.startsWith('mongodb+srv://') || uri.includes('mongodb.net')) {
    throw new Error('Refusing to run tests against a hosted database');
  }
  const dbName = `nova_test_${process.pid}_${Date.now()}`;
  await mongoose.connect(uri, { dbName });
  // Build indexes (unique constraints matter to the tests). Some Mongo-compatible
  // stand-ins lack TTL indexes; a failure there must not stop the run.
  await Promise.all(Object.values(mongoose.models).map((m) => m.init().catch(() => undefined)));
});

beforeEach(async () => {
  vi.clearAllMocks();
  for (const model of Object.values(mongoose.models)) {
    await model.deleteMany({});
  }
});

afterAll(async () => {
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
  if (memoryServer) await memoryServer.stop();
});
