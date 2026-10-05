/**
 * Pins the workflow family against Go's pkg/domain/workflow tests —
 * through the REAL stack: a composed server on an ephemeral port, a native
 * gRPC client and the full interceptor chain.
 *
 * The load-bearing pins conformance cannot reach (it sees only the wire):
 *   - the #341 content-addressed AUDIT ROW semantics: an idempotent apply
 *     inserts no row; a changed apply inserts exactly one; a rollback
 *     re-apply REPOINTS the head without a new row;
 *   - the version hash chain (previous_version_id) across applies, and the
 *     version rule: the hash is the spec's own (run visibility cleared),
 *     so an edit to the declared env or the description mints a version
 *     the generated YAML never showed, and a head last saved under the
 *     YAML hash mints exactly one version at its next unchanged save;
 *   - tag single-holder at the audit column + live-head tag reconcile on
 *     every tagVersion arm (tag head, move off head, tag archived);
 *   - audit rows SURVIVE workflow delete (execution viewers need them,
 *     oss#582);
 *   - run visibility: stored at create, kept by update and apply, changed
 *     by updateExecutionVisibility alone, and never a version;
 *   - an agent_call that names its organization by slug saves through the
 *     create and update chains, stored by the organization's id.
 */
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { create } from "@bufbuild/protobuf";
import { Code, ConnectError, createClient } from "@connectrpc/connect";
import type { Client, Transport } from "@connectrpc/connect";
import { createGrpcTransport } from "@connectrpc/connect-node";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { WorkflowSchema } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/api_pb";
import { WorkflowCommandController } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/command_pb";
import { WorkflowQueryController } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/query_pb";
import { ValidationState } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/serverless/validation_pb";
import { WorkflowExecutionVisibility } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/enum_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { ApiResourceVisibility } from "@stigmer/protos/ai/stigmer/commons/apiresource/enum_pb";
import { AgentSchema } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/api_pb";
import { EnvironmentSchema } from "@stigmer/protos/ai/stigmer/agentic/environment/v1/api_pb";
import { WorkflowTaskKind } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/enum_pb";
import { WorkflowTaskSchema } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/spec_pb";

import { loadConfig } from "../../../boot/config.js";
import { composeServer } from "../../../boot/compose.js";
import type { ComposedServer } from "../../../boot/compose.js";
import { createLogger } from "../../../boot/logger.js";
import { workflowVersionHash } from "../steps.js";
import {
  organizationId,
  seedOrganizations,
} from "../../organization/__tests__/support.js";

const silentLogger = createLogger({ level: "error", pretty: false, write: () => {} });

const API_VERSION = "agentic.stigmer.ai/v1";
const ORG = "acme";
const OTHER_ORG = "other-org";
// The ids the server minted for ORG and OTHER_ORG: the cross-org refusal
// names each organization by the id its rows store.
let ORG_ID: string;
let OTHER_ORG_ID: string;

let dir: string;
let server: ComposedServer;
let transport: Transport;
let command: Client<typeof WorkflowCommandController>;
let query: Client<typeof WorkflowQueryController>;

beforeAll(async () => {
  dir = mkdtempSync(path.join(tmpdir(), "workflow-domain-test-"));
  server = await composeServer({
    config: loadConfig({
      STIGMER_MODEL_REGISTRY_REFRESH: "off",
      // No engine behind composed tests: 127.0.0.1:1 is deterministically
      // closed, so boots fail the non-fatal connect fast and can never touch
      // a live local Temporal (the conformance CRUD harness does the same).
      TEMPORAL_HOST_PORT: "127.0.0.1:1",
      DB_PATH: path.join(dir, "stigmer.db"),
      // The skill artifact store + staging wipe must stay inside the
      // test dir — the default resolves to ~/.stigmer/storage.
      STORAGE_PATH: path.join(dir, "storage"),
      // Keep the artifact store inside the test dir — the default
      // resolves to ~/.stigmer, which tests must never touch.
      ARTIFACT_LOCAL_BASE_PATH: path.join(dir, "artifacts"),
    }),
    logger: silentLogger,
    portOverride: 0,
    host: "127.0.0.1",
  });
  const port = await server.start();
  transport = createGrpcTransport({ baseUrl: `http://127.0.0.1:${port}` });
  const ids = await seedOrganizations(transport, [ORG, OTHER_ORG]);
  ORG_ID = organizationId(ids, ORG);
  OTHER_ORG_ID = organizationId(ids, OTHER_ORG);
  command = createClient(WorkflowCommandController, transport);
  query = createClient(WorkflowQueryController, transport);
});

