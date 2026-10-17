"use client";

import { useState } from "react";
import { MessageThread } from "@stigmer/react-sdk";
import { samples } from "@stigmer/react-sdk/test";
import { cn, THEME_PRESETS, resolvePresetClass, type ThemePresetId } from "@stigmer/design-tokens";
import { RunPhase } from "@stigmer/apis/ai/stigmer/agentic/run/v1/enum_pb";
import { conversation } from "../../fixtures";
import { DEMO_SHELL_HEIGHT } from "../../shared/tokens";
import { useDocsColorMode, type StigmerColorMode } from "../../../useDocsColorMode";

import "@stigmer/design-tokens/presets/corporate.css";
import "@stigmer/design-tokens/presets/startup.css";
import "@stigmer/design-tokens/presets/friendly.css";
import "@stigmer/design-tokens/presets/fintech.css";
import "@stigmer/design-tokens/presets/monochrome.css";

/**
 * One conversation rendered by the real `MessageThread` organism: a user
 * bubble, a thinking card, a tool call and the assistant's reply, and a
 * call waiting on its approval gate (inline on its own row) — the exact
 * chrome issue #187 is about. Built once at module level from the turn's
 * session events; only the theme scope around it changes.
 */
const flagSearch = samples.toolUseEvent("grep_search", { pattern: "featureFlag(", path: "billing" });

const flagDelete = samples.toolUseEvent(
  "delete_file",
  { path: "billing/flags/legacy-invoice-path.ts" },
  { evaluatedPermission: "ask" },
);

const demoConversation = conversation(
  [
    samples.userMessageEvent("Can you clean up the stale feature flags in the billing service?"),
    samples.runStatusEvent("running"),
    ...samples.thinkingEvents(
      "Scanning the billing service for flag references, then checking which flags are past their expiry date before proposing removals.",
    ),
    flagSearch,
    samples.toolResultEvent(flagSearch.event.value!.id, "12 matches across 4 files"),
    samples.agentMessageEvent(
      "I found 3 stale flags. Two are safe to remove directly; deleting `legacy-invoice-path` needs your approval since it still has a fallback branch.",
    ),
    flagDelete,
    samples.permissionAskedEvent(flagDelete.event.value!.id, {
      argsPreview: '{"path": "billing/flags/legacy-invoice-path.ts"}',
    }),
    samples.runStatusEvent("waiting"),
  ],
  RunPhase.RUN_WAITING_FOR_APPROVAL,
);

const noopAnswer = () => {
  // Playground only — there is no run to answer.
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
          turns={demoConversation.turns}
          runs={demoConversation.runs}
          onAnswerToolUse={noopAnswer}
          className="h-full"
          contentColumn="center"
        />
      </div>
    </div>
  );
}
