"use client";

import { useCallback } from "react";
import { CodeBlock } from "./CodeBlock.js";
import { useCopyFeedback } from "./useCopyFeedback.js";
import { Button } from "../button/Button.js";

/**
 * Copyable values shared across domains: a multi-line block (a channel
 * app's manifest, a routine's curl) and the copy button single-line rows
 * pair with. Internal: not exported from the package.
 */

/**
 * A multi-line copyable value (an app manifest, a command) in a scrollable
 * block, which the keyboard reaches as a region named by `label`. `tall`
 * gives a whole source file room to be read in place; `caption` says what
 * the value is for beside its label ("a page to try it"), outside the
 * region's name.
 */
export function CopyBlock({
  label,
  value,
  copyTargetId,
  tall = false,
  caption,
}: {
  label: string;
  value: string;
  copyTargetId?: string;
  tall?: boolean;
  caption?: string;
}) {
  const { copied, copy } = useCopy(value);

  return (
    <div className="stg:space-y-1">
      <div className="stg:flex stg:items-center stg:justify-between">
        <p className="stg:text-2xs stg:font-medium stg:text-muted-foreground">
          {label}
          {caption !== undefined && <span className="stg:font-normal">, {caption}</span>}
        </p>
        <CopyButton copied={copied} onCopy={copy} copyTargetId={copyTargetId} />
      </div>
      <CodeBlock size="2xs" label={label} maxHeight={tall ? "96" : "40"}>
        {value}
      </CodeBlock>
    </div>
  );
}

/** The copy button beside a copyable value; says "Copied" briefly. */
export function CopyButton({
  copied,
  onCopy,
  copyTargetId,
}: {
  copied: boolean;
  onCopy: () => void;
  copyTargetId?: string;
}) {
  return (
    <Button
      variant="outline"
      size="xs"
      onClick={onCopy}
      data-cursor-target={copyTargetId}
      className={copied ? "stg:text-status-ready" : undefined}
      aria-live="polite"
    >
      {copied ? "Copied" : "Copy"}
    </Button>
  );
}

/** Copies one held value and flashes the `copied` flag. */
export function useCopy(value: string) {
  const { copy: copyText, copied } = useCopyFeedback();

  const copy = useCallback(() => {
    void copyText(value);
  }, [copyText, value]);

  return { copied, copy };
}
