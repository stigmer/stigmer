"use client";

import {
  ArtifactContentRenderer,
  MessageThread,
  SessionComposer,
} from "@stigmer/react";
import type { UseWorkspaceEntriesReturn } from "@stigmer/react";
import type { AgentExecution } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import { motion } from "framer-motion";
import { Check, FileText, Folder } from "lucide-react";

const noop = () => {};

const MOCK_WORKSPACE: UseWorkspaceEntriesReturn = {
  entries: [],
  addGitRepo: noop,
  addLocalPath: noop,
  remove: noop,
  clear: noop,
  toInput: () => [],
  hasEntries: false,
};

const SKILL_CREATOR_REF = { org: "demo-org", slug: "skill-creator" };

interface ComposerViewProps {
  /** When provided, renders the conversation via MessageThread. */
  execution?: AgentExecution;
  /**
   * When provided, replaces the MessageThread with an inline
   * artifact preview using `ArtifactContentRenderer`.
   */
  artifactContent?: string;
  /**
   * Controls the push CTA state shown below the artifact preview.
   *
   * - `"ready"` — renders a pulsing "Push Skill to my-org" button
   * - `"success"` — renders a green success indicator
   * - `undefined` — no push CTA shown
   */
  pushState?: "ready" | "success";
}

/**
 * Session composer view for the guided-tour demo.
 *
 * Uses real `@stigmer/react` components: `MessageThread` for
 * conversation steps, `SessionComposer` for the empty "ready" state
 * (with an agent chip rendered natively via `agentRef`), and
 * `ArtifactContentRenderer` for inline artifact preview.
 */
export function ComposerView({
  execution,
  artifactContent,
  pushState,
}: ComposerViewProps) {
  const showArtifact = artifactContent != null;

  return (
    <div className="flex h-full flex-col">
      <div className="flex-1 overflow-hidden">
        {execution ? (
          <div className="flex h-full flex-col">
            {showArtifact ? (
              <ArtifactPanel
                content={artifactContent}
                pushState={pushState}
              />
            ) : (
              <MessageThread
                executions={[execution]}
                className="max-h-[320px] px-3 py-2"
              />
            )}
          </div>
        ) : (
          <div className="flex h-full items-center justify-center p-4">
            <div className="w-full max-w-xl" style={{ zoom: 0.88 }}>
              <SessionComposer
                onSubmit={noop}
                placeholder="Describe your skill..."
                autoFocus={false}
                workspace={MOCK_WORKSPACE}
                org="demo-org"
                agentRef={SKILL_CREATOR_REF}
                onAgentRefChange={noop}
                onMcpServerUsagesChange={noop}
                onSkillRefsChange={noop}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Inline artifact preview for a skill directory.
 *
 * Mirrors the SDK's `DirectoryContentView` pattern from
 * `ArtifactPreviewModal`: directory header with "Skill · 1 file"
 * badge, skill name/description callout, file entries list, then
 * rendered SKILL.md content scrollable below.
 */
function ArtifactPanel({
  content,
  pushState,
}: {
  readonly content: string;
  readonly pushState?: "ready" | "success";
}) {
  return (
    <div className="flex h-full flex-col">
      {/* Directory header — matches SDK ModalHeader pattern */}
      <div className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-1.5">
        <Folder className="h-3 w-3 shrink-0 text-muted-foreground" />
        <span className="text-[11px] font-semibold text-foreground">
          return-policy/
        </span>
        <span className="inline-flex items-center rounded-full bg-primary/10 px-1.5 py-0.5 text-[9px] font-medium text-primary">
          Skill · 1 file
        </span>
      </div>

      {/* Scrollable body */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {/* Skill detection callout — matches SDK DirectoryContentView */}
        <div className="mx-3 mt-3 rounded-md bg-primary/5 p-2.5">
          <p className="text-[11px] font-medium text-foreground">
            Return Policy
          </p>
          <p className="mt-0.5 text-[10px] text-muted-foreground">
            Acme Corp&apos;s customer return and refund policy.
          </p>
        </div>

        {/* File entries list — matches SDK DirectoryContentView */}
        <div className="px-3 pt-3">
          <h3 className="mb-1.5 text-[10px] font-medium text-muted-foreground">
            Files (1)
          </h3>
          <ul role="list">
            <li className="flex items-center gap-1.5 rounded-sm px-1.5 py-0.5 font-mono text-[10px] text-foreground">
              <FileText className="h-3 w-3 shrink-0 text-muted-foreground" />
              <span>SKILL.md</span>
            </li>
          </ul>
        </div>

        {/* Rendered SKILL.md content */}
        <div className="mt-2 border-t border-border">
          <ArtifactContentRenderer
            content={content}
            fileName="SKILL.md"
            contentType="text/markdown"
          />
        </div>
      </div>

      {/* Push CTA pinned at the bottom */}
      {pushState && (
        <div className="flex shrink-0 items-center justify-end border-t border-border px-3 py-1.5">
          {pushState === "success" ? (
            <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-success">
              <Check size={11} />
              Pushed · Return Policy
            </span>
          ) : (
            <div className="relative" data-cursor-target="push-button">
              <button
                type="button"
                className="rounded-md bg-primary px-2.5 py-0.5 text-[11px] font-medium text-primary-foreground"
                tabIndex={-1}
              >
                Push Skill to my-org
              </button>
              <motion.span
                className="absolute inset-0 rounded-md border border-foreground"
                initial={{ opacity: 0 }}
                animate={{ opacity: [0, 0.5, 0] }}
                transition={{
                  duration: 1.2,
                  repeat: Infinity,
                  ease: "easeInOut",
                }}
                aria-hidden
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
