import type { Metadata } from "next";
import { IBM_Plex_Mono, Manrope } from "next/font/google";

import { AuthProvider } from "@/components/providers/auth-provider";
import { TRPCReactProvider } from "@/components/providers/trpc-provider";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { getSiteUrl } from "@/lib/site";

import "./globals.css";

const manrope = Manrope({
  variable: "--font-manrope",
  subsets: ["latin"],
});

const ibmPlexMono = IBM_Plex_Mono({
  variable: "--font-ibm-plex-mono",
  weight: ["400", "500"],
  subsets: ["latin"],
});

export const metadata: Metadata = {
  metadataBase: getSiteUrl(),
  title: {
    default: "Transcrivo",
    template: "%s | Transcrivo",
  },
  description:
    "Transcribe live conversations locally with Whisper, stream them to the web, and get transcript-grounded AI help in real time.",
  applicationName: "Transcrivo",
  alternates: {
    canonical: "/",
  },
  openGraph: {
    type: "website",
    url: "/",
    siteName: "Transcrivo",
    title: "Transcrivo",
    description:
      "Transcribe live conversations locally with Whisper, stream them to the web, and get transcript-grounded AI help in real time.",
  },
  twitter: {
    card: "summary_large_image",
    title: "Transcrivo",
    description:
      "Transcribe live conversations locally with Whisper, stream them to the web, and get transcript-grounded AI help in real time.",
  },
  robots: {
    index: true,
    follow: true,
  },
  icons: {
    icon: "/transcrivo.svg",
    shortcut: "/transcrivo.svg",
    apple: "/transcrivo.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${manrope.variable} ${ibmPlexMono.variable} h-full antialiased`}
    >
      <body className="h-full bg-background text-foreground">
        <TRPCReactProvider>
          <AuthProvider>
            <TooltipProvider>
              {children}
              <Toaster />
            </TooltipProvider>
          </AuthProvider>
        </TRPCReactProvider>
      </body>
    </html>
  );
}
