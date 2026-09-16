/**
 * The Cursor manifest (`.cursor-plugin/plugin.json`).
 *
 * Cursor publishes a draft-07 schema for this file (`additionalProperties:
 * false`, only `name` required); the known-field set below is that schema's
 * key list, and `author` there carries `name` and `email` only. Component
 * fields `skills`, `agents`, `rules`, `commands` are a path or an array of
 * paths (the schema says "glob pattern(s) or path(s)"; every published
 * plugin uses a `./`-prefixed directory, and a glob is refused rather than
 * expanded). `mcpServers` is a path, an inline object, or an array of
 * either. `variables` is a JSON Schema object whose `properties` are the
 * variables a user is prompted for and whose `required` list marks the
 * mandatory ones; Cursor has no sensitivity flag, so Stigmer treats every
 * Cursor variable as a secret. `rules`, `commands`, `hooks`, `logo` and
 * `minClientVersions` are recorded as ignored; `displayName`, `publisher`,
 * `category` and `tags` are marketplace metadata Stigmer neither carries
 * nor warns about.
 */

import type { JsonObject } from "../documents.js";
import type { Findings } from "../messages.js";
import {
  type DialectManifest,
  ignoredFieldComponents,
  readDeclaredPaths,
  readIdentity,
  readMcpSources,
  warnUnknownFields,
} from "./manifest.js";

const KNOWN_FIELDS: ReadonlySet<string> = new Set([
  "name",
  "displayName",
  "description",
  "version",
  "minClientVersions",
  "author",
  "publisher",
  "homepage",
  "repository",
  "license",
  "logo",
  "keywords",
  "category",
  "tags",
  "commands",
  "agents",
  "skills",
  "rules",
  "hooks",
  "variables",
  "mcpServers",
]);

export function readCursorManifest(object: JsonObject, path: string, findings: Findings): DialectManifest {
  warnUnknownFields(object, KNOWN_FIELDS, path, findings);
  const identity = readIdentity(object, path, findings);
  const skillPaths = readDeclaredPaths(object, "skills", path, findings) ?? [];
  const agentPaths = readDeclaredPaths(object, "agents", path, findings);
  const manifest: { -readonly [K in keyof DialectManifest]: DialectManifest[K] } = {
    dialect: "cursor",
    path,
    identity,
    skillPaths,
    mcpConfigs: readMcpSources(object, "mcpServers", path, "cursor", findings),
    ignored: ignoredFieldComponents(object, path),
  };
  if (agentPaths !== undefined) manifest.agentPaths = agentPaths;
  if (object["variables"] !== undefined) {
    manifest.variables = { dialect: "cursor", value: object["variables"], manifest: path };
  }
  return manifest;
}
