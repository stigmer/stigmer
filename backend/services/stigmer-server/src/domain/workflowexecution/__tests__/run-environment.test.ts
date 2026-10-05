/**
 * Where a workflow run's keys come from (create-execution-context-step.ts
 * `workflowRunEnvironment`, shared by create and recover): the values
 * passed with the run first, filtered to the keys the workflow declares,
 * then every declared key still missing from the personal environment of
 * the person who started the run — never the workflow author's, never a
 * teammate's — and none at all for a workflow of another organization
 * than the run's. A run with no person reads nobody's, and a failed secret
 * read is non-fatal.
 *
 * Over a real store (the rows the personal lookup scans) with a reader
 * that answers the secret reads by environment id and records them, so a
 * read of the wrong person's row is visible even where its value would
 * not be.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { create } from "@bufbuild/protobuf";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { Environment } from "@stigmer/protos/ai/stigmer/agentic/environment/v1/api_pb";
import { EnvironmentSchema } from "@stigmer/protos/ai/stigmer/agentic/environment/v1/api_pb";
import { EnvironmentValueSchema } from "@stigmer/protos/ai/stigmer/agentic/environment/v1/spec_pb";
import type { ExecutionValue } from "@stigmer/protos/ai/stigmer/agentic/executioncontext/v1/spec_pb";
import { ExecutionValueSchema } from "@stigmer/protos/ai/stigmer/agentic/executioncontext/v1/spec_pb";
import type { Workflow } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/api_pb";
import { WorkflowSchema } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/api_pb";
import type { WorkflowExecution } from "@stigmer/protos/ai/stigmer/agentic/workflowexecution/v1/api_pb";
import { WorkflowExecutionSchema } from "@stigmer/protos/ai/stigmer/agentic/workflowexecution/v1/api_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import { createLogger } from "../../../boot/logger.js";
import type { Store } from "../../../store/interface.js";
import { SqliteStore } from "../../../store/sqlite/store.js";
import {
  PERSONAL_LABEL_KEY,
  PERSONAL_LABEL_VALUE,
} from "../../environment/constants.js";

import type { WorkflowExecutionContextBuilderDeps } from "../create-execution-context-step.js";
import { workflowRunEnvironment } from "../create-execution-context-step.js";

const silentLogger = createLogger({
  level: "error",
  pretty: false,
  write: () => {},
});

const ORG = "acme";
const AUTHOR = "acc_author";
const RUNNER = "acc_runner";

let dir: string;
let store: Store;

function personalEnvironment(
  id: string,
  creator: string,
  data: Record<string, string>,
): Environment {
  return create(EnvironmentSchema, {
    metadata: {
      id,
      org: ORG,
      slug: id,
      labels: { [PERSONAL_LABEL_KEY]: PERSONAL_LABEL_VALUE },
    },
    spec: {
      data: Object.fromEntries(
        Object.entries(data).map(([key, value]) => [
          key,
          { value, isSecret: true },
        ]),
      ),
    },
    status: { audit: { specAudit: { createdBy: { id: creator } } } },
  });
}

const ENVIRONMENTS = [
  personalEnvironment("env_author", AUTHOR, {
    SLACK_WEBHOOK: "author-hook",
    API_TOKEN: "author-token",
  }),
  personalEnvironment("env_runner", RUNNER, {
    SLACK_WEBHOOK: "runner-hook",
    API_TOKEN: "runner-token",
    UNDECLARED: "never-read",
  }),
];

beforeAll(async () => {
  dir = mkdtempSync(path.join(tmpdir(), "wfexec-run-env-"));
  store = SqliteStore.open(path.join(dir, "stigmer.db"));
  for (const env of ENVIRONMENTS) {
    await store.saveResource(
      ApiResourceKind.environment,
      env.metadata!.id,
      EnvironmentSchema,
      env,
    );
  }
});

afterAll(async () => {
  await store.close();
  rmSync(dir, { recursive: true, force: true });
});

/** The deps with a reader answering from the seeded rows; `reads` records each environment id read. */
function deps(
  reads: string[],
  fail = false,
): WorkflowExecutionContextBuilderDeps {
  return {
    store,
    logger: silentLogger,
    environmentReader: () => ({
      getSecretValue: (input) => {
        reads.push(input.environmentId ?? "");
        if (fail) {
          return Promise.reject(new Error("secret store unavailable"));
        }
        const env = ENVIRONMENTS.find(
          (e) => e.metadata?.id === input.environmentId,
        );
        return Promise.resolve(
          create(EnvironmentValueSchema, {
            value: env?.spec?.data[input.key ?? ""]?.value ?? "",
            isSecret: true,
          }),
        );
      },
    }),
    executionContextCreator: () => {
      throw new Error("not reached by workflowRunEnvironment");
    },
    executionContextDeleter: () => {
      throw new Error("not reached by workflowRunEnvironment");
    },
  };
}

