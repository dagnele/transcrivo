import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, Terminal } from "lucide-react";

import { InstallCommandBuilder } from "@/components/install/install-command-builder";
import { SiteHeader } from "@/components/site-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

export const metadata: Metadata = {
  title: "Install CLI",
  description: "Install the Transcrivo CLI from the latest release binaries.",
  alternates: {
    canonical: "/install",
  },
  openGraph: {
    title: "Install the Transcrivo CLI",
    description: "Install the Transcrivo CLI from the latest release binaries.",
    url: "/install",
  },
  twitter: {
    title: "Install the Transcrivo CLI",
    description: "Install the Transcrivo CLI from the latest release binaries.",
  },
};

export default async function InstallPage() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <SiteHeader />

      <main className="mx-auto flex w-full max-w-6xl flex-col gap-10 px-6 pt-10 pb-16 sm:px-10 sm:pt-16 sm:pb-24">
        <div className="space-y-5">
          <Badge variant="secondary" className="w-fit">
            CLI install
          </Badge>
          <div className="max-w-3xl space-y-4">
            <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
              Install the Transcrivo CLI from one place.
            </h1>
            <p className="text-sm leading-relaxed text-muted-foreground sm:text-base">
              Choose your operating system and runtime backend, copy the installer command,
              and you are ready to generate a token and connect a live session.
            </p>
          </div>

          <div className="flex flex-wrap gap-3">
            <Button variant="outline" asChild>
              <Link href="/">
                <ArrowLeft className="h-4 w-4" />
                Back home
              </Link>
            </Button>
          </div>
        </div>

        <InstallCommandBuilder />

        <section className="rounded-2xl border border-border/70 bg-muted/20 px-6 py-5">
          <div className="flex items-start gap-3">
            <div className="rounded-full border border-border/70 bg-background p-2">
              <Terminal className="h-4 w-4" />
            </div>
            <div className="space-y-2">
              <h2 className="text-sm font-semibold tracking-tight sm:text-base">
                After installation
              </h2>
              <p className="text-sm leading-relaxed text-muted-foreground">
                Open the web app, create a session, generate a token, then run this in your terminal:
                <span className="mt-2 block rounded bg-background px-3 py-2 font-mono text-xs text-foreground">
                  transcrivo run --token YOUR_TOKEN
                </span>
              </p>
              <p className="text-sm leading-relaxed text-muted-foreground">
                List available audio devices:
                <span className="mt-2 block rounded bg-background px-3 py-2 font-mono text-xs text-foreground">
                  transcrivo devices
                </span>
                Use{" "}
                <span className="font-mono text-xs">--mic-device</span> to select your microphone and{" "}
                <span className="font-mono text-xs">--system-device</span> to capture system audio (e.g., speakers).
                Example:
                <span className="mt-2 block rounded bg-background px-3 py-2 font-mono text-xs text-foreground">
                  transcrivo run --token YOUR_TOKEN --mic-device mic-1 --system-device loopback-1
                </span>
              </p>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}
