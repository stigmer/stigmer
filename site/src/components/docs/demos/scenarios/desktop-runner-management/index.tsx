"use client";

import { useCallback, useRef, useState } from "react";
import { RunnerListPanel } from "@stigmer/react";
import { PreviewProvider } from "@scenar/preview/runtime";
import {
  ScenarioPlayer,
  useNarrationManifest,
  Cursor,
  useStepInteractions,
  DesktopView,
  BrowserView,
} from "@scenar/react";
import { RunnerQueryController } from "@stigmer/protos/ai/stigmer/agentic/runner/v1/query_pb";
import { create } from "@bufbuild/protobuf";
import {
  RunnerSchema,
  RunnerStatusSchema,
  RunnerConnectionInfoSchema,
} from "@stigmer/protos/ai/stigmer/agentic/runner/v1/api_pb";
import { RunnerSpecSchema } from "@stigmer/protos/ai/stigmer/agentic/runner/v1/spec_pb";
import { RunnerListSchema } from "@stigmer/protos/ai/stigmer/agentic/runner/v1/io_pb";
import { RunnerPhase } from "@stigmer/protos/ai/stigmer/agentic/runner/v1/enum_pb";
import { ApiResourceMetadataSchema } from "@stigmer/protos/ai/stigmer/commons/apiresource/metadata_pb";
import { PreviewProviders } from "../../../../../../.scenar/providers";
import { connectFixture } from "@scenar/preview/connect";
import { StigmerDemoViewport } from "../../shared/StigmerDemoViewport";
import { DEMO_CONTENT_ZOOM, DEMO_BROWSER_ZOOM } from "../../shared/tokens";
import { type DesktopRunnerStep, desktopRunnerSteps } from "./steps";

const DEMO_ORG = "acme";

// ---------------------------------------------------------------------------
// Runner data builders
// ---------------------------------------------------------------------------

type RunnerDataState =
  | "empty"
  | "one-runner"
  | "two-runners"
  | "one-stopped";

function heartbeatAgo(seconds: number) {
  const d = new Date(Date.now() - seconds * 1000);
  return { seconds: BigInt(Math.floor(d.getTime() / 1000)), nanos: 0 };
}

function makeRunner(
  id: string,
  name: string,
  phase: RunnerPhase,
  hostname: string,
  os: string,
  arch: string,
  heartbeatSec: number,
  executions = 0,
) {
  return create(RunnerSchema, {
    apiVersion: "agentic.stigmer.ai/v1",
    kind: "Runner",
    metadata: create(ApiResourceMetadataSchema, {
      id,
      name,
      slug: name,
      org: DEMO_ORG,
    }),
    spec: create(RunnerSpecSchema, { description: "" }),
    status: create(RunnerStatusSchema, {
      phase,
      taskQueue: `runner:${id}`,
      lastHeartbeatAt: heartbeatAgo(heartbeatSec),
      currentExecutions: executions,
      connectionInfo: create(RunnerConnectionInfoSchema, {
        hostname,
        os,
        arch,
        runnerVersion: "0.12.4",
      }),
    }),
  });
}

const DEV_RUNNER_READY = () =>
  makeRunner(
    "rnr-00000000-0000-0000-0000-000000000001",
    "dev-macbook",
    RunnerPhase.READY,
    "suresh-macbook.local",
    "darwin",
    "arm64",
    12,
  );

const BROWSER_RUNNER_READY = () =>
  makeRunner(
    "rnr-00000000-0000-0000-0000-000000000002",
    "dev-macbook-2",
    RunnerPhase.READY,
    "suresh-macbook.local",
    "darwin",
    "arm64",
    3,
  );

const DEV_RUNNER_STOPPED = () =>
  makeRunner(
    "rnr-00000000-0000-0000-0000-000000000001",
    "dev-macbook",
    RunnerPhase.STOPPED,
    "suresh-macbook.local",
    "darwin",
    "arm64",
    7200,
  );

function buildRunnerList(state: RunnerDataState) {
  switch (state) {
    case "empty":
      return create(RunnerListSchema, { totalCount: 0, items: [] });
    case "one-runner":
      return create(RunnerListSchema, {
        totalCount: 1,
        items: [DEV_RUNNER_READY()],
      });
    case "two-runners":
      return create(RunnerListSchema, {
        totalCount: 2,
        items: [DEV_RUNNER_READY(), BROWSER_RUNNER_READY()],
      });
    case "one-stopped":
      return create(RunnerListSchema, {
        totalCount: 2,
        items: [DEV_RUNNER_STOPPED(), BROWSER_RUNNER_READY()],
      });
  }
}

let activeRunnerState: RunnerDataState = "empty";

const previewFixtures = [
  connectFixture(RunnerQueryController, "list", () =>
    buildRunnerList(activeRunnerState),
  ),
];