afterAll(async () => {
  await server.shutdown();
  rmSync(dir, { recursive: true, force: true });
});

let counter = 0;
function workflowInput(overrides?: {
  name?: string;
  org?: string;
  variables?: Record<string, string>;
  tag?: string;
  description?: string;
  env?: Record<string, { isSecret?: boolean; optional?: boolean }>;
  executionVisibility?: WorkflowExecutionVisibility;
}) {
  counter += 1;
  const name = overrides?.name ?? `Test Workflow ${counter}`;
  // The document name derives from the WORKFLOW name so a re-apply of the
  // same logical workflow renders an identical document (the hash input) —
  // idempotency assertions depend on it.
  const docName = name.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  return create(WorkflowSchema, {
    apiVersion: API_VERSION,
    kind: "Workflow",
    metadata: {
      name,
      org: overrides?.org ?? ORG,
      ...(overrides?.tag !== undefined
        ? { version: { tag: overrides.tag } }
        : {}),
    },
    spec: {
      description: overrides?.description ?? "",
      env: overrides?.env ?? {},
      executionVisibility:
        overrides?.executionVisibility ??
        WorkflowExecutionVisibility.unspecified,
      document: {
        dsl: "1.0.0",
        namespace: "tests",
        name: docName,
        version: "0.1.0",
      },
      tasks: [
        {
          name: "seed",
          kind: 1, // set_vars
          taskConfig: { variables: overrides?.variables ?? { greeting: "hello" } },
        },
      ],
    },
  });
}

async function auditCount(workflowId: string): Promise<number> {
  return server.store.countAuditEntries(ApiResourceKind.workflow, workflowId);
}

