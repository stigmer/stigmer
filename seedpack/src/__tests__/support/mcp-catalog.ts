// Test support: the one loader for the marketplace MCP catalog.
//
// Every catalog policy test reads the manifests through this module, so there
// is exactly one definition of "a catalog entry": the file's YAML decoded into
// the generated `McpServer` message by protobuf-es `fromJson`, the same call
// `tools/codegen`'s docs-yaml gate makes for every seedpack manifest. The
// tests therefore see the contract's own field names (`spec.auth.targetEnvVar`,
// `spec.serverType.case`) and nothing hand-written. The Go tests this replaced
// (`seedpack/mcp_servers_test.go`) mirrored the schema in eight structs; a
// renamed proto field would have left those structs reading `""` and every
// dependent policy passing on an empty population. Here a rename is a decode
// failure at load, and unknown fields are rejected the way the gate rejects
// them (the protobuf-es default).
//
// Two things this module does NOT do, by design:
//   - It does not validate the manifests against the contract. That is the
//     gate's job (`make check-docs-yaml`, every PR); a manifest that fails to
//     decode here has already failed there.
//   - It is not part of the package's public surface. `tsconfig.build.json`
//     excludes `src/__tests__/**`, so nothing in this directory reaches `dist/`;
//     `@stigmer/protos` and `yaml` are devDependencies only.
//
// The canary credential manifest is read by path from `seedpack/canary/`,
// outside the canonical content set (`SEEDPACK_ENTRIES` in `src/index.ts`),
// because it is CI-tracking metadata and not a resource.

import { readdirSync, readFileSync } from "node:fs";
import { basename, extname, join } from "node:path";
import { fromJson, type JsonValue } from "@bufbuild/protobuf";
import {
  type McpServer,
  McpServerSchema,
} from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/api_pb";
import type { McpServerSpec } from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/spec_pb";
import type { ApiResourceMetadata } from "@stigmer/protos/ai/stigmer/commons/apiresource/metadata_pb";
import { parseAllDocuments } from "yaml";
import { contentDir } from "../../index.js";

/**
 * A decoded manifest with `metadata` and `spec` present. The generated type
 * makes both optional (proto3 message fields); the loader checks them once so
 * every policy reads them without a guard.
 */
export type CatalogServer = McpServer & {
  readonly metadata: ApiResourceMetadata;
  readonly spec: McpServerSpec;
};

/** One catalog entry: the manifest file name (the marketplace slug) and its decoded message. */
export interface CatalogEntry {
  /** File stem under `mcp-servers/`, e.g. `github` for `mcp-servers/github.yaml`. */
  readonly slug: string;
  /** Path relative to the seedpack root, for diagnostics. */
  readonly path: string;
  readonly server: CatalogServer;
}

/**
 * Load every `mcp-servers/*.yaml` manifest, decoded through the generated
 * schema. Throws on the first manifest that does not decode: a malformed
 * entry is a finding for the gate, not something a policy test should route
 * around. Returned in lexical slug order so failures read the same every run.
 */
export function loadMcpCatalog(root: string = contentDir()): CatalogEntry[] {
  const dir = join(root, "mcp-servers");
  const entries: CatalogEntry[] = [];
  for (const file of readdirSync(dir).sort()) {
    if (extname(file) !== ".yaml") continue;
    const path = join("mcp-servers", file);
    const docs = parseAllDocuments(readFileSync(join(dir, file), "utf8"));
    const values = docs
      .map((d) => d.toJS() as unknown)
      .filter((v) => v !== null && v !== undefined);
    if (values.length !== 1) {
      throw new Error(
        `${path}: expected exactly one YAML document, found ${values.length}`,
      );
    }
    let server: McpServer;
    try {
      server = fromJson(McpServerSchema, values[0] as JsonValue);
    } catch (err) {
      throw new Error(
        `${path}: does not decode as ${McpServerSchema.typeName}: ${(err as Error).message}`,
      );
    }
    if (server.metadata === undefined || server.spec === undefined) {
      throw new Error(
        `${path}: a catalog entry must carry both metadata and spec`,
      );
    }
    entries.push({
      slug: basename(file, ".yaml"),
      path,
      server: server as CatalogServer,
    });
  }
  if (entries.length === 0) {
    throw new Error(`no MCP server manifests found under ${dir}`);
  }
  return entries;
}

/** `${VAR}` placeholders in a manifest value; the capture is the variable name. */
export const PLACEHOLDER = /\$\{([^}]+)\}/g;

/** The variable names referenced by `${VAR}` placeholders in `value`. */
export function placeholdersIn(value: string): string[] {
  return [...value.matchAll(PLACEHOLDER)].map((m) => m[1] as string);
}

/**
 * The slugs the CI canary credential manifest tracks (`seedpack/canary/
 * credential-manifest.yaml`, `servers:` keys). Read from disk because the
 * manifest deliberately lives outside the canonical content set.
 */
export function canaryManifestSlugs(root: string = contentDir()): string[] {
  const path = join(root, "canary", "credential-manifest.yaml");
  const doc = parseAllDocuments(readFileSync(path, "utf8"))[0]?.toJS() as
    | { servers?: Record<string, unknown> }
    | undefined;
  const servers = doc?.servers;
  if (servers === undefined || typeof servers !== "object") {
    throw new Error(`${path}: expected a top-level 'servers' mapping`);
  }
  return Object.keys(servers).sort();
}
