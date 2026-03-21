import type { Metadata } from "next";
import { IBM_Plex_Mono, Manrope } from "next/font/google";

import { TRPCReactProvider } from "@/components/providers/trpc-provider";
import { TooltipProvider } from "@/components/ui/tooltip";

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
  title: {
    default: "Cheatcode",
    template: "%s | Cheatcode",
  },
  description: "Live interview transcript viewer.",
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
          <TooltipProvider>{children}</TooltipProvider>
        </TRPCReactProvider>
      </body>
    </html>
  );
}