describe("workflow version machinery (the #341 audit-row semantics)", () => {
  it("create archives exactly one version, hashed over its spec", async () => {
    const created = await command.create(workflowInput());
    const id = created.metadata!.id;

    expect(created.status?.versionHash).toMatch(/^[a-f0-9]{64}$/);
    expect(created.metadata?.version?.id).toBe(created.status?.versionHash);
    expect(created.metadata?.version?.previousVersionId).toBe("");
    expect(await auditCount(id)).toBe(1);

    expect(created.status?.versionHash).toBe(
      workflowVersionHash(created.spec!),
    );
    const v1 = await query.getVersion({
      workflowId: id,
      versionHash: created.status!.versionHash,
    });
    expect(v1.isCurrent).toBe(true);
    expect(v1.validatedYaml).not.toBe("");
  });

  it("an idempotent apply registers NO version; a changed apply chains one", async () => {
    const name = `Idem ${++counter}`;
    const v1 = await command.apply(workflowInput({ name, variables: { a: "1" } }));
    const id = v1.metadata!.id;
    expect(await auditCount(id)).toBe(1);

    const unchanged = await command.apply(workflowInput({ name, variables: { a: "1" } }));
    expect(unchanged.status?.versionHash).toBe(v1.status?.versionHash);
    expect(await auditCount(id)).toBe(1);

    const v2 = await command.apply(workflowInput({ name, variables: { a: "2" } }));
    expect(v2.status?.versionHash).not.toBe(v1.status?.versionHash);
    // The hash chain: v2's previous is v1's hash.
    expect(v2.metadata?.version?.id).toBe(v2.status?.versionHash);
    expect(v2.metadata?.version?.previousVersionId).toBe(v1.status?.versionHash);
    expect(await auditCount(id)).toBe(2);
  });

  it("an edit the generated YAML never shows — the declared env, the description — mints a version", async () => {
    const name = `Unrendered ${++counter}`;
    const v1 = await command.apply(workflowInput({ name }));
    const id = v1.metadata!.id;

    const withEnv = await command.apply(
      workflowInput({ name, env: { SLACK_WEBHOOK: { isSecret: true } } }),
    );
    expect(withEnv.status?.serverlessWorkflowValidation?.yaml).toBe(
      v1.status?.serverlessWorkflowValidation?.yaml,
    );
    expect(withEnv.status?.versionHash).not.toBe(v1.status?.versionHash);
    expect(await auditCount(id)).toBe(2);

    const described = await command.apply(
      workflowInput({
        name,
        env: { SLACK_WEBHOOK: { isSecret: true } },
        description: "posts the nightly triage",
      }),
    );
    expect(described.status?.versionHash).not.toBe(
      withEnv.status?.versionHash,
    );
    expect(await auditCount(id)).toBe(3);
  });

  it("a head last saved under the YAML hash mints exactly one version at its next unchanged save", async () => {
    const name = `Legacy Hash ${++counter}`;
    const v1 = await command.apply(workflowInput({ name }));
    const id = v1.metadata!.id;

    // The head as a save before the spec hash left it: its hash is the
    // SHA-256 of its generated YAML.
    const yaml = v1.status!.serverlessWorkflowValidation!.yaml;
    const yamlHash = createHash("sha256").update(yaml).digest("hex");
    const legacy = await server.store.getResource(
      ApiResourceKind.workflow,
      id,
      WorkflowSchema,
    );
    legacy.status!.versionHash = yamlHash;
    await server.store.saveResource(
      ApiResourceKind.workflow,
      id,
      WorkflowSchema,
      legacy,
    );

    const resaved = await command.apply(workflowInput({ name }));
    expect(resaved.status?.versionHash).toBe(workflowVersionHash(resaved.spec!));
    expect(resaved.status?.versionHash).not.toBe(yamlHash);
    expect(resaved.metadata?.version?.previousVersionId).toBe(yamlHash);

    const again = await command.apply(workflowInput({ name }));
    expect(again.status?.versionHash).toBe(resaved.status?.versionHash);
  });

  it("a rollback re-apply REPOINTS the head without inserting a row", async () => {
    const name = `Rollback ${++counter}`;
    const v1 = await command.apply(workflowInput({ name, variables: { a: "1" } }));
    const id = v1.metadata!.id;
    await command.apply(workflowInput({ name, variables: { a: "2" } }));
    expect(await auditCount(id)).toBe(2);

    // Re-applying v1's spec reproduces v1's hash (canonical rendering) —
    // the content is already archived, so the head repoints, no new row.
    const rolledBack = await command.apply(workflowInput({ name, variables: { a: "1" } }));
    expect(rolledBack.status?.versionHash).toBe(v1.status?.versionHash);
    expect(await auditCount(id)).toBe(2);

    // listVersions marks the OLDER row current — recency and currency
    // legitimately diverge under repoint semantics.
    const history = await query.listVersions({ org: ORG, slug: v1.metadata!.slug });
    expect(history.totalCount).toBe(2);
    const current = history.versions.filter((entry) => entry.isCurrent);
    expect(current).toHaveLength(1);
    expect(current[0]!.versionHash).toBe(v1.status?.versionHash);
  });

  it("an unchanged re-apply keeps the version metadata and moves a newly named tag; head and history agree", async () => {
    const name = `Retag ${++counter}`;
    const v1 = await command.apply(workflowInput({ name, variables: { a: "1" } }));
    const id = v1.metadata!.id;
    const v1Hash = v1.status!.versionHash;

    // Unchanged content naming a tag: no new row, the stored chain kept,
    // the tag assigned to the head's version in the audit column.
    const retagged = await command.apply(
      workflowInput({ name, variables: { a: "1" }, tag: "stable" }),
    );
    expect(await auditCount(id)).toBe(1);
    expect(retagged.status?.versionHash).toBe(v1Hash);
    expect(retagged.metadata?.version?.id).toBe(v1Hash);
    expect(retagged.metadata?.version?.previousVersionId).toBe("");
    expect(retagged.metadata?.version?.tag).toBe("stable");
    const history = await query.listVersions({ org: ORG, slug: v1.metadata!.slug });
    expect(history.versions.map((entry) => entry.tag)).toEqual(["stable"]);

    // An unchanged re-apply naming no tag keeps the stored one.
    const kept = await command.apply(workflowInput({ name, variables: { a: "1" } }));
    expect(kept.metadata?.version?.tag).toBe("stable");
    expect(kept.metadata?.version?.id).toBe(v1Hash);
  });

  it("a repoint naming no tag shows the tag the version holds, and head and history agree", async () => {
    const name = `Repoint ${++counter}`;
    const a = await command.apply(workflowInput({ name, variables: { a: "1" }, tag: "stable" }));
    await command.apply(workflowInput({ name, variables: { a: "2" } }));

    const back = await command.apply(workflowInput({ name, variables: { a: "1" } }));

    expect(back.status?.versionHash).toBe(a.status?.versionHash);
    expect(back.metadata?.version?.tag).toBe("stable");
    const head = await query.getByReference({ org: ORG, slug: a.metadata!.slug });
    expect(head.metadata?.version?.tag).toBe("stable");
    const history = await query.listVersions({ org: ORG, slug: a.metadata!.slug });
    expect(
      history.versions.filter((entry) => entry.tag === "stable").map((entry) => entry.versionHash),
    ).toEqual([a.status?.versionHash]);
  });

  it("a fetched archived version reports the tag it holds now, not the one it was applied with", async () => {
    const name = `Moved ${++counter}`;
    const v1 = await command.apply(
      workflowInput({ name, variables: { a: "1" }, tag: "stable" }),
    );
    const slug = v1.metadata!.slug;
    const v1Hash = v1.status!.versionHash;
    const v2 = await command.apply(
      workflowInput({ name, variables: { a: "2" }, tag: "stable" }),
    );
    expect(v2.metadata?.version?.tag).toBe("stable");

    const archived = await query.getByReference({ org: ORG, slug, version: v1Hash });
    expect(archived.status?.versionHash).toBe(v1Hash);
    expect(archived.metadata?.version?.tag).toBe("");
    const byTag = await query.getByReference({ org: ORG, slug, version: "stable" });
    expect(byTag.status?.versionHash).toBe(v2.status?.versionHash);
  });

  it("permuted task-config key order is version-identical end-to-end", async () => {
    const name = `Permute ${++counter}`;
    const first = await command.apply(
      workflowInput({ name, variables: { alpha: "1", beta: "2", gamma: "3" } }),
    );
    const id = first.metadata!.id;
    await command.apply(
      workflowInput({ name, variables: { gamma: "3", beta: "2", alpha: "1" } }),
    );
    expect(await auditCount(id)).toBe(1);
  });
});

