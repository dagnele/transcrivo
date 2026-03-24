import type { Metadata } from "next";
import { AccountView } from "@daveyplate/better-auth-ui";
import { accountViewPaths } from "@daveyplate/better-auth-ui/server";

export const dynamicParams = false;

export const metadata: Metadata = {
  title: "Account Settings",
  robots: {
    index: false,
    follow: false,
  },
};

export function generateStaticParams() {
  return Object.values(accountViewPaths).map((path) => ({ path }));
}

type AccountPageProps = {
  params: Promise<{ path: string }>;
};

export default async function AccountPage({ params }: AccountPageProps) {
  const { path } = await params;

  return (
    <div className="flex h-full flex-col overflow-y-auto">
      <div className="mx-auto w-full max-w-2xl px-6 py-10">
        <div className="mb-6 space-y-1.5">
          <h1 className="text-xl font-semibold tracking-tight">
            Account settings
          </h1>
          <p className="text-sm text-muted-foreground">
            Manage your profile, security, and preferences.
          </p>
        </div>
        <AccountView path={path} />
      </div>
    </div>
  );
}
