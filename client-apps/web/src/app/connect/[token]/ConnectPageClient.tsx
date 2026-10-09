"use client";

import { useMemo } from "react";
import { useTheme } from "next-themes";
import { Stigmer } from "@stigmer/sdk";
import { ConnectLinkView, StigmerProvider } from "@stigmer/react";
import type { ResolvedColorMode } from "@stigmer/react";
import { getApiBaseUrl } from "@/config/env";
import { useStaticRouteParam } from "@/domain/_shared/hooks/useStaticRouteParam";
import { StigmerLogo } from "@/auth/StigmerLogo";

/**
 * The page a Connect link opens: someone an integrator sent here signs in
 * at an address, and the login is saved into the integrator's vault for
 * them. They have no Stigmer account, so the page renders outside the
 * authenticated provider chain (`PUBLIC_ROUTES` in
 * `providers/Providers.tsx`) with its own client and no token: the link's
 * secret is the only authority. The page is the SDK's `ConnectLinkView`;
 * the login page returns to the console's callback page, which finishes the
 * sign-in (`app/auth/oauth/callback`).
 */
export default function ConnectPageClient() {
  const token = useStaticRouteParam("token");
  const { resolvedTheme } = useTheme();
  const colorMode: ResolvedColorMode = resolvedTheme === "dark" ? "dark" : "light";
  const client = useMemo(() => new Stigmer({ baseUrl: getApiBaseUrl(), getAccessToken: () => null }), []);

  return (
    <StigmerProvider client={client} colorMode={colorMode} preset="monochrome">
      <div className="flex min-h-screen flex-col items-center justify-center bg-background p-4">
        <div className="w-full max-w-sm space-y-6">
          <div className="text-center">
            <StigmerLogo />
          </div>
          <ConnectLinkView token={token ?? ""} />
        </div>
      </div>
    </StigmerProvider>
  );
}
