import Link from "next/link";

import { Button } from "@/components/ui/button";

export function SiteHeader() {
  return (
    <header className="flex items-center justify-between px-6 py-4 sm:px-10">
      <Link
        href="/"
        className="text-[11px] font-medium uppercase tracking-[0.24em] text-muted-foreground transition-colors hover:text-foreground"
      >
        Transcrivo
      </Link>
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="sm" asChild>
          <Link href="/auth/sign-in">Sign in</Link>
        </Button>
        <Button size="sm" asChild>
          <Link href="/auth/sign-up">Get started</Link>
        </Button>
      </div>
    </header>
  );
}
