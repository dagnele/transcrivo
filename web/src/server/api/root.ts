import { createTRPCRouter, publicProcedure } from "@/server/api/trpc";
import { billingRouter } from "@/server/api/routers/billing";
import { sessionRouter } from "@/server/api/routers/session";

export const appRouter = createTRPCRouter({
  health: publicProcedure.query(() => {
    return {
      ok: true,
      service: "transcrivo-web",
      now: new Date().toISOString(),
    };
  }),
  billing: billingRouter,
  session: sessionRouter,
});

export type AppRouter = typeof appRouter;
