import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { nextCookies } from "better-auth/next-js";
import { emailOTP } from "better-auth/plugins";
import { polar, checkout, webhooks } from "@polar-sh/better-auth";
import { Polar } from "@polar-sh/sdk";

import { sendVerificationEmail } from "@/server/auth-email";
import { handleOrderPaid, handleCheckoutEvent } from "@/server/billing/webhooks";
import { db } from "@/server/db/client";
import * as schema from "@/server/db/schema";

function createAuth() {
  const polarClient = new Polar({
    accessToken: process.env.POLAR_ACCESS_TOKEN!,
    server: (process.env.POLAR_ENVIRONMENT as "sandbox" | "production") ?? "sandbox",
  });

  return betterAuth({
    database: drizzleAdapter(db, {
      provider: "pg",
      schema,
    }),
    baseURL: process.env.BETTER_AUTH_URL,
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: true,
    },
    socialProviders: {
      google: {
        clientId: process.env.GOOGLE_CLIENT_ID!,
        clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
      },
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
      polar({
        client: polarClient,
        createCustomerOnSignUp: true,
        use: [
          checkout({
            products: [
              {
                productId: process.env.POLAR_SESSION_PRODUCT_ID!,
                slug: "session",
              },
            ],
            successUrl: "/sessions?checkout=success",
            authenticatedUsersOnly: true,
          }),
          webhooks({
            secret: process.env.POLAR_WEBHOOK_SECRET!,
            onOrderPaid: async (payload) => {
              await handleOrderPaid(payload);
            },
            onCheckoutCreated: async (payload) => {
              await handleCheckoutEvent(payload);
            },
            onCheckoutUpdated: async (payload) => {
              await handleCheckoutEvent(payload);
            },
          }),
        ],
      }),
    ],
  });
}

type Auth = ReturnType<typeof createAuth>;

let authInstance: Auth | null = null;

export function getAuth(): Auth {
  authInstance ??= createAuth();
  return authInstance;
}

export const auth = new Proxy({} as Auth, {
  get(_target, property, receiver) {
    return Reflect.get(getAuth(), property, receiver);
  },
});
