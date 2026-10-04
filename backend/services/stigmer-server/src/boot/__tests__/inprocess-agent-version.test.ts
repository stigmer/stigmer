/**
 * Pins the in-process agent loader's version read: the ExecutionContext
 * build reads the agent version a turn recorded through
 * `executionAgentLoader.getVersion`, which must be the AgentQueryController
 * getVersion RPC over the in-process transport, carrying the turn's agent id
 * and hash as given, its answer passed through and its refusal surfaced.
 */
import { create } from "@bufbuild/protobuf";
import { Code, ConnectError } from "@connectrpc/connect";
import type { ConnectRouter } from "@connectrpc/connect";
import { describe, expect, it } from "vitest";

import { AgentQueryController } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/query_pb";
import { AgentVersionEntrySchema } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/version_pb";
import type { GetAgentVersionInput } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/version_pb";

import { createInProcessClients } from "../inprocess.js";
import { createLogger } from "../logger.js";

const silentLogger = createLogger({ level: "error", pretty: false, write: () => {} });
const HASH = "d".repeat(64);

function loaderAnswering(getVersion: (req: GetAgentVersionInput) => unknown) {
  const routes = (router: ConnectRouter) => {
    router.service(AgentQueryController, {
      getVersion: (req) => getVersion(req) as ReturnType<typeof create<typeof AgentVersionEntrySchema>>,
    });
  };
  return createInProcessClients(routes, silentLogger).clients.executionAgentLoader;
}

describe("the in-process agent loader's version read", () => {
  it("asks getVersion for the turn's agent and hash and answers its entry", async () => {
    const asked: Array<[string, string]> = [];
    const loader = loaderAnswering((req) => {
      asked.push([req.agentId, req.versionHash]);
      return create(AgentVersionEntrySchema, {
        versionHash: req.versionHash,
        specSnapshot: { instructions: "The recorded instructions." },
      });
    });

    const entry = await loader.getVersion("agt_1", HASH);

    expect(asked).toEqual([["agt_1", HASH]]);
    expect(entry.specSnapshot?.instructions).toBe("The recorded instructions.");
  });

  it("surfaces the RPC's refusal with its code", async () => {
    const loader = loaderAnswering(() => {
      throw new ConnectError("agent version not found", Code.NotFound);
    });

    const error = await loader.getVersion("agt_1", HASH).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ConnectError);
    expect((error as ConnectError).code).toBe(Code.NotFound);
  });
});
