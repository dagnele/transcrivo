import { AuthView } from "@daveyplate/better-auth-ui";
import { authViewPaths } from "@daveyplate/better-auth-ui/server";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { auth } from "@/lib/auth";

export const dynamicParams = false;

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
    <main className="flex min-h-screen items-center justify-center bg-background px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-6 space-y-1.5 px-1">
          <p className="text-[11px] font-medium uppercase tracking-[0.24em] text-muted-foreground">
            Transcrivo
          </p>
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
  );
}
