"use client";

import { Suspense } from "react";
import { ThemeProvider } from "next-themes";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { isRetryableError } from "@stigmer/sdk";
import { AuthProvider, AuthGuard } from "@/auth";
import { StigmerTransportBridge } from "@/components/providers/StigmerTransportBridge";
import { Toaster } from "@/components/ui/sonner";
import { OrgProvider } from "@/contexts/org-context";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: (failureCount, error) => {
        if (!isRetryableError(error)) return false;
        return failureCount < 1;
      },
      refetchOnWindowFocus: true,
    },
    mutations: {
      retry: false,
    },
  },
});

/**
 * Application-level provider composition root.
 *
 * Establishes the provider nesting order:
 * 1. ThemeProvider           — manages dark/light/system class on <html>
 * 2. AuthProvider            — resolves auth mode and provides AuthContext
 * 3. AuthGuard               — blocks rendering until auth is resolved
 * 4. QueryClientProvider     — TanStack Query cache and state management
 * 5. StigmerTransportBridge  — bridges console auth to @stigmer/* library transport
 * 6. OrgProvider             — fetches organizations and provides OrgContext
 * 7. Toaster                 — sonner toast container (themed, top-right)
 *
 * Query retry strategy:
 * - Only transient errors (server / unavailable) are retried once
 * - Auth, permission, not-found, and validation errors fail immediately
 * - Mutations are never retried (not idempotent by default)
 *
 * This component is rendered once in layout.tsx and wraps the entire app.
 */
export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
      <AuthProvider>
        <Suspense fallback={<SuspenseFallback />}>
          <AuthGuard>
            <QueryClientProvider client={queryClient}>
              <StigmerTransportBridge>
                <OrgProvider>
                  {children}
                  <Toaster />
                </OrgProvider>
              </StigmerTransportBridge>
            </QueryClientProvider>
          </AuthGuard>
        </Suspense>
      </AuthProvider>
    </ThemeProvider>
  );
}

function SuspenseFallback() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-3">
      <Loader2 className="text-muted-foreground size-8 animate-spin" />
    </div>
  );
}
