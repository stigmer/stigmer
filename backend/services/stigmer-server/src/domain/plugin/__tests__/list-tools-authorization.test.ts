/**
 * Pins the annotation enforcement on `PluginCommandController.listTools`:
 * the handler evaluates its own annotation (can_view on the plugin, by
 * `plugin_id`) through authorizeDirect, and a denying authorizer answers
 * PERMISSION_DENIED with the method's byte-pinned error_msg. The orders are
 * asserted structurally:
 *
 *   - authorize AFTER the load (stigmer#224): a missing plugin answers
 *     NOT_FOUND even to a caller the authorizer would deny;
 *   - authorize BEFORE anything about the plugin's servers or the engine:
 *     a denied caller learns neither which servers the plugin carries nor
 *     whether listing is available, and no engine, vault, credential or
 *     attempt is touched;
 *   - a credential bound to one organization, though allowed on the
 *     plugin, is refused with the binding's sentence when the listing
 *     names another organization, before any of those is touched.
 */
import { create } from "@bufbuild/protobuf";
import { Code, ConnectError } from "@connectrpc/connect";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { PluginSchema } from "@stigmer/protos/ai/stigmer/agentic/plugin/v1/api_pb";
import { ListPluginToolsInputSchema } from "@stigmer/protos/ai/stigmer/agentic/plugin/v1/io_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { IamPermission } from "@stigmer/protos/ai/stigmer/iam/v1/enum_pb";

import { BOUND_ELSEWHERE_DENY_REASON } from "../../../authorization/credential-binding.js";
import { createLogger } from "../../../boot/logger.js";
import type { Authorizer, AuthzCheck } from "../../../extensions/authorizer.js";
import { testCallerIdentity } from "../../../pipeline/__tests__/support.js";
import { SqliteStore } from "../../../store/sqlite/store.js";
import { listTools } from "../list-tools.js";
import type { PluginToolsDeps } from "../list-tools.js";

const silentLogger = createLogger({ level: "error", pretty: false, write: () => {} });

const caller = testCallerIdentity();

/** Records every check and answers `kind` — the arm and target assertions read it. */
function recordingAuthorizer(kind: "allow" | "deny"): { authorizer: Authorizer; checks: AuthzCheck[] } {
  const checks: AuthzCheck[] = [];
  return {
    checks,
    authorizer: {
      authorize(_caller, check) {
        checks.push(check);
        return Promise.resolve(kind === "allow" ? { kind: "allow" } : { kind: "deny", reason: "" });
      },
    },
  };
}

let dir: string;
let store: SqliteStore;

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "plugin-tools-authz-test-"));
  store = SqliteStore.open(path.join(dir, "stigmer.db"));
});

afterEach(() => {
  store.close();
  rmSync(dir, { recursive: true, force: true });
});

async function seedPlugin(id: string): Promise<void> {
  await store.saveResource(
    ApiResourceKind.plugin,
    id,
    PluginSchema,
    create(PluginSchema, {
      apiVersion: "agentic.stigmer.ai/v1",
      kind: "Plugin",
      metadata: { id, name: "linear", slug: "linear", org: "test-org" },
      status: {
        mcpServers: [{ name: "linear", transport: { case: "http", value: { url: "https://mcp.linear.app/mcp" } } }],
      },
    }),
  );
}

function deps(authorizer: Authorizer): PluginToolsDeps {
  // Only the members the handler touches BEFORE its authorize call are real;
  // everything after the denial is unreachable and throws if touched.
  const unreachable = <T extends object>(name: string): T =>
    new Proxy({} as T, {
      get(_target, prop) {
        throw new Error(`${name}.${String(prop)} reached despite the refusal`);
      },
    });
  return {
    store,
    logger: silentLogger,
    authorizer,
    engineState: () => {
      throw new Error("the engine state was read despite the refusal");
    },
    runnerAuth: unreachable("runnerAuth"),
    vaultResolver: unreachable("vaultResolver"),
    sandboxLane: unreachable("sandboxLane"),
  };
}

async function expectRefused(run: () => Promise<unknown>, code: Code, copy: string): Promise<void> {
  const error = await run().catch((e: unknown) => e);
  expect(error).toBeInstanceOf(ConnectError);
  expect((error as ConnectError).code).toBe(code);
  expect((error as ConnectError).rawMessage).toBe(copy);
}

describe("listTools authorization", () => {
  it("a missing plugin answers NOT_FOUND even under denial (load-first, #224)", async () => {
    const { authorizer, checks } = recordingAuthorizer("deny");
    const error = await listTools(
      deps(authorizer),
      create(ListPluginToolsInputSchema, { pluginId: "plg_missing", server: "linear", org: "test-org" }),
      caller,
    ).catch((e: unknown) => e);
    expect((error as ConnectError).code).toBe(Code.NotFound);
    expect(checks).toEqual([]);
  });

  it("denies with the annotation copy, asking can_view on the plugin by its id, before the server or the engine is read", async () => {
    await seedPlugin("plg_denied");
    const { authorizer, checks } = recordingAuthorizer("deny");
    // A server the plugin does not carry would answer NOT_FOUND; denial
    // comes first, so the caller learns nothing about its servers.
    await expectRefused(
      () =>
        listTools(
          deps(authorizer),
          create(ListPluginToolsInputSchema, { pluginId: "plg_denied", server: "not-there", org: "test-org" }),
          caller,
        ),
      Code.PermissionDenied,
      "unauthorized to list plugin tools",
    );
    expect(checks).toEqual([{ permission: IamPermission.can_view, resourceKind: ApiResourceKind.plugin, resourceId: "plg_denied" }]);
  });

  it("refuses a credential bound to another organization, though allowed on the plugin, before the engine or any vault is touched", async () => {
    await seedPlugin("plg_bound");
    const { authorizer } = recordingAuthorizer("allow");
    await expectRefused(
      () =>
        listTools(
          deps(authorizer),
          create(ListPluginToolsInputSchema, { pluginId: "plg_bound", server: "linear", org: "test-org" }),
          { ...caller, boundOrg: "org_a" },
        ),
      Code.PermissionDenied,
      BOUND_ELSEWHERE_DENY_REASON,
    );
  });
});
