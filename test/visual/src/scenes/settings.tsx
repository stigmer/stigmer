// The settings scenes: the model picker the composer opens. (Models &
// providers and the launcher's readiness are in models.tsx.)
import { ModelSelector } from "@stigmer/react-sdk";
import type { Drawing } from "./drawing.ts";

function inert(): void {}

/** The model picker on the Claude harness with Claude Sonnet 4.6 chosen; the case opens it. */
export function modelSelectorScene(): Drawing {
  return {
    render: () => <ModelSelector value="claude-sonnet-4.6" onValueChange={inert} initialHarness="claude" />,
  };
}
