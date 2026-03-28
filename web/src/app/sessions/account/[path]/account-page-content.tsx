"use client";

import { PanelLeft } from "lucide-react";

import { AccountView } from "@daveyplate/better-auth-ui";
import { Button } from "@/components/ui/button";
import { useSessionsSidebar } from "@/components/sessions/sessions-shell";

function AccountPageContent({ path }: { path: string }) {
  const { sidebarOpen, toggleSidebar } = useSessionsSidebar();

  return (
    <div className="flex h-full flex-col">
      <header className="flex shrink-0 items-center justify-between border-b border-border/60 px-6 py-2.5">
        <div className="flex items-center gap-3">
          {!sidebarOpen ? (
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={toggleSidebar}
              aria-label="Show sessions panel"
            >
              <PanelLeft className="h-4 w-4" />
            </Button>
          ) : null}
          <h1 className="text-sm font-medium text-foreground">Account settings</h1>
        </div>
      </header>
      <div className="flex-1 overflow-y-auto px-6 py-4">
        <p className="text-sm text-muted-foreground">
          Manage your profile, security, and preferences.
        </p>
        <div className="mt-8">
          <AccountView path={path} />
        </div>
      </div>
    </div>
  );
}

export { AccountPageContent };