// ---------------------------------------------------------------------------
// Hand-crafted console page for the BrowserView step
// ---------------------------------------------------------------------------

function ConsoleRunnersPage() {
  return (
    <div className="flex h-full flex-col bg-background p-4">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-foreground">Runners</h3>
      </div>
      <div className="mb-3 rounded-md border border-border">
        <div className="flex items-center justify-between px-3 py-2">
          <div className="flex items-center gap-2">
            <span className="text-xs font-medium text-foreground">
              dev-macbook
            </span>
            <span className="rounded-full bg-emerald-500/10 px-1.5 py-0.5 text-xs font-medium text-emerald-500">
              Ready
            </span>
          </div>
          <span className="text-xs text-muted-foreground">darwin arm64</span>
        </div>
      </div>
      <div data-cursor-target="launch-runner-btn">
        <button className="flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground">
          Launch Local Runner
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Step renderer
// ---------------------------------------------------------------------------

function renderStep(step: DesktopRunnerStep) {
  switch (step.view) {
    case "desktop-empty":
      return (
        <DesktopView title="Stigmer" contentKey="empty">
          <div style={{ zoom: DEMO_CONTENT_ZOOM }} className="p-4">
            <RunnerListPanel
              key="empty"
              org={DEMO_ORG}
              includeSystemManaged={false}
            />
          </div>
        </DesktopView>
      );

    case "desktop-one":
      return (
        <DesktopView title="Stigmer" contentKey="one">
          <div style={{ zoom: DEMO_CONTENT_ZOOM }} className="p-4">
            <RunnerListPanel
              key="one"
              org={DEMO_ORG}
              includeSystemManaged={false}
            />
          </div>
        </DesktopView>
      );

    case "browser-launch":
      return (
        <BrowserView
          url="console.stigmer.ai/settings/runners"
          contentKey="console"
          zoom={DEMO_BROWSER_ZOOM}
        >
          <ConsoleRunnersPage />
        </BrowserView>
      );

    case "desktop-two":
      return (
        <DesktopView title="Stigmer" contentKey="two" slideDirection="forward">
          <div style={{ zoom: DEMO_CONTENT_ZOOM }} className="p-4">
            <RunnerListPanel
              key="two"
              org={DEMO_ORG}
              includeSystemManaged={false}
            />
          </div>
        </DesktopView>
      );

    case "desktop-stopped":
      return (
        <DesktopView title="Stigmer" contentKey="stopped">
          <div style={{ zoom: DEMO_CONTENT_ZOOM }} className="p-4">
            <RunnerListPanel
              key="stopped"
              org={DEMO_ORG}
              includeSystemManaged={false}
            />
          </div>
        </DesktopView>
      );
  }
}

// ---------------------------------------------------------------------------
// Mapping from step view to runner fixture state
// ---------------------------------------------------------------------------

function runnerStateFor(step: DesktopRunnerStep): RunnerDataState {
  switch (step.view) {
    case "desktop-empty":
      return "empty";
    case "desktop-one":
    case "browser-launch":
      return "one-runner";
    case "desktop-two":
      return "two-runners";
    case "desktop-stopped":
      return "one-stopped";
  }
}

// ---------------------------------------------------------------------------
// Exported component
// ---------------------------------------------------------------------------

/**
 * Desktop runner management walkthrough.
 *
 * Five-step playback: empty runner list → start a runner → browser
 * deep link → second runner appears → stop a runner. Uses real
 * RunnerListPanel with dynamic fixture data per step and a hand-crafted
 * BrowserView page for the deep link step.
 */
export function DesktopRunnerManagement() {
  const narrationManifest = useNarrationManifest(
    "desktop-runner-management",
  );
  const containerRef = useRef<HTMLDivElement>(null);
  const [cursorTarget, setCursorTarget] = useState<string | undefined>();
  const [stepIndex, setStepIndex] = useState(0);

  const handleStepChange = useCallback(
    (step: DesktopRunnerStep, index: number) => {
      activeRunnerState = runnerStateFor(step);
      setCursorTarget(undefined);
      setStepIndex(index);
    },
    [],
  );

  useStepInteractions({
    stepIndex,
    narrationManifest,
    containerRef,
    setCursorTarget,
    steps: desktopRunnerSteps,
  });

  return (
    <PreviewProvider providers={PreviewProviders} fixtures={previewFixtures}>
      <StigmerDemoViewport containerRef={containerRef}>
        <ScenarioPlayer
          steps={desktopRunnerSteps}
          narrationManifest={narrationManifest}
          onStepChange={handleStepChange}
        >
          {(step) => renderStep(step)}
        </ScenarioPlayer>
        <Cursor target={cursorTarget} containerRef={containerRef} />
      </StigmerDemoViewport>
    </PreviewProvider>
  );
}
