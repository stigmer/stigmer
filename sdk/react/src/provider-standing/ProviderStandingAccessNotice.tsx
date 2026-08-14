"use client";

import { cn } from "@stigmer/theme";

/**
 * The access-denied state for the provider-standing operator surface.
 * Server-side authorization (`can_view_provider_standing` on
 * `platform:stigmer`) is the real gate — this is the honest, designed
 * face of that denial for anyone who navigates to the operator route
 * without the permission, instead of a raw RPC error string.
 */
export function ProviderStandingAccessNotice({
  className,
}: {
  readonly className?: string;
}) {
  return (
    <div
      className={cn(
        "stg:rounded-lg stg:border stg:border-border stg:bg-card stg:px-4 stg:py-6 stg:text-center",
        className,
      )}
      role="status"
    >
      <p className="stg:text-xs stg:font-semibold stg:text-foreground">
        Platform operator access required
      </p>
      <p className="stg:mx-auto stg:mt-1 stg:max-w-md stg:text-xs stg:text-muted-foreground">
        Provider standing reports the health of the platform&apos;s own LLM
        provider accounts, which is Stigmer-internal. It needs the platform
        operator role — organization roles do not grant it. If you believe
        you should have access, contact a platform operator.
      </p>
    </div>
  );
}
