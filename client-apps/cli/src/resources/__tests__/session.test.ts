// Unit tests for the session read helpers resume is built on: a session is
// read by its id, and its runs are listed in one call for that session,
// returned in the server's order (newest first). The client is a double
// recording what it was asked.

import { create } from "@bufbuild/protobuf";
import { AgentRunSchema } from "@stigmer/protos/ai/stigmer/agentic/agentrun/v1/api_pb";
import type { ListAgentRunsBySessionRequest } from "@stigmer/protos/ai/stigmer/agentic/agentrun/v1/io_pb";
import { SessionSchema } from "@stigmer/protos/ai/stigmer/agentic/session/v1/api_pb";
import type { Stigmer } from "@stigmer/sdk";
import { describe, expect, it } from "vitest";
import { getSessionById, listRunsBySession } from "../session.js";

describe("session reads", () => {
  it("reads a session by its id", async () => {
    const asked: string[] = [];
    const client = {
      session: {
        get: async (id: string) => {
          asked.push(id);
          return create(SessionSchema, { metadata: { id } });
        },
      },
    } as unknown as Stigmer;

    const session = await getSessionById(client, "ses_1");

    expect(asked).toEqual(["ses_1"]);
    expect(session.metadata?.id).toBe("ses_1");
  });

  it("lists a session's runs in one call, in the server's order", async () => {
    const requests: ListAgentRunsBySessionRequest[] = [];
    const client = {
      agentRun: {
        listBySession: async (req: ListAgentRunsBySessionRequest) => {
          requests.push(req);
          return {
            entries: [
              create(AgentRunSchema, { metadata: { id: "aex_2" } }),
              create(AgentRunSchema, { metadata: { id: "aex_1" } }),
            ],
          };
        },
      },
    } as unknown as Stigmer;

    const runs = await listRunsBySession(client, "ses_1");

    expect(requests.map((r) => r.sessionId)).toEqual(["ses_1"]);
    expect(runs.map((r) => r.metadata?.id)).toEqual(["aex_2", "aex_1"]);
  });
});
