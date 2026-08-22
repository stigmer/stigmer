"use client";

import { useId } from "react";
import type { McpServerUsageInput, ResourceRef } from "@stigmer/sdk";
import { Copy, FileJson, FileText } from "lucide-react";
import type { HarnessOption } from "../../models/harness.js";
import { HARNESS_META } from "../../models/harness.js";
import { Switch } from "../../switch/Switch.js";
import type { ExecutionTargetOption } from "../execution-target.js";
import type { UseSessionVariablesReturn } from "../../execution/useSessionVariables.js";
import { useExportTranscript } from "../useExportTranscript.js";
import {
  FACET_ROW_BUTTON,
  FacetEmptyHint,
  FacetKeyValueRow,
  FacetRemoveButton,
  FacetRow,
  FacetSection,
} from "./primitives.js";

/** Interactive mutation callbacks for config items in SetupTab. */
export interface SetupTabMutationCallbacks {
  /** Remove the current agent. Absent = non-removable (e.g. default agent). */
  readonly onRemoveAgent?: () => void;
  /** Remove an MCP server by its org/slug ref. */
  readonly onRemoveMcp?: (ref: ResourceRef) => void;
  /** Remove a skill by its org/slug ref. */
  readonly onRemoveSkill?: (ref: ResourceRef) => void;
}

/**
 * Wiring for the Run Config section's auto-approve switch — the session-level
 * arming control (stigmer/stigmer#816 rework: config lives in Config, not the
 * composer). Session-scoped: an explicit flip beats the account's
 * `default_auto_approve` preference and the host's `approvalDefaults` for
 * THIS conversation only, and is never persisted anywhere.
 *
 * Presence renders the switch; absence keeps the section read-only. Consumers
 * must only wire it on surfaces whose viewer may submit approvals — never
 * observer or guest audiences (the approval-submission withhold).
 */
export interface SetupTabAutoApprove {
  /** Whether auto-approve is currently armed for this conversation. */
  readonly armed: boolean;
  /** Called with the next value when the user flips the switch. */
  readonly onChange: (armed: boolean) => void;
}

/** Props for {@link SetupTab}. */
export interface SetupTabProps {
  readonly agentRef: ResourceRef | null;
  readonly isDefaultAgent: boolean;
  readonly mcpServerUsages: readonly McpServerUsageInput[];
  readonly skillRefs: readonly ResourceRef[];
  readonly sessionVariables: UseSessionVariablesReturn | null;
  readonly harness: HarnessOption;
  readonly executionTarget: ExecutionTargetOption | undefined;
  readonly modelId: string | undefined;
  /**
   * Session-level auto-approve switch in the Run Config section. When
   * provided, the switch renders and is interactive at all times — including
   * mid-run, where flipping it ON releases the in-flight execution's pending
   * gates (the flow's standing responder). When absent (read-only audiences,
   * demo fixtures), the section shows no approval control at all.
   */
  readonly autoApprove?: SetupTabAutoApprove;
  /**
   * The session whose transcript the Session section exports. When provided,
   * the facet renders Copy / Download Markdown / Download JSON actions
   * (stigmer/stigmer#814's export, relocated from the header). Omit on the
   * launcher (no session exists yet) and in inert fixtures. Deliberately not
   * audience-gated: the export is `can_view`-scoped — it serializes exactly
   * what the viewer already shows — so observers keep it.
   */
  readonly sessionId?: string | null;
  /**
   * Interactive mutation callbacks. When provided, items render remove
   * buttons. When absent, sections are read-only (DD-011).
   */
  readonly mutations?: SetupTabMutationCallbacks;
  /**
   * Host-injected access management control (e.g. the Console's
   * `ManageAccessButton`) rendered as the facet's final section. A slot keeps
   * the SDK auth-agnostic (DD-004); the injected control owns its own
   * visibility (permission gating), so this section renders no chrome of its
   * own — an empty heading over a denied control would read as breakage.
   */
  readonly accessSlot?: React.ReactNode;
}

