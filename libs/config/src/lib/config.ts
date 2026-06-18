import { z } from 'zod';

export const apiEnvSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().default(18600),
    CORS_ORIGIN: z.string().default('http://localhost:18601'),
    DATABASE_URL: z.string().min(1),
    CLERK_SECRET_KEY: z.string().min(1),
    CLERK_JWT_KEY: z.string().optional(),
    CLERK_AUTHORIZED_PARTIES: z.string().default('http://localhost:18601'),
    STRIPE_SECRET_KEY: z.string().min(1),
    STRIPE_WEBHOOK_SECRET: z.string().min(1),
    STRIPE_SUCCESS_URL: z.string().url().default('http://localhost:18601/checkout/success'),
    STRIPE_CANCEL_URL: z.string().url().default('http://localhost:18601/checkout/cancel'),
    SERVICE_FEE_AMOUNT: z.coerce.number().int().nonnegative().default(400),
    SERVICE_FEE_CURRENCY: z.string().min(1).default('usd'),
    HOLD_TTL_MINUTES: z.coerce.number().int().positive().default(3),
    PAYMENT_PROVIDER: z.enum(['stripe', 'test']).default('stripe'),
    // Test-auth bypass — strictly gated; see clerk.guard.ts. Production fail-fast below.
    // Only literal boolean `true` or the string 'true' enables bypass; everything else
    // (incl. 'false', '0', '') is false. Avoids the z.coerce.boolean() footgun where any
    // non-empty string (e.g. 'false') coerces to true.
    CLERK_BYPASS_AUTH: z.preprocess((v) => v === true || v === 'true', z.boolean()).default(false),
    AUTH_BYPASS_TOKEN: z.string().default(''),
    AUTH_BYPASS_SUBJECT: z.string().default('test_clerk_user'),
  })
  .superRefine((env, ctx) => {
    if (env.NODE_ENV === 'production' && (env.CLERK_BYPASS_AUTH || env.AUTH_BYPASS_TOKEN !== '')) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        fatal: true,
        message:
          'bypass env must not be set in production (CLERK_BYPASS_AUTH / AUTH_BYPASS_TOKEN)',
      });
    }
  });

export type ApiEnv = z.infer<typeof apiEnvSchema>;

export const webEnvSchema = z.object({
  VITE_CLERK_PUBLISHABLE_KEY: z.string().min(1),
  VITE_API_URL: z.string().default('/api'),
});

export type WebEnv = z.infer<typeof webEnvSchema>;