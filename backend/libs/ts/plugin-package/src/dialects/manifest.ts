/**
 * The intermediate every dialect reader reduces its manifest to, and the
 * field-reading helpers they share.
 *
 * A `DialectManifest` says what one manifest CONTRIBUTES: identity fields,
 * declared component paths, MCP configuration sources, a variables block,
 * and the fields it carries that Stigmer records as ignored. It does not
 * decide anything across manifests: precedence, name conflicts and default
 * locations are `detect.ts`'s, and turning declarations into skills,
 * servers and variables is `normalise/`'s. Keeping the readers to "what
 * does this file say" is what lets a plugin carry a root manifest and a
 * vendor manifest at once and have both read.
 *
 * Unknown fields WARN in every dialect (the open format says report and
 * ignore; Cursor's own validator would reject them, but a warning serves
 * the author and the install still works). A known field of the wrong type
 * is fatal (`manifest-field-type`), the open format's rule for any
 * violation other than an unknown field.
 */

import { fields, isJsonObject, type JsonObject, optionalString, optionalStringArray, stringOrStringArray } from "../documents.js";
import { resolveDeclaredPath } from "../files.js";
import type { Findings } from "../messages.js";
import type { IgnoredComponent, IgnoredComponentKind, PluginAuthor, PluginDialect } from "../types.js";

export interface PluginIdentity {
  readonly name?: string;
  readonly version?: string;
  readonly description?: string;
  readonly author?: PluginAuthor;
  readonly homepage?: string;
  readonly repository?: string;
  readonly license?: string;
  readonly keywords?: readonly string[];
}

/** A component path a manifest declared, normalised, with where it was declared. */
export interface DeclaredPath {
  /** Plugin-relative, no leading `./`, no trailing slash; the root is `""`. */
  readonly path: string;
  /** The manifest that declared it, for messages. */
  readonly manifest: string;
}

/** Where MCP server entries come from: a configuration file, or an object inline in a manifest. */
export type McpConfigSource =
  | { readonly kind: "file"; readonly path: string; readonly dialect: PluginDialect; readonly manifest: string }
  | { readonly kind: "inline"; readonly manifest: string; readonly servers: unknown; readonly dialect: PluginDialect };

/** A variables block, raw, tagged with the dialect whose shape it takes. */
export type VariablesDeclaration =
  | { readonly dialect: "cursor"; readonly value: unknown; readonly manifest: string }
  | { readonly dialect: "claude"; readonly value: unknown; readonly manifest: string };

export interface DialectManifest {
  readonly dialect: PluginDialect;
  readonly path: string;
  readonly identity: PluginIdentity;
  /** Declared skill paths; the default `skills/` is scanned regardless. */
  readonly skillPaths: readonly DeclaredPath[];
  /** Declared agent paths; `undefined` leaves the default `agents/` scan in force. */
  readonly agentPaths?: readonly DeclaredPath[];
  readonly mcpConfigs: readonly McpConfigSource[];
  readonly variables?: VariablesDeclaration;
  readonly ignored: readonly IgnoredComponent[];
}

/** Warn once per field the dialect does not define. */
export function warnUnknownFields(object: JsonObject, known: ReadonlySet<string>, path: string, findings: Findings): void {
  for (const [name] of fields(object)) {
    if (!known.has(name)) findings.warn("manifest-field-unknown", { path, subject: name });
  }
}

/**
 * The identity fields every dialect shares. `author` is an object in every
 * dialect (Cursor's schema has no `url`; the extra key is a warning there,
 * reported by the caller's known-field set for `author`).
 */
export function readIdentity(object: JsonObject, path: string, findings: Findings): PluginIdentity {
  const identity: { -readonly [K in keyof PluginIdentity]: PluginIdentity[K] } = {};
  const name = optionalString(object, "name", path, findings);
  if (name !== undefined) identity.name = name;
  const version = optionalString(object, "version", path, findings);
  if (version !== undefined) identity.version = version;
  const description = optionalString(object, "description", path, findings);
  if (description !== undefined) identity.description = description;
  const homepage = optionalString(object, "homepage", path, findings);
  if (homepage !== undefined) identity.homepage = homepage;
  const repository = optionalString(object, "repository", path, findings);
  if (repository !== undefined) identity.repository = repository;
  const license = optionalString(object, "license", path, findings);
  if (license !== undefined) identity.license = license;
  const keywords = optionalStringArray(object, "keywords", path, findings);
  if (keywords !== undefined) identity.keywords = keywords;
  const author = readAuthor(object, path, findings);
  if (author !== undefined) identity.author = author;
  return identity;
}

