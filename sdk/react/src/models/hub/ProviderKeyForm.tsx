"use client";

// The form an admin saves an organization's key with: the key (never shown
// again once saved), where to get one, and for a provider that can be served
// from an endpoint of the organization's own, that endpoint. Most people use
// the provider's own API and never need the endpoint, so it waits behind a
// quiet "Use your own endpoint" link: closed until opened, and open from the
// start when the key being replaced already uses one. What is saved is what
// shows: a closed endpoint saves none. Saving asks the provider about the key
// first (the server's check), so the button reads "Checking…" while it does;
// a refusal is the server's own words.

import { useEffect, useId, useRef, useState } from "react";
import { getUserMessage } from "@stigmer/client";
import { ArrowUpRight } from "lucide-react";
import { Button } from "../../button/index.js";
import { useProviderKeyActions, type ProviderKeyProvider } from "../../billing/useProviderKeys.js";
import { presentationOf } from "../provider-presentation.js";
import { FIELD_LABEL_CLASSES, FieldError, TextInput } from "../../internal/form/index.js";

/** Props for {@link ProviderKeyForm}. */
export interface ProviderKeyFormProps {
  readonly org: string;
  /** The provider the key is for. */
  readonly provider: ProviderKeyProvider;
  /** The endpoint the saved key uses, when replacing one; a non-empty one opens the endpoint field from the start. */
  readonly initialBaseUrl?: string;
  readonly onSaved: () => void;
  readonly onCancel?: () => void;
  /** The submit button's words; "Save key" by default. */
  readonly submitLabel?: string;
}

/**
 * Saves an organization's key for one provider, optionally against its own
 * endpoint (behind "Use your own endpoint"), and says where to get a key.
 * The caller needs `can_manage_billing`.
 */
export function ProviderKeyForm({ org, provider, initialBaseUrl = "", onSaved, onCancel, submitLabel = "Save key" }: ProviderKeyFormProps) {
  const presentation = presentationOf(provider);
  const actions = useProviderKeyActions();
  const inputId = useId();
  const keyHintId = useId();
  const baseUrlId = useId();
  const baseUrlHintId = useId();
  const endpointId = useId();
  const [value, setValue] = useState("");
  const [baseUrl, setBaseUrl] = useState(initialBaseUrl);
  const offersEndpoint = presentation.baseUrlExample !== null;
  const [endpointOpen, setEndpointOpen] = useState(initialBaseUrl !== "");
  // Opening the endpoint moves focus into its field; an endpoint open from
  // the start leaves focus where the page put it.
  const baseUrlRef = useRef<HTMLInputElement>(null);
  const focusEndpoint = useRef(false);
  useEffect(() => {
    if (!endpointOpen || !focusEndpoint.current) return;
    focusEndpoint.current = false;
    baseUrlRef.current?.focus();
  }, [endpointOpen]);

  const save = async () => {
    try {
      await actions.setKey(
        org,
        provider,
        value.trim(),
        offersEndpoint && endpointOpen ? baseUrl.trim() : "",
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
        <div className="stg:min-w-56 stg:flex-1 stg:space-y-1">
          <label htmlFor={inputId} className={FIELD_LABEL_CLASSES}>
            {presentation.name} API key
          </label>
          <TextInput
            id={inputId}
            type="password"
            autoComplete="off"
            value={value}
            onChange={(event) => setValue(event.target.value)}
            placeholder={presentation.placeholder}
            aria-describedby={keyHintId}
            disabled={actions.isSubmitting}
          />
        </div>
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
      <p id={keyHintId} className="stg:text-muted-foreground stg:text-xs">
        Stigmer checks the key with {presentation.name} when you save it, and never shows it again: only its last
        four characters.
      </p>
      {(presentation.keysUrl !== null || offersEndpoint) && (
        <div className="stg:flex stg:flex-wrap stg:items-center stg:gap-x-4 stg:gap-y-1">
          {presentation.keysUrl !== null && (
            <a
              href={presentation.keysUrl}
              target="_blank"
              rel="noreferrer"
              className="stg:inline-flex stg:items-center stg:gap-1 stg:text-xs stg:text-muted-foreground stg:hover:text-foreground"
            >
              Get a key at {presentation.keysUrlLabel}
              <ArrowUpRight aria-hidden className="stg:size-3" />
            </a>
          )}
          {offersEndpoint && (
            <button
              type="button"
              aria-expanded={endpointOpen}
              aria-controls={endpointId}
              onClick={() => {
                focusEndpoint.current = !endpointOpen;
                setEndpointOpen(!endpointOpen);
              }}
              disabled={actions.isSubmitting}
              className="stg:p-0 stg:text-xs stg:text-muted-foreground stg:underline stg:decoration-border stg:underline-offset-2 stg:hover:text-foreground stg:hover:decoration-current"
            >
              Use your own endpoint
            </button>
          )}
        </div>
      )}
      {offersEndpoint && endpointOpen && (
        <div id={endpointId} className="stg:space-y-1">
          <label htmlFor={baseUrlId} className={FIELD_LABEL_CLASSES}>
            Base URL (optional)
          </label>
          <TextInput
            ref={baseUrlRef}
            id={baseUrlId}
            type="url"
            inputMode="url"
            autoComplete="off"
            value={baseUrl}
            onChange={(event) => setBaseUrl(event.target.value)}
            placeholder={presentation.baseUrlExample ?? undefined}
            aria-describedby={baseUrlHintId}
            disabled={actions.isSubmitting}
          />
          <p id={baseUrlHintId} className="stg:text-muted-foreground stg:text-xs">
            Leave the base URL empty for {presentation.name}&apos;s own API, or give your own{" "}
            {presentation.name}-compatible endpoint, such as {presentation.baseUrlExample}.
          </p>
        </div>
      )}
      {actions.error && (
        <FieldError>
          {getUserMessage(actions.error)}
        </FieldError>
      )}
    </form>
  );
}
