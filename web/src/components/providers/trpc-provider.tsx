"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  createTRPCClient,
  httpBatchLink,
  httpSubscriptionLink,
  splitLink,
} from "@trpc/client";
import { useState } from "react";
import superjson from "superjson";

import { TRPCProvider } from "@/lib/trpc";
import type { AppRouter } from "@/server/api/root";

function makeQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
      },
    },
  });
}

function makeTRPCClient() {
  return createTRPCClient<AppRouter>({
    links: [
      splitLink({
        condition: (op) => op.type === "subscription",
        true: httpSubscriptionLink({
          transformer: superjson,
          url: "/api/trpc",
        }),
        false: httpBatchLink({
          transformer: superjson,
          url: "/api/trpc",
        }),
      }),
    ],
  });
}

export function TRPCReactProvider({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(makeQueryClient);
  const [trpcClient] = useState(makeTRPCClient);

  return (
    <QueryClientProvider client={queryClient}>
      <TRPCProvider queryClient={queryClient} trpcClient={trpcClient}>
        {children}
      </TRPCProvider>
    </QueryClientProvider>
  );
}
