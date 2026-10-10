/**
 * Pins the derived `organization#agent_creation_open` edge
 * (../organization-policies.ts): an organization's edge to itself while its
 * policy lets members create agents, which open source reads from the row at
 * check time. A row with no policies reads as the default (open); a row
 * that closes the policy, and a row of any other kind, derive nothing.
 */
import { create } from "@bufbuild/protobuf";
import { describe, expect, it } from "vitest";

import { AgentSchema } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/api_pb";
import { OrganizationSchema } from "@stigmer/protos/ai/stigmer/tenancy/organization/v1/api_pb";

import { agentCreationOpen } from "../organization-policies.js";
import type { DerivedRelation } from "../rewrite.js";

const OBJECT = { type: "organization", id: "org_01jacme" };
const NO_LOADER = {} as Parameters<DerivedRelation>[2];

function organization(open: boolean | undefined) {
  return create(OrganizationSchema, {
    metadata: { id: OBJECT.id },
    spec: open === undefined ? {} : { policies: { membersCanCreateAgents: open } },
  });
}

describe("agent_creation_open", () => {
  it("is the organization's edge to itself while members may create agents", async () => {
    const edge = {
      object: OBJECT,
      relation: "agent_creation_open",
      subject: { form: "object", object: { type: "organization", id: OBJECT.id } },
    };
    expect(await agentCreationOpen(OBJECT, organization(true), NO_LOADER)).toEqual([edge]);
    // A row stored with no policies reads as the default: open.
    expect(await agentCreationOpen(OBJECT, organization(undefined), NO_LOADER)).toEqual([edge]);
  });

  it("derives nothing while the policy is off", async () => {
    expect(await agentCreationOpen(OBJECT, organization(false), NO_LOADER)).toEqual([]);
  });

  it("derives nothing from a row of another kind", async () => {
    expect(await agentCreationOpen(OBJECT, create(AgentSchema), NO_LOADER)).toEqual([]);
  });
});
