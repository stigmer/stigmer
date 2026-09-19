/**
 * The Agent Plugins 1.0.0 root manifest (`plugin.json`).
 *
 * The open format's manifest is closed and versioned: `$schema` is required
 * and must be the canonical 1.0.0 identifier, the ten permitted fields are
 * fixed, an unknown field is reported and ignored, and any other violation
 * is fatal. Components live at fixed locations only (`skills/`, `mcp.json`),
 * so this manifest declares no paths and no inline servers; `mcp.json` is
 * read under the open format's rules by `detect.ts` when it exists.
 * Client-specific data belongs under `extensions`, which Stigmer records as
 * ignored per foreign namespace; its own `ai.stigmer` namespace carries the
 * appearance fields a storefront card shows (`manifest.ts`,
 * `STIGMER_EXTENSION_FIELDS`), the open format's only place for them.
 */

import { describeValue, type JsonObject } from "../documents.js";
import { AGENT_PLUGINS_MANIFEST_SCHEMA, type Findings } from "../messages.js";
import { type DialectManifest, extensionComponents, readIdentity, warnUnknownFields } from "./manifest.js";

const KNOWN_FIELDS: ReadonlySet<string> = new Set([
  "$schema",
  "name",
  "version",
  "description",
  "author",
  "homepage",
  "repository",
  "license",
  "keywords",
  "extensions",
]);

export function readOpenManifest(object: JsonObject, path: string, findings: Findings): DialectManifest {
  const schema = object["$schema"];
  if (schema === undefined) {
    findings.error("manifest-schema-missing", { path });
  } else if (schema !== AGENT_PLUGINS_MANIFEST_SCHEMA) {
    findings.error("manifest-schema-unsupported", { path, detail: describeValue(schema) });
  }
  warnUnknownFields(object, KNOWN_FIELDS, path, findings);
  return {
    dialect: "agent-plugins",
    path,
    identity: readIdentity(object, path, findings),
    skillPaths: [],
    mcpConfigs: [],
    ignored: extensionComponents(object, path, findings),
  };
}
