/**
 * Pins getExecutionUsageReport's store-fault mapping in LoadExecution — the
 * composed suite (agentexecution.test.ts) reaches only the real store, which
 * cannot fail selectively:
 *
 *   - a typed ResourceNotFoundError answers the domain's NotFound copy,
 *     `agent_execution not found: <id>` (stigmer/stigmer#859);
 *   - any other store failure is an infrastructure fault: a sanitized
 *     Internal whose wire text never carries the cause, never a NotFound
 *     that would tell a client the execution does not exist.
 */
import { create } from "@bufbuild/protobuf";
import { Code, ConnectError } from "@connectrpc/connect";
import { describe, expect, it } from "vitest";

import { AgentExecutionQueryController } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/query_pb";

import { createLogger } from "../../../boot/logger.js";
import type { Authorizer } from "../../../extensions/authorizer.js";
import { testCallerIdentity } from "../../../pipeline/__tests__/support.js";
import { ResourceNotFoundError } from "../../../store/interface.js";
import type { Store } from "../../../store/interface.js";

import { getExecutionUsageReport } from "../usage.js";

const silentLogger = createLogger({
  level: "error",
  pretty: false,
  write: () => {},
});

const allowingAuthorizer: Authorizer = {
  authorize: () => Promise.resolve({ kind: "allow" }),
};

/** A store whose one read the chain makes fails with the given error. */
function failingStore(error: Error): Store {
  return {
    getResource: () => Promise.reject(error),
  } as unknown as Store;
}

async function reportError(store: Store): Promise<ConnectError> {
  const error = await getExecutionUsageReport(
    {
      store,
      logger: silentLogger,
      authorizer: allowingAuthorizer,
      listReadScope: undefined,
    },
    create(AgentExecutionQueryController.method.getExecutionUsageReport.input, {
      executionId: "aex_missing",
    }),
    testCallerIdentity(),
  ).catch((e: unknown) => e);
  expect(error).toBeInstanceOf(ConnectError);
  return error as ConnectError;
}

describe("getExecutionUsageReport — LoadExecution store faults", () => {
  it("a missing execution answers NotFound with the domain's copy", async () => {
    const error = await reportError(
      failingStore(new ResourceNotFoundError("agent_execution/aex_missing")),
    );

    expect(error.code).toBe(Code.NotFound);
    expect(error.rawMessage).toBe("agent_execution not found: aex_missing");
  });

  it("any other store failure answers a sanitized Internal, never NotFound", async () => {
    const error = await reportError(
      failingStore(new Error("SQLITE_BUSY: database is locked")),
    );

    expect(error.code).toBe(Code.Internal);
    expect(error.rawMessage).toBe("failed to load agent execution");
  });
});
