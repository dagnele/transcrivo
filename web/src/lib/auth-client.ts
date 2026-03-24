import { polarClient } from "@polar-sh/better-auth/client";
import { emailOTPClient } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";

export const authClient = createAuthClient({
  plugins: [emailOTPClient(), polarClient()],
});
