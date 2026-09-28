/**
 * Pins the driver-neutral half of the organization-slug ledger's data
 * migration (organization-slug-history.ts): the frozen kind table is
 * exactly the kinds `api_resource_kind.proto` scoped to an organization
 * when the ledger arrived, spelled out here as the step's statement about
 * the store as it was, each with a schema whose rows carry the shared
 * metadata; a row's
 * organization is read from its bytes, a row with no metadata or an empty
 * organization names none, and bytes that do not decode are a thrown
 * fault, never a skipped row. The drivers' replay tests pin the SQL around
 * these functions.
 */
import { create, toBinary } from "@bufbuild/protobuf";
import { describe, expect, it } from "vitest";

import { AgentSchema } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/api_pb";

import {
  ORGANIZATION_SCOPED_KINDS_AT_LEDGER,
  organizationNamedBy,
  undecodableRowError,
} from "../organization-slug-history.js";

const AGENT = ORGANIZATION_SCOPED_KINDS_AT_LEDGER.find(
  (entry) => entry.kind === "agent",
)!;

describe("the frozen kind table", () => {
  it("is exactly the kinds api_resource_kind.proto scoped to an organization when the ledger arrived, in its order", () => {
    expect(
      ORGANIZATION_SCOPED_KINDS_AT_LEDGER.map((entry) => entry.kind),
    ).toEqual([
      "iam_policy",
      "invitation",
      "identity_provider",
      "oauth_app",
      "platform_client",
      "team",
      "agent",
      "session",
      "skill",
      "mcp_server",
      "agent_instance",
      "agent_share",
      "agent_channel",
      "channel_app",
      "workflow",
      "workflow_instance",
      "workflow_execution",
      "environment",
      "artifact",
      "schedule",
      "memory",
      "plugin",
      "subscription",
    ]);
  });

  it("gives every kind a schema whose rows carry the metadata every resource shares", () => {
    for (const entry of ORGANIZATION_SCOPED_KINDS_AT_LEDGER) {
      const metadata = entry.schema.fields.find(
        (field) => field.name === "metadata",
      );
      expect(metadata?.fieldKind, entry.kind).toBe("message");
    }
  });
});

describe("organizationNamedBy", () => {
  it("reads the organization a row names", () => {
    const bytes = toBinary(
      AgentSchema,
      create(AgentSchema, {
        metadata: { id: "agt_1", slug: "helper", org: "acme" },
        spec: { instructions: "a conformant instruction body" },
      }),
    );
    expect(organizationNamedBy(AGENT, bytes)).toBe("acme");
  });

  it("names no organization for a row with no metadata or an empty org", () => {
    expect(
      organizationNamedBy(AGENT, toBinary(AgentSchema, create(AgentSchema))),
    ).toBe("");
    expect(
      organizationNamedBy(
        AGENT,
        toBinary(
          AgentSchema,
          create(AgentSchema, { metadata: { id: "agt_2", org: "" } }),
        ),
      ),
    ).toBe("");
  });

  it("throws on bytes that do not decode, and the driver's error names the row", () => {
    const broken = new Uint8Array([0xff, 0xff, 0xff]);
    expect(() => organizationNamedBy(AGENT, broken)).toThrow();
    let caught: unknown;
    try {
      organizationNamedBy(AGENT, broken);
    } catch (error) {
      caught = error;
    }
    expect(undecodableRowError(AGENT, "agt_broken", caught).message).toMatch(
      /^agent 'agt_broken' cannot be read for the organization it names: /,
    );
  });
});
