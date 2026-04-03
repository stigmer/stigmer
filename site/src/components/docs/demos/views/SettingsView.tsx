"use client";

import { useEffect, useRef } from "react";
import { Plus } from "lucide-react";
import {
  ApiKeyCreatedAlert,
  ApiKeyListPanel,
  CreateApiKeyForm,
  EnvironmentVariableEditor,
} from "@stigmer/react";
import { DEMO_ORG } from "../engine/shared";
import { PulseHighlight } from "../shared/PulseHighlight";
import { DEMO_CONTENT_ZOOM } from "../shared/tokens";

type ApiKeyVisualState = "list" | "creating" | "created";

interface SettingsViewProps {
  /** Controls which API key UI is shown. */
  readonly apiKeyState: ApiKeyVisualState;
  /** When true, the "+ New API key" button pulses. */
  readonly highlightCreate?: boolean;
  /** Raw key value shown by ApiKeyCreatedAlert. */
  readonly rawKey?: string;
  /** Key name shown by ApiKeyCreatedAlert. */
  readonly keyName?: string;
  /** Pre-fill text for the create form name input. */
  readonly createFormName?: string;
  /** Environment resource ID for the personal env editor. */
  readonly personalEnvId: string;
}

const noop = () => {};

/**
 * Settings page layout for demo scenarios.
 *
 * Composes SDK components (`ApiKeyListPanel`, `CreateApiKeyForm`,
 * `ApiKeyCreatedAlert`, `EnvironmentVariableEditor`) into a page
 * layout that mirrors the Console's Settings route. This is a
 * docs-only view — it provides page chrome (header, sections) and
 * delegates all domain UI to the SDK.
 */
export function SettingsView({
  apiKeyState,
  highlightCreate,
  rawKey,
  keyName,
  createFormName,
  personalEnvId,
}: SettingsViewProps) {
  return (
    <div className="flex h-full flex-col overflow-y-auto">
      {/* Page header */}
      <div className="shrink-0 px-4 pt-3 pb-2">
        <h2 className="text-sm font-semibold text-foreground">Settings</h2>
        <p className="mt-0.5 text-[10px] text-muted-foreground">
          Manage your API keys, environments, and configuration.
        </p>
      </div>

      <div className="min-h-0 flex-1 px-4 pb-4" style={{ zoom: DEMO_CONTENT_ZOOM }}>
        {/* API Keys section */}
        <section>
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-xs font-semibold text-foreground">API Keys</h3>
            <div className="relative" data-cursor-target="create-api-key">
              <div className="flex items-center gap-1 rounded-md bg-primary px-2 py-0.5 text-[10px] font-medium text-primary-foreground">
                <Plus className="h-2.5 w-2.5" />
                New API key
              </div>

              {highlightCreate && <PulseHighlight />}
            </div>
          </div>

          {apiKeyState === "created" && rawKey && keyName ? (
            <ApiKeyCreatedAlert
              rawKey={rawKey}
              keyName={keyName}
              onDismiss={noop}
              className="mb-3"
            />
          ) : apiKeyState === "creating" ? (
            <PrefilledCreateForm name={createFormName} />
          ) : null}

          <ApiKeyListPanel />
        </section>

        {/* Personal Environment section */}
        <section className="mt-4">
          <div className="mb-2 flex items-center justify-between">
            <div className="flex items-center gap-1.5">
              <h3 className="text-xs font-semibold text-foreground">
                Personal Environment
              </h3>
              <span className="rounded-full bg-primary/10 px-1.5 py-px text-[8px] font-medium text-primary">
                YOU
              </span>
            </div>
          </div>
          <p className="mb-2 text-[9px] text-muted-foreground">
            Your private secrets and configuration, automatically managed
            for you. Only visible to you — used when running agents that
            require your personal credentials.
          </p>
          <EnvironmentVariableEditor
            environmentId={personalEnvId}
            readOnly
          />
        </section>
      </div>
    </div>
  );
}

/**
 * Wraps `CreateApiKeyForm` and programmatically fills the name input
 * to simulate user typing in the timed playback.
 */
function PrefilledCreateForm({
  name,
}: {
  readonly name?: string;
}) {
  const wrapperRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!name) return;

    const input = wrapperRef.current?.querySelector(
      "#stgm-new-apikey-name",
    ) as HTMLInputElement | null;
    if (!input) return;

    const setter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )?.set;
    setter?.call(input, name);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  }, [name]);

  return (
    <div ref={wrapperRef} className="mb-3">
      <CreateApiKeyForm org={DEMO_ORG} onCancel={noop} />
    </div>
  );
}