function workflow(org = ORG): Workflow {
  return create(WorkflowSchema, {
    metadata: { id: "wfl_nightly", org, slug: "nightly" },
    spec: {
      env: {
        SLACK_WEBHOOK: { isSecret: true },
        API_TOKEN: { isSecret: true },
        OPTIONAL_FLAG: { optional: true },
      },
    },
    status: { audit: { specAudit: { createdBy: { id: AUTHOR } } } },
  });
}

function run(person: string | undefined): WorkflowExecution {
  return create(WorkflowExecutionSchema, {
    metadata: { id: "wex_1", org: ORG },
    spec: { workflowId: "wfl_nightly" },
    status:
      person === undefined
        ? {}
        : { audit: { specAudit: { createdBy: { id: person } } } },
  });
}

function value(text: string): ExecutionValue {
  return create(ExecutionValueSchema, { value: text });
}

function values(env: Map<string, ExecutionValue>): Record<string, string> {
  return Object.fromEntries([...env].map(([key, v]) => [key, v.value]));
}

describe("workflowRunEnvironment", () => {
  it("fills a declared key from the starter's personal environment, never the author's", async () => {
    const reads: string[] = [];
    const env = await workflowRunEnvironment(
      deps(reads),
      workflow(),
      run(RUNNER),
      {},
    );
    expect(values(env)).toEqual({
      SLACK_WEBHOOK: "runner-hook",
      API_TOKEN: "runner-token",
    });
    expect(new Set(reads)).toEqual(new Set(["env_runner"]));
  });

  it("a value passed with the run wins, and an undeclared one is dropped", async () => {
    const reads: string[] = [];
    const env = await workflowRunEnvironment(
      deps(reads),
      workflow(),
      run(RUNNER),
      { SLACK_WEBHOOK: value("typed-hook"), UNDECLARED: value("typed") },
    );
    expect(values(env)).toEqual({
      SLACK_WEBHOOK: "typed-hook",
      API_TOKEN: "runner-token",
    });
    expect(reads).toEqual(["env_runner"]);
  });

  it("a workflow of another organization gets none of the person's keys", async () => {
    const reads: string[] = [];
    const env = await workflowRunEnvironment(
      deps(reads),
      workflow("other-org"),
      run(RUNNER),
      { API_TOKEN: value("typed-token") },
    );
    expect(values(env)).toEqual({ API_TOKEN: "typed-token" });
    expect(reads).toEqual([]);
  });

  it("a run with no person reads nobody's", async () => {
    const reads: string[] = [];
    const env = await workflowRunEnvironment(
      deps(reads),
      workflow(),
      run(undefined),
      {},
    );
    expect(env.size).toBe(0);
    expect(reads).toEqual([]);
  });

  it("a failed secret read leaves the key missing and does not fail the run", async () => {
    const reads: string[] = [];
    const env = await workflowRunEnvironment(
      deps(reads, true),
      workflow(),
      run(RUNNER),
      { SLACK_WEBHOOK: value("typed-hook") },
    );
    expect(values(env)).toEqual({ SLACK_WEBHOOK: "typed-hook" });
    expect(reads).toEqual(["env_runner"]);
  });
});
