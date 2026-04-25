import type { ScenarioStep, TerminalLine } from "@scenar/react";

export type StopRunnerTourStep =
  | { view: "list-active" }
  | { view: "stop-one" }
  | { view: "stop-all" };

export const LIST_ACTIVE_OUTPUT: readonly TerminalLine[] = [
  { type: "prompt", text: "stigmer list runners" },
  { type: "blank", text: "" },
  {
    type: "output",
    text: "NAME          RUNTIME   BACKEND            STARTED",
  },
  {
    type: "output",
    text: "dev-laptop    native    api.stigmer.ai     14 minutes ago",
  },
  {
    type: "output",
    text: "dev-docker    docker    api.stigmer.ai     12 minutes ago",
  },
  {
    type: "output",
    text: "ci-runner     native    api.stigmer.ai     3 minutes ago",
  },
];

export const STOP_ONE_OUTPUT: readonly TerminalLine[] = [
  { type: "prompt", text: "stigmer down runner --name dev-laptop" },
  { type: "blank", text: "" },
  { type: "output", text: 'Stopping runner "dev-laptop"...' },
  { type: "output", text: "Sent SIGTERM to process 48291" },
  { type: "output", text: "Process exited (code 0)" },
  { type: "output", text: "Removed state file ~/.stigmer/runners/dev-laptop.json" },
  { type: "blank", text: "" },
  { type: "success", text: 'Runner "dev-laptop" stopped.' },
];

export const STOP_ALL_OUTPUT: readonly TerminalLine[] = [
  { type: "prompt", text: "stigmer down" },
  { type: "blank", text: "" },
  { type: "output", text: "Stopping daemon (server + embedded runner)..." },
  { type: "output", text: "Daemon stopped." },
  { type: "blank", text: "" },
  { type: "output", text: "Stopping standalone runners..." },
  { type: "output", text: '  dev-docker    stopped (container removed)' },
  { type: "output", text: '  ci-runner     stopped (exit 0)' },
  { type: "blank", text: "" },
  { type: "success", text: "All runners and services stopped." },
];

export const stopRunnerTourSteps: ScenarioStep<StopRunnerTourStep>[] = [
  {
    delayMs: 0,
    data: { view: "list-active" },
    caption: "Three runners active",
    narration:
      "You have three runners on this machine — two standalone and one from the local dev server.",
  },
  {
    delayMs: 3000,
    data: { view: "stop-one" },
    caption: "Stop one runner by name",
    narration:
      "Use stigmer down runner with a name to stop a single runner. The CLI sends SIGTERM and cleans up the state file.",
  },
  {
    delayMs: 3500,
    data: { view: "stop-all" },
    caption: "Stop everything at once",
    narration:
      "Use stigmer down without arguments to stop the daemon and every standalone runner in one command.",
  },
];
