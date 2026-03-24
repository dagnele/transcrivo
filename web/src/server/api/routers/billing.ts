import {
  entitlementSummarySchema,
} from "@/lib/contracts/billing";
import { createTRPCRouter, protectedProcedure } from "@/server/api/trpc";
import { getUserEntitlementSummary } from "@/server/billing/entitlements";

export const billingRouter = createTRPCRouter({
  entitlements: protectedProcedure
    .output(entitlementSummarySchema)
    .query(async ({ ctx }) => {
      const summary = await getUserEntitlementSummary(ctx.session.user.id);
      return entitlementSummarySchema.parse(summary);
    }),
});
