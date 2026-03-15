"use client";

import { Suspense } from "react";
import { ThemeProvider } from "next-themes";
import { Loader2 } from "lucide-react";
import { AuthProvider, AuthGuard } from "@/auth";
import { StigmerTransportBridge } from "@/components/providers/StigmerTransportBridge";
import { OrgProvider } from "@/contexts/org-context";

/**
 * Application-level provider composition root.
 *
 * Establishes the provider nesting order:
 * 1. ThemeProvider           — manages dark/light/system class on <html>
 * 2. AuthProvider            — resolves auth mode and provides AuthContext
 * 3. AuthGuard               — blocks rendering until auth is resolved
 * 4. StigmerTransportBridge  — bridges console auth to @stigmer/* library transport
 * 5. OrgProvider             — fetches organizations and provides OrgContext
 *
 * This component is rendered once in layout.tsx and wraps the entire app.
 */
export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
      <AuthProvider>
        <Suspense fallback={<SuspenseFallback />}>
          <AuthGuard>
            <StigmerTransportBridge>
              <OrgProvider>{children}</OrgProvider>
            </StigmerTransportBridge>
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
