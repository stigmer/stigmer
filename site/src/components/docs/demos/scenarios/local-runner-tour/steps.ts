import type { ScenarioStep, TerminalLine } from "@scenar/react";

export type LocalRunnerTourStep =
  | { view: "start-native" }
  | { view: "start-docker" }
  | { view: "list-runners" };

export const START_NATIVE_OUTPUT: readonly TerminalLine[] = [
  { type: "prompt", text: "stigmer up --name dev-laptop" },
  { type: "blank", text: "" },
  { type: "output", text: 'Starting runner "dev-laptop" (native runtime)...' },
  { type: "output", text: "Bootstrapping Python environment... done" },
  { type: "output", text: "Registering runner with server... done" },
  { type: "blank", text: "" },
  {
    type: "output",
    text: "Runner ID: rnr-a1b2c3d4-5678-9012-3456-789012345678",
  },
  { type: "output", text: "First heartbeat sent — phase: Ready" },
  { type: "blank", text: "" },
  {
    type: "success",
    text: 'Runner "dev-laptop" is now accepting executions.',
  },
];

export const START_DOCKER_OUTPUT: readonly TerminalLine[] = [
  { type: "prompt", text: "stigmer up --runtime docker --name dev-docker" },
  { type: "blank", text: "" },
  {
    type: "output",
    text: 'Starting runner "dev-docker" (Docker runtime)...',
  },
  {
    type: "output",
    text: "Pulling ghcr.io/stigmer/agent-runner:0.12.4... done",
  },
  {
    type: "output",
    text: "Starting container stigmer-runner-dev-docker... done",
  },
  { type: "blank", text: "" },
  {
    type: "output",
    text: "Runner ID: rnr-e5f6a7b8-9012-3456-7890-123456789012",
  },
  { type: "output", text: "First heartbeat sent — phase: Ready" },
  { type: "blank", text: "" },
  {
    type: "success",
    text: 'Runner "dev-docker" is now accepting executions.',
  },
];

export const LIST_RUNNERS_OUTPUT: readonly TerminalLine[] = [
  { type: "prompt", text: "stigmer list runners" },
  { type: "blank", text: "" },
  {
    type: "output",
    text: "NAME          RUNTIME   BACKEND            STARTED",
  },
  {
    type: "output",
    text: "dev-laptop    native    api.stigmer.ai     2 minutes ago",
  },
  {
    type: "output",
    text: "dev-docker    docker    api.stigmer.ai     30 seconds ago",
  },
];

export const localRunnerTourSteps: ScenarioStep<LocalRunnerTourStep>[] = [
  {
    delayMs: 0,
    data: { view: "start-native" },
    caption: "Start a runner with one command",
    narration:
      "One command starts a runner on your machine. It bootstraps, registers with the server, and begins accepting work.",
  },
  {
    delayMs: 3500,
    data: { view: "start-docker" },
    caption: "Or run inside Docker",
    narration:
      "Add the docker flag for an isolated runtime. The CLI pulls the image, starts a container, and connects.",
  },
  {
    delayMs: 3500,
    data: { view: "list-runners" },
    caption: "See what's running",
    narration:
      "Use stigmer list runners to see every runner started from this machine — name, runtime, and backend.",
  },
];
