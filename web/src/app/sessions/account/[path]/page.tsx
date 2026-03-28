import type { Metadata } from "next";
import { accountViewPaths } from "@daveyplate/better-auth-ui/server";

import { AccountPageContent } from "./account-page-content";

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

  return <AccountPageContent path={path} />;
}
