"use client";

import { cn } from "@stigmer/design-tokens";
import { useEnvironmentAvailability } from "../server-info.js";
import { ENVIRONMENTS_NOT_ON_SERVER_BANNER } from "./copy.js";

/** Props for {@link EnvironmentsNotOnServerNotice}. */
export interface EnvironmentsNotOnServerNoticeProps {
  /** Additional CSS class names for the root element. */
  readonly className?: string;
}

/**
 * The note over the Environments list and form on a server whose
 * conversations run in no sandbox it starts (the default open-source
 * install): no Environment applies there, and one can still be written for
 * a server where one does. Renders nothing anywhere else, including while
 * the server's answer loads and on a server that predates it.
 *
 * @example
 * ```tsx
 * <EnvironmentsNotOnServerNotice className="stg:mb-4" />
 * ```
 */
export function EnvironmentsNotOnServerNotice({ className }: EnvironmentsNotOnServerNoticeProps) {
  const availability = useEnvironmentAvailability();
  if (availability?.applies !== false) {
    return null;
  }
  return (
    <p
      role="note"
      className={cn(
        "stg:rounded-md stg:border stg:border-border stg:bg-muted stg:px-3 stg:py-2 stg:text-sm stg:text-foreground",
        className,
      )}
    >
      {ENVIRONMENTS_NOT_ON_SERVER_BANNER}
    </p>
  );
}
