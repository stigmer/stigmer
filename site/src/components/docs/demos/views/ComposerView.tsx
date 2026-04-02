"use client";

import { useEffect, useRef } from "react";
import {
  ArtifactContentRenderer,
  MessageThread,
  SessionComposer,
} from "@stigmer/react";
import type { AgentExecution } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import { motion } from "framer-motion";
import { Check, FileText, Folder } from "lucide-react";
import { DEMO_ORG, MOCK_WORKSPACE } from "../engine/shared";
import { DEMO_CONTENT_ZOOM } from "../shared/tokens";

const noop = () => {};

interface ComposerViewProps {
  /** When provided, renders the conversation via MessageThread. */
  execution?: AgentExecution;
  /**
   * When provided, programmatically fills the SessionComposer textarea
   * with this text (simulating user typing).
   */
  typingMessage?: string;
  /** Placeholder text for the SessionComposer textarea. */
  placeholder?: string;
  /** Agent reference chip shown in the composer. */
  agentRef?: { org: string; slug: string };
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
 * Session composer view used across demo scenarios.
 *
 * Handles five visual states driven by props:
 * 1. **Empty** — `SessionComposer` in its "ready" state
 * 2. **Typing** — `SessionComposer` with pre-filled text
 * 3. **Conversation** — `MessageThread` showing execution messages
 * 4. **Artifact preview** — `ArtifactContentRenderer` inline
 * 5. **Push CTA** — artifact preview with push button/success indicator
 */
export function ComposerView({
  execution,
  typingMessage,
  placeholder = "Describe your skill...",
  agentRef,
  artifactContent,
  pushState,
}: ComposerViewProps) {
  const showArtifact = artifactContent != null;

  return (
    <div className="flex h-full flex-col">
      <div className="flex-1 overflow-hidden">
        {execution ? (
          <div className="flex h-full flex-col" style={{ zoom: DEMO_CONTENT_ZOOM }}>
            {showArtifact ? (
              <ArtifactPanel
                content={artifactContent}
                pushState={pushState}
              />
            ) : (
              <MessageThread
                executions={[execution]}
                className="max-h-[390px] px-3 py-2"
              />
            )}
          </div>
        ) : (
          <div className="flex h-full items-center justify-center p-4">
            <div className="w-full max-w-xl" style={{ zoom: DEMO_CONTENT_ZOOM }}>
              {typingMessage ? (
                <TypingComposer
                  message={typingMessage}
                  placeholder={placeholder}
                  agentRef={agentRef}
                />
              ) : (
                <SessionComposer
                  onSubmit={noop}
                  placeholder={placeholder}
                  autoFocus={false}
                  workspace={MOCK_WORKSPACE}
                  org={DEMO_ORG}
                  agentRef={agentRef}
                  onAgentRefChange={noop}
                  onMcpServerUsagesChange={noop}
                  onSkillRefsChange={noop}
                />
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Wraps `SessionComposer` and programmatically fills the textarea with
 * the given message by setting the native value and dispatching an
 * `input` event. This is a standard React pattern for programmatically
 * updating controlled inputs that don't expose a `value` prop.
 */
function TypingComposer({
  message,
  placeholder,
  agentRef,
}: {
  readonly message: string;
  readonly placeholder: string;
  readonly agentRef?: { org: string; slug: string };
}) {
  const wrapperRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const textarea = wrapperRef.current?.querySelector("textarea");
    if (!textarea) return;

    const setter = Object.getOwnPropertyDescriptor(
      HTMLTextAreaElement.prototype,
      "value",
    )?.set;
    setter?.call(textarea, message);
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
  }, [message]);

  return (
    <div ref={wrapperRef}>
      <SessionComposer
        onSubmit={noop}
        placeholder={placeholder}
        autoFocus={false}
        workspace={MOCK_WORKSPACE}
        org={DEMO_ORG}
        agentRef={agentRef}
        onAgentRefChange={noop}
        onMcpServerUsagesChange={noop}
        onSkillRefsChange={noop}
      />
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
