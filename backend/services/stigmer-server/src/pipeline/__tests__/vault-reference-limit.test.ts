/**
 * Pins the cap on how many vaults one resource may name: every `vaults`
 * list (a session's, an agent share's, an agent channel's, a schedule's
 * AgentInvocation and a platform client's) holds at most 20
 * references (`repeated.max_items = 20` on each field), so the resolver's
 * per-run work stays bounded whoever writes the list.
 *
 * Two layers. Through the shared validator (steps/validation.ts, the
 * instance the transport interceptor uses), one row per list: 21
 * references trip `repeated.max_items` on `vaults`, and 20 trip no rule on
 * that field (other required fields of the bare spec may still be missing;
 * only the vaults rules are judged). And through the REAL stack (a
 * composed server, a native gRPC client and the full interceptor chain),
 * a session create naming 21 vaults is refused as InvalidArgument while one
 * naming 20 real vaults is created, so the refusal is the cap and not some
 * other check on the same create.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { create } from "@bufbuild/protobuf";
import type { DescMessage, MessageInitShape } from "@bufbuild/protobuf";
import { Code, ConnectError, createClient } from "@connectrpc/connect";
import { createGrpcTransport } from "@connectrpc/connect-node";
import type { Violation } from "@bufbuild/protovalidate";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { AgentChannelSpecSchema } from "@stigmer/protos/ai/stigmer/agentic/agentchannel/v1/spec_pb";
import { AgentShareSpecSchema } from "@stigmer/protos/ai/stigmer/agentic/agentshare/v1/spec_pb";
import { AgentInvocationSchema } from "@stigmer/protos/ai/stigmer/agentic/run/v1/invocation_pb";
import { SessionCommandController } from "@stigmer/protos/ai/stigmer/agentic/session/v1/command_pb";
import { SessionSpecSchema } from "@stigmer/protos/ai/stigmer/agentic/session/v1/spec_pb";
import { VaultCommandController } from "@stigmer/protos/ai/stigmer/agentic/vault/v1/command_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { PlatformClientSpecSchema } from "@stigmer/protos/ai/stigmer/iam/platformclient/v1/spec_pb";

import { loadConfig } from "../../boot/config.js";
import { composeServer } from "../../boot/compose.js";
import type { ComposedServer } from "../../boot/compose.js";
import { createLogger } from "../../boot/logger.js";
import { seedOrganizations } from "../../domain/organization/__tests__/support.js";
import { validator } from "../steps/validation.js";

const MAX_VAULTS = 20;
const ORG = "acme";
const MAX_ITEMS_RULE = "repeated.max_items";

/** `count` vault references, by slug in ORG. */
function vaultRefs(count: number, slugs?: readonly string[]) {
  return Array.from({ length: count }, (_, i) => ({
    org: ORG,
    slug: slugs?.[i] ?? `vault-${i}`,
    kind: ApiResourceKind.vault,
  }));
}

/** The violations on the message's top-level `vaults` field. */
function vaultsViolations<Desc extends DescMessage>(
  schema: Desc,
  init: MessageInitShape<Desc>,
): Violation[] {
  const result = validator().validate(schema, create(schema, init));
  if (result.kind === "valid") {
    return [];
  }
  if (result.kind === "error") {
    throw result.error;
  }
  return result.error.violations.filter((v) => {
    const first = v.field[0];
    return first?.kind === "field" && first.name === "vaults";
  });
}

interface ListRow {
  readonly name: string;
  readonly check: (count: number) => Violation[];
}

const lists: readonly ListRow[] = [
  { name: "a session's", check: (n) => vaultsViolations(SessionSpecSchema, { vaults: vaultRefs(n) }) },
  { name: "an agent share's", check: (n) => vaultsViolations(AgentShareSpecSchema, { vaults: vaultRefs(n) }) },
  { name: "an agent channel's", check: (n) => vaultsViolations(AgentChannelSpecSchema, { vaults: vaultRefs(n) }) },
  {
    name: "a schedule's agent invocation's",
    check: (n) => vaultsViolations(AgentInvocationSchema, { vaults: vaultRefs(n) }),
  },
  {
    name: "a platform client's",
    check: (n) => vaultsViolations(PlatformClientSpecSchema, { vaults: vaultRefs(n) }),
  },
];

describe("a vaults list holds at most 20 references, through the shared validator", () => {
  for (const list of lists) {
    it(`${list.name} vaults list refuses ${MAX_VAULTS + 1} and takes ${MAX_VAULTS}`, () => {
      expect(list.check(MAX_VAULTS + 1).map((v) => v.ruleId)).toEqual([MAX_ITEMS_RULE]);
      expect(list.check(MAX_VAULTS)).toEqual([]);
    });
  }
});

const silentLogger = createLogger({
  level: "error",
  pretty: false,
  write: () => {},
});

describe("a session naming more than 20 vaults is refused through the real stack", () => {
  let dir: string;
  let server: ComposedServer;
  let sessions: ReturnType<typeof createClient<typeof SessionCommandController>>;
  let slugs: string[];

  beforeAll(async () => {
    dir = mkdtempSync(path.join(tmpdir(), "vault-reference-limit-test-"));
    server = await composeServer({
      config: loadConfig({
        STIGMER_MODEL_REGISTRY_REFRESH: "off",
        // No engine behind composed tests: 127.0.0.1:1 is deterministically
        // closed, so the boot's non-fatal connect fails fast.
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
    const transport = createGrpcTransport({ baseUrl: `http://127.0.0.1:${port}` });
    await seedOrganizations(transport, [ORG]);
    sessions = createClient(SessionCommandController, transport);
    const vaults = createClient(VaultCommandController, transport);
    slugs = [];
    for (let i = 0; i < MAX_VAULTS + 1; i++) {
      const made = await vaults.create({
        apiVersion: "agentic.stigmer.ai/v1",
        kind: "Vault",
        metadata: { name: `Limit Vault ${i}`, org: ORG },
      });
      slugs.push(made.metadata?.slug ?? "");
    }
  });

  afterAll(async () => {
    await server.shutdown();
    rmSync(dir, { recursive: true, force: true });
  });

  function sessionNaming(count: number, name: string) {
    return {
      apiVersion: "agentic.stigmer.ai/v1",
      kind: "Session",
      metadata: { name, org: ORG },
      spec: { vaults: vaultRefs(count, slugs) },
    };
  }

  it(`refuses ${MAX_VAULTS + 1} vaults as InvalidArgument and creates one naming ${MAX_VAULTS}`, async () => {
    const refusal = await sessions.create(sessionNaming(MAX_VAULTS + 1, "Too Many Vaults")).then(
      () => undefined,
      (e: unknown) => e,
    );
    expect(refusal).toBeInstanceOf(ConnectError);
    expect((refusal as ConnectError).code).toBe(Code.InvalidArgument);
    expect((refusal as ConnectError).rawMessage).toContain("vaults");

    const created = await sessions.create(sessionNaming(MAX_VAULTS, "Enough Vaults"));
    expect(created.spec?.vaults).toHaveLength(MAX_VAULTS);
  });
});
