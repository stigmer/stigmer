/**
 * The tier-truthfulness invariant (editions program 20260911.03 DD-001;
 * P0 review finding 4; landed with the first tier flip, 20260911.11
 * Q-IA-6): a kind's `kind_meta.tier` states what the edition's server
 * SERVES, not a plan. The SDK reads a tier as "available now"
 * (sdk/typescript/src/resource-availability.ts), so a tier that runs ahead
 * of the server turns hidden hooks into UNIMPLEMENTED errors, and a tier
 * that lags hides a served kind.
 *
 * Proven against the EMPTY composition (no extension units — the
 * open-source server as shipped): every `open_source` kind has a routed
 * service and no `enterprise` or `cloud_only` kind does. Services are
 * enumerated by replaying the composed `routes` closure into a recording
 * router (compose.ts hands the same closure to both transports); a service
 * maps to its kind by the package's kind segment, which equals
 * `kind_meta.name` lowercased for every kind in the registry (checked at
 * the gate against all 28 entries).
 *
 * Two exceptions were ruled at the P1 gate (20260911.04 T01_1_review.md,
 * "Placements taken at the gate"). Under this check they take two shapes:
 *   - platform is a lie the ruling exempts by name: served by every
 *     edition (getServerInfo is is_public and every console reads it)
 *     while the tier names the platform#operator seat an Enterprise
 *     deployment sells. Its service lives at `ai.stigmer.platform.v1`, the
 *     one package where the kind IS the group;
 *   - api_resource_version is a record kind with no service in any
 *     edition; tiered cloud_only and unserved it tells no lie, so it needs
 *     no exemption — its own arm pins that it stays unserved.
 * A third exemption can only join by the same recorded act.
 *
 * The mutation arms prove the check bites: the same function over a
 * registry with one tier flipped reports the lie.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import type { DescService } from "@bufbuild/protobuf";
import type { ConnectRouter } from "@connectrpc/connect";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  ApiResourceKind,
  ResourceTier,
} from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import { loadConfig } from "../../boot/config.js";
import { composeServer } from "../../boot/compose.js";
import type { ComposedServer } from "../../boot/compose.js";
import { createLogger } from "../../boot/logger.js";
import { getKindMeta } from "../../pipeline/apiresource-meta.js";

/** The registry as the check reads it: every kind with kind_meta, by tier. */
interface KindEntry {
  readonly kind: ApiResourceKind;
  readonly name: string;
  readonly tier: ResourceTier;
}

/** The pre-ruled exemption, by name, with the ruling that exempts it. */
const RULED_EXCEPTIONS: ReadonlyMap<ApiResourceKind, string> = new Map([
  [
    ApiResourceKind.platform,
    "served by every edition; the tier names the platform#operator seat (P1 gate, placements)",
  ],
]);

function registryEntries(): KindEntry[] {
  return Object.values(ApiResourceKind)
    .filter((value): value is ApiResourceKind => typeof value === "number")
    .filter((kind) => kind !== ApiResourceKind.api_resource_kind_unknown)
    .map((kind) => {
      const meta = getKindMeta(kind);
      return { kind, name: meta.name, tier: meta.tier };
    });
}

/**
 * The kind segment of a service's fully-qualified name:
 * `ai.stigmer.<group>.<kind>.v1.<Service>` → `<kind>`, and for the one
 * package where the kind is the group, `ai.stigmer.<group>.v1.<Service>` →
 * `<group>` (platform). Services outside the registry's shape (health,
 * third-party, kind-less groups like search) yield a segment that matches
 * no kind and fall out of the comparison.
 */
function kindSegmentOf(serviceTypeName: string): string | undefined {
  const parts = serviceTypeName.split(".");
  if (parts[0] !== "ai" || parts[1] !== "stigmer") return undefined;
  if (parts.length === 5) return parts[2];
  if (parts.length >= 6) return parts[3];
  return undefined;
}

/**
 * The invariant as a pure function. Returns one sentence per lie so the
 * failure names the kind and the direction.
 */
function tierViolations(
  entries: ReadonlyArray<KindEntry>,
  servedKindSegments: ReadonlySet<string>,
  exceptions: ReadonlyMap<ApiResourceKind, string>,
): string[] {
  const violations: string[] = [];
  for (const entry of entries) {
    if (exceptions.has(entry.kind)) continue;
    const served = servedKindSegments.has(entry.name.toLowerCase());
    switch (entry.tier) {
      case ResourceTier.open_source:
        if (!served) {
          violations.push(
            `${entry.name} is tiered open_source but the empty composition routes no service for it`,
          );
        }
        break;
      case ResourceTier.enterprise:
      case ResourceTier.cloud_only:
        if (served) {
          violations.push(
            `${entry.name} is tiered ${ResourceTier[entry.tier]} but the empty composition serves it — the tier lags the server`,
          );
        }
        break;
      case ResourceTier.resource_tier_unspecified:
        violations.push(
          `${entry.name} has no tier — every kind_meta must declare one`,
        );
        break;
      default: {
        const exhaustive: never = entry.tier;
        throw new Error(`unknown tier ${String(exhaustive)}`);
      }
    }
  }
  return violations;
}

