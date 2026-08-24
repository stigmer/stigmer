/**
 * Pins the workflow family against Go's pkg/domain/workflow tests —
 * through the REAL stack: a composed server on an ephemeral port, a native
 * gRPC client, the full interceptor chain, and the DD-002 in-process
 * mutual edge (workflow create provisions its default instance through the
 * router transport; instance create loads its parent the same way).
 *
 * The load-bearing pins conformance cannot reach (it sees only the wire):
 *   - the #341 content-addressed AUDIT ROW semantics: an idempotent apply
 *     inserts no row; a changed apply inserts exactly one; a rollback
 *     re-apply REPOINTS the head without a new row;
 *   - the version hash chain (previous_version_id) across applies;
 *   - tag single-holder at the audit column + live-head tag reconcile on
 *     every tagVersion arm (tag head, move off head, tag archived);
 *   - audit rows SURVIVE workflow delete (execution viewers need them,
 *     oss#582) while instances are cascade-swept (oss#592);
 *   - the default instance's factory shape (slug, reserved labels).
 */
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
import { WorkflowInstanceCommandController } from "@stigmer/protos/ai/stigmer/agentic/workflowinstance/v1/command_pb";
import { WorkflowInstanceQueryController } from "@stigmer/protos/ai/stigmer/agentic/workflowinstance/v1/query_pb";
import { WorkflowExecutionVisibility } from "@stigmer/protos/ai/stigmer/agentic/workflowinstance/v1/spec_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { ApiResourceVisibility } from "@stigmer/protos/ai/stigmer/commons/apiresource/enum_pb";

import { loadConfig } from "../../../boot/config.js";
import { composeServer } from "../../../boot/compose.js";
import type { ComposedServer } from "../../../boot/compose.js";
import { createLogger } from "../../../boot/logger.js";
import {
  DEFAULT_INSTANCE_LABEL,
  RESERVED_LABEL_TRUE,
  SYSTEM_MANAGED_LABEL,
} from "../../../pipeline/apiresource-labels.js";
import { defaultWorkflowInstanceSlug } from "../../workflowinstance/defaultinstance.js";

const silentLogger = createLogger({ level: "error", pretty: false, write: () => {} });

const API_VERSION = "agentic.stigmer.ai/v1";
const ORG = "acme";

let dir: string;
let server: ComposedServer;
let transport: Transport;
let command: Client<typeof WorkflowCommandController>;
let query: Client<typeof WorkflowQueryController>;
let instanceCommand: Client<typeof WorkflowInstanceCommandController>;
let instanceQuery: Client<typeof WorkflowInstanceQueryController>;

