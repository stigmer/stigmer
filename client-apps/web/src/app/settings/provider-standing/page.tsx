"use client";

import { ProviderStandingConsole } from "@stigmer/react";

/**
 * Platform-operator page for provider standing: the latest canary-probe
 * verdict per platform LLM provider account (health, billing/auth
 * rejections, latency, probe freshness) recorded by the hourly standing
 * probe. Read-only — the console page is the where-operators-look twin
 * of the SigNoz standing alerts.
 *
 * Reached via the operator-gated "Platform" nav group (see
 * `useSettingsNavGroups` — fail-closed on `can_view_provider_standing`
 * on `platform:stigmer`). The nav gate is discoverability only; the
 * server permission is the real boundary, and non-operators who navigate
 * here by URL see the authorization notice the console renders.
 */
export default function ProviderStandingPage() {
  return <ProviderStandingConsole />;
}
