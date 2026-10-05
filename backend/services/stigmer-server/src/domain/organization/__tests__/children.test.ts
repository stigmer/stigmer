/**
 * Pins parent and child organizations (../children.ts) through the REAL
 * stack: a composed server on an ephemeral port (the trusted-local posture,
 * so authorization admits every call and the domain's own rules are what
 * the suite sees), a native gRPC client and the full interceptor chain,
 * the edge resolver included.
 *
 * What it pins:
 *   - a child names its parent by slug and the stored value is the id;
 *   - `external_id` without `parent_org` is refused by the contract;
 *   - a parent that is itself a child is refused with
 *     ORGANIZATION_PARENT_IS_CHILD;
 *   - an external id is unique among one parent's children and free under
 *     another, and of two concurrent creates of one id exactly one wins;
 *   - update and apply keep `parent_org` and `external_id` as stored;
 *   - getByExternalId answers the child under its parent alone, every miss
 *     one NotFound; listChildOrgs pages a parent's children newest first;
 *   - a parent with children is not deleted (ORGANIZATION_HAS_CHILDREN),
 *     and a deleted child's external id is free again;
 *   - visibility_child_orgs is refused in a child and accepted in its
 *     parent.
 *
 * Authorization of the child lanes (`can_manage_child_orgs`, a child with
 * no owner) is pinned where an Authorizer decides: the extension
 * composition suite and child-organizations.conformance.test.ts.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { create } from "@bufbuild/protobuf";
import { Code, ConnectError, createClient } from "@connectrpc/connect";
import type { Client, Transport } from "@connectrpc/connect";
import { createGrpcTransport } from "@connectrpc/connect-node";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { AgentCommandController } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/command_pb";
import { AgentSchema } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/api_pb";
import { ApiResourceVisibility } from "@stigmer/protos/ai/stigmer/commons/apiresource/enum_pb";
import { OrganizationCommandController } from "@stigmer/protos/ai/stigmer/tenancy/organization/v1/command_pb";
import { OrganizationQueryController } from "@stigmer/protos/ai/stigmer/tenancy/organization/v1/query_pb";
import { OrganizationSchema } from "@stigmer/protos/ai/stigmer/tenancy/organization/v1/api_pb";
import type { Organization } from "@stigmer/protos/ai/stigmer/tenancy/organization/v1/api_pb";
import { ErrorInfoSchema } from "@stigmer/protos/google/rpc/error_details_pb";

import { loadConfig } from "../../../boot/config.js";
import { composeServer } from "../../../boot/compose.js";
import type { ComposedServer } from "../../../boot/compose.js";
import { createLogger } from "../../../boot/logger.js";
import { CHILD_ORGS_VISIBILITY_IN_CHILD_MESSAGE } from "../../../pipeline/steps/validate-visibility.js";
import {
  ORGANIZATION_HAS_CHILDREN,
  ORGANIZATION_PARENT_IS_CHILD,
} from "../children.js";

const silentLogger = createLogger({ level: "error", pretty: false, write: () => {} });

let dir: string;
let server: ComposedServer;
let transport: Transport;
let command: Client<typeof OrganizationCommandController>;
let query: Client<typeof OrganizationQueryController>;
let agents: Client<typeof AgentCommandController>;

beforeAll(async () => {
  dir = mkdtempSync(path.join(tmpdir(), "org-children-test-"));
  server = await composeServer({
    config: loadConfig({
      STIGMER_MODEL_REGISTRY_REFRESH: "off",
      TEMPORAL_HOST_PORT: "127.0.0.1:1",
      DB_PATH: path.join(dir, "stigmer.db"),
      STORAGE_PATH: path.join(dir, "storage"),
      ARTIFACT_LOCAL_BASE_PATH: path.join(dir, "artifacts"),
    }),
    logger: silentLogger,
    portOverride: 0,
    host: "127.0.0.1",
  });
  const port = await server.start();
  transport = createGrpcTransport({ baseUrl: `http://127.0.0.1:${port}` });
  command = createClient(OrganizationCommandController, transport);
  query = createClient(OrganizationQueryController, transport);
  agents = createClient(AgentCommandController, transport);
});

afterAll(async () => {
  await server.shutdown();
  rmSync(dir, { recursive: true, force: true });
});

function organization(
  slug: string,
  spec: { parentOrg?: string; externalId?: string; description?: string } = {},
): Organization {
  return create(OrganizationSchema, {
    apiVersion: "tenancy.stigmer.ai/v1",
    kind: "Organization",
    metadata: { name: slug, slug },
    spec: {
      description: spec.description ?? "created by the children test",
      parentOrg: spec.parentOrg ?? "",
      externalId: spec.externalId ?? "",
    },
  });
}

async function refusal(run: () => Promise<unknown>): Promise<ConnectError> {
  try {
    await run();
  } catch (error) {
    if (error instanceof ConnectError) {
      return error;
    }
    throw error;
  }
  throw new Error("expected the call to fail");
}

function reasonsOf(error: ConnectError): string[] {
  return error.findDetails(ErrorInfoSchema).map((info) => info.reason);
}

describe("creating a child organization", () => {
  it("names its parent by slug and stores the parent's id", async () => {
    const parent = await command.create(organization("par-one"));
    const child = await command.create(
      organization("par-one-c1", { parentOrg: "par-one", externalId: "cust-1" }),
    );
    expect(child.spec?.parentOrg).toBe(parent.metadata?.id);
    expect(child.spec?.externalId).toBe("cust-1");
  });

  it("refuses an external_id on an organization with no parent", async () => {
    const error = await refusal(() =>
      command.create(organization("orphan-ext", { externalId: "cust-x" })),
    );
    expect(error.code).toBe(Code.InvalidArgument);
  });

  it("refuses a parent that is itself a child: one level deep", async () => {
    await command.create(organization("par-two"));
    await command.create(organization("par-two-c1", { parentOrg: "par-two" }));
    const error = await refusal(() =>
      command.create(organization("par-two-gc", { parentOrg: "par-two-c1" })),
    );
    expect(error.code).toBe(Code.FailedPrecondition);
    expect(reasonsOf(error)).toEqual([ORGANIZATION_PARENT_IS_CHILD]);
  });

  it("keeps an external id unique among one parent's children, and free under another parent", async () => {
    await command.create(organization("par-three"));
    await command.create(organization("par-four"));
    await command.create(
      organization("par-three-a", { parentOrg: "par-three", externalId: "cust-7" }),
    );
    const duplicate = await refusal(() =>
      command.create(
        organization("par-three-b", { parentOrg: "par-three", externalId: "cust-7" }),
      ),
    );
    expect(duplicate.code).toBe(Code.AlreadyExists);
    const elsewhere = await command.create(
      organization("par-four-a", { parentOrg: "par-four", externalId: "cust-7" }),
    );
    expect(elsewhere.spec?.externalId).toBe("cust-7");
    // The refused create left its slug free.
    const retried = await command.create(
      organization("par-three-b", { parentOrg: "par-three", externalId: "cust-8" }),
    );
    expect(retried.metadata?.slug).toBe("par-three-b");
  });

  it("lets exactly one of two concurrent creates claim one external id", async () => {
    await command.create(organization("par-race"));
    const outcomes = await Promise.allSettled([
      command.create(
        organization("par-race-a", { parentOrg: "par-race", externalId: "cust-r" }),
      ),
      command.create(
        organization("par-race-b", { parentOrg: "par-race", externalId: "cust-r" }),
      ),
    ]);
    const won = outcomes.filter((outcome) => outcome.status === "fulfilled");
    const lost = outcomes.filter(
      (outcome): outcome is PromiseRejectedResult => outcome.status === "rejected",
    );
    expect(won).toHaveLength(1);
    expect(lost).toHaveLength(1);
    expect(ConnectError.from(lost[0]?.reason).code).toBe(Code.AlreadyExists);
    const listed = await query.listChildOrgs({ org: "par-race" });
    expect(listed.entries).toHaveLength(1);
  });
});

describe("a child's parent and external id after create", () => {
  it("update and apply keep both as stored", async () => {
    await command.create(organization("par-five"));
    await command.create(organization("par-six"));
    const child = await command.create(
      organization("par-five-c", { parentOrg: "par-five", externalId: "cust-5" }),
    );
    const moved = organization("par-five-c", {
      parentOrg: "par-six",
      externalId: "cust-other",
      description: "renamed description",
    });
    moved.metadata!.id = child.metadata?.id ?? "";
    const updated = await command.update(moved);
    expect(updated.spec?.description).toBe("renamed description");
    expect(updated.spec?.parentOrg).toBe(child.spec?.parentOrg);
    expect(updated.spec?.externalId).toBe("cust-5");
    const applied = await command.apply(
      organization("par-five-c", { description: "applied without the link" }),
    );
    expect(applied.spec?.parentOrg).toBe(child.spec?.parentOrg);
    expect(applied.spec?.externalId).toBe("cust-5");
  });
});

describe("finding and listing a parent's children", () => {
  it("getByExternalId answers the child under its parent alone, every miss one NotFound", async () => {
    await command.create(organization("par-seven"));
    await command.create(organization("par-eight"));
    const child = await command.create(
      organization("par-seven-c", { parentOrg: "par-seven", externalId: "cust-9" }),
    );
    const found = await query.getByExternalId({
      parentOrg: "par-seven",
      externalId: "cust-9",
    });
    expect(found.metadata?.id).toBe(child.metadata?.id);
    for (const [parentOrg, externalId] of [
      ["par-seven", "cust-unknown"],
      ["par-eight", "cust-9"],
    ] as const) {
      const missing = await refusal(() =>
        query.getByExternalId({ parentOrg, externalId }),
      );
      expect(missing.code).toBe(Code.NotFound);
    }
  });

  it("listChildOrgs pages a parent's children newest first, and lists no other parent's", async () => {
    await command.create(organization("par-nine"));
    const created: string[] = [];
    for (const suffix of ["a", "b", "c"]) {
      const child = await command.create(
        organization(`par-nine-${suffix}`, { parentOrg: "par-nine" }),
      );
      created.push(child.metadata?.slug ?? "");
    }
    const first = await query.listChildOrgs({ org: "par-nine", pageSize: 2 });
    expect(first.entries.map((org) => org.metadata?.slug)).toEqual([
      "par-nine-c",
      "par-nine-b",
    ]);
    expect(first.nextPageToken).not.toBe("");
    const second = await query.listChildOrgs({
      org: "par-nine",
      pageSize: 2,
      pageToken: first.nextPageToken,
    });
    expect(second.entries.map((org) => org.metadata?.slug)).toEqual([
      "par-nine-a",
    ]);
    expect(second.nextPageToken).toBe("");
    const whole = await query.listChildOrgs({ org: "par-nine" });
    expect(whole.entries.map((org) => org.metadata?.slug).sort()).toEqual(
      created.sort(),
    );
    const none = await query.listChildOrgs({ org: "par-nine-a" });
    expect(none.entries).toEqual([]);
  });
});

describe("deleting a parent and its children", () => {
  it("refuses a parent with children, frees a deleted child's external id, and deletes the parent once it has none", async () => {
    const parent = await command.create(organization("par-ten"));
    const child = await command.create(
      organization("par-ten-c", { parentOrg: "par-ten", externalId: "cust-10" }),
    );
    const refused = await refusal(() =>
      command.delete({ value: parent.metadata?.id ?? "" }),
    );
    expect(refused.code).toBe(Code.FailedPrecondition);
    expect(reasonsOf(refused)).toEqual([ORGANIZATION_HAS_CHILDREN]);

    await command.delete({ value: child.metadata?.id ?? "" });
    const again = await command.create(
      organization("par-ten-d", { parentOrg: "par-ten", externalId: "cust-10" }),
    );
    expect(
      (await query.getByExternalId({ parentOrg: "par-ten", externalId: "cust-10" }))
        .metadata?.id,
    ).toBe(again.metadata?.id);
    await command.delete({ value: again.metadata?.id ?? "" });
    await command.delete({ value: parent.metadata?.id ?? "" });
  });
});

describe("sharing with child organizations", () => {
  function agent(org: string, slug: string) {
    return create(AgentSchema, {
      apiVersion: "agentic.stigmer.ai/v1",
      kind: "Agent",
      metadata: {
        name: slug,
        slug,
        org,
        visibility: ApiResourceVisibility.visibility_child_orgs,
      },
      spec: { instructions: "help the customer with their questions" },
    });
  }

  it("is accepted in a parent and refused in a child, which has no children to share with", async () => {
    await command.create(organization("par-share"));
    await command.create(organization("par-share-c", { parentOrg: "par-share" }));
    const shared = await agents.create(agent("par-share", "helper"));
    expect(shared.metadata?.visibility).toBe(
      ApiResourceVisibility.visibility_child_orgs,
    );
    const refused = await refusal(() =>
      agents.create(agent("par-share-c", "helper")),
    );
    expect(refused.code).toBe(Code.FailedPrecondition);
    expect(refused.rawMessage).toBe(CHILD_ORGS_VISIBILITY_IN_CHILD_MESSAGE);
  });
});
