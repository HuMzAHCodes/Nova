import { z } from 'zod';
import dotenv from 'dotenv';

// Loads variables from the local .env file into process.env.
// Without this line, process.env would only contain whatever the OS/terminal already set.
dotenv.config();

// This schema is the single source of truth for every environment variable Nova needs.
// If a variable is missing here, no other file in the app is allowed to assume it exists.
const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.string().regex(/^\d+$/, 'PORT must be numeric').default('5000'),

  // MongoDB connection string — accepts both the SRV format (mongodb+srv://...)
  // and the standard multi-host format (mongodb://host1:port,host2:port,.../...).
  // We deliberately don't use z.string().url() here: the standard multi-host
  // format isn't a spec-valid URL (comma-separated hosts), so the strict URL
  // parser would reject a perfectly valid MongoDB connection string. Instead,
  // we just check it starts with the right protocol.
  MONGODB_URI: z.string().regex(/^mongodb(\+srv)?:\/\//, 'MONGODB_URI must start with mongodb:// or mongodb+srv://'),

  // JWT secrets are required to be at least 32 characters — a short secret is
  // brute-forceable, so this length check is a basic security guard, not just a formality.
  JWT_ACCESS_SECRET: z.string().min(32, 'JWT_ACCESS_SECRET must be at least 32 characters'),
  JWT_REFRESH_SECRET: z.string().min(32, 'JWT_REFRESH_SECRET must be at least 32 characters'),

  // CONCEPT: jwt-auth-design — 15 min access / 7 day refresh, the
  // industry-standard tradeoff between leak-window size and how often the
  // frontend needs to silently refresh. Expressed as strings here because
  // that's the format jsonwebtoken's `expiresIn` option expects (e.g. "15m", "7d").
  JWT_ACCESS_EXPIRY: z.string().default('15m'),
  JWT_REFRESH_EXPIRY: z.string().default('7d'),

  // Stripe secret keys always start with "sk_" — this catches the common mistake
  // of accidentally pasting a publishable key ("pk_...") here instead.
  STRIPE_SECRET_KEY: z.string().startsWith('sk_'),
  STRIPE_WEBHOOK_SECRET: z.string(),

  CLOUDINARY_CLOUD_NAME: z.string(),
  CLOUDINARY_API_KEY: z.string(),
  CLOUDINARY_API_SECRET: z.string(),

  REDIS_URL: z.string(),

  LLM_API_KEY: z.string(),
  // Restricting this to a fixed set of values prevents typos like "Gemeni" from
  // silently passing validation and breaking the AI module later.
  LLM_PROVIDER: z.enum(['gemini', 'groq']),
});

// Infers a TypeScript type directly from the zod schema above, so the shape of
// `env` is always guaranteed to match the validation rules — one definition, not two.
export type Env = z.infer<typeof envSchema>;

// safeParse (instead of parse) lets us handle a failure gracefully with our own
// error message, rather than letting zod throw an uncaught exception.
const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('❌ Invalid environment variables:');
  console.error(parsed.error.flatten().fieldErrors);
  process.exit(1);
}

const env: Env = parsed.data;
export default env;