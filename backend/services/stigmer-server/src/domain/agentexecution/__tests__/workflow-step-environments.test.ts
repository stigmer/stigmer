/**
 * Pins how an agent turn a workflow step created finds that step's
 * environment_refs (create-execution-context-step.ts `loadPinnedWorkflow`
 * and `agentCallTaskEnvironmentRefs`, stigmer#1906):
 *   - the workflow is read at the version the run pinned: an author's save
 *     after the run started (the head moved on) never reaches the running
 *     step, which reads the archived version's refs;
 *   - a run with no pin reads the head, as the runner's hydrate does;
 *   - a pinned version the live workflow no longer holds fails naming it
 *     (FAILED_PRECONDITION), never answered with the head;
 *   - a deleted workflow degrades to no workflow environments;
 *   - the step is found at any depth, a for-each body included.
 *
 * Over a real store: the archived version is an audit row, read through
 * the same reader getVersion uses.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { create } from "@bufbuild/protobuf";
import { Code, ConnectError } from "@connectrpc/connect";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { Workflow } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/api_pb";
import { WorkflowSchema } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/api_pb";
import { WorkflowTaskKind } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/enum_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import { createLogger } from "../../../boot/logger.js";
import type { Store } from "../../../store/interface.js";
import { SqliteStore } from "../../../store/sqlite/store.js";
import {
  agentCallTaskEnvironmentRefs,
  loadPinnedWorkflow,
} from "../create-execution-context-step.js";

const silentLogger = createLogger({
  level: "error",
  pretty: false,
  write: () => {},
});

const WORKFLOW_ID = "wfl_triage";
const V1 = "a".repeat(64);
const V2 = "b".repeat(64);

let dir: string;
let store: Store;

/** The workflow at one version: its review step, nested in a for-each, reads `env`. */
function version(hash: string, env: string): Workflow {
  return create(WorkflowSchema, {
    metadata: { id: WORKFLOW_ID, org: "acme", slug: "triage" },
    spec: {
      tasks: [
        {
          name: "each-ticket",
          kind: WorkflowTaskKind.for_each,
          taskConfig: {
            each: "ticket",
            in: "${ .tickets }",
            do: [
              {
                name: "review",
                kind: "agent_call",
                task_config: {
                  agent: "acme/reviewer",
                  message: "review",
                  environment_refs: [{ org: "acme", slug: env }],
                },
              },
            ],
          },
        },
      ],
    },
    status: { versionHash: hash },
  });
}

beforeAll(async () => {
  dir = mkdtempSync(path.join(tmpdir(), "aexec-step-envs-"));
  store = SqliteStore.open(path.join(dir, "stigmer.db"));
  // The run started on v1; the author saved v2 since.
  await store.saveAudit(
    ApiResourceKind.workflow,
    WORKFLOW_ID,
    WorkflowSchema,
    version(V1, "pinned-env"),
    V1,
    "",
  );
  await store.saveResource(
    ApiResourceKind.workflow,
    WORKFLOW_ID,
    WorkflowSchema,
    version(V2, "edited-env"),
  );
});

afterAll(async () => {
  await store.close();
  rmSync(dir, { recursive: true, force: true });
});

const deps = () => ({ store, logger: silentLogger });

function reviewRefs(workflow: Workflow | undefined): string[] {
  if (workflow === undefined) {
    return [];
  }
  return agentCallTaskEnvironmentRefs(silentLogger, workflow, "review").map(
    (ref) => ref.slug,
  );
}

describe("a workflow step's environments, read as the run pinned them", () => {
  it("a run pinned to v1 reads v1's refs after the author saved v2", async () => {
    const workflow = await loadPinnedWorkflow(deps(), WORKFLOW_ID, V1, "aex_1");
    expect(reviewRefs(workflow)).toEqual(["pinned-env"]);
  });

  it("a run pinned to the head reads the head", async () => {
    const workflow = await loadPinnedWorkflow(deps(), WORKFLOW_ID, V2, "aex_2");
    expect(reviewRefs(workflow)).toEqual(["edited-env"]);
  });

  it("a run with no pin reads the head", async () => {
    const workflow = await loadPinnedWorkflow(deps(), WORKFLOW_ID, "", "aex_3");
    expect(reviewRefs(workflow)).toEqual(["edited-env"]);
  });

  it("a pinned version the workflow no longer holds fails naming it", async () => {
    const error = await loadPinnedWorkflow(
      deps(),
      WORKFLOW_ID,
      "c".repeat(64),
      "aex_4",
    )
      .then(() => undefined)
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ConnectError);
    expect((error as ConnectError).code).toBe(Code.FailedPrecondition);
    expect((error as ConnectError).rawMessage).toBe(
      `workflow ${WORKFLOW_ID} no longer holds version cccccccccccc..., the version its run started on`,
    );
  });

  it("a deleted workflow degrades to no workflow environments", async () => {
    expect(
      await loadPinnedWorkflow(deps(), "wfl_deleted", V1, "aex_5"),
    ).toBeUndefined();
    expect(
      await loadPinnedWorkflow(deps(), "wfl_deleted", "", "aex_6"),
    ).toBeUndefined();
  });
});