describe("workflow tagVersion (single-holder + head reconcile)", () => {
  it("moves the tag between versions, clears the prior holder, reconciles the live head", async () => {
    const name = `Tagged ${++counter}`;
    const v1 = await command.apply(workflowInput({ name, variables: { a: "1" } }));
    const id = v1.metadata!.id;
    const v2 = await command.apply(workflowInput({ name, variables: { a: "2" } }));
    const v1Hash = v1.status!.versionHash;
    const v2Hash = v2.status!.versionHash;

    // Tag the archived v1: the live head (v2) stays untagged.
    let updated = await command.tagVersion({ workflowId: id, versionHash: v1Hash, tag: "stable" });
    expect(updated.metadata?.version?.tag).toBe("");
    const byTag = await query.getByReference({ org: ORG, slug: v1.metadata!.slug, version: "stable" });
    expect(byTag.status?.versionHash).toBe(v1Hash);

    // Move the tag to the head: single-holder means v1 no longer resolves,
    // and the live head's metadata.version.tag reconciles to "stable".
    updated = await command.tagVersion({ workflowId: id, versionHash: v2Hash, tag: "stable" });
    expect(updated.metadata?.version?.tag).toBe("stable");
    const nowHead = await query.getByReference({ org: ORG, slug: v1.metadata!.slug, version: "stable" });
    expect(nowHead.status?.versionHash).toBe(v2Hash);

    // The audit column is the source of truth: v1's entry is untagged now.
    const history = await query.listVersions({ org: ORG, slug: v1.metadata!.slug });
    const tags = history.versions.map((entry) => entry.tag);
    expect(tags.filter((tag) => tag === "stable")).toHaveLength(1);
  });

  it("refuses tagging a version that was never archived", async () => {
    const wf = await command.create(workflowInput());
    const err = await command
      .tagVersion({
        workflowId: wf.metadata!.id,
        versionHash: "0".repeat(64),
        tag: "ghost",
      })
      .then(() => undefined)
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ConnectError);
    expect((err as ConnectError).code).toBe(Code.NotFound);
  });
});

