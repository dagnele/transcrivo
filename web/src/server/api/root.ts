import { createTRPCRouter, publicProcedure } from "@/server/api/trpc";
import { sessionRouter } from "@/server/api/routers/session";

export const appRouter = createTRPCRouter({
  health: publicProcedure.query(() => {
    return {
      ok: true,
      service: "transcrivo-web",
      now: new Date().toISOString(),
    };
  }),
  session: sessionRouter,
});

export type AppRouter = typeof appRouter;
