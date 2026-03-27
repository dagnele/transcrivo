import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { redirect } from "next/navigation";
import {
  ArrowRight,
  Check,
  Mic,
  Terminal,
  Timer,
  Zap,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { SiteHeader } from "@/components/site-header";
import { getOptionalSession } from "@/server/auth-session";

export const metadata: Metadata = {
  title: "Local Whisper Transcription With Live AI Assistance",
  description:
    "Run local Whisper transcription during interviews and meetings, stream transcripts live, and get transcript-grounded AI assistance in your browser.",
  alternates: {
    canonical: "/",
  },
  openGraph: {
    title: "Transcrivo",
    description:
      "Run local Whisper transcription during interviews and meetings, stream transcripts live, and get transcript-grounded AI assistance in your browser.",
    url: "/",
  },
  twitter: {
    title: "Transcrivo",
    description:
      "Run local Whisper transcription during interviews and meetings, stream transcripts live, and get transcript-grounded AI assistance in your browser.",
  },
};

export default async function HomePage() {
  const session = await getOptionalSession();

  if (session) {
    redirect("/sessions");
  }

  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      {/* Nav */}
      <SiteHeader />

      {/* Hero */}
      <section className="mx-auto flex w-full max-w-5xl flex-col items-center px-6 pt-20 pb-16 text-center sm:pt-28 sm:pb-20">
        <Badge variant="secondary" className="mb-6">
          Local Whisper &middot; Real-time AI
        </Badge>
        <h1 className="max-w-3xl text-3xl font-semibold leading-tight tracking-tight sm:text-4xl md:text-5xl">
          Live transcription with AI&#8209;powered&nbsp;solutions
        </h1>
        <p className="mt-4 max-w-xl text-sm leading-relaxed text-muted-foreground sm:text-base">
          Capture audio locally, transcribe in real time with Whisper, and get
          AI&#8209;generated solutions streamed to a split&#8209;pane workspace.
        </p>
        <div className="mt-8 flex items-center gap-3">
          <Button size="lg" asChild>
            <Link href="/auth/sign-up">
              Start free trial
              <ArrowRight data-icon="inline-end" className="size-4" />
            </Link>
          </Button>
          <Button variant="outline" size="lg" asChild>
            <Link href="/auth/sign-in">Sign in</Link>
          </Button>
        </div>

        <div className="mt-14 w-full overflow-hidden rounded-xl border border-border ring-1 ring-foreground/[0.06]">
          <div className="flex items-center gap-1.5 border-b border-border px-4 py-2.5">
            <span className="size-2.5 rounded-full bg-muted-foreground/20" />
            <span className="size-2.5 rounded-full bg-muted-foreground/20" />
            <span className="size-2.5 rounded-full bg-muted-foreground/20" />
            <span className="ml-3 text-[10px] text-muted-foreground/50">
              transcrivo &mdash; live session
            </span>
          </div>
          <Image
            src="/images/screenshot-session.png"
            alt="Transcrivo live session"
            width={1920}
            height={1080}
            className="w-full"
            priority
          />
        </div>
      </section>

      <Separator className="mx-auto w-full max-w-5xl" />

      {/* How it works */}
      <section className="mx-auto w-full max-w-5xl px-6 py-16 sm:py-20">
        <p className="text-center text-[11px] font-medium uppercase tracking-[0.24em] text-muted-foreground">
          How it works
        </p>
        <h2 className="mt-2 text-center text-2xl font-semibold tracking-tight sm:text-3xl">
          Three steps. That&apos;s it.
        </h2>

        <div className="mt-12 grid gap-6 sm:grid-cols-3">
          <StepCard
            step="1"
            icon={<Zap className="size-4" />}
            title="Create a session"
            description="Open the web app, pick a session type — coding, system design, writing, or meeting — and you're ready."
          />
          <StepCard
            step="2"
            icon={<Terminal className="size-4" />}
            title="Connect the CLI"
            description="Generate a token, run the Rust CLI locally. It captures mic and system audio, transcribes with Whisper on your machine."
          />
          <StepCard
            step="3"
            icon={<Mic className="size-4" />}
            title="Live transcripts + AI"
            description="Watch real-time transcripts stream in. The AI analyzes the conversation and generates solutions in a split-pane view."
          />
        </div>

        {/* CLI snippet */}
        <div className="mx-auto mt-12 max-w-xl">
          <pre className="overflow-x-auto rounded-lg border border-border bg-muted/30 px-5 py-4 font-mono text-xs leading-relaxed text-muted-foreground">
            <span className="text-foreground/50">$</span>{" "}
            <span className="text-foreground">transcrivo run</span> \{"\n"}
            {"  "}--token &lt;your-token&gt;
          </pre>
        </div>
      </section>

      <Separator className="mx-auto w-full max-w-5xl" />

      {/* Pricing */}
      <section className="mx-auto w-full max-w-5xl px-6 py-16 sm:py-20">
        <p className="text-center text-[11px] font-medium uppercase tracking-[0.24em] text-muted-foreground">
          Pricing
        </p>
        <h2 className="mt-2 text-center text-2xl font-semibold tracking-tight sm:text-3xl">
          Start free, pay per session
        </h2>
        <p className="mx-auto mt-3 max-w-md text-center text-sm text-muted-foreground">
          No subscriptions. Buy session credits when you need them.
        </p>

        <div className="mt-12 grid gap-6 sm:grid-cols-2">
          {/* Trial */}
          <Card>
            <CardHeader>
              <div className="flex items-center gap-2">
                <CardTitle>Free Trial</CardTitle>
                <Badge variant="secondary">One-time</Badge>
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-3xl font-semibold tracking-tight">
                $0
                <span className="ml-1 text-sm font-normal text-muted-foreground">
                  / 1 session
                </span>
              </p>
              <ul className="space-y-2 text-sm text-muted-foreground">
                <PricingFeature>1 free session per account</PricingFeature>
                <PricingFeature>5-minute session limit</PricingFeature>
                <PricingFeature>Full live transcript</PricingFeature>
                <PricingFeature>AI-powered solutions</PricingFeature>
                <PricingFeature>Local Whisper transcription</PricingFeature>
              </ul>
            </CardContent>
            <CardFooter>
              <Button variant="outline" className="w-full" asChild>
                <Link href="/auth/sign-up">Try for free</Link>
              </Button>
            </CardFooter>
          </Card>

          {/* Paid */}
          <Card className="ring-foreground/20">
            <CardHeader>
              <div className="flex items-center gap-2">
                <CardTitle>Session Credits</CardTitle>
                <Badge>Pay per session</Badge>
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-3xl font-semibold tracking-tight">
                $10
                <span className="ml-1 text-sm font-normal text-muted-foreground">
                  / session
                </span>
              </p>
              <ul className="space-y-2 text-sm text-muted-foreground">
                <PricingFeature included>
                  Everything in free trial
                </PricingFeature>
                <PricingFeature included>
                  1-hour session duration
                </PricingFeature>
                <PricingFeature included>
                  Buy credits as needed
                </PricingFeature>
                <PricingFeature included>
                  Credits never expire
                </PricingFeature>
                <PricingFeature included>
                  Priority AI models
                </PricingFeature>
              </ul>
            </CardContent>
            <CardFooter>
              <Button className="w-full" asChild>
                <Link href="/auth/sign-up">Get started</Link>
              </Button>
            </CardFooter>
          </Card>
        </div>
      </section>

      {/* Footer */}
      <footer className="mt-auto border-t border-border px-6 py-6 text-center text-xs text-muted-foreground">
        &copy; {new Date().getFullYear()} Transcrivo. All rights reserved.
      </footer>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Local sub-components                                               */
/* ------------------------------------------------------------------ */

function StepCard({
  step,
  icon,
  title,
  description,
}: {
  step: string;
  icon: React.ReactNode;
  title: string;
  description: string;
}) {
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <span className="flex size-6 items-center justify-center rounded-md bg-muted text-xs font-medium text-muted-foreground">
            {step}
          </span>
          <span className="text-muted-foreground">{icon}</span>
        </div>
        <CardTitle className="mt-2">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-sm leading-relaxed text-muted-foreground">
          {description}
        </p>
      </CardContent>
    </Card>
  );
}

function PricingFeature({
  children,
  included,
}: {
  children: React.ReactNode;
  included?: boolean;
}) {
  return (
    <li className="flex items-start gap-2">
      {included ? (
        <Check className="mt-0.5 size-3.5 shrink-0 text-foreground" />
      ) : (
        <Timer className="mt-0.5 size-3.5 shrink-0 text-muted-foreground/50" />
      )}
      <span>{children}</span>
    </li>
  );
}