beforeAll(async () => {
  dir = mkdtempSync(path.join(tmpdir(), "workflow-domain-test-"));
  server = composeServer({
    config: loadConfig({
      STIGMER_MODEL_REGISTRY_REFRESH: "off",
      DB_PATH: path.join(dir, "stigmer.db"),
      // The skill artifact store + staging wipe (#8) must stay inside the
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
  command = createClient(WorkflowCommandController, transport);
  query = createClient(WorkflowQueryController, transport);
  instanceCommand = createClient(WorkflowInstanceCommandController, transport);
  instanceQuery = createClient(WorkflowInstanceQueryController, transport);
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
  it("create archives exactly one version whose snapshot carries default_instance_id", async () => {
    const created = await command.create(workflowInput());
    const id = created.metadata!.id;

    expect(created.status?.versionHash).toMatch(/^[a-f0-9]{64}$/);
    expect(created.metadata?.version?.id).toBe(created.status?.versionHash);
    expect(created.metadata?.version?.previousVersionId).toBe("");
    expect(await auditCount(id)).toBe(1);

    // v1 archives AFTER the default instance is wired, so the snapshot
    // (what getVersion serves) carries default_instance_id.
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

describe("workflow delete (oss#592 cascade, oss#582 survivors)", () => {
  it("sweeps ALL instances but leaves the audit history resolvable", async () => {
    const wf = await command.create(workflowInput());
    const id = wf.metadata!.id;

    // A user instance beside the default.
    await instanceCommand.create({
      apiVersion: API_VERSION,
      kind: "WorkflowInstance",
      metadata: { name: `Extra ${counter}`, org: ORG },
      spec: { workflowId: id, description: "user instance" },
    });
    const before = await instanceQuery.getByWorkflow({ workflowId: id });
    expect(before.entries).toHaveLength(2);

    await command.delete({ value: id });

    const after = await instanceQuery.getByWorkflow({ workflowId: id });
    expect(after.entries).toHaveLength(0);
    // Version rows SURVIVE: execution viewers render historical graphs
    // through getVersion after the workflow is gone.
    expect(await auditCount(id)).toBe(1);
  });
});

describe("workflow default instance (factory contract)", () => {
  it("provisions <slug>-default with the reserved labels and pins its visibility", async () => {
    const wf = await command.create(workflowInput());
    const instances = await instanceQuery.getByWorkflow({ workflowId: wf.metadata!.id });
    expect(instances.entries).toHaveLength(1);

    const def = instances.entries[0]!;
    expect(def.metadata?.slug).toBe(defaultWorkflowInstanceSlug(wf.metadata!.slug));
    expect(def.metadata?.labels[DEFAULT_INSTANCE_LABEL]).toBe(RESERVED_LABEL_TRUE);
    expect(def.metadata?.labels[SYSTEM_MANAGED_LABEL]).toBe(RESERVED_LABEL_TRUE);
    expect(wf.status?.defaultInstanceId).toBe(def.metadata?.id);

    const err = await instanceCommand
      .updateVisibility({
        resourceId: def.metadata!.id,
        visibility: ApiResourceVisibility.visibility_org,
      })
      .then(() => undefined)
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ConnectError);
    expect((err as ConnectError).code).toBe(Code.FailedPrecondition);
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

describe("workflowinstance guards", () => {
  it("refuses a missing parent (NotFound) and a cross-org parent (InvalidArgument, pinned copy)", async () => {
    const missing = await instanceCommand
      .create({
        apiVersion: API_VERSION,
        kind: "WorkflowInstance",
        metadata: { name: `Orphan ${++counter}`, org: ORG },
        spec: { workflowId: "wf_does_not_exist" },
      })
      .then(() => undefined)
      .catch((e: unknown) => e);
    expect((missing as ConnectError).code).toBe(Code.NotFound);

    const wf = await command.create(workflowInput());
    const crossOrg = await instanceCommand
      .create({
        apiVersion: API_VERSION,
        kind: "WorkflowInstance",
        metadata: { name: `Cross ${counter}`, org: "other-org" },
        spec: { workflowId: wf.metadata!.id },
      })
      .then(() => undefined)
      .catch((e: unknown) => e);
    expect((crossOrg as ConnectError).code).toBe(Code.InvalidArgument);
    expect((crossOrg as ConnectError).rawMessage).toContain(
      `Workflow belongs to org '${ORG}', instance target is org 'other-org'.`,
    );
  });

  it("refuses repointing spec.workflow_id on update (FailedPrecondition, oss#646)", async () => {
    const wfA = await command.create(workflowInput());
    const wfB = await command.create(workflowInput());
    const inst = await instanceCommand.create({
      apiVersion: API_VERSION,
      kind: "WorkflowInstance",
      metadata: { name: `Pinned ${counter}`, org: ORG },
      spec: { workflowId: wfA.metadata!.id },
    });

    const err = await instanceCommand
      .update({
        apiVersion: API_VERSION,
        kind: "WorkflowInstance",
        metadata: { name: inst.metadata!.name, org: ORG },
        spec: { workflowId: wfB.metadata!.id },
      })
      .then(() => undefined)
      .catch((e: unknown) => e);
    expect((err as ConnectError).code).toBe(Code.FailedPrecondition);
    expect((err as ConnectError).rawMessage).toContain(
      `spec.workflow_id is immutable (instance runs workflow ${wfA.metadata!.id})`,
    );
  });

  it("persists execution visibility faithfully (no FGA in this edition)", async () => {
    const wf = await command.create(workflowInput());
    const instances = await instanceQuery.getByWorkflow({ workflowId: wf.metadata!.id });
    const def = instances.entries[0]!;

    // Execution visibility is deliberately NOT guarded for default
    // instances (cloud allows it too — run observability, not access).
    const updated = await instanceCommand.updateExecutionVisibility({
      resourceId: def.metadata!.id,
      executionVisibility: WorkflowExecutionVisibility.organization,
    });
    expect(updated.spec?.executionVisibility).toBe(WorkflowExecutionVisibility.organization);

    const reloaded = await instanceQuery.get({ value: def.metadata!.id });
    expect(reloaded.spec?.executionVisibility).toBe(WorkflowExecutionVisibility.organization);
  });
});
