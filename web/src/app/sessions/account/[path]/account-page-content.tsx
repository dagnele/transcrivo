"use client";

import { AccountView } from "@daveyplate/better-auth-ui";
import { SidebarTrigger } from "@/components/ui/sidebar";

function AccountPageContent({ path }: { path: string }) {
  return (
    <div className="flex h-full flex-col">
      <header className="flex h-12 shrink-0 items-center justify-between border-b border-border/60 px-6">
        <div className="flex items-center gap-3">
          <SidebarTrigger aria-label="Toggle sessions panel" />
          <h1 className="text-sm font-medium text-foreground">Account settings</h1>
        </div>
      </header>
      <div className="flex-1 overflow-y-auto px-6 py-4">
        <div className="mx-auto w-full max-w-4xl">
          <p className="text-sm text-muted-foreground">
            Manage your profile, security, and preferences.
          </p>
          <div className="mt-8">
            <AccountView path={path} />
          </div>
        </div>
      </div>
    </div>
  );
}

export { AccountPageContent };
