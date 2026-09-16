/**
 * The workflow side of the run credential (`interceptors/run-credential.ts`):
 * the stamp on both activity kinds, the gate by workflow type, the
 * credential-less pass-through, and the fence that every gated type is a
 * real export alias of the workflow barrel.
 *
 * `workflowInfo()` is the only sandbox API the interceptor reads; it is
 * replaced here so the factory can run outside an isolate. Everything else
 * from `@temporalio/workflow` is the real module, imported once for the
 * barrel fence.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { defaultPayloadConverter } from "@temporalio/common";
import type {
  ActivityInput,
  LocalActivityInput,
  WorkflowExecuteInput,
} from "@temporalio/workflow";

let workflowType = "";

vi.mock("@temporalio/workflow", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("@temporalio/workflow")>();
  return { ...original, workflowInfo: () => ({ workflowType }) };
});

import {
  RUN_WORKFLOW_TYPES,
  interceptors,
} from "../interceptors/run-credential.js";
import { EXECUTE_FROM_EXECUTION_WORKFLOW_TYPE } from "../execute-from-execution.js";
import {
  RUN_CREDENTIAL_HEADER,
  RUN_CREDENTIAL_INPUT_KEY,
} from "../../shared/run-credential.js";
import * as barrel from "../index.js";

/** Drive one workflow run through the factory: its inbound execute, then one schedule of each kind. */
async function run(type: string, workflowArg: unknown) {
  workflowType = type;
  const { inbound, outbound } = interceptors();
  const executeInput: WorkflowExecuteInput = {
    args: [workflowArg],
    headers: {},
  };
  await inbound![0]!.execute!(executeInput, async () => undefined);

  const seen: { activity?: ActivityInput; local?: LocalActivityInput } = {};
  const activityInput = {
    activityType: "EmitWorkflowEvents",
    args: ["wex_1"],
    headers: {},
    options: {},
    seq: 1,
  } as unknown as ActivityInput;
  const localInput = {
    activityType: "PromoteTaskOutput",
    args: ["out", "wex_1"],
    headers: {},
    options: {},
    seq: 2,
  } as unknown as LocalActivityInput;
  await outbound![0]!.scheduleActivity!(activityInput, async (input) => {
    seen.activity = input;
    return undefined;
  });
  await outbound![0]!.scheduleLocalActivity!(localInput, async (input) => {
    seen.local = input;
    return undefined;
  });
  return seen;
}

function credentialIn(headers: ActivityInput["headers"] | undefined): unknown {
  const payload = headers?.[RUN_CREDENTIAL_HEADER];
  return payload === undefined
    ? undefined
    : defaultPayloadConverter.fromPayload(payload);
}

describe("run-credential workflow interceptors", () => {
  beforeEach(() => {
    workflowType = "";
  });

  it("stamps the run workflow's credential onto a remote activity and a local activity alike", async () => {
    const seen = await run(EXECUTE_FROM_EXECUTION_WORKFLOW_TYPE, {
      execution_id: "wex_1",
      [RUN_CREDENTIAL_INPUT_KEY]: "cred-run",
    });
    expect(credentialIn(seen.activity?.headers)).toBe("cred-run");
    expect(credentialIn(seen.local?.headers)).toBe("cred-run");
  });

  it("keeps the other headers a schedule already carries", async () => {
    workflowType = EXECUTE_FROM_EXECUTION_WORKFLOW_TYPE;
    const { inbound, outbound } = interceptors();
    await inbound![0]!.execute!(
      { args: [{ [RUN_CREDENTIAL_INPUT_KEY]: "cred-run" }], headers: {} },
      async () => undefined,
    );
    const other = defaultPayloadConverter.toPayload("trace");
    let stamped: ActivityInput | undefined;
    await outbound![0]!.scheduleActivity!(
      {
        activityType: "X",
        args: [],
        headers: { "_tracer-data": other },
        options: {},
        seq: 1,
      } as unknown as ActivityInput,
      async (input) => {
        stamped = input;
        return undefined;
      },
    );
    expect(stamped?.headers["_tracer-data"]).toBe(other);
    expect(credentialIn(stamped?.headers)).toBe("cred-run");
  });

  it("stamps nothing when the run workflow's input carries no credential — an older server's dispatch replays byte for byte", async () => {
    const seen = await run(EXECUTE_FROM_EXECUTION_WORKFLOW_TYPE, {
      execution_id: "wex_1",
    });
    expect(seen.activity?.headers).toEqual({});
    expect(seen.local?.headers).toEqual({});
  });

  it("stamps nothing for the connect workflow even though its input carries the same key — that token is not a run credential", async () => {
    const seen = await run("stigmer/mcp-server/connect", {
      mcp_server_id: "mcp_1",
      [RUN_CREDENTIAL_INPUT_KEY]: "connect-token",
    });
    expect(seen.activity?.headers).toEqual({});
    expect(seen.local?.headers).toEqual({});
  });

  it("keeps each workflow run's credential on its own factory instance", async () => {
    workflowType = EXECUTE_FROM_EXECUTION_WORKFLOW_TYPE;
    const first = interceptors();
    const second = interceptors();
    await first.inbound![0]!.execute!(
      { args: [{ [RUN_CREDENTIAL_INPUT_KEY]: "cred-1" }], headers: {} },
      async () => undefined,
    );
    await second.inbound![0]!.execute!(
      { args: [{ execution_id: "wex_2" }], headers: {} },
      async () => undefined,
    );
    let fromSecond: ActivityInput | undefined;
    await second.outbound![0]!.scheduleActivity!(
      {
        activityType: "X",
        args: [],
        headers: {},
        options: {},
        seq: 1,
      } as unknown as ActivityInput,
      async (input) => {
        fromSecond = input;
        return undefined;
      },
    );
    expect(fromSecond?.headers).toEqual({});
  });

  it("gates on workflow types that are export aliases of the barrel — the list cannot name a type that does not exist", () => {
    expect(RUN_WORKFLOW_TYPES).toEqual([EXECUTE_FROM_EXECUTION_WORKFLOW_TYPE]);
    for (const type of RUN_WORKFLOW_TYPES) {
      expect(
        Object.keys(barrel),
        `"${type}" must be exported by workflows/index.ts`,
      ).toContain(type);
    }
  });
});
