"use client";

// The form an admin saves an organization's key with: the key (never shown
// again once saved), and for a provider that can be served from an endpoint
// of the organization's own, that endpoint. Saving asks the provider about
// the key first (the server's check), so the button reads "Checking…" while
// it does; a refusal is the server's own words.

import { useId, useState } from "react";
import { cn } from "@stigmer/design-tokens";
import { getUserMessage } from "@stigmer/client";
import { Button } from "../../button/index.js";
import { useProviderKeyActions, type ProviderKeyProvider } from "../../billing/useProviderKeys.js";
import { presentationOf } from "../provider-presentation.js";

/** The hub's text inputs' and selects' classes. */
export const INPUT_CLASSES = cn(
  "stg:w-full stg:rounded-md stg:border stg:border-input stg:bg-background stg:px-2.5 stg:py-1.5 stg:text-xs stg:text-foreground",
  "stg:placeholder:text-muted-foreground",
  "stg:focus-visible:outline-none stg:focus-visible:ring-1 stg:focus-visible:ring-ring",
  "stg:disabled:pointer-events-none stg:disabled:opacity-50",
);

/** Props for {@link ProviderKeyForm}. */
export interface ProviderKeyFormProps {
  readonly org: string;
  /** The provider the key is for. */
  readonly provider: ProviderKeyProvider;
  /** The endpoint the saved key uses, when replacing one. */
  readonly initialBaseUrl?: string;
  readonly onSaved: () => void;
  readonly onCancel?: () => void;
  /** The submit button's words; "Save key" by default. */
  readonly submitLabel?: string;
}

/** Saves an organization's key for one provider, optionally against its own endpoint. The caller needs `can_manage_billing`. */
export function ProviderKeyForm({ org, provider, initialBaseUrl = "", onSaved, onCancel, submitLabel = "Save key" }: ProviderKeyFormProps) {
  const presentation = presentationOf(provider);
  const actions = useProviderKeyActions();
  const inputId = useId();
  const keyHintId = useId();
  const baseUrlId = useId();
  const baseUrlHintId = useId();
  const [value, setValue] = useState("");
  const [baseUrl, setBaseUrl] = useState(initialBaseUrl);

  const save = async () => {
    try {
      await actions.setKey(
        org,
        provider,
        value.trim(),
        presentation.baseUrlExample === null ? "" : baseUrl.trim(),
      );
      setValue("");
      onSaved();
    } catch {
      // The hook holds the error; the form renders it.
    }
  };

  return (
    <form
      className="stg:space-y-2"
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
    >
      <div className="stg:flex stg:flex-wrap stg:items-end stg:gap-2">
        <div className="stg:min-w-56 stg:flex-[2] stg:space-y-1">
          <label htmlFor={inputId} className="stg:text-foreground stg:text-xs stg:font-medium">
            {presentation.name} API key
          </label>
          <input
            id={inputId}
            type="password"
            autoComplete="off"
            value={value}
            onChange={(event) => setValue(event.target.value)}
            placeholder={presentation.placeholder}
            aria-describedby={keyHintId}
            disabled={actions.isSubmitting}
            className={INPUT_CLASSES}
          />
        </div>
        {presentation.baseUrlExample !== null && (
          <div className="stg:min-w-48 stg:flex-1 stg:space-y-1">
            <label htmlFor={baseUrlId} className="stg:text-foreground stg:text-xs stg:font-medium">
              Base URL (optional)
            </label>
            <input
              id={baseUrlId}
              type="url"
              inputMode="url"
              autoComplete="off"
              value={baseUrl}
              onChange={(event) => setBaseUrl(event.target.value)}
              placeholder={presentation.baseUrlExample}
              aria-describedby={baseUrlHintId}
              disabled={actions.isSubmitting}
              className={INPUT_CLASSES}
            />
          </div>
        )}
        <div className="stg:flex stg:gap-2">
          <Button size="sm" type="submit" disabled={actions.isSubmitting || value.trim() === ""}>
            {actions.isSubmitting ? "Checking…" : submitLabel}
          </Button>
          {onCancel && (
            <Button size="sm" variant="ghost" type="button" onClick={onCancel} disabled={actions.isSubmitting}>
              Cancel
            </Button>
          )}
        </div>
      </div>
      <p id={keyHintId} className="stg:text-muted-foreground stg:text-2xs">
        Stigmer checks the key with {presentation.name} when you save it, and never shows it again: only its last
        four characters.
      </p>
      {presentation.baseUrlExample !== null && (
        <p id={baseUrlHintId} className="stg:text-muted-foreground stg:text-2xs">
          Leave the base URL empty for {presentation.name}&apos;s own API, or give your own{" "}
          {presentation.name}-compatible endpoint, such as {presentation.baseUrlExample}.
        </p>
      )}
      {actions.error && (
        <p role="alert" className="stg:text-destructive stg:text-xs">
          {getUserMessage(actions.error)}
        </p>
      )}
    </form>
  );
}
