// Pins what the resource layer prints and asks on a server that holds one
// organization: the field view and the delete warning leave the Org line out
// (machine output keeps it), an empty version history names no organization
// (and names one by slug on a server that holds several),
// and a schedule named by bare slug with no organization resolves on such a
// server and is refused, naming the ways to set one, on a server that holds
// several.

import { create } from "@bufbuild/protobuf";
import { describe, expect, it, vi } from "vitest";
import { AgentSchema } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/api_pb";
import { OrganizationSchema } from "@stigmer/protos/ai/stigmer/tenancy/organization/v1/api_pb";
import { ScheduleSchema } from "@stigmer/protos/ai/stigmer/agentic/schedule/v1/api_pb";
import type { Stigmer } from "@stigmer/sdk";
import { UsageError } from "../../errors/usage-error.js";
import { planDelete } from "../delete.js";
import { renderResource } from "../render.js";
import { resumeSchedule } from "../schedule.js";
import { renderAgentVersionHistory } from "../version.js";

const AGENT = create(AgentSchema, {
  metadata: { id: "agt_1", name: "Helper", slug: "helper", org: "stigmer" },
});

describe("renderResource's field view", () => {
  it("names the organization on a server that holds several", () => {
    expect(renderResource(AgentSchema, AGENT, "table")).toMatch(/Org:\s+stigmer/);
  });

  it("leaves it out on a server that holds one", () => {
    const rendered = renderResource(AgentSchema, AGENT, "table", { hideOrg: true });
    expect(rendered).not.toMatch(/Org:/);
    expect(rendered).toMatch(/Slug:\s+helper/);
  });

  it("keeps it in machine output either way", () => {
    expect(JSON.parse(renderResource(AgentSchema, AGENT, "json"))).toMatchObject({
      metadata: { org: "stigmer" },
    });
  });
});

describe("the delete warning", () => {
  function serverHolding(singleOrg: boolean) {
    return {
      platform: { getServerInfo: async () => ({ singleOrg }) },
      agent: { get: async () => AGENT },
      // The label lookup names the organization by its slug.
      organization: {
        get: async () => ({ metadata: { id: "stigmer", slug: "stigmer-co" } }),
      },
    } as unknown as Stigmer;
  }
  const keys = (stigmer: Stigmer) =>
    planDelete(stigmer, "agent", "agt_1", "").then((plan) =>
      plan.warning.sections[0]?.fields.map((field) => field.key),
    );

  it("leaves the Org line out on a server that holds one", async () => {
    expect(await keys(serverHolding(true))).toEqual(["ID", "Name", "Slug"]);
  });

  it("names the organization by its slug on a server that holds several", async () => {
    const plan = await planDelete(serverHolding(false), "agent", "agt_1", "");
    expect(plan.warning.sections[0]?.fields).toContainEqual({ key: "Org", value: "stigmer-co" });
  });
});

describe("renderAgentVersionHistory with no versions", () => {
  const empty = {
    agent: { listVersions: async () => ({ versions: [], totalCount: 0 }) },
  } as unknown as Stigmer;

  it("names org/slug when an organization was named", async () => {
    expect(await renderAgentVersionHistory(empty, "acme", "reviewer")).toContain(
      "No version history found for acme/reviewer",
    );
  });

  it("names the organization by slug when given its id", async () => {
    const id = "org_01jaaaaaaaaaaaaaaaaaaaaaaa";
    const knowingAcme = {
      agent: { listVersions: async () => ({ versions: [], totalCount: 0 }) },
      organization: {
        get: async (value: string) => {
          if (value !== id) throw new Error("organization not found");
          return create(OrganizationSchema, { metadata: { id, slug: "acme" } });
        },
      },
    } as unknown as Stigmer;
    const rendered = await renderAgentVersionHistory(knowingAcme, id, "reviewer");
    expect(rendered).toContain("No version history found for acme/reviewer\n");
    expect(rendered).not.toContain(id);
  });

  it("names the slug alone when none was (a server that holds one)", async () => {
    expect(await renderAgentVersionHistory(empty, "", "reviewer")).toContain(
      "No version history found for reviewer\n",
    );
  });
});

describe("resumeSchedule by bare slug with no organization", () => {
  function serverHolding(singleOrg: boolean) {
    const getByReference = vi.fn(async () =>
      create(ScheduleSchema, { metadata: { id: "sch_1", slug: "nightly" } }),
    );
    const stigmer = {
      platform: { getServerInfo: async () => ({ singleOrg }) },
      schedule: {
        getByReference,
        resume: async () => create(ScheduleSchema, { metadata: { id: "sch_1", slug: "nightly" } }),
      },
    } as unknown as Stigmer;
    return { stigmer, getByReference };
  }

  it("resolves on a server that holds one organization, which fills it", async () => {
    const { stigmer, getByReference } = serverHolding(true);
    await resumeSchedule(stigmer, "nightly", "");
    expect(getByReference).toHaveBeenCalledWith({ org: "", slug: "nightly" });
  });

  it("is refused on a server that holds several, naming the ways to set one", async () => {
    const { stigmer, getByReference } = serverHolding(false);
    const refusal = resumeSchedule(stigmer, "nightly", "");
    await expect(refusal).rejects.toBeInstanceOf(UsageError);
    await expect(refusal).rejects.toThrow(/stigmer schedule resume --org <org>/);
    expect(getByReference).not.toHaveBeenCalled();
  });
});
