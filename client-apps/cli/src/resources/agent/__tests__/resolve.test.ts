// Pins the `agent` group's one rule for naming an agent: an id is read as
// it is, `org/slug` in that organization, a bare slug in the active one;
// and a slug with no organization set, on a server that holds several,
// is refused with the caller's own lines for setting one before any read,
// while a server that holds one reads it with none.

import { create } from "@bufbuild/protobuf";
import { AgentSchema } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/api_pb";
import type { Stigmer } from "@stigmer/sdk";
import { describe, expect, it } from "vitest";
import { UsageError } from "../../../errors/index.js";
import { resolveAgent } from "../resolve.js";

const agent = create(AgentSchema, { metadata: { id: "agt_1", org: "org_acme", slug: "support-desk" } });

const SET_IT_WITH = ["stigmer config context set --org <org>", "stigmer agent quality --org <org> <agent>"];

function fakeClient(singleOrg = false) {
  const calls: string[] = [];
  const client = {
    platform: { getServerInfo: async () => ({ singleOrg }) },
    agent: {
      get: async (id: string) => {
        calls.push(`get ${id}`);
        return agent;
      },
      getByReference: async (ref: { org: string; slug: string }) => {
        calls.push(`ref ${ref.org}/${ref.slug}`);
        return agent;
      },
    },
  } as unknown as Stigmer;
  return { client, calls };
}

describe("resolveAgent", () => {
  it("reads an id as it is, whatever the active organization", async () => {
    const { client, calls } = fakeClient();
    expect(await resolveAgent(client, "agt_1", "acme", SET_IT_WITH)).toBe(agent);
    expect(calls).toEqual(["get agt_1"]);
  });

  it("reads a bare slug in the active organization, and org/slug in the one it names", async () => {
    const { client, calls } = fakeClient();
    await resolveAgent(client, "support-desk", "acme", SET_IT_WITH);
    await resolveAgent(client, "globex/support-desk", "acme", SET_IT_WITH);
    expect(calls).toEqual(["ref acme/support-desk", "ref globex/support-desk"]);
  });

  it("refuses a slug with no organization on a server that holds several, naming the caller's lines", async () => {
    const { client, calls } = fakeClient();
    const error = await resolveAgent(client, "support-desk", "", SET_IT_WITH).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(UsageError);
    expect((error as UsageError).message).toContain("organization not set");
    expect((error as UsageError).message).toContain("stigmer agent quality --org <org> <agent>");
    expect(calls).toEqual([]);
  });

  it("reads a slug with no organization on a server that holds one", async () => {
    const { client, calls } = fakeClient(true);
    await resolveAgent(client, "support-desk", "", SET_IT_WITH);
    expect(calls).toEqual(["ref /support-desk"]);
  });
});
