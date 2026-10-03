// Pins what the resource layer prints and asks on a server that holds one
// organization: the field view leaves the Org line out (machine output keeps
// it), an empty version history names no organization, and a schedule named by
// bare slug with no organization resolves on such a server and is refused,
// naming the ways to set one, on a server that holds several.

import { create } from "@bufbuild/protobuf";
import { describe, expect, it, vi } from "vitest";
import { AgentSchema } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/api_pb";
import { ScheduleSchema } from "@stigmer/protos/ai/stigmer/agentic/schedule/v1/api_pb";
import type { Stigmer } from "@stigmer/sdk";
import { UsageError } from "../../errors/usage-error.js";
import { renderResource } from "../render.js";
import { resumeSchedule } from "../schedule.js";
import { renderWorkflowVersionHistory } from "../version.js";

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

describe("renderWorkflowVersionHistory with no versions", () => {
  const empty = {
    workflow: { listVersions: async () => ({ versions: [], totalCount: 0 }) },
  } as unknown as Stigmer;

  it("names org/slug when an organization was named", async () => {
    expect(await renderWorkflowVersionHistory(empty, "acme", "deploy")).toContain(
      "No version history found for acme/deploy",
    );
  });

  it("names the slug alone when none was (a server that holds one)", async () => {
    expect(await renderWorkflowVersionHistory(empty, "", "deploy")).toContain(
      "No version history found for deploy\n",
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
