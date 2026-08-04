import { describe, it, expect } from "vitest";
import { clone, create, equals } from "@bufbuild/protobuf";
import { AgentSchema, type Agent } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/api_pb";
import { EnvironmentSchema, type Environment } from "@stigmer/protos/ai/stigmer/agentic/environment/v1/api_pb";
import { ScheduleSchema, type Schedule } from "@stigmer/protos/ai/stigmer/agentic/schedule/v1/api_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { ApiResourceMetadataSchema } from "@stigmer/protos/ai/stigmer/commons/apiresource/metadata_pb";
import { parse as parseYaml } from "yaml";
import { parseManifest } from "../manifest/parse";
import { serializeManifest } from "../manifest/serialize";
import { manifestDocumentForResource } from "../manifest/document";
import { manifestKinds, manifestHandlerForYamlKind } from "../manifest/registry";

/**
 * Manifest engine contract tests.
 *
 * The engine's core promise is *round-trip fidelity against the generated
 * proto schemas*: any resource the server returns serializes to YAML that
 * parses back to the same proto (minus system-managed state), and any
 * repo-authored manifest (snake_case fields, `apiVersion` spelling) parses
 * to a proto the `apply` RPC accepts. Fixtures mirror the real manifests
 * in the whatsapp-doctor-assistant dogfooding repo.
 */

// ---------------------------------------------------------------------------
// Fixtures — shaped like the whatsapp-doctor-assistant repo manifests
// ---------------------------------------------------------------------------

const AGENT_YAML = `
apiVersion: agentic.stigmer.ai/v1
kind: Agent
metadata:
  name: clinic-patient-assistant
  org: rakeshreddi098
spec:
  description: Patient-facing WhatsApp assistant for the clinic.
  instructions: |
    You are the appointment assistant for the clinic.
    Short messages. One question at a time.
`;

const ENVIRONMENT_YAML = `
apiVersion: agentic.stigmer.ai/v1
kind: Environment
metadata:
  name: clinic-patient-db
  org: rakeshreddi098
spec:
  description: "Clinic records access for the patient assistant"
  data:
    POSTGRES_CONNECTION_URL:
      value: "postgresql://patient_role:secret@host:5432/postgres"
      is_secret: true
      description: "Supabase Postgres connection URL for patient_role"
`;

const AGENT_CHANNEL_YAML = `
apiVersion: agentic.stigmer.ai/v1
kind: AgentChannel
metadata:
  name: clinic-patient-whatsapp
  org: rakeshreddi098
spec:
  agent_ref:
    kind: agent
    org: rakeshreddi098
    slug: clinic-patient-assistant
  enabled: true
  whatsapp:
    phone_number_id: "1234567890"
  app_ref:
    kind: channel_app
    org: rakeshreddi098
    slug: hosipital
  environment_refs:
    - kind: environment
      org: rakeshreddi098
      slug: clinic-patient-db
`;

// ---------------------------------------------------------------------------
// parseManifest
// ---------------------------------------------------------------------------

