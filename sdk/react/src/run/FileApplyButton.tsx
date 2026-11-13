"use client";

import { Button } from "../button/Button.js";
import { SpinnerIcon } from "../internal/thread-card/glyphs.js";

/** Props for {@link FileApplyButton}. */
export interface FileApplyButtonProps {
  /** CTA label (`"Apply to org"`). */
  readonly label: string;
  /**
   * Whether the producing run is terminal. The apply/push action is only
   * enabled once the run has finished; a mid-run File renders the
   * button disabled (its content may still change).
   */
  readonly isTerminal: boolean;
  /** `true` while the apply/push is in-flight. */
  readonly isApplying: boolean;
  /** Perform the apply/push. */
  readonly onApply: () => void;
}

/**
 * The primary "Apply to [org]" action for a detected
 * resource in a File, shared by every File chrome (the preview modal's
 * action bar and the editor-area `FileDocument` toolbar) so its
 * terminal-gating, in-flight, and disabled states are single-source.
 *
 * All visual properties flow through `--stgm-*` tokens.
 */
export function FileApplyButton({
  label,
  isTerminal,
  isApplying,
  onApply,
}: FileApplyButtonProps) {
  const canApply = isTerminal && !isApplying;

  return (
    <Button
      size="xs"
      onClick={canApply ? onApply : undefined}
      disabled={!canApply}
      aria-busy={isApplying}
      icon={isApplying ? <SpinnerIcon size={12} className="stg:shrink-0" /> : undefined}
    >
      {isApplying ? <>Applying{"\u2026"}</> : label}
    </Button>
  );
}

