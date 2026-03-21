import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { nextCookies } from "better-auth/next-js";
import { emailOTP } from "better-auth/plugins";

import { sendVerificationEmail } from "@/server/auth-email";
import { db } from "@/server/db/client";
import * as schema from "@/server/db/schema";

export const auth = betterAuth({
  database: drizzleAdapter(db, {
    provider: "pg",
    schema,
  }),
  baseURL: process.env.BETTER_AUTH_URL,
  emailAndPassword: {
    enabled: true,
    requireEmailVerification: true,
  },
  emailVerification: {
    autoSignInAfterVerification: true,
    sendOnSignIn: true,
  },
  plugins: [
    nextCookies(),
    emailOTP({
      overrideDefaultEmailVerification: true,
      sendVerificationOTP: async ({ email, otp, type }) => {
        await sendVerificationEmail({ email, otp, type });
      },
    }),
  ],
});
