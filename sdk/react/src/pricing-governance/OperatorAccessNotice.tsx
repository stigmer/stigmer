"use client";

import { cn } from "@stigmer/theme";

/**
 * The access-denied state for platform-operator pricing surfaces
 * (governance + catalog panels). Server-side authorization
 * (`can_manage_model_pricing` on `platform:stigmer`) is the real gate —
 * this is the honest, designed face of that denial for anyone who
 * navigates to an operator route without the permission, instead of a
 * raw RPC error string.
 */
export function OperatorAccessNotice({ className }: { readonly className?: string }) {
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
        Model pricing governance is a Stigmer-internal surface. It needs the
        platform operator role — organization roles do not grant it. If you
        believe you should have access, contact a platform operator.
      </p>
    </div>
  );
}