describe("workflow delete (oss#582 survivors)", () => {
  it("removes the workflow but leaves the audit history resolvable", async () => {
    const wf = await command.create(workflowInput());
    const id = wf.metadata!.id;

    await command.delete({ value: id });

    // Version rows SURVIVE: execution viewers render historical graphs
    // through getVersion after the workflow is gone.
    expect(await auditCount(id)).toBe(1);
  });
});

describe("validateSpec (persist-free verdicts)", () => {
  it("returns VALID with YAML and persists nothing", async () => {
    const wf = workflowInput();
    const verdict = await command.validateSpec(wf);
    expect(verdict.state).toBe(ValidationState.VALID);
    expect(verdict.yaml).toContain("document:");

    const err = await query
      .getByReference({ org: ORG, slug: wf.metadata!.name.toLowerCase().replace(/ /g, "-") })
      .then(() => undefined)
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ConnectError);
    expect((err as ConnectError).code).toBe(Code.NotFound);
  });

  it("folds Layer-2 typed-config violations into a structured INVALID verdict (#805)", async () => {
    const wf = workflowInput();
    wf.spec!.tasks = create(WorkflowSchema, {
      spec: {
        tasks: [
          { name: "conditional_wait", kind: 10 /* wait */, taskConfig: { duration: {} } },
        ],
      },
    }).spec!.tasks;

    const verdict = await command.validateSpec(wf);
    expect(verdict.state).toBe(ValidationState.INVALID);
    expect(verdict.errors).toContain(
      "task 'conditional_wait' (wait): duration \u2013 at least one duration field must be non-zero",
    );
  });
});

