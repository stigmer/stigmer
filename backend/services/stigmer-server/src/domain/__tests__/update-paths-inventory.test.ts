/**
 * Holds docs/update-paths.md true to the server it documents: one row per
 * served update, naming each path that kind's update_mask may not name and
 * who writes it instead (domain/update-paths.ts, gathered from the
 * declaration beside each update chain), and "none" for a kind that
 * refuses no path of its own. Every refused path is a field of its kind,
 * every registry entry is a kind the server updates, and every spec field
 * the contract marks `computed` is refused by its kind: a field the server
 * computes is never an update's to write.
 *
 * So a new update RPC, a new door-owned field or a new computed field
 * fails here with the row to write. The mutation proofs below show the
 * comparison bites.
 */
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { getOption, hasOption } from "@bufbuild/protobuf";
import type { DescMessage, DescMethod } from "@bufbuild/protobuf";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { ApiResourceKind } from "@stigmer/apis/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { computed } from "@stigmer/apis/ai/stigmer/commons/apiresource/field_options_pb";
import { api_resource_kind } from "@stigmer/apis/ai/stigmer/commons/apiresource/rpc_service_options_pb";

import { loadConfig } from "../../boot/config.js";
import { composeServer } from "../../boot/compose.js";
import type { ComposedServer } from "../../boot/compose.js";
import {
  baseConfig,
  servedMethods,
  silentLogger,
} from "../../extensions/__tests__/composed-support.js";
import { getKindName } from "../../pipeline/apiresource-meta.js";
import { checkUpdateMask } from "../../pipeline/steps/update-mask.js";
import type { RefusedUpdatePath } from "../../pipeline/steps/update-mask.js";
import { REFUSED_UPDATE_PATHS_BY_KIND } from "../update-paths.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = path.resolve(HERE, "../../..");
const INVENTORY_DOC = path.join(PACKAGE_ROOT, "docs/update-paths.md");

/** A served update: its kind and the resource its input carries. */
interface ServedUpdate {
  readonly kind: ApiResourceKind;
  readonly resource: DescMessage;
}

function servedUpdates(server: ComposedServer): ServedUpdate[] {
  const updates: ServedUpdate[] = [];
  for (const method of servedMethods(server.routes)) {
    const resource = updatedResourceOf(method);
    if (resource === undefined || !hasOption(method.parent, api_resource_kind)) {
      continue;
    }
    updates.push({ kind: getOption(method.parent, api_resource_kind), resource });
  }
  return updates;
}

/** The resource an `update` method's Update<Kind>Input carries, or undefined for any other method. */
function updatedResourceOf(method: DescMethod): DescMessage | undefined {
  if (method.localName !== "update") {
    return undefined;
  }
  const resource = method.input.fields.find((field) => field.name === "resource");
  const mask = method.input.fields.find((field) => field.name === "update_mask");
  return resource?.fieldKind === "message" && mask !== undefined ? resource.message : undefined;
}

/** The doc's table rows, as `Kind | path | written by` strings. */
function rowsOf(doc: string): string[] {
  return doc
    .split("\n")
    .filter((line) => line.startsWith("| ") && !line.startsWith("| Kind ") && !line.startsWith("|---"))
    .map((line) =>
      line
        .split("|")
        .slice(1, -1)
        .map((cell) => cell.replaceAll("`", "").trim())
        .join(" | "),
    );
}

/** The rows the registry gives, one per refused path, or "none". */
function expectedRows(
  updates: ReadonlyArray<ServedUpdate>,
  registry: ReadonlyMap<ApiResourceKind, ReadonlyArray<RefusedUpdatePath>>,
): string[] {
  const rows: string[] = [];
  const named = updates
    .map((update) => ({ ...update, name: getKindName(update.kind) }))
    .sort((a, b) => a.name.localeCompare(b.name));
  for (const { kind, name } of named) {
    const refused = registry.get(kind) ?? [];
    if (refused.length === 0) {
      rows.push(`${name} | none | `);
      continue;
    }
    for (const entry of refused) {
      rows.push(`${name} | ${entry.path} | ${entry.writtenBy}`);
    }
  }
  return rows;
}