describe("parseManifest", () => {
  it("parses a snake_case Agent manifest into a full Agent proto", () => {
    const docs = parseManifest(AGENT_YAML);
    expect(docs).toHaveLength(1);

    const doc = docs[0];
    expect(doc.handler.yamlKind).toBe("Agent");
    expect(doc.name).toBe("clinic-patient-assistant");
    expect(doc.org).toBe("rakeshreddi098");

    const agent = doc.message as Agent;
    expect(agent.spec?.description).toBe(
      "Patient-facing WhatsApp assistant for the clinic.",
    );
    expect(agent.spec?.instructions).toContain("appointment assistant");
  });

  it("parses an AgentChannel manifest with enum-valued resource refs", () => {
    const docs = parseManifest(AGENT_CHANNEL_YAML);
    expect(docs).toHaveLength(1);
    expect(docs[0].handler.yamlKind).toBe("AgentChannel");
    expect(docs[0].slug).toBe("clinic-patient-whatsapp");
  });

  it("sorts multi-document manifests into dependency apply order", () => {
    // Authored channel-first; the Environment must still apply first.
    const docs = parseManifest(`${AGENT_CHANNEL_YAML}\n---\n${ENVIRONMENT_YAML}`);
    expect(docs.map((d) => d.handler.yamlKind)).toEqual([
      "Environment",
      "AgentChannel",
    ]);
  });

  it("injects the target org when the document omits it", () => {
    const yaml = AGENT_YAML.replace("  org: rakeshreddi098\n", "");
    const docs = parseManifest(yaml, { org: "acme" });
    expect(docs[0].org).toBe("acme");
    expect(docs[0].warning).toBeUndefined();
  });

  it("honors the document org and warns when it differs from the target", () => {
    const docs = parseManifest(AGENT_YAML, { org: "acme" });
    expect(docs[0].org).toBe("rakeshreddi098");
    expect(docs[0].warning).toContain('"rakeshreddi098"');
    expect(docs[0].warning).toContain('"acme"');
  });

  it("rejects unknown fields loudly (strict schema contract)", () => {
    const yaml = AGENT_YAML.replace("spec:", "spec:\n  instrctions: typo");
    expect(() => parseManifest(yaml)).toThrow(/Invalid Agent/);
  });

  it("rejects a document without a kind", () => {
    expect(() => parseManifest("metadata:\n  name: x\n")).toThrow(/'kind'/);
  });

  it("rejects unsupported kinds with the supported list", () => {
    expect(() => parseManifest("kind: Skill\nmetadata:\n  name: x\n")).toThrow(
      /Unsupported resource kind "Skill".*Agent/s,
    );
  });

  it("rejects empty input with actionable guidance", () => {
    expect(() => parseManifest("   \n")).toThrow(/empty/i);
  });

  it("rejects malformed YAML", () => {
    expect(() => parseManifest("kind: Agent\n  bad indent: [")).toThrow(
      /Invalid YAML/,
    );
  });
});

// ---------------------------------------------------------------------------
// serializeManifest
// ---------------------------------------------------------------------------

describe("serializeManifest", () => {
  const agent = create(AgentSchema, {
    apiVersion: "agentic.stigmer.ai/v1",
    kind: "Agent",
    metadata: {
      id: "agt_01example",
      name: "clinic-patient-assistant",
      slug: "clinic-patient-assistant",
      org: "rakeshreddi098",
      version: { id: "ver_01", message: "server-managed" },
    },
    spec: {
      description: "Patient-facing WhatsApp assistant.",
      instructions: "Short messages.\nOne question at a time.\n",
    },
    status: { defaultInstanceId: "agi_01example" },
  });

  it("emits the canonical envelope: apiVersion spelling, no status", () => {
    const yaml = serializeManifest(agent);
    const doc = parseYaml(yaml) as Record<string, unknown>;

    expect(Object.keys(doc)[0]).toBe("apiVersion");
    expect(doc.apiVersion).toBe("agentic.stigmer.ai/v1");
    expect(doc.kind).toBe("Agent");
    expect(doc.status).toBeUndefined();
    expect(yaml).not.toContain("api_version:");
  });

  it("keeps metadata.id but strips server-managed metadata.version", () => {
    const doc = parseYaml(serializeManifest(agent)) as {
      metadata: Record<string, unknown>;
    };
    expect(doc.metadata.id).toBe("agt_01example");
    expect(doc.metadata.version).toBeUndefined();
  });

  it("fills apiVersion and kind from the registry when the proto omits them", () => {
    const bare = create(AgentSchema, {
      metadata: { name: "x", org: "acme" },
    });
    const doc = parseYaml(serializeManifest(bare)) as Record<string, unknown>;
    expect(doc.apiVersion).toBe("agentic.stigmer.ai/v1");
    expect(doc.kind).toBe("Agent");
  });

  it("round-trips through parseManifest to an equal proto", () => {
    const docs = parseManifest(serializeManifest(agent));
    expect(docs).toHaveLength(1);

    // The round-tripped proto matches the original minus system-managed
    // state (status, metadata.version) — exactly what apply consumes.
    const expected = create(AgentSchema, {
      ...agent,
      status: undefined,
      metadata: { ...agent.metadata!, version: undefined },
    });
    expect(equals(AgentSchema, docs[0].message as Agent, expected)).toBe(true);
  });

  it("round-trips Environment secret values byte-identically", () => {
    const env = create(EnvironmentSchema, {
      metadata: { name: "clinic-patient-db", org: "rakeshreddi098" },
      spec: {
        data: {
          POSTGRES_CONNECTION_URL: {
            value: "***REDACTED***",
            isSecret: true,
            description: "Supabase Postgres connection URL",
          },
        },
      },
    });

    const docs = parseManifest(serializeManifest(env));
    const roundTripped = docs[0].message as Environment;
    expect(roundTripped.spec?.data.POSTGRES_CONNECTION_URL?.value).toBe(
      "***REDACTED***",
    );
    expect(roundTripped.spec?.data.POSTGRES_CONNECTION_URL?.isSecret).toBe(true);
  });

  it("rejects messages of kinds outside the registry", () => {
    // ApiResourceMetadata is a real proto message but not a manifest kind.
    const notAResource = create(ApiResourceMetadataSchema, { name: "x" });
    expect(() => serializeManifest(notAResource)).toThrow(/not.*registry/i);
  });
});

