/**
 * Pins what the conversation's computer refusal names (../resolve-session-
 * computer.ts) when the agent can't be read as it is now: an agent that is
 * gone leaves the sentence naming "this conversation's agent", and a store
 * fault reading it is INTERNAL, never a refusal that hides it. The cases
 * where the agent is read are pinned over the composed server
 * (domain/agent/__tests__/agent-computer.test.ts).
 */
import { create } from "@bufbuild/protobuf";
import { Code, ConnectError } from "@connectrpc/connect";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { SessionSchema } from "@stigmer/apis/ai/stigmer/agentic/session/v1/api_pb";
import type { Session } from "@stigmer/apis/ai/stigmer/agentic/session/v1/api_pb";
import { Computer } from "@stigmer/apis/ai/stigmer/agentic/session/v1/enum_pb";

import type { Store } from "../../../store/interface.js";
import { tempStore, type TempStore } from "../../../store/sqlite/__tests__/support.js";
import { refuseSessionWithoutComputer } from "../resolve-session-computer.js";

let temp: TempStore;

beforeEach(() => {
  temp = tempStore();
});

afterEach(async () => {
  await temp.cleanup();
});

/** A conversation without a computer, on an agent nobody can read now, that attaches a repository. */
function withRepository(): Session {
  return create(SessionSchema, {
    metadata: { id: "ses_1", org: "org_1" },
    spec: { resources: [{ name: "app", resource: { case: "gitRepository", value: { url: "https://github.com/acme/app" } } }] },
    status: { agentId: "agt_gone", computer: Computer.NONE },
  });
}

async function refusal(run: Promise<void>): Promise<ConnectError> {
  try {
    await run;
  } catch (error) {
    return ConnectError.from(error);
  }
  throw new Error("expected a refusal");
}

describe("refuseSessionWithoutComputer's agent name", () => {
  it("says this conversation's agent when the agent is gone", async () => {
    const error = await refusal(refuseSessionWithoutComputer(temp.store, withRepository()));
    expect([error.code, error.rawMessage]).toEqual([
      Code.FailedPrecondition,
      "this conversation's agent has no computer, so this conversation can't attach repository 'app'; remove it, or give the agent a computer",
    ]);
  });

  it("is INTERNAL when the store can't read the agent", async () => {
    const failing = new Proxy(temp.store, {
      get(target, property, receiver) {
        if (property === "getResource") {
          return () => Promise.reject(new Error("disk unavailable"));
        }
        const value: unknown = Reflect.get(target, property, receiver);
        return typeof value === "function" ? value.bind(target) : value;
      },
    }) as Store;
    const error = await refusal(refuseSessionWithoutComputer(failing, withRepository()));
    expect(error.code).toBe(Code.Internal);
  });
});
