import { cache } from "react";
import { headers } from "next/headers";

import { appRouter } from "@/server/api/root";
import { createTRPCContext } from "@/server/api/trpc";

export const getServerTRPCCaller = cache(async () => {
  const context = await createTRPCContext({
    headers: await headers(),
  });

  return appRouter.createCaller(context);
});
