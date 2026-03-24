import { z } from "zod";

// ---------------------------------------------------------------------------
// Polar env config
// ---------------------------------------------------------------------------

const polarEnvSchema = z.object({
  POLAR_ACCESS_TOKEN: z.string().min(1),
  POLAR_WEBHOOK_SECRET: z.string().min(1),
  POLAR_SESSION_PRODUCT_ID: z.string().min(1),
  POLAR_ENVIRONMENT: z.enum(["sandbox", "production"]).default("sandbox"),
});

export function getPolarEnv() {
  return polarEnvSchema.parse(process.env);
}
