import { defineConfig } from 'vitest/config';

// CONCEPT: automated-testing. Every variable config/env.ts requires gets a
// fake value here, so the real app code loads unchanged and no real secret
// or service is ever touched by the test run.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    setupFiles: ['tests/setup.ts'],
    // All test files share one test database, so files run one after another.
    fileParallelism: false,
    testTimeout: 30000,
    hookTimeout: 120000,
    env: {
      NODE_ENV: 'test',
      PORT: '5999',
      MONGODB_URI: 'mongodb://127.0.0.1:27017/nova_unused',
      JWT_ACCESS_SECRET: 'test-access-secret-test-access-secret-1234',
      JWT_REFRESH_SECRET: 'test-refresh-secret-test-refresh-secret-123',
      GMAIL_USER: 'test@example.com',
      GMAIL_APP_PASSWORD: 'x',
      FRONTEND_URL: 'http://localhost:3000',
      STRIPE_SECRET_KEY: 'sk_test_fake',
      STRIPE_WEBHOOK_SECRET: 'whsec_fake',
      STRIPE_PRICE_ID_PRO: 'price_fake_pro',
      STRIPE_PRICE_ID_BUSINESS: 'price_fake_business',
      CLOUDINARY_CLOUD_NAME: 'x',
      CLOUDINARY_API_KEY: 'x',
      CLOUDINARY_API_SECRET: 'x',
      REDIS_URL: 'redis://127.0.0.1:6379',
      LLM_API_KEY: 'x',
      LLM_PROVIDER: 'gemini',
    },
  },
});