// ---------------------------------------------------------------------------
// manifestDocumentForResource
// ---------------------------------------------------------------------------

describe("manifestDocumentForResource", () => {
  // Shaped like a server-returned schedule: full metadata (including
  // fields the curated ScheduleInput cannot express, like tags) and a
  // populated status — the exact input of a lossless partial edit.
  const schedule = create(ScheduleSchema, {
    apiVersion: "agentic.stigmer.ai/v1",
    kind: "Schedule",
    metadata: {
      id: "sch_01example",
      name: "daily-fee-reminders",
      slug: "daily-fee-reminders",
      org: "isc",
      tags: ["billing"],
      labels: { team: "ops" },
    },
    spec: {
      cron: "0 9 * * *",
      timeZone: "Asia/Kolkata",
      enabled: true,
      target: {
        case: "agent",
        value: {
          agentRef: { kind: ApiResourceKind.agent, org: "isc", slug: "fee-reminder" },
          message: "Send today's fee reminders.",
        },
      },
    },
    status: { consecutiveFailures: 2, pausedReason: "" },
  });

  it("wraps a fetched proto untouched — the lossless edit contract", () => {
    const flipped = clone(ScheduleSchema, schedule);
    flipped.spec!.enabled = false;

    const doc = manifestDocumentForResource(flipped);

    expect(doc.handler.yamlKind).toBe("Schedule");
    expect(doc.name).toBe("daily-fee-reminders");
    expect(doc.slug).toBe("daily-fee-reminders");
    expect(doc.org).toBe("isc");
    // Identity, not a copy: nothing is re-serialized or down-converted,
    // so every field survives (the ScheduleInput path would drop tags).
    expect(doc.message).toBe(flipped);

    const expected = clone(ScheduleSchema, schedule);
    expected.spec!.enabled = false;
    expect(equals(ScheduleSchema, doc.message as Schedule, expected)).toBe(true);
  });

  it("falls back to name when the proto has no slug", () => {
    const bare = create(AgentSchema, { metadata: { name: "x", org: "acme" } });
    const doc = manifestDocumentForResource(bare);
    expect(doc.slug).toBe("x");
  });

  it("rejects messages of kinds outside the registry", () => {
    const notAResource = create(ApiResourceMetadataSchema, { name: "x" });
    expect(() => manifestDocumentForResource(notAResource)).toThrow(
      /not.*registry/i,
    );
  });

  it("rejects a resource without metadata.name", () => {
    const nameless = create(ScheduleSchema, { metadata: { org: "acme" } });
    expect(() => manifestDocumentForResource(nameless)).toThrow(
      /metadata\.name/,
    );
  });
});

// ---------------------------------------------------------------------------
// Registry invariants
// ---------------------------------------------------------------------------

describe("manifest registry", () => {
  it("every handler resolves by its own YAML kind", () => {
    for (const handler of manifestKinds()) {
      expect(manifestHandlerForYamlKind(handler.yamlKind)).toBe(handler);
    }
  });

  it("apply order is strictly increasing (no accidental ties)", () => {
    const orders = manifestKinds().map((h) => h.applyOrder);
    for (let i = 1; i < orders.length; i++) {
      expect(orders[i]).toBeGreaterThan(orders[i - 1]);
    }
  });

  it("covers the kinds the console flows depend on", () => {
    for (const kind of ["Agent", "McpServer", "Workflow", "Environment", "AgentChannel", "ChannelApp"]) {
      expect(manifestHandlerForYamlKind(kind), `missing handler for ${kind}`).toBeDefined();
    }
  });
});
