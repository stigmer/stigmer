"use client";

import { timestampDate } from "@bufbuild/protobuf/wkt";
import type { Timestamp } from "@bufbuild/protobuf/wkt";
import { formatRelativeTime } from "../activity/format-relative-time.js";
import { Tooltip, TooltipContent, TooltipTrigger } from "./tooltip.js";

/** Props for {@link LastUsedLabel}. */
export interface LastUsedLabelProps {
  /** The credential's `status.last_used_at`; absent means it was never used. */
  readonly at: Timestamp | undefined;
  /** Frozen clock for tests; defaults to the wall clock. */
  readonly now?: Date;
}

/**
 * When a credential was last used, said one way on every surface that
 * lists credentials (API keys, platform clients): "Used 5m" in the SDK's
 * compact relative vocabulary, with the exact instant in a tooltip, or
 * "Never used". The label names what the time is, because it sits beside
 * other dates (created, expires) in the same row.
 *
 * The server records a use at most once a minute, so "Used now" means
 * within the last minute or so.
 */
export function LastUsedLabel({ at, now }: LastUsedLabelProps) {
  if (at === undefined) {
    return <span>Never used</span>;
  }
  const date = timestampDate(at);
  return (
    <Tooltip>
      <TooltipTrigger render={<time dateTime={date.toISOString()} />}>
        {`Used ${formatRelativeTime(date, now)}`}
      </TooltipTrigger>
      <TooltipContent side="top">
        {`Last used ${date.toISOString()}`}
      </TooltipContent>
    </Tooltip>
  );
}
