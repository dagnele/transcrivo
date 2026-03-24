import type { Metadata } from "next";
import { AuthView } from "@daveyplate/better-auth-ui";
import { authViewPaths } from "@daveyplate/better-auth-ui/server";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { auth } from "@/lib/auth";
import { SiteHeader } from "@/components/site-header";

export const dynamicParams = false;

export const metadata: Metadata = {
  title: "Sign In",
  robots: {
    index: false,
    follow: false,
  },
};

export function generateStaticParams() {
  return Object.values(authViewPaths).map((path) => ({ path }));
}

type AuthPageProps = {
  params: Promise<{ path: string }>;
};

export default async function AuthPage({ params }: AuthPageProps) {
  const [{ path }, session] = await Promise.all([
    params,
    auth.api.getSession({ headers: await headers() }),
  ]);

  if (session && path !== authViewPaths.SIGN_OUT) {
    redirect("/sessions");
  }

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <SiteHeader />
      <main className="flex flex-1 items-center justify-center px-4 py-10">
        <div className="w-full max-w-sm">
          <div className="mb-6 space-y-1.5 px-1">
            <h1 className="text-xl font-semibold tracking-tight">
              Sign in to your workspace
            </h1>
            <p className="text-sm text-muted-foreground">
              Access private sessions, live transcripts, and CLI connection tokens.
            </p>
          </div>
          <AuthView path={path} />
        </div>
      </main>
    </div>
  );
}
