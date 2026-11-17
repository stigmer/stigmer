"use client";

import { cn } from "@stigmer/design-tokens";
import { TruncatedText } from "../internal/truncated-text.js";
import { UnknownPublicAddressNotice } from "../internal/UnknownPublicAddressNotice.js";
import { CopyButton, useCopy } from "../internal/CopyBlock.js";
import { Field, TextInput } from "../internal/form/index.js";

/**
 * Internal building blocks shared by the channel-app forms and panels.
 * Not exported from the package — content-level pieces stay domain-local.
 */

/** Labeled text/password input with an optional hint line: the kit's `Field`. */
export function FormField({
  id,
  label,
  value,
  onChange,
  placeholder,
  hint,
  type = "text",
  disabled,
  required,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  hint?: string;
  type?: "text" | "password";
  disabled: boolean;
  required?: boolean;
}) {
  return (
    <Field id={id} label={label} hint={hint}>
      <TextInput
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        disabled={disabled}
        required={required}
        className="stg:w-full"
      />
    </Field>
  );
}

/**
 * A single-line copyable value (webhook URL, redirect URL) with a copy
 * button that confirms briefly.
 */
export function CopyRow({
  label,
  value,
  copyTargetId,
}: {
  label: string;
  value: string;
  copyTargetId?: string;
}) {
  const { copied, copy } = useCopy(value);

  return (
    <div className="stg:space-y-1">
      <p className="stg:text-xs stg:font-medium stg:text-foreground">{label}</p>
      <div className="stg:flex stg:items-center stg:gap-1.5">
        <TruncatedText
          text={value}
          className={cn(
            "stg:min-w-0 stg:flex-1 stg:rounded-md stg:border stg:border-border stg:bg-muted-subtle",
            "stg:px-2 stg:py-1.5 stg:font-mono stg:text-2xs stg:text-foreground",
          )}
        />
        <CopyButton copied={copied} onCopy={copy} copyTargetId={copyTargetId} />
      </div>
    </div>
  );
}

/**
 * The place of a {@link CopyRow} whose URL cannot be built because the
 * server's public address is unknown: the same label, then the shared
 * notice in place of the value and its copy button.
 */
export function UnknownAddressRow({
  label,
  subject,
}: {
  label: string;
  subject: string;
}) {
  return (
    <div className="stg:space-y-1">
      <p className="stg:text-xs stg:font-medium stg:text-foreground">{label}</p>
      <UnknownPublicAddressNotice subject={subject} />
    </div>
  );
}
