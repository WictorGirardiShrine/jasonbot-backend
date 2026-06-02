import { z } from 'zod';

export const envSchema = z.object({
  NODE_ENV: z
    .enum(['development', 'test', 'production'])
    .default('development'),
  PORT: z.coerce.number().int().positive().default(3001),
  FRONTEND_URL: z.string().url(),
  SUPABASE_URL: z.string().url(),
  SUPABASE_ANON_KEY: z.string().min(1),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  DATABASE_URL: z.string().min(1),
  ADMIN_EMAILS: z
    .string()
    .default('')
    .transform((val) =>
      val
        .split(',')
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean),
    ),
  ANTHROPIC_API_KEY: z.string().min(1),
  VOYAGE_API_KEY: z.string().min(1),

  // Stripe vars are only required when BILLING_STRIPE_ENABLED=true.
  // While dormant we keep them optional so the app boots without them.
  STRIPE_SECRET_KEY: z.string().default(''),
  STRIPE_WEBHOOK_SECRET: z.string().default(''),
  STRIPE_PRICE_MONTHLY_ID: z.string().default(''),
  STRIPE_PRICE_ANNUAL_ID: z.string().default(''),
  FREE_TIER_DAILY_MESSAGE_LIMIT: z.coerce.number().int().positive().default(10),

  CONVERTKIT_API_SECRET: z.string().min(1),
  CONVERTKIT_TAG_ID: z.string().min(1),
  BILLING_STRIPE_ENABLED: z.coerce.boolean().default(false),
  BETA_ACCESS_DURATION_DAYS: z.coerce.number().int().positive().default(30),
});

export type Env = z.infer<typeof envSchema>;

export function validateEnv(config: Record<string, unknown>): Env {
  const result = envSchema.safeParse(config);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `  • ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    throw new Error(`Invalid environment variables:\n${issues}`);
  }
  return result.data;
}
