/**
 * What recover's RecreateExecutionContext rebuilds (lifecycle.ts): the
 * environment create built, by create's own rule — the declarations of
 * the version the run pinned, never the head an author saved since, filled
 * from the personal environment of the person who started the run, read
 * now ("fix the key, then recover"). A pinned version that declares no key
 * the person holds rebuilds no context at all.
 *
 * Over a real store (the workflow head, its archived version, the person's
 * personal environment and the run) with a connected engine stub and a
 * recording context creator.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { create } from "@bufbuild/protobuf";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { EnvironmentSchema } from "@stigmer/protos/ai/stigmer/agentic/environment/v1/api_pb";
import { EnvironmentValueSchema } from "@stigmer/protos/ai/stigmer/agentic/environment/v1/spec_pb";
import type { ExecutionContext } from "@stigmer/protos/ai/stigmer/agentic/executioncontext/v1/api_pb";
import type { Workflow } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/api_pb";
import { WorkflowSchema } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/api_pb";
import { WorkflowExecutionSchema } from "@stigmer/protos/ai/stigmer/agentic/workflowexecution/v1/api_pb";
import { ExecutionPhase } from "@stigmer/protos/ai/stigmer/agentic/workflowexecution/v1/enum_pb";
import { RecoverWorkflowExecutionInputSchema } from "@stigmer/protos/ai/stigmer/agentic/workflowexecution/v1/io_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import { createLogger } from "../../../boot/logger.js";
import { KeyedSerializer } from "../../../pipeline/keyed-serializer.js";
import { testCallerIdentity } from "../../../pipeline/__tests__/support.js";
import { newPermissiveSingleTeamAuthorizer } from "../../../pipeline/steps/authorize.js";
import { SqliteStore } from "../../../store/sqlite/store.js";
import {
  PERSONAL_LABEL_KEY,
  PERSONAL_LABEL_VALUE,
} from "../../environment/constants.js";

import type { LifecycleDeps } from "../lifecycle.js";
import { recoverExecution } from "../lifecycle.js";
import { StreamBroker } from "../stream-broker.js";
import { newWorkflowExecutionConfigFromEnv } from "../temporal/config.js";
import { stubConnectedEngine } from "./engine-stub.js";

const silentLogger = createLogger({
  level: "error",
  pretty: false,
  write: () => {},
});

const ORG = "acme";
const PERSON = "acc_runner";
const WORKFLOW_ID = "wfl_nightly";
const PINNED = "a".repeat(64);
const HEAD = "b".repeat(64);

let dir: string;
let store: SqliteStore;
let counter = 0;

function workflowAt(hash: string, declared: readonly string[]): Workflow {
  return create(WorkflowSchema, {
    metadata: { id: WORKFLOW_ID, org: ORG, slug: "nightly" },
    spec: {
      env: Object.fromEntries(declared.map((key) => [key, { isSecret: true }])),
    },
    status: { versionHash: hash },
  });
}

beforeAll(async () => {
  dir = mkdtempSync(path.join(tmpdir(), "wfexec-recover-env-"));
  store = SqliteStore.open(path.join(dir, "stigmer.db"));
  // The run pinned a version declaring SLACK_WEBHOOK; the author has since
  // saved a head that declares API_TOKEN instead.
  await store.saveAudit(
    ApiResourceKind.workflow,
    WORKFLOW_ID,
    WorkflowSchema,
    workflowAt(PINNED, ["SLACK_WEBHOOK"]),
    PINNED,
    "",
  );
  await store.saveResource(
    ApiResourceKind.workflow,
    WORKFLOW_ID,
    WorkflowSchema,
    workflowAt(HEAD, ["API_TOKEN"]),
  );
  await store.saveResource(
    ApiResourceKind.environment,
    "env_runner",
    EnvironmentSchema,
    create(EnvironmentSchema, {
      metadata: {
        id: "env_runner",
        org: ORG,
        slug: "personal",
        labels: { [PERSONAL_LABEL_KEY]: PERSONAL_LABEL_VALUE },
      },
      spec: {
        data: {
          SLACK_WEBHOOK: { value: "runner-hook", isSecret: true },
          API_TOKEN: { value: "runner-token", isSecret: true },
        },
      },
      status: { audit: { specAudit: { createdBy: { id: PERSON } } } },
    }),
  );
});

afterAll(async () => {
  await store.close();
  rmSync(dir, { recursive: true, force: true });
});

async function seedFailedRun(versionHash: string): Promise<string> {
  counter += 1;
  const id = `wex_rec_${counter}`;
  await store.saveResource(
    ApiResourceKind.workflow_execution,
    id,
    WorkflowExecutionSchema,
    create(WorkflowExecutionSchema, {
      metadata: { id, name: id, org: ORG },
      spec: { workflowId: WORKFLOW_ID },
      status: {
        phase: ExecutionPhase.EXECUTION_FAILED,
        workflowVersionHash: versionHash,
        audit: { specAudit: { createdBy: { id: PERSON } } },
      },
    }),
  );
  return id;
}

function deps(created: ExecutionContext[]): LifecycleDeps {
  return {
    store,
    logger: silentLogger,
    authorizer: newPermissiveSingleTeamAuthorizer(),
    recoverSerializer: new KeyedSerializer(),
    broker: new StreamBroker(silentLogger),
    engineState: () => stubConnectedEngine().state,
    executionContextBuilder: {
      store,
      logger: silentLogger,
      environmentReader: () => ({
        getSecretValue: (input) =>
          Promise.resolve(
            create(EnvironmentValueSchema, {
              value: input.key === "SLACK_WEBHOOK" ? "runner-hook" : "runner-token",
              isSecret: true,
            }),
          ),
      }),
      executionContextCreator: () => ({
        create: (ec) => {
          created.push(ec);
          return Promise.resolve(ec);
        },
      }),
      executionContextDeleter: () => ({ delete: () => Promise.resolve() }),
    },
    sandboxLane: { enabled: false },
    temporalConfig: newWorkflowExecutionConfigFromEnv(),
    sandboxTerminalObserver: () => {},
    gateSteps: new Map(),
  };
}

describe("recover rebuilds the run's context", () => {
  it("from the pinned version's declarations and the person's personal environment", async () => {
    const id = await seedFailedRun(PINNED);
    const created: ExecutionContext[] = [];
    await recoverExecution(
      deps(created),
      create(RecoverWorkflowExecutionInputSchema, { id }),
      testCallerIdentity(),
    );
    expect(created).toHaveLength(1);
    const data = created[0]!.spec!.data;
    expect(Object.keys(data)).toEqual(["SLACK_WEBHOOK"]);
    expect(data.SLACK_WEBHOOK?.value).toBe("runner-hook");
  });

  it("builds no context when the pinned version declares nothing the person holds", async () => {
    await store.saveAudit(
      ApiResourceKind.workflow,
      WORKFLOW_ID,
      WorkflowSchema,
      workflowAt("c".repeat(64), ["UNHELD_KEY"]),
      "c".repeat(64),
      "",
    );
    const id = await seedFailedRun("c".repeat(64));
    const created: ExecutionContext[] = [];
    await recoverExecution(
      deps(created),
      create(RecoverWorkflowExecutionInputSchema, { id }),
      testCallerIdentity(),
    );
    expect(created).toEqual([]);
  });
});