function readAuthor(object: JsonObject, path: string, findings: Findings): PluginAuthor | undefined {
  const value = object["author"];
  if (value === undefined) return undefined;
  if (!isJsonObject(value)) {
    findings.error("manifest-field-type", { path, subject: "author", detail: "an object" });
    return undefined;
  }
  const author: { -readonly [K in keyof PluginAuthor]: PluginAuthor[K] } = {};
  const name = optionalString(value, "name", path, findings);
  if (name !== undefined) author.name = name;
  const email = optionalString(value, "email", path, findings);
  if (email !== undefined) author.email = email;
  const url = optionalString(value, "url", path, findings);
  if (url !== undefined) author.url = url;
  return author;
}

/**
 * A path field (`skills`, `agents`, ...) as declared paths. A value that is
 * not a path (wrong prefix, escape, glob) is reported and dropped; the
 * rest are kept, so one bad entry does not hide the others.
 */
export function readDeclaredPaths(
  object: JsonObject,
  field: string,
  path: string,
  findings: Findings,
): readonly DeclaredPath[] | undefined {
  const values = stringOrStringArray(object, field, path, findings);
  if (values === undefined) return undefined;
  const declared: DeclaredPath[] = [];
  for (const value of values) {
    const resolved = resolveDeclaredPath(value);
    if (!resolved.ok) {
      findings.error(resolved.kind, { path, subject: value });
      continue;
    }
    declared.push({ path: resolved.path, manifest: path });
  }
  return declared;
}

/**
 * A vendor `mcpServers` field: a path, an inline `mcpServers` object, or an
 * array of either. Each becomes one source under the dialect's rules.
 */
export function readMcpSources(
  object: JsonObject,
  field: string,
  path: string,
  dialect: PluginDialect,
  findings: Findings,
): readonly McpConfigSource[] {
  const value = object[field];
  if (value === undefined) return [];
  const items = Array.isArray(value) ? value : [value];
  const sources: McpConfigSource[] = [];
  for (const item of items) {
    if (typeof item === "string") {
      const resolved = resolveDeclaredPath(item);
      if (!resolved.ok) {
        findings.error(resolved.kind, { path, subject: item });
        continue;
      }
      sources.push({ kind: "file", path: resolved.path, dialect, manifest: path });
    } else if (isJsonObject(item)) {
      sources.push({ kind: "inline", manifest: path, servers: item, dialect });
    } else {
      findings.error("manifest-field-type", { path, subject: field, detail: "a path, an object, or an array of either" });
    }
  }
  return sources;
}

/**
 * Manifest fields Stigmer reads past, recorded as ignored components at
 * `<manifest>#<field>` when present. Shared across dialects; each names the
 * fields it knows through `known` so the same field is never also an
 * unknown-field warning.
 */
export const IGNORED_FIELD_KINDS: Readonly<Record<string, IgnoredComponentKind>> = {
  hooks: "hooks",
  rules: "rules",
  commands: "commands",
  workflows: "workflows",
  outputStyles: "output-styles",
  lspServers: "lsp-servers",
  channels: "channels",
  dependencies: "dependencies",
  defaultEnabled: "default-enabled",
  minClientVersions: "min-client-versions",
  logo: "logo",
  apps: "apps",
};

export function ignoredFieldComponents(object: JsonObject, path: string): IgnoredComponent[] {
  const ignored: IgnoredComponent[] = [];
  for (const [name, value] of fields(object)) {
    const kind = IGNORED_FIELD_KINDS[name];
    if (kind !== undefined) ignored.push({ kind, path: `${path}#${name}` });
    if (name === "experimental" && isJsonObject(value)) {
      for (const [sub] of fields(value)) {
        const subKind = EXPERIMENTAL_KINDS[sub];
        if (subKind !== undefined) ignored.push({ kind: subKind, path: `${path}#experimental.${sub}` });
      }
    }
  }
  return ignored;
}

const EXPERIMENTAL_KINDS: Readonly<Record<string, IgnoredComponentKind>> = {
  themes: "themes",
  monitors: "monitors",
  evals: "evals",
};

/**
 * `extensions` in a root manifest: every namespace with content is an
 * ignored component (a client ignores namespaces it does not implement
 * without validating them); an empty object, including Stigmer's own
 * reserved `ai.stigmer`, is silent. A non-object `extensions` is the open
 * format's one non-fatal type violation: reported and ignored.
 */
export function extensionComponents(object: JsonObject, path: string, findings: Findings): IgnoredComponent[] {
  const value = object["extensions"];
  if (value === undefined) return [];
  if (!isJsonObject(value)) {
    findings.warn("manifest-extensions-invalid", { path });
    return [];
  }
  const ignored: IgnoredComponent[] = [];
  for (const [namespace, content] of fields(value)) {
    if (isJsonObject(content) && fields(content).length === 0) continue;
    ignored.push({ kind: "extension", path: `${path}#extensions.${namespace}` });
  }
  return ignored;
}
