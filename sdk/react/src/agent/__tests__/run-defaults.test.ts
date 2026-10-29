/**
 * The client half of the server's engine rule for an agent's run
 * defaults: the model choices count only on a conversation running the
 * engine the agent names, and only when it names a model. A surface that
 * showed "Agent default" anywhere else would promise a model the server
 * does not run.
 */
import { describe, it, expect } from "vitest";
import { create, type MessageInitShape } from "@bufbuild/protobuf";
import { AgentSpecSchema } from "@stigmer/apis/ai/stigmer/agentic/agent/v1/spec_pb";
import { Harness } from "@stigmer/apis/ai/stigmer/agentic/session/v1/enum_pb";
import {
  ServiceTier,
  ThinkingMode,
} from "@stigmer/apis/ai/stigmer/agentic/run/v1/enum_pb";
import { agentHarnessOf, agentRunDefaultsFor } from "../run-defaults";

const spec = (fields: MessageInitShape<typeof AgentSpecSchema>) =>
  create(AgentSpecSchema, fields);

describe("agentRunDefaultsFor", () => {
  it("returns the model, tier and thinking on the agent's engine", () => {
    expect(
      agentRunDefaultsFor(
        spec({
          harness: Harness.STIGMER,
          runConfig: {
            modelName: "claude-sonnet-4-6",
            serviceTier: ServiceTier.FAST,
            thinkingMode: ThinkingMode.ENABLED,
            maxCostUsd: 2,
          },
        }),
        "stigmer",
      ),
    ).toEqual({ modelName: "claude-sonnet-4-6", serviceTier: "fast", thinkingMode: "enabled" });
  });

  it("returns nothing on another engine", () => {
    expect(
      agentRunDefaultsFor(
        spec({ harness: Harness.CLAUDE, runConfig: { modelName: "claude-sonnet-4-6" } }),
        "stigmer",
      ),
    ).toBeUndefined();
  });

  it("returns nothing when the agent names an engine but no model", () => {
    expect(
      agentRunDefaultsFor(spec({ harness: Harness.STIGMER, runConfig: { maxCostUsd: 2 } }), "stigmer"),
    ).toBeUndefined();
  });

  it("returns nothing for an agent with no run defaults", () => {
    expect(agentRunDefaultsFor(spec({}), "stigmer")).toBeUndefined();
    expect(agentRunDefaultsFor(undefined, "stigmer")).toBeUndefined();
  });
});

describe("agentHarnessOf", () => {
  it("names the agent's engine, and nothing when it names none", () => {
    expect(agentHarnessOf(spec({ harness: Harness.CLAUDE }))).toBe("claude");
    expect(agentHarnessOf(spec({}))).toBeUndefined();
  });
});
