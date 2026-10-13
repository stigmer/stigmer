/**
 * Pins etag.ts: a resource's etag fingerprints what a person edits (spec,
 * name, labels, tags, annotations) and nothing the platform writes.
 *
 *   - the same content gives the same etag, whatever a map's insertion
 *     order;
 *   - each edited field moves it;
 *   - status, slug, id, org, visibility and the audit stamps never move it;
 *   - stampEtag writes it onto the resource's metadata, and storedEtagOf
 *     reads it back;
 *   - a message with no resource metadata has none and is left as it is.
 */
import { create } from "@bufbuild/protobuf";
import { describe, expect, it } from "vitest";

import { AgentSchema } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/api_pb";
import { RunSchema } from "@stigmer/protos/ai/stigmer/agentic/run/v1/api_pb";
import { ApiKeySchema } from "@stigmer/protos/ai/stigmer/iam/apikey/v1/api_pb";
import type { Agent } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/api_pb";
import { AgentSpecSchema } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/spec_pb";
import { AgentStatusSchema } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/status_pb";
import { ApiResourceVisibility } from "@stigmer/protos/ai/stigmer/commons/apiresource/enum_pb";

import { etagOf, stampEtag, storedEtagOf } from "../etag.js";

function agent(): Agent {
  return create(AgentSchema, {
    metadata: {
      id: "agt_1",
      org: "org_1",
      slug: "reviewer",
      name: "Reviewer",
      labels: { team: "core", tier: "gold" },
      tags: ["prod"],
      annotations: { note: "kept" },
    },
    spec: { instructions: "Review every pull request.", env: { A: { description: "first" }, B: { isSecret: true } } },
    status: {},
  });
}

describe("etagOf", () => {
  it("gives the same etag for the same content, whatever a map's insertion order", () => {
    const reordered = agent();
    reordered.metadata!.labels = { tier: "gold", team: "core" };
    expect(etagOf(AgentSchema, reordered)).toBe(etagOf(AgentSchema, agent()));
    expect(etagOf(AgentSchema, agent())).toMatch(/^[0-9a-f]{64}$/);
  });

  it("moves when spec, name, labels, tags or annotations change", () => {
    const base = etagOf(AgentSchema, agent());
    const edits: Array<(edited: Agent) => void> = [
      (edited) => {
        edited.spec!.instructions = "Review only drafts.";
      },
      (edited) => {
        edited.metadata!.name = "Senior reviewer";
      },
      (edited) => {
        edited.metadata!.labels.team = "infra";
      },
      (edited) => {
        edited.metadata!.tags.push("beta");
      },
      (edited) => {
        edited.metadata!.annotations.note = "changed";
      },
      (edited) => {
        edited.spec = undefined;
      },
    ];
    for (const edit of edits) {
      const edited = agent();
      edit(edited);
      expect(etagOf(AgentSchema, edited)).not.toBe(base);
    }
  });

  it("never moves for what the platform writes", () => {
    const base = etagOf(AgentSchema, agent());
    const writes: Array<(written: Agent) => void> = [
      (written) => {
        written.status = create(AgentStatusSchema, { versionHash: "a1b2" });
      },
      (written) => {
        written.metadata!.slug = "renamed";
      },
      (written) => {
        written.metadata!.id = "agt_2";
      },
      (written) => {
        written.metadata!.org = "org_2";
      },
      (written) => {
        written.metadata!.visibility = ApiResourceVisibility.visibility_public;
      },
      (written) => {
        written.metadata!.etag = "anything";
      },
    ];
    for (const write of writes) {
      const written = agent();
      write(written);
      expect(etagOf(AgentSchema, written)).toBe(base);
    }
  });

  it("answers none for a message with no resource metadata", () => {
    expect(etagOf(AgentSpecSchema, create(AgentSpecSchema, { instructions: "x" }))).toBeUndefined();
    expect(etagOf(AgentSchema, create(AgentSchema, { spec: { instructions: "x" } }))).toBeUndefined();
  });
});

describe("stampEtag and storedEtagOf", () => {
  it("stamps the etag onto the metadata, and reads it back", () => {
    const stamped = agent();
    expect(storedEtagOf(AgentSchema, stamped)).toBe("");
    stampEtag(AgentSchema, stamped);
    expect(stamped.metadata!.etag).toBe(etagOf(AgentSchema, agent()));
    expect(storedEtagOf(AgentSchema, stamped)).toBe(stamped.metadata!.etag);
  });

  it("leaves a message with no resource metadata as it is", () => {
    const bare = create(AgentSchema, { spec: { instructions: "x" } });
    stampEtag(AgentSchema, bare);
    expect(bare.metadata).toBeUndefined();
    expect(storedEtagOf(AgentSchema, bare)).toBeUndefined();
  });
});

describe("etagOf on a spec JSON cannot carry", () => {
  it("fingerprints a timestamp past year 9999 and a NaN in a struct value by their bytes, never throwing", () => {
    const key = create(ApiKeySchema, {
      metadata: { id: "key_1", org: "org_1", name: "far future" },
      spec: { expiresAt: { seconds: 999_999_999_999n } },
    });
    const keyEtag = etagOf(ApiKeySchema, key);
    expect(keyEtag).toMatch(/^[0-9a-f]{64}$/);
    key.spec!.expiresAt!.seconds = 999_999_999_998n;
    expect(etagOf(ApiKeySchema, key), "a change still moves it").not.toBe(keyEtag);

    const run = create(RunSchema, {
      metadata: { id: "run_1", org: "org_1", name: "nan" },
      spec: {
        structuredOutputSchema: { fields: { score: { kind: { case: "numberValue", value: Number.NaN } } } },
      },
    });
    expect(etagOf(RunSchema, run)).toMatch(/^[0-9a-f]{64}$/);
    stampEtag(RunSchema, run);
    expect(run.metadata?.etag).toBe(etagOf(RunSchema, run));
  });
});
