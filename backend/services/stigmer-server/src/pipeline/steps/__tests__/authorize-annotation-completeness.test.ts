/**
 * The annotation-completeness invariant for the Authorize step (stigmer#1073;
 * found on the 20260911.11 cloud readout, 2026-09-13): an `rpc.config`
 * annotation that names a resource KIND must also name where the resource
 * ID comes from (`field_path` or `resource_id`). A kind without an id is a
 * check against `<kind>:` with an empty id — the step resolves it to "" by
 * doctrine (resolution never throws, see authorize.ts) and an enforcing
 * authorizer refuses it for EVERY caller, while the open-source permissive
 * default allows it, so no `local*` conformance target can see the gap.
 * `getActorInfo` shipped that way: green on every OSS gate, denied on the
 * cloud composition the moment the annotation-driven step replaced the
 * cloud's hand-written handler (which had passed `id.value` by hand).
 *
 * Scope is every method the open-source server SERVES — the empty
 * composition's `routes` replayed into a recording router, the
 * tier-truthfulness precedent — because that is exactly the set the OSS
 * Authorize step governs; a composition's own services are its own
 * `direct-handler-authorization` conformance suite's business. Two arms are
 * exempt by construction: `is_public` and `is_skip_authorization` methods
 * never reach the annotation's resolution (the skip lanes resolve their
 * target in the handler through `authorizeDirect`'s override). A config
 * that names NO kind (static or by path) is outside this invariant: the
 * check is then about the kind, not the id, and today no OSS-served method
 * is shaped that way (the IamPolicy RPCs that are belong to
 * `sp.oss-organization-roles`).
 *
 * The mutation arms prove the check bites over the same function.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { getOption, hasOption } from "@bufbuild/protobuf";
import type { DescService } from "@bufbuild/protobuf";
import type { ConnectRouter } from "@connectrpc/connect";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import {
  config as rpcAuthorizationConfig,
  is_public,
  is_skip_authorization,
} from "@stigmer/protos/ai/stigmer/commons/rpc/method_options_pb";

import { loadConfig } from "../../../boot/config.js";
import { composeServer } from "../../../boot/compose.js";
import type { ComposedServer } from "../../../boot/compose.js";
import { createLogger } from "../../../boot/logger.js";

/** One annotated method as the invariant reads it. */
interface AnnotationTarget {
  readonly method: string;
  readonly namesKind: boolean;
  readonly namesId: boolean;
  readonly skipsResolution: boolean;
}

/** Replays the composed routes into a recorder and returns the served services. */
function servedServices(
  routes: (router: ConnectRouter) => void,
): DescService[] {
  const served: DescService[] = [];
  const recorder = {
    handlers: [],
    service(desc: DescService) {
      served.push(desc);
      return recorder;
    },
    rpc() {
      return recorder;
    },
  };
  routes(recorder as unknown as ConnectRouter);
  return served;
}

/** Every `rpc.config`-annotated method of the given services, read once. */
function annotationTargets(services: DescService[]): AnnotationTarget[] {
  const targets: AnnotationTarget[] = [];
  for (const service of services) {
    for (const method of service.methods) {
      if (!hasOption(method, rpcAuthorizationConfig)) continue;
      const config = getOption(method, rpcAuthorizationConfig);
      targets.push({
        method: `${service.typeName}/${method.name}`,
        namesKind:
          config.resourceKind !== ApiResourceKind.api_resource_kind_unknown ||
          config.resourceKindPath !== "",
        namesId: config.fieldPath !== "" || config.resourceId !== "",
        skipsResolution:
          getOption(method, is_public) ||
          getOption(method, is_skip_authorization),
      });
    }
  }
  return targets;
}

/** The methods whose annotation names a kind but no id, one sentence each. */
function unresolvableTargets(targets: AnnotationTarget[]): string[] {
  return targets
    .filter((t) => !t.skipsResolution && t.namesKind && !t.namesId)
    .map(
      (t) =>
        `${t.method} names a resource kind but neither field_path nor resource_id — the Authorize step would check an empty id`,
    );
}

describe("authorization annotations name where the resource id comes from", () => {
  let dir: string;
  let server: ComposedServer;

  beforeAll(async () => {
    dir = mkdtempSync(path.join(tmpdir(), "authorize-annotations-test-"));
    server = await composeServer({
      config: loadConfig({
        STIGMER_MODEL_REGISTRY_REFRESH: "off",
        TEMPORAL_HOST_PORT: "127.0.0.1:1",
        DB_PATH: path.join(dir, "stigmer.db"),
        STORAGE_PATH: path.join(dir, "storage"),
        ARTIFACT_LOCAL_BASE_PATH: path.join(dir, "artifacts"),
      }),
      logger: createLogger({ level: "error", pretty: false, write: () => {} }),
      portOverride: 0,
      host: "127.0.0.1",
    });
  });

  afterAll(async () => {
    await server.shutdown();
    rmSync(dir, { recursive: true, force: true });
  });

  it("every served method that names a kind also names its id (field_path or resource_id)", () => {
    const targets = annotationTargets(servedServices(server.routes));
    expect(targets.length).toBeGreaterThan(100);
    expect(unresolvableTargets(targets)).toEqual([]);
  });

  it("getActorInfo is annotated exactly like get — the arm stigmer#1073 was missing", () => {
    const targets = annotationTargets(servedServices(server.routes));
    const byName = new Map(targets.map((t) => [t.method, t]));
    const get = byName.get(
      "ai.stigmer.iam.identityaccount.v1.IdentityAccountQueryController/get",
    );
    const actor = byName.get(
      "ai.stigmer.iam.identityaccount.v1.IdentityAccountQueryController/getActorInfo",
    );
    expect(get?.namesId, "get names its id").toBe(true);
    expect(actor?.namesId, "getActorInfo names its id").toBe(true);
  });
});

describe("the check bites (mutation proofs over the same function)", () => {
  const shaped = (overrides: Partial<AnnotationTarget>): AnnotationTarget => ({
    method: "x.v1.Query/probe",
    namesKind: true,
    namesId: true,
    skipsResolution: false,
    ...overrides,
  });

  it("a kind with no id is reported, by method name", () => {
    expect(unresolvableTargets([shaped({ namesId: false })])).toEqual([
      "x.v1.Query/probe names a resource kind but neither field_path nor resource_id — the Authorize step would check an empty id",
    ]);
  });

  it("a kind with an id is not", () => {
    expect(unresolvableTargets([shaped({})])).toEqual([]);
  });

  it("a skip or public method is exempt — its target is the handler's, not the annotation's", () => {
    expect(
      unresolvableTargets([shaped({ namesId: false, skipsResolution: true })]),
    ).toEqual([]);
  });

  it("a config that names no kind is outside this invariant", () => {
    expect(
      unresolvableTargets([shaped({ namesKind: false, namesId: false })]),
    ).toEqual([]);
  });
});