/**
 * Persistent session configuration panel (Config facet) — shows run config
 * (harness, model, target, and the session-level auto-approve switch), agent,
 * MCP servers, skills, session variables, transcript export, and the host's
 * access management control (via `accessSlot`).
 *
 * Rendered in the session panel's shared facet vocabulary (see
 * `./primitives.tsx`): dense rows, quiet right-aligned metadata, and
 * hover/focus-revealed actions — the Artifacts facet's idiom.
 *
 * When mutation callbacks are provided via `mutations`, items render
 * inline remove affordances. When callbacks are absent, sections render
 * read-only (backward compatible, DD-011).
 *
 * All visual properties flow through `--stgm-*` tokens (DD-005).
 */
export function SetupTab({
  agentRef,
  isDefaultAgent,
  mcpServerUsages,
  skillRefs,
  sessionVariables,
  harness,
  executionTarget,
  modelId,
  autoApprove,
  sessionId,
  mutations,
  accessSlot,
}: SetupTabProps) {
  const hasSessionVars = sessionVariables != null && !sessionVariables.isEmpty;

  return (
    <div className="stg:flex stg:flex-col stg:gap-5">
      <RunConfigSection
        harness={harness}
        executionTarget={executionTarget}
        modelId={modelId}
        autoApprove={autoApprove}
      />

      <AgentSection
        agentRef={agentRef}
        isDefaultAgent={isDefaultAgent}
        onRemove={mutations?.onRemoveAgent}
      />

      <McpSection
        mcpServerUsages={mcpServerUsages}
        onRemove={mutations?.onRemoveMcp}
      />

      <SkillsSection
        skillRefs={skillRefs}
        onRemove={mutations?.onRemoveSkill}
      />

      {hasSessionVars && (
        <SessionVarsSection entries={sessionVariables.entries} />
      )}

      {sessionId && <TranscriptSection sessionId={sessionId} />}

      {accessSlot && <section>{accessSlot}</section>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Run config
// ---------------------------------------------------------------------------

function RunConfigSection({
  harness,
  executionTarget,
  modelId,
  autoApprove,
}: {
  harness: HarnessOption;
  executionTarget: ExecutionTargetOption | undefined;
  modelId: string | undefined;
  autoApprove: SetupTabAutoApprove | undefined;
}) {
  const autoApproveLabelId = useId();

  return (
    <FacetSection heading="Run Config">
      <FacetKeyValueRow label="Harness">
        {HARNESS_META[harness]?.label ?? harness}
      </FacetKeyValueRow>
      {modelId && (
        <FacetKeyValueRow label="Model">{modelId}</FacetKeyValueRow>
      )}
      {executionTarget && (
        <FacetKeyValueRow label="Target">
          {executionTarget === "local" ? "Local" : "Cloud"}
        </FacetKeyValueRow>
      )}
      {autoApprove && (
        <FacetKeyValueRow label="Auto-approve" labelId={autoApproveLabelId}>
          <Switch
            checked={autoApprove.armed}
            onCheckedChange={autoApprove.onChange}
            aria-labelledby={autoApproveLabelId}
          />
        </FacetKeyValueRow>
      )}
    </FacetSection>
  );
}

// ---------------------------------------------------------------------------
// Agent
// ---------------------------------------------------------------------------

function AgentSection({
  agentRef,
  isDefaultAgent,
  onRemove,
}: {
  agentRef: ResourceRef | null;
  isDefaultAgent: boolean;
  onRemove?: () => void;
}) {
  return (
    <FacetSection heading="Agent">
      {agentRef ? (
        <FacetRow
          meta={isDefaultAgent ? "default" : undefined}
          actions={
            onRemove && !isDefaultAgent ? (
              <FacetRemoveButton
                onClick={onRemove}
                label={`Remove agent ${agentRef.slug}`}
              />
            ) : undefined
          }
        >
          <span className="stg:truncate">{agentRef.slug}</span>
        </FacetRow>
      ) : (
        <FacetEmptyHint>No agent selected — using platform default.</FacetEmptyHint>
      )}
    </FacetSection>
  );
}

// ---------------------------------------------------------------------------
// MCP Servers
// ---------------------------------------------------------------------------

function McpSection({
  mcpServerUsages,
  onRemove,
}: {
  mcpServerUsages: readonly McpServerUsageInput[];
  onRemove?: (ref: ResourceRef) => void;
}) {
  return (
    <FacetSection heading="MCP Servers" count={mcpServerUsages.length}>
      {mcpServerUsages.length > 0 ? (
        mcpServerUsages.map((usage) => {
          const slug = usage.mcpServerRef.slug;
          const enabledCount = usage.enabledTools?.length;
          return (
            <FacetRow
              key={`${usage.mcpServerRef.org}/${slug}`}
              meta={
                enabledCount != null && enabledCount > 0
                  ? `${enabledCount} tool${enabledCount !== 1 ? "s" : ""}`
                  : undefined
              }
              actions={
                onRemove ? (
                  <FacetRemoveButton
                    onClick={() => onRemove(usage.mcpServerRef)}
                    label={`Remove MCP server ${slug}`}
                  />
                ) : undefined
              }
            >
              <span className="stg:truncate">{slug}</span>
            </FacetRow>
          );
        })
      ) : (
        <FacetEmptyHint>No MCP servers attached.</FacetEmptyHint>
      )}
    </FacetSection>
  );
}

// ---------------------------------------------------------------------------
// Skills
// ---------------------------------------------------------------------------

function SkillsSection({
  skillRefs,
  onRemove,
}: {
  skillRefs: readonly ResourceRef[];
  onRemove?: (ref: ResourceRef) => void;
}) {
  return (
    <FacetSection heading="Skills" count={skillRefs.length}>
      {skillRefs.length > 0 ? (
        skillRefs.map((ref) => (
          <FacetRow
            key={`${ref.org}/${ref.slug}`}
            actions={
              onRemove ? (
                <FacetRemoveButton
                  onClick={() => onRemove(ref)}
                  label={`Remove skill ${ref.slug}`}
                />
              ) : undefined
            }
          >
            <span className="stg:truncate">{ref.slug}</span>
          </FacetRow>
        ))
      ) : (
        <FacetEmptyHint>No skills attached.</FacetEmptyHint>
      )}
    </FacetSection>
  );
}

// ---------------------------------------------------------------------------
// Session Variables (ephemeral, only shown when entries exist)
// ---------------------------------------------------------------------------

function SessionVarsSection({
  entries,
}: {
  entries: UseSessionVariablesReturn["entries"];
}) {
  return (
    <FacetSection heading="Session Variables" annotation="next message only">
      {entries.map((entry) => (
        <FacetRow
          key={entry.id}
          meta={
            entry.isSecret ? (
              "********"
            ) : (
              <span className="stg:inline-block stg:max-w-[140px] stg:truncate stg:align-bottom">
                {entry.value}
              </span>
            )
          }
        >
          <span className="stg:truncate stg:font-medium">
            {entry.key || "(unnamed)"}
          </span>
        </FacetRow>
      ))}
    </FacetSection>
  );
}

// ---------------------------------------------------------------------------
// Transcript export (stigmer/stigmer#814, relocated from the viewer header)
// ---------------------------------------------------------------------------

function TranscriptSection({ sessionId }: { sessionId: string }) {
  const exporter = useExportTranscript(sessionId);

  return (
    <FacetSection heading="Transcript">
      <button
        type="button"
        onClick={() => void exporter.copyMarkdown()}
        disabled={exporter.isExporting}
        className={FACET_ROW_BUTTON}
      >
        <Copy className="stg:size-3.5 stg:shrink-0" aria-hidden="true" />
        Copy transcript
      </button>
      <button
        type="button"
        onClick={() => void exporter.downloadMarkdown()}
        disabled={exporter.isExporting}
        className={FACET_ROW_BUTTON}
      >
        <FileText className="stg:size-3.5 stg:shrink-0" aria-hidden="true" />
        Download Markdown
      </button>
      <button
        type="button"
        onClick={() => void exporter.downloadJson()}
        disabled={exporter.isExporting}
        className={FACET_ROW_BUTTON}
      >
        <FileJson className="stg:size-3.5 stg:shrink-0" aria-hidden="true" />
        Download JSON
      </button>
    </FacetSection>
  );
}
