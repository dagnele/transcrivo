import { initTRPC } from "@trpc/server";
import type { FetchCreateContextFnOptions } from "@trpc/server/adapters/fetch";
import superjson from "superjson";

export type TRPCContext = {
  headers: Headers;
};

export async function createTRPCContext(
  opts?: Pick<FetchCreateContextFnOptions, "req"> | { headers?: Headers },
): Promise<TRPCContext> {
  return {
    headers:
      opts && "req" in opts
        ? opts.req.headers
        : (opts?.headers ?? new Headers()),
  };
}

const t = initTRPC.context<TRPCContext>().create({
  transformer: superjson,
});

export const createTRPCRouter = t.router;
export const publicProcedure = t.procedure;