/** Replays the composed routes into a recorder and returns the served kind segments. */
function servedKindSegments(
  routes: (router: ConnectRouter) => void,
): Set<string> {
  const served = new Set<string>();
  const recorder = {
    handlers: [],
    service(desc: DescService) {
      const segment = kindSegmentOf(desc.typeName);
      if (segment !== undefined) served.add(segment);
      return recorder;
    },
    rpc() {
      return recorder;
    },
  };
  routes(recorder as unknown as ConnectRouter);
  return served;
}

describe("tier truthfulness against the empty composition", () => {
  let dir: string;
  let server: ComposedServer;

  beforeAll(async () => {
    dir = mkdtempSync(path.join(tmpdir(), "tier-truthfulness-test-"));
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

  it("every kind's tier states what the open-source server serves (two ruled exceptions)", () => {
    const served = servedKindSegments(server.routes);
    expect(served.size).toBeGreaterThan(10);
    expect(tierViolations(registryEntries(), served, RULED_EXCEPTIONS)).toEqual(
      [],
    );
  });

  it("the ruled exemption is exactly the lie the registry tells today, no fewer", () => {
    // If platform stops being a lie (its tier becomes open_source), it must
    // leave the exemption by a recorded act rather than linger as dead
    // vocabulary.
    const served = servedKindSegments(server.routes);
    const withoutExceptions = tierViolations(
      registryEntries(),
      served,
      new Map(),
    );
    const exceptionNames = [...RULED_EXCEPTIONS.keys()]
      .map((kind) => getKindMeta(kind).name)
      .sort();
    const lyingNames = withoutExceptions
      .map((sentence) => sentence.split(" ")[0] ?? "")
      .sort();
    expect(lyingNames).toEqual(exceptionNames);
  });

  it("api_resource_version stays a record kind with no service (the P1 gate's second placement)", () => {
    const served = servedKindSegments(server.routes);
    expect(served.has("apiresourceversion")).toBe(false);
  });

  it("identity_account is open_source and served — the flip and the serving PR are one change (Q-EC-2b)", () => {
    const served = servedKindSegments(server.routes);
    expect(getKindMeta(ApiResourceKind.identity_account).tier).toBe(
      ResourceTier.open_source,
    );
    expect(served.has("identityaccount")).toBe(true);
  });
});

describe("the check bites (mutation proofs over the same function)", () => {
  const served = new Set(["agent", "apikey", "identityaccount"]);
  const entries: KindEntry[] = [
    {
      kind: ApiResourceKind.agent,
      name: "Agent",
      tier: ResourceTier.open_source,
    },
    {
      kind: ApiResourceKind.api_key,
      name: "ApiKey",
      tier: ResourceTier.open_source,
    },
    {
      kind: ApiResourceKind.identity_account,
      name: "IdentityAccount",
      tier: ResourceTier.open_source,
    },
    {
      kind: ApiResourceKind.invitation,
      name: "Invitation",
      tier: ResourceTier.cloud_only,
    },
  ];

  it("passes a truthful registry", () => {
    expect(tierViolations(entries, served, new Map())).toEqual([]);
  });

  it("a tier that runs ahead of the server (open_source, unserved) is named", () => {
    const ahead = entries.map((entry) =>
      entry.kind === ApiResourceKind.invitation
        ? { ...entry, tier: ResourceTier.open_source }
        : entry,
    );
    expect(tierViolations(ahead, served, new Map())).toEqual([
      "Invitation is tiered open_source but the empty composition routes no service for it",
    ]);
  });

  it("a tier that lags the server (cloud_only, served) is named — reverting the flip fails here", () => {
    const lagging = entries.map((entry) =>
      entry.kind === ApiResourceKind.identity_account
        ? { ...entry, tier: ResourceTier.cloud_only }
        : entry,
    );
    expect(tierViolations(lagging, served, new Map())).toEqual([
      "IdentityAccount is tiered cloud_only but the empty composition serves it — the tier lags the server",
    ]);
  });

  it("a kind with no tier is a lie of omission", () => {
    const untiered = [
      ...entries,
      {
        kind: ApiResourceKind.memory,
        name: "Memory",
        tier: ResourceTier.resource_tier_unspecified,
      },
    ];
    expect(tierViolations(untiered, served, new Map())).toEqual([
      "Memory has no tier — every kind_meta must declare one",
    ]);
  });

  it("an exception is honoured only by name", () => {
    const lagging = entries.map((entry) =>
      entry.kind === ApiResourceKind.identity_account
        ? { ...entry, tier: ResourceTier.cloud_only }
        : entry,
    );
    const exceptions = new Map([
      [ApiResourceKind.identity_account, "a test-only exemption"],
    ]);
    expect(tierViolations(lagging, served, exceptions)).toEqual([]);
  });
});
