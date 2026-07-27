"use client";

import { useState } from "react";
import { create } from "@bufbuild/protobuf";
import { MessageThread } from "@stigmer/react";
import { samples } from "@stigmer/react/test";
import { cn, THEME_PRESETS, resolvePresetClass, type ThemePresetId } from "@stigmer/theme";
import { AgentMessageSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/message_pb";
import { PendingApprovalSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/approval_pb";
import {
  ExecutionPhase,
  MessageType,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import { DEMO_SHELL_HEIGHT } from "../../shared/tokens";
import { useDocsColorMode, type StigmerColorMode } from "../../../useDocsColorMode";

import "@stigmer/theme/presets/corporate.css";
import "@stigmer/theme/presets/startup.css";
import "@stigmer/theme/presets/friendly.css";
import "@stigmer/theme/presets/fintech.css";
import "@stigmer/theme/presets/monochrome.css";

/**
 * One conversation rendered by the real `MessageThread` organism: a user
 * bubble, a thinking card, an assistant turn with a tool call, and a
 * pending approval gate — the exact chrome issue #187 is about. Built once
 * at module level; only the theme scope around it changes.
 */
const demoExecution = samples.agentExecution({
  phase: ExecutionPhase.EXECUTION_WAITING_FOR_APPROVAL,
  messages: [
    create(AgentMessageSchema, {
      type: MessageType.MESSAGE_THINKING,
      content:
        "Scanning the billing service for flag references, then checking which flags are past their expiry date before proposing removals.",
    }),
    samples.aiMessage(
      "I found 3 stale flags. Two are safe to remove directly; deleting `legacy-invoice-path` needs your approval since it still has a fallback branch.",
      [samples.toolCall("grep_search", "12 matches across 4 files")],
    ),
  ],
});
// The user's prompt lives in spec.message (MessageThread synthesizes the
// bubble from it) — real executions never repeat it in status.messages.
demoExecution.spec!.message =
  "Can you clean up the stale feature flags in the billing service?";

// The approval's toolCallId matches no rendered tool row, so MessageThread
// emits its bottom backstop ApprovalCard — deterministic for a static demo.
const demoApproval = create(PendingApprovalSchema, {
  toolCallId: "tc-demo-approval",
  toolName: "delete_file",
  argsPreview: '{"path": "billing/flags/legacy-invoice-path.ts"}',
});
demoExecution.status!.pendingApprovals = [demoApproval];

const noopApprovalSubmit = () => {
  // Playground only — there is no execution to approve.
};

const COLOR_MODES = ["light", "dark"] as const;

/**
 * Interactive theming playground: the real `MessageThread` chrome rendered
 * inside a Stigmer theme scope, with preset and color-mode switchers. Every
 * visual change the reader sees comes purely from `--stgm-*` token values —
 * the component tree never changes.
 */
export function ThemingPlayground() {
  const [presetId, setPresetId] = useState<ThemePresetId>("default");
  // Follow the docs reader's theme until they touch the toggle, then
  // their explicit choice wins for the rest of the visit.
  const docsColorMode = useDocsColorMode();
  const [colorModeOverride, setColorModeOverride] = useState<StigmerColorMode | null>(null);
  const colorMode = colorModeOverride ?? docsColorMode;

  return (
    <div className="not-prose">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Theme preset">
          {THEME_PRESETS.map((preset) => (
            <button
              key={preset.id}
              type="button"
              onClick={() => setPresetId(preset.id)}
              aria-pressed={presetId === preset.id}
              className={cn(
                "flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition-colors",
                presetId === preset.id
                  ? "border-fd-primary bg-fd-primary/10 font-medium"
                  : "border-fd-border hover:bg-fd-accent",
              )}
            >
              <span
                aria-hidden
                className="size-2.5 rounded-full border border-black/20"
                style={{ background: preset.swatch }}
              />
              {preset.name}
            </button>
          ))}
        </div>
        <div className="ms-auto flex gap-1.5" role="group" aria-label="Color mode">
          {COLOR_MODES.map((mode) => (
            <button
              key={mode}
              type="button"
              onClick={() => setColorModeOverride(mode)}
              aria-pressed={colorMode === mode}
              className={cn(
                "rounded-full border px-2.5 py-1 text-xs capitalize transition-colors",
                colorMode === mode
                  ? "border-fd-primary bg-fd-primary/10 font-medium"
                  : "border-fd-border hover:bg-fd-accent",
              )}
            >
              {mode}
            </button>
          ))}
        </div>
      </div>

      <div
        className={cn(
          "stgm overflow-hidden rounded-lg border border-fd-border bg-background",
          resolvePresetClass(presetId),
        )}
        data-stgm-color-mode={colorMode}
        style={{ height: DEMO_SHELL_HEIGHT }}
      >
        <MessageThread
          executions={[demoExecution]}
          onApprovalSubmit={noopApprovalSubmit}
          className="h-full"
          contentColumn="center"
        />
      </div>
    </div>
  );
}
