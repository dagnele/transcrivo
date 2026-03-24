import { toNextJsHandler } from "better-auth/next-js";

import { getAuth } from "@/lib/auth";

export const runtime = "nodejs";

type AuthRouteHandlers = ReturnType<typeof toNextJsHandler>;

export const GET: AuthRouteHandlers["GET"] = (...args) => {
  return toNextJsHandler(getAuth()).GET(...args);
};

export const POST: AuthRouteHandlers["POST"] = (...args) => {
  return toNextJsHandler(getAuth()).POST(...args);
};
