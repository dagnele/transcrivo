import { cache } from "react";

import { appRouter } from "@/server/api/root";
import { createTRPCContext } from "@/server/api/trpc";

export const getServerTRPCCaller = cache(async () => {
  const context = await createTRPCContext();

  return appRouter.createCaller(context);
});
