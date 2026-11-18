"use client";

import { UnknownPublicAddressNotice } from "../internal/UnknownPublicAddressNotice.js";
import { useCopy } from "../internal/CopyBlock.js";
import { Copy } from "lucide-react";
import { Button } from "../button/Button.js";
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

  // A copy row is a read-only field at the fields' size, its Copy beside it.
  return (
    <Field label={label}>
      <div className="stg:flex stg:min-w-0 stg:items-center stg:gap-2">
        <TextInput
          readOnly
          value={value}
          className="stg:min-w-0 stg:flex-1 stg:font-mono"
          onFocus={(e) => e.currentTarget.select()}
        />
        <Button
          variant="outline"
          size="sm"
          onClick={copy}
          data-cursor-target={copyTargetId}
          icon={<Copy className="stg:size-3.5" aria-hidden="true" />}
          aria-live="polite"
        >
          {copied ? "Copied" : "Copy"}
        </Button>
      </div>
    </Field>
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
