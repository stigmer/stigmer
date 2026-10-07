// The human field view of `get` names the settings a resource runs with: an
// agent's run defaults (engine, model, speed tier, thinking, bounds), and a
// turn's resolved settings rather than what its message asked, each only
// when set. Pinned here because the view is generic over kinds and a
// field it never names is invisible to a person reading `get agent`.

import { create } from "@bufbuild/protobuf";
import { AgentSchema } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/api_pb";
import { RunSchema } from "@stigmer/protos/ai/stigmer/agentic/run/v1/api_pb";
import {
  ServiceTier,
  ThinkingMode,
} from "@stigmer/protos/ai/stigmer/agentic/run/v1/enum_pb";
import { Harness } from "@stigmer/protos/ai/stigmer/agentic/session/v1/enum_pb";
import { describe, expect, it } from "vitest";
import { renderResource } from "../render.js";

describe("renderResource — run settings in the human view", () => {
  it("names an agent's run defaults", () => {
    const agent = create(AgentSchema, {
      metadata: { id: "agt_1", name: "Reviewer", slug: "reviewer" },
      spec: {
        harness: Harness.NATIVE,
        runConfig: {
          modelName: "claude-sonnet-4-6",
          serviceTier: ServiceTier.FAST,
          thinkingMode: ThinkingMode.ENABLED,
          maxCostUsd: 2.5,
          maxToolRounds: 12,
          maxToolResultChars: 20000,
        },
      },
    });

    const out = renderResource(AgentSchema, agent, "table", { hideOrg: true });
    expect(out).toMatch(/Engine:\s+native/);
    expect(out).toMatch(/Model:\s+claude-sonnet-4-6/);
    expect(out).toMatch(/Speed tier:\s+fast/);
    expect(out).toMatch(/Thinking:\s+enabled/);
    expect(out).toMatch(/Cost cap:\s+\$2\.5 per message/);
    expect(out).toMatch(/Tool rounds:\s+at most 12 per message/);
    expect(out).toMatch(/Tool result size:\s+at most 20000 characters/);
  });

  it("names the settings a turn ran with, not only what its message asked", () => {
    const execution = create(RunSchema, {
      metadata: { id: "aex_1", name: "aex_1" },
      spec: { message: "hi", runConfig: { maxCostUsd: 1 } },
      status: {
        runConfig: { modelName: "claude-sonnet-4-6", thinkingMode: ThinkingMode.ENABLED, maxCostUsd: 1 },
      },
    });

    const out = renderResource(RunSchema, execution, "table", { hideOrg: true });
    expect(out).toMatch(/Model:\s+claude-sonnet-4-6/);
    expect(out).toMatch(/Thinking:\s+enabled/);
    expect(out).toMatch(/Cost cap:\s+\$1 per message/);
  });

  it("names nothing for an agent with no run defaults", () => {
    const agent = create(AgentSchema, {
      metadata: { id: "agt_1", name: "Reviewer", slug: "reviewer" },
      spec: {},
    });

    const out = renderResource(AgentSchema, agent, "table", { hideOrg: true });
    expect(out).not.toMatch(/Engine|Model|Speed tier|Thinking|Cost cap/);
  });
});
