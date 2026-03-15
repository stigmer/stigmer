"use client";

import { Suspense } from "react";
import { Loader2 } from "lucide-react";
import { AuthProvider, AuthGuard } from "@/auth";
import { StigmerTransportBridge } from "@/components/providers/StigmerTransportBridge";
import { OrgProvider } from "@/contexts/org-context";

/**
 * Application-level provider composition root.
 *
 * Establishes the provider nesting order:
 * 1. AuthProvider            — resolves auth mode and provides AuthContext
 * 2. AuthGuard               — blocks rendering until auth is resolved
 * 3. StigmerTransportBridge  — bridges console auth to @stigmer/* library transport
 * 4. OrgProvider             — fetches organizations and provides OrgContext
 *
 * This component is rendered once in layout.tsx and wraps the entire app.
 */
export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <AuthProvider>
      <Suspense fallback={<SuspenseFallback />}>
        <AuthGuard>
          <StigmerTransportBridge>
            <OrgProvider>{children}</OrgProvider>
          </StigmerTransportBridge>
        </AuthGuard>
      </Suspense>
    </AuthProvider>
  );
}

function SuspenseFallback() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-3">
      <Loader2 className="text-muted-foreground size-8 animate-spin" />
    </div>
  );
}