describe("run visibility (spec.execution_visibility)", () => {
  it("is stored at create, changed by updateExecutionVisibility alone, and never mints a version", async () => {
    const created = await command.create(
      workflowInput({
        executionVisibility: WorkflowExecutionVisibility.organization,
      }),
    );
    const id = created.metadata!.id;
    expect(created.spec?.executionVisibility).toBe(
      WorkflowExecutionVisibility.organization,
    );

    const updated = await command.updateExecutionVisibility({
      resourceId: id,
      executionVisibility: WorkflowExecutionVisibility.private,
    });
    expect(updated.spec?.executionVisibility).toBe(
      WorkflowExecutionVisibility.private,
    );
    expect(updated.status?.versionHash).toBe(created.status?.versionHash);
    expect(await auditCount(id)).toBe(1);

    const reloaded = await query.get({ value: id });
    expect(reloaded.spec?.executionVisibility).toBe(
      WorkflowExecutionVisibility.private,
    );
  });

  it("update and apply keep the stored level whatever the manifest carries", async () => {
    const name = `Audience ${++counter}`;
    const created = await command.apply(workflowInput({ name }));
    const id = created.metadata!.id;
    await command.updateExecutionVisibility({
      resourceId: id,
      executionVisibility: WorkflowExecutionVisibility.organization,
    });

    // A manifest re-applied without the field, and one carrying a stale
    // level, both keep what the door set.
    const reapplied = await command.apply(workflowInput({ name }));
    expect(reapplied.spec?.executionVisibility).toBe(
      WorkflowExecutionVisibility.organization,
    );
    const stale = workflowInput({
      name,
      executionVisibility: WorkflowExecutionVisibility.private,
      variables: { greeting: "changed" },
    });
    stale.metadata!.id = id;
    const updated = await command.update(stale);
    expect(updated.spec?.executionVisibility).toBe(
      WorkflowExecutionVisibility.organization,
    );
  });

  it("an unknown workflow answers NotFound", async () => {
    const err = await command
      .updateExecutionVisibility({
        resourceId: "wfl_missing",
        executionVisibility: WorkflowExecutionVisibility.organization,
      })
      .then(() => undefined)
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ConnectError);
    expect((err as ConnectError).code).toBe(Code.NotFound);
  });
});

describe("an agent_call naming its organization by slug (ResolveAgentCallOrganizations on the chains)", () => {
  function callingBySlug(name: string) {
    const input = workflowInput({ name });
    input.spec!.tasks = [
      create(WorkflowTaskSchema, {
        name: "review",
        kind: WorkflowTaskKind.agent_call,
        taskConfig: {
          agent: `${ORG}/reviewer`,
          message: "review the change",
          environment_refs: [{ org: ORG, slug: "review-keys" }],
        },
      }),
    ];
    return input;
  }

  beforeAll(async () => {
    await server.store.saveResource(
      ApiResourceKind.agent,
      "agt_slugcall",
      AgentSchema,
      create(AgentSchema, {
        apiVersion: API_VERSION,
        kind: "Agent",
        metadata: {
          id: "agt_slugcall",
          name: "reviewer",
          slug: "reviewer",
          org: ORG_ID,
          visibility: ApiResourceVisibility.visibility_org,
        },
        spec: { instructions: "a conformant instruction body" },
      }),
    );
    await server.store.saveResource(
      ApiResourceKind.environment,
      "env_slugcall",
      EnvironmentSchema,
      create(EnvironmentSchema, {
        metadata: { id: "env_slugcall", name: "review-keys", slug: "review-keys", org: ORG_ID },
      }),
    );
  });

  it("create stores the organization's id, and an update written by slug again stores the same", async () => {
    const created = await command.create(callingBySlug("Slug Caller"));
    const stored = (await query.get({ value: created.metadata!.id })).spec!.tasks[0]!.taskConfig;
    expect(stored).toMatchObject({
      agent: `${ORG_ID}/reviewer`,
      environment_refs: [{ org: ORG_ID, slug: "review-keys" }],
    });

    const again = callingBySlug("Slug Caller");
    again.metadata!.id = created.metadata!.id;
    const updated = await command.update(again);
    expect(updated.spec!.tasks[0]!.taskConfig).toMatchObject({ agent: `${ORG_ID}/reviewer` });
    expect(updated.status?.versionHash, "the same workflow, written by slug, is no new version").toBe(
      created.status?.versionHash,
    );
  });

  it("a refusal names the workflow's own organization by its slug, not the id it judged", async () => {
    const missing = callingBySlug("Slug Caller Missing");
    (missing.spec!.tasks[0]!.taskConfig as { agent: string }).agent = `${ORG}/ghost`;
    const refusal = await command.create(missing).then(
      () => undefined,
      (error: unknown) => error as ConnectError,
    );
    expect(refusal?.code).toBe(Code.FailedPrecondition);
    expect(refusal?.rawMessage).toContain(`'ghost' (org: ${ORG})`);
    expect(refusal?.rawMessage).not.toContain(ORG_ID);
  });
});
