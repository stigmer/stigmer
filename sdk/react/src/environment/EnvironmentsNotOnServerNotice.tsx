"use client";

import { Notice } from "../internal/surface/Notice.js";
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
    <Notice tone="plain" role="note" headline={BANNER_HEADLINE} className={className}>
      <p className="stg:m-0">{BANNER_LINE}</p>
    </Notice>
  );
}

/** The banner's first sentence, the notice's headline, and the rest, the line under it. */
const BANNER_SPLIT = ENVIRONMENTS_NOT_ON_SERVER_BANNER.indexOf(". ") + 1;
const BANNER_HEADLINE = ENVIRONMENTS_NOT_ON_SERVER_BANNER.slice(0, BANNER_SPLIT);
const BANNER_LINE = ENVIRONMENTS_NOT_ON_SERVER_BANNER.slice(BANNER_SPLIT).trim();
