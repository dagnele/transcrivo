import { initTRPC } from "@trpc/server";
import type { FetchCreateContextFnOptions } from "@trpc/server/adapters/fetch";
import { TRPCError } from "@trpc/server";
import superjson from "superjson";

import { auth } from "@/lib/auth";

export type TRPCContext = {
  headers: Headers;
  session: Awaited<ReturnType<typeof auth.api.getSession>>;
};

export async function createTRPCContext(
  opts?: Pick<FetchCreateContextFnOptions, "req"> | { headers?: Headers },
): Promise<TRPCContext> {
  const headers =
    opts && "req" in opts
      ? opts.req.headers
      : (opts?.headers ?? new Headers());

  return {
    headers,
    session: await auth.api.getSession({ headers }),
  };
}

const t = initTRPC.context<TRPCContext>().create({
  transformer: superjson,
});

export const createTRPCRouter = t.router;
export const publicProcedure = t.procedure;
export const protectedProcedure = t.procedure.use(({ ctx, next }) => {
  if (!ctx.session) {
    throw new TRPCError({
      code: "UNAUTHORIZED",
      message: "Sign in required.",
    });
  }

  return next({
    ctx: {
      ...ctx,
      session: ctx.session,
    },
  });
});
