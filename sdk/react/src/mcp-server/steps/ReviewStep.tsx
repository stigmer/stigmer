"use client";

import { useEffect, useMemo, useRef } from "react";
import { cn } from "@stigmer/theme";
import { buildMcpServerProto, getUserMessage, serializeManifest } from "@stigmer/sdk";
import type { McpServerInput } from "@stigmer/sdk";
import type { McpServerWizardData } from "./types.js";

/** Props for {@link ReviewStep}. */
export interface ReviewStepProps {
  readonly org: string;
  readonly data: McpServerWizardData;
  readonly isCreating: boolean;
  readonly error: Error | null;
}

/**
 * Wizard step 3: Review and create.
 *
 * Shows a summary card with key configuration details and a full
 * YAML preview of the MCP server that will be created. The "Create"
 * action is in the WizardNav footer, not in this component.
 *
 * Fully presentational: renders entirely from props, including the
 * `isCreating` in-flight state and a submit `error`. Standalone
 * consumers (embedded builders, guided tours) can therefore depict
 * any review state — success preview or failure — deterministically.
 */
export function ReviewStep({
  org,
  data,
  isCreating,
  error,
}: ReviewStepProps) {
  const errorRef = useRef<HTMLDivElement>(null);

  // The error panel renders below the (tall) YAML preview inside the wizard's
  // internal scroll area, so a failed create could otherwise report itself
  // out of view. Bring it into view whenever a new error arrives.
  useEffect(() => {
    if (error) {
      errorRef.current?.scrollIntoView({ block: "nearest" });
    }
  }, [error]);

  const mcpServerInput = useMemo(
    () => buildMcpServerInput(org, data),
    [org, data],
  );
  const yamlPreview = useMemo(
    () => serializeManifest(buildMcpServerProto(mcpServerInput)),
    [mcpServerInput],
  );

  const transportSummary =
    data.transportType === "http"
      ? data.httpUrl || "(no URL)"
      : `${data.stdioCommand}${data.stdioArgs ? ` ${data.stdioArgs}` : ""}` || "(no command)";

  return (
    <div className="stg:flex stg:flex-col stg:gap-6">
      <div>
        <h2 className="stg:text-lg stg:font-semibold stg:text-foreground">
          Review & Create
        </h2>
        <p className="stg:mt-1 stg:text-sm stg:text-muted-foreground">
          Review the MCP server configuration below, then create it.
        </p>
      </div>

      {/* Summary card */}
      <div className="stg:rounded-lg stg:border stg:border-border stg:p-4">
        <dl className="stg:grid stg:gap-x-6 stg:gap-y-3 stg:text-sm stg:sm:grid-cols-2">
          <SummaryItem label="Name" value={data.name} />
          <SummaryItem label="Slug" value={data.slug} mono />
          <SummaryItem label="Organization" value={org} mono />
          <SummaryItem
            label="Visibility"
            value={data.visibility === "public" ? "Public" : "Private"}
          />
          <SummaryItem
            label="Transport"
            value={data.transportType === "http" ? "HTTP" : "Stdio"}
          />
          <SummaryItem
            label={data.transportType === "http" ? "URL" : "Command"}
            value={transportSummary}
            mono
          />
          {data.description && (
            <SummaryItem
              label="Description"
              value={data.description}
              className="stg:sm:col-span-2"
            />
          )}
          {data.env.length > 0 && (
            <SummaryItem
              label="Env Variables"
              value={`${data.env.length} declared`}
            />
          )}
          {data.authEnabled && data.authOAuthAppSlug && (
            <SummaryItem
              label="OAuth"
              value={
                data.authOAuthAppOrg
                  ? `${data.authOAuthAppOrg}/${data.authOAuthAppSlug}`
                  : data.authOAuthAppSlug
              }
              mono
            />
          )}
        </dl>
      </div>

      {/* YAML preview */}
      <div className="stg:space-y-2">
        <h3 className="stg:text-xs stg:font-medium stg:uppercase stg:tracking-wider stg:text-muted-foreground">
          YAML Preview
        </h3>
        <div className="stg:max-h-80 stg:overflow-auto stg:rounded-lg stg:border stg:border-border stg:bg-muted-faint">
          <pre className="stg:p-4 stg:font-mono stg:text-xs stg:leading-relaxed stg:text-foreground">
            {yamlPreview}
          </pre>
        </div>
      </div>

      {/* Error display */}
      {error && (
        <div
          ref={errorRef}
          className="stg:rounded-md stg:border stg:border-destructive stg:bg-muted-faint stg:px-4 stg:py-3"
          role="alert"
        >
          <p className="stg:text-sm stg:font-medium stg:text-destructive">
            Failed to create MCP server
          </p>
          <p className="stg:mt-1 stg:text-xs stg:text-muted-foreground">
            {getUserMessage(error)}
          </p>
        </div>
      )}

      {/* Creating state */}
      {isCreating && (
        <p className="stg:text-sm stg:text-muted-foreground" aria-live="polite">
          Creating MCP server…
        </p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Summary item
// ---------------------------------------------------------------------------

function SummaryItem({
  label,
  value,
  mono,
  className,
}: {
  readonly label: string;
  readonly value: string;
  readonly mono?: boolean;
  readonly className?: string;
}) {
  return (
    <div className={className}>
      <dt className="stg:text-xs stg:text-muted-foreground">{label}</dt>
      <dd
        className={cn(
          "stg:mt-0.5 stg:text-sm stg:text-foreground",
          mono && "stg:font-mono",
        )}
      >
        {value}
      </dd>
    </div>
  );
}

// ---------------------------------------------------------------------------
// buildMcpServerInput
// ---------------------------------------------------------------------------

/**
 * Transforms wizard data into the SDK `McpServerInput` shape for submission.
 * Exported for reuse by `McpServerCreationWizard`.
 */
export function buildMcpServerInput(
  org: string,
  data: McpServerWizardData,
): McpServerInput {
  const input: McpServerInput = {
    name: data.name.trim(),
    org,
    ...(data.slug && { slug: data.slug }),
    ...(data.description && { description: data.description.trim() }),
    ...(data.iconUrl && { iconUrl: data.iconUrl.trim() }),
  };

  if (data.transportType === "http" && data.httpUrl) {
    const http: McpServerInput["http"] = {
      url: data.httpUrl.trim(),
    };

    const headers = buildHeadersMap(data.httpHeaders);
    if (headers) {
      http.headers = headers;
    }

    if (data.httpTimeoutSeconds > 0) {
      http.timeoutSeconds = data.httpTimeoutSeconds;
    }

    input.http = http;
  }

  if (data.transportType === "stdio" && data.stdioCommand) {
    const stdio: McpServerInput["stdio"] = {
      command: data.stdioCommand.trim(),
    };

    const args = parseSpaceSeparated(data.stdioArgs);
    if (args.length > 0) {
      stdio.args = args;
    }

    if (data.stdioWorkingDir.trim()) {
      stdio.workingDir = data.stdioWorkingDir.trim();
    }

    input.stdio = stdio;
  }

  if (data.env.length > 0) {
    const env: NonNullable<McpServerInput["env"]> = {};
    for (const entry of data.env) {
      if (!entry.key) continue;
      env[entry.key] = {
        ...(entry.isSecret && { isSecret: true }),
        ...(entry.description && { description: entry.description }),
        ...(entry.optional && { optional: true }),
      };
    }
    if (Object.keys(env).length > 0) {
      input.env = env;
    }
  }

  if (data.authEnabled) {
    const auth: NonNullable<McpServerInput["auth"]> = {};

    if (data.authOAuthAppSlug) {
      auth.oauthAppRef = {
        org: data.authOAuthAppOrg,
        slug: data.authOAuthAppSlug,
      };
    }
    if (data.authTargetEnvVar) {
      auth.targetEnvVar = data.authTargetEnvVar;
    }
    if (data.authTokenLifetimeHint) {
      auth.tokenLifetimeHint = data.authTokenLifetimeHint;
    }
    const scopes = parseCommaSeparated(data.authScopeHints);
    if (scopes.length > 0) {
      auth.scopeHints = scopes;
    }
    if (data.authDiscoveryUrl) {
      auth.discoveryUrl = data.authDiscoveryUrl;
    }

    if (Object.keys(auth).length > 0) {
      input.auth = auth;
    }
  }

  return input;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildHeadersMap(
  entries: readonly { key: string; value: string }[],
): Record<string, string> | undefined {
  const map: Record<string, string> = {};
  for (const entry of entries) {
    if (entry.key.trim()) {
      map[entry.key.trim()] = entry.value;
    }
  }
  return Object.keys(map).length > 0 ? map : undefined;
}

function parseSpaceSeparated(input: string): string[] {
  return input
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

function parseCommaSeparated(input: string): string[] {
  return input
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}
