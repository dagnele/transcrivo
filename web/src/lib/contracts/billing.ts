import { z } from "zod";

// ---------------------------------------------------------------------------
// Enum value lists (reused by Drizzle schema and runtime validation)
// ---------------------------------------------------------------------------

export const billingOrderStatusValues = [
  "created",
  "paid",
  "failed",
  "refunded",
] as const;

export const sessionAccessKindValues = ["paid", "trial"] as const;

// ---------------------------------------------------------------------------
// Zod schemas
// ---------------------------------------------------------------------------

export const billingOrderStatusSchema = z.enum(billingOrderStatusValues);
export const sessionAccessKindSchema = z.enum(sessionAccessKindValues);

// ---------------------------------------------------------------------------
// Entitlement summary – returned by billing.entitlements
// ---------------------------------------------------------------------------

export const entitlementSummarySchema = z.object({
  availablePurchasedSessions: z.number().int().nonnegative(),
  trialAvailable: z.boolean(),
});

export type EntitlementSummary = z.infer<typeof entitlementSummarySchema>;

// ---------------------------------------------------------------------------
// Billing order schema (for DB row validation / API output)
// ---------------------------------------------------------------------------

export const billingOrderSchema = z.object({
  id: z.string().min(1),
  userId: z.string().min(1),
  polarCheckoutId: z.string().min(1),
  polarOrderId: z.string().nullable(),
  polarProductId: z.string().min(1),
  status: billingOrderStatusSchema,
  amount: z.number().int().nonnegative(),
  currency: z.string().min(1),
  metadata: z.record(z.string(), z.unknown()).nullable(),
  createdAt: z.date(),
  updatedAt: z.date(),
});

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type BillingOrderStatus = z.infer<typeof billingOrderStatusSchema>;
export type SessionAccessKind = z.infer<typeof sessionAccessKindSchema>;
