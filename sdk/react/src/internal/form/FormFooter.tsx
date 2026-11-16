"use client";

// Every form ends the same way: the primary act, then Cancel beside it,
// one size. A form on a page sets them at its start (`align="start"`), the
// act first; a dialog sets them at its end (`align="end"`), Cancel first and
// the act where the eye ends. A failure of the whole form is the kit's
// `ErrorMessage`, passed as `failure` and drawn above the acts; a field's
// error belongs under its field, not here. While the act runs it keeps its
// words, waits with a spinner, and Cancel waits too.

import type { ReactNode } from "react";
import { cn } from "@stigmer/design-tokens";
import { Button } from "../../button/Button.js";
import type { ButtonVariant } from "../../button/buttonClasses.js";
import { SpinnerIcon } from "../SpinnerIcon.js";

/** Props for {@link FormFooter}. */
export interface FormFooterProps {
  /** The primary act's words ("Create routine"). */
  readonly submitLabel: ReactNode;
  /** Its click, when it isn't the form's submit. */
  readonly onSubmit?: () => void;
  /** `submit` (the default) submits the enclosing form. */
  readonly submitType?: "submit" | "button";
  /** The act's look: `primary`, or `destructive` for a delete's confirm. */
  readonly submitVariant?: Extract<ButtonVariant, "primary" | "destructive">;
  /** Holds the act (a required field is empty, the server would refuse). */
  readonly submitDisabled?: boolean;
  /** The act is running: it waits, with its words. */
  readonly busy?: boolean;
  /** Cancel's click; no Cancel without one. */
  readonly onCancel?: () => void;
  readonly cancelLabel?: string;
  /** The form's failure, an `ErrorMessage`, drawn above the acts. */
  readonly failure?: ReactNode;
  /** `start` on a page, the act first; `end` in a dialog, Cancel first. */
  readonly align?: "start" | "end";
  /** More acts, after the primary and Cancel (a page) or before them (a dialog). */
  readonly extra?: ReactNode;
  readonly className?: string;
}

/** A form's acts: the primary act and Cancel, with the form's failure above them. */
export function FormFooter({
  submitLabel,
  onSubmit,
  submitType = "submit",
  submitVariant = "primary",
  submitDisabled,
  busy,
  onCancel,
  cancelLabel = "Cancel",
  failure,
  align = "start",
  extra,
  className,
}: FormFooterProps) {
  const submit = (
    <Button
      type={submitType}
      variant={submitVariant}
      onClick={onSubmit}
      disabled={submitDisabled || busy}
      icon={busy ? <SpinnerIcon size={14} /> : undefined}
    >
      {submitLabel}
    </Button>
  );
  const cancel = onCancel ? (
    <Button variant="ghost" onClick={onCancel} disabled={busy}>
      {cancelLabel}
    </Button>
  ) : null;
  const atEnd = align === "end";
  return (
    <div className={cn("stg:flex stg:flex-col stg:gap-3", className)}>
      {failure}
      <div
        className={cn(
          "stg:flex stg:flex-wrap stg:items-center stg:gap-2",
          atEnd ? "stg:justify-end" : undefined,
        )}
      >
        {atEnd ? (
          <>
            {extra}
            {cancel}
            {submit}
          </>
        ) : (
          <>
            {submit}
            {cancel}
            {extra}
          </>
        )}
      </div>
    </div>
  );
}
