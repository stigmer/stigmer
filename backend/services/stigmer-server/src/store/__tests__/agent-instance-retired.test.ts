/**
 * Pins the driver-neutral half of the agent instance kind's removal
 * (../agent-instance-retired.ts) over rows built the way an earlier
 * release wrote them (retired-instance-rows.ts):
 *   - a retired instance row names its agent by spec.agent_id;
 *   - a session whose instance survives with its agent names that agent by
 *     organization id and slug and pins its current version, dropping the
 *     retired field and keeping every other field it carried;
 *   - a session whose instance survives its deleted agent keeps the agent's
 *     id with no reference;
 *   - a session whose instance is gone, or whose retired field is empty,
 *     names no agent: the built-in assistant;
 *   - a session that never carried the field is left alone;
 *   - bytes that do not decode throw (the step must not pass over them).
 */
import { fromBinary } from "@bufbuild/protobuf";
import { describe, expect, it } from "vitest";

import { SessionSchema } from "@stigmer/protos/ai/stigmer/agentic/session/v1/api_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import {
  instanceAgentIdOf,
  migrateSessionRow,
  sessionInstanceIdOf,
  type InstanceAgent,
} from "../agent-instance-retired.js";
import {
  retiredInstanceRow,
  retiredSessionRow,
  sessionBytes,
} from "./retired-instance-rows.js";

const ORG = "org_01jz0000000000000000000000";
const HEAD = "d".repeat(64);

const LIVE: InstanceAgent = {
  kind: "agent",
  agentId: "agt_1",
  org: ORG,
  slug: "reviewer",
  versionHash: HEAD,
};

function agents(
  byInstance: Record<string, InstanceAgent>,
): (instanceId: string) => InstanceAgent | undefined {
  return (instanceId) => byInstance[instanceId];
}

describe("instanceAgentIdOf", () => {
  it("reads the agent a retired instance row names", () => {
    const row = retiredInstanceRow({
      metadata: { id: "ain_1", org: ORG, slug: "reviewer-default" },
      agentId: "agt_1",
      description: "Default instance",
    });
    expect(instanceAgentIdOf(row)).toBe("agt_1");
  });

  it("throws on bytes that do not decode", () => {
    expect(() => instanceAgentIdOf(new Uint8Array([0x0a, 0xff]))).toThrow();
  });
});

describe("migrateSessionRow", () => {
  const metadata = { id: "ses_1", org: ORG, slug: "chat" };
  const spec = {
    subject: "Release notes",
    workspaceEntries: [{ name: "repo" }],
  };

  it("names the instance's agent and pins its current version", () => {
    const old = retiredSessionRow({ metadata, instanceId: "ain_1", spec });
    expect(sessionInstanceIdOf(fromBinary(SessionSchema, old))).toBe("ain_1");

    const migrated = migrateSessionRow(old, agents({ ain_1: LIVE }));

    expect(migrated).toEqual(
      sessionBytes({
        metadata,
        spec: {
          ...spec,
          agentRef: { kind: ApiResourceKind.agent, org: ORG, slug: "reviewer" },
        },
        status: { agentId: "agt_1", agentVersionHash: HEAD },
      }),
    );
  });

  it("keeps a deleted agent's id with no reference", () => {
    const old = retiredSessionRow({ metadata, instanceId: "ain_1", spec });
    const migrated = migrateSessionRow(
      old,
      agents({ ain_1: { kind: "agent-gone", agentId: "agt_gone" } }),
    );
    expect(migrated).toEqual(
      sessionBytes({ metadata, spec, status: { agentId: "agt_gone" } }),
    );
  });

  it("drops the field of an instance that is gone: the built-in assistant", () => {
    const old = retiredSessionRow({ metadata, instanceId: "ain_gone", spec });
    expect(migrateSessionRow(old, agents({}))).toEqual(
      sessionBytes({ metadata, spec }),
    );
  });

  it("leaves a session that never named an instance alone", () => {
    const old = retiredSessionRow({ metadata, instanceId: "", spec });
    expect(migrateSessionRow(old, agents({ ain_1: LIVE }))).toBeUndefined();
  });

  it("throws on bytes that do not decode", () => {
    expect(() =>
      migrateSessionRow(new Uint8Array([0x22, 0xff]), agents({})),
    ).toThrow();
  });
});