/** What is wrong with the registry against the served contract, as sentences. */
function registryProblems(
  updates: ReadonlyArray<ServedUpdate>,
  registry: ReadonlyMap<ApiResourceKind, ReadonlyArray<RefusedUpdatePath>>,
): string[] {
  const problems: string[] = [];
  const served = new Map(updates.map((update) => [update.kind, update.resource]));
  for (const [kind, refused] of registry) {
    const resource = served.get(kind);
    if (resource === undefined) {
      problems.push(`${getKindName(kind)} has refused paths but no served update`);
      continue;
    }
    for (const entry of refused) {
      try {
        checkUpdateMask(resource, [entry.path], []);
      } catch {
        problems.push(`${getKindName(kind)} refuses '${entry.path}', which is no field an update could name`);
      }
    }
  }
  for (const { kind, resource } of updates) {
    const spec = resource.fields.find((field) => field.name === "spec");
    if (spec?.fieldKind !== "message") {
      continue;
    }
    const refused = (registry.get(kind) ?? []).map((entry) => entry.path);
    for (const field of spec.message.fields) {
      if (hasOption(field, computed) && getOption(field, computed) && !refused.includes(`spec.${field.name}`)) {
        problems.push(`${getKindName(kind)}'s spec.${field.name} is computed but its update does not refuse it`);
      }
    }
  }
  return problems;
}

describe("the update-path inventory (docs/update-paths.md) is true to the served server", () => {
  let dir: string;
  let server: ComposedServer;
  let updates: ServedUpdate[];

  beforeAll(async () => {
    dir = mkdtempSync(path.join(tmpdir(), "update-paths-inventory-test-"));
    server = await composeServer({
      config: loadConfig(baseConfig(dir)),
      logger: silentLogger,
      portOverride: 0,
      host: "127.0.0.1",
    });
    updates = servedUpdates(server);
  });

  afterAll(async () => {
    await server.shutdown();
    rmSync(dir, { recursive: true, force: true });
  });

  it("serves the fifteen open-source updates, each on an Update<Kind>Input", () => {
    expect(updates).toHaveLength(15);
  });

  it("the doc's rows are exactly the registry's, one per served update", () => {
    expect(rowsOf(readFileSync(INVENTORY_DOC, "utf8"))).toEqual(
      expectedRows(updates, REFUSED_UPDATE_PATHS_BY_KIND),
    );
  });

  it("every refused path is a field of its kind, and every computed spec field is refused", () => {
    expect(registryProblems(updates, REFUSED_UPDATE_PATHS_BY_KIND)).toEqual([]);
  });

  it("the comparison bites: a missing path, a computed field left out and an entry for no update each disagree", () => {
    const vault = REFUSED_UPDATE_PATHS_BY_KIND.get(ApiResourceKind.vault) ?? [];
    const apiKey = REFUSED_UPDATE_PATHS_BY_KIND.get(ApiResourceKind.api_key) ?? [];
    const mutated = new Map(REFUSED_UPDATE_PATHS_BY_KIND);
    mutated.set(ApiResourceKind.vault, [...vault, { path: "spec.no_such_field", writtenBy: "nobody" }]);
    mutated.set(ApiResourceKind.api_key, apiKey.filter((entry) => entry.path !== "spec.key_hash"));
    mutated.set(ApiResourceKind.skill, [{ path: "spec.description", writtenBy: "push" }]);
    expect(registryProblems(updates, mutated)).toEqual([
      "Vault refuses 'spec.no_such_field', which is no field an update could name",
      "Skill has refused paths but no served update",
      "ApiKey's spec.key_hash is computed but its update does not refuse it",
    ]);
    expect(expectedRows(updates, mutated)).not.toEqual(
      rowsOf(readFileSync(INVENTORY_DOC, "utf8")),
    );
  });
});
