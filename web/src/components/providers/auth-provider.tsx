"use client";

import { AuthUIProvider } from "@daveyplate/better-auth-ui";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { authClient } from "@/lib/auth-client";

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();

  return (
    <AuthUIProvider
      authClient={authClient}
      navigate={router.push}
      replace={router.replace}
      onSessionChange={() => {
        router.refresh();
      }}
      Link={Link}
      redirectTo="/sessions"
      account={{ basePath: "/sessions/account" }}
      emailVerification={{
        otp: true,
      }}
      credentials={{
        confirmPassword: true,
      }}
      nameRequired
    >
      {children}
    </AuthUIProvider>
  );
}
