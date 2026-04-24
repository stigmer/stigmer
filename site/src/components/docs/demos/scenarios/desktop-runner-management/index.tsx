"use client";

import { RunnerListPanel } from "@stigmer/react";
import { PreviewProvider } from "@scenar/preview/runtime";
import { DesktopView } from "@scenar/react";
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
import { DEMO_CONTENT_ZOOM } from "../../shared/tokens";

const DEMO_ORG = "acme";

function heartbeatAgo(seconds: number) {
  const d = new Date(Date.now() - seconds * 1000);
  return { seconds: BigInt(Math.floor(d.getTime() / 1000)), nanos: 0 };
}

function buildDemoRunners() {
  return create(RunnerListSchema, {
    totalCount: 3,
    items: [
      create(RunnerSchema, {
        apiVersion: "agentic.stigmer.ai/v1",
        kind: "Runner",
        metadata: create(ApiResourceMetadataSchema, {
          id: "rnr-00000000-0000-0000-0000-000000000001",
          name: "dev-macbook",
          slug: "dev-macbook",
          org: DEMO_ORG,
        }),
        spec: create(RunnerSpecSchema, {
          description: "Development runner on MacBook Pro",
        }),
        status: create(RunnerStatusSchema, {
          phase: RunnerPhase.READY,
          taskQueue: "runner:rnr-00000000-0000-0000-0000-000000000001",
          lastHeartbeatAt: heartbeatAgo(12),
          currentExecutions: 0,
          connectionInfo: create(RunnerConnectionInfoSchema, {
            hostname: "suresh-macbook.local",
            os: "darwin",
            arch: "arm64",
            runnerVersion: "0.12.4",
          }),
        }),
      }),
      create(RunnerSchema, {
        apiVersion: "agentic.stigmer.ai/v1",
        kind: "Runner",
        metadata: create(ApiResourceMetadataSchema, {
          id: "rnr-00000000-0000-0000-0000-000000000002",
          name: "ci-build-server",
          slug: "ci-build-server",
          org: DEMO_ORG,
        }),
        spec: create(RunnerSpecSchema, {
          description: "CI/CD build server",
        }),
        status: create(RunnerStatusSchema, {
          phase: RunnerPhase.BUSY,
          taskQueue: "runner:rnr-00000000-0000-0000-0000-000000000002",
          lastHeartbeatAt: heartbeatAgo(5),
          currentExecutions: 3,
          connectionInfo: create(RunnerConnectionInfoSchema, {
            hostname: "build-01.internal",
            os: "linux",
            arch: "x86_64",
            runnerVersion: "0.12.4",
          }),
        }),
      }),
      create(RunnerSchema, {
        apiVersion: "agentic.stigmer.ai/v1",
        kind: "Runner",
        metadata: create(ApiResourceMetadataSchema, {
          id: "rnr-00000000-0000-0000-0000-000000000003",
          name: "staging-runner",
          slug: "staging-runner",
          org: DEMO_ORG,
        }),
        spec: create(RunnerSpecSchema, {
          description: "Staging environment runner",
        }),
        status: create(RunnerStatusSchema, {
          phase: RunnerPhase.STOPPED,
          taskQueue: "runner:rnr-00000000-0000-0000-0000-000000000003",
          lastHeartbeatAt: heartbeatAgo(7200),
          connectionInfo: create(RunnerConnectionInfoSchema, {
            hostname: "staging-01.internal",
            os: "linux",
            arch: "x86_64",
            runnerVersion: "0.12.3",
          }),
        }),
      }),
    ],
  });
}

const previewFixtures = [
  connectFixture(RunnerQueryController, "list", () => buildDemoRunners()),
];

export function DesktopRunnerManagement() {
  return (
    <PreviewProvider providers={PreviewProviders} fixtures={previewFixtures}>
      <DesktopView title="Stigmer" contentKey="runners">
        <div style={{ zoom: DEMO_CONTENT_ZOOM }} className="p-4">
          <RunnerListPanel org={DEMO_ORG} includeSystemManaged={false} />
        </div>
      </DesktopView>
    </PreviewProvider>
  );
}
