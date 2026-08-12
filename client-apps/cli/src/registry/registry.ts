// The type registry: the single source of truth that maps user-facing resource
// identifiers (aliases, YAML kinds) to proto kinds and their supported verbs.
// Built once from the declarative kind-metadata table with aliases derived
// algorithmically. (Structure inherited from the Go CLI's types.Registry,
// removed in the TypeScript migration — stigmer/stigmer#203.)

import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { generateAliases, normalizeAlias } from "./aliases.js";
import { CLI_RELEVANT_KINDS, KIND_META } from "./metadata.js";
import { Verb } from "./verbs.js";
import { verbsForKind } from "./verb-support.js";

/** CLI metadata for a single resource type. */
export interface TypeInfo {
  /** Proto enum value this type maps to. */
  readonly kind: ApiResourceKind;
  /** Kind name (also the YAML `kind` value), e.g. "McpServer". */
  readonly name: string;
  /** Human-readable name, e.g. "MCP Server". */
  readonly displayName: string;
  /** ID prefix, e.g. "mcp". */
  readonly idPrefix: string;
  /** Canonical singular form (lowercase name), e.g. "mcpserver". */
  readonly singular: string;
  /** Plural form for list commands, e.g. "mcpservers". */
  readonly plural: string;
  /** All accepted input spellings (case-insensitive on lookup). */
  readonly aliases: readonly string[];
  /** Verbs this type supports. */
  readonly supportedVerbs: ReadonlySet<Verb>;
}

export function supportsVerb(info: TypeInfo, verb: Verb): boolean {
  return info.supportedVerbs.has(verb);
}

export interface Registry {
  /** Look up a type by its proto kind. */
  getByKind(kind: ApiResourceKind): TypeInfo | undefined;
  /** Look up a type by any alias (case-insensitive). */
  getByAlias(input: string): TypeInfo | undefined;
  /** Look up a type by its exact YAML kind string. */
  getByYamlKind(yamlKind: string): TypeInfo | undefined;
  /** All registered CLI-relevant types, in declaration order. */
  all(): readonly TypeInfo[];
  /** Whether a kind supports a verb. */
  supportsVerb(kind: ApiResourceKind, verb: Verb): boolean;
  /** All types supporting a given verb, in declaration order. */
  typesForVerb(verb: Verb): readonly TypeInfo[];
}

function buildTypeInfo(kind: ApiResourceKind): TypeInfo | undefined {
  const meta = KIND_META.get(kind);
  if (meta === undefined) return undefined;

  const singular = meta.name.toLowerCase();
  return {
    kind,
    name: meta.name,
    displayName: meta.displayName,
    idPrefix: meta.idPrefix,
    singular,
    plural: singular.endsWith("s") ? singular : `${singular}s`,
    // ApiResourceKind[kind] reverse-maps to the proto enum value name (e.g.
    // "oauth_app") — the canonical spelling, taken from the enum itself so it
    // can never drift from the proto.
    aliases: generateAliases(meta.name, meta.displayName, meta.idPrefix, ApiResourceKind[kind]),
    supportedVerbs: verbsForKind(kind),
  };
}

function buildRegistry(): Registry {
  const byKind = new Map<ApiResourceKind, TypeInfo>();
  const byAlias = new Map<string, TypeInfo>();
  const byYamlKind = new Map<string, TypeInfo>();
  const all: TypeInfo[] = [];

  for (const kind of CLI_RELEVANT_KINDS) {
    const info = buildTypeInfo(kind);
    if (info === undefined) continue;
    byKind.set(kind, info);
    byYamlKind.set(info.name, info);
    all.push(info);
    for (const alias of info.aliases) {
      byAlias.set(normalizeAlias(alias), info);
    }
  }

  return {
    getByKind: (kind) => byKind.get(kind),
    getByAlias: (input) => byAlias.get(normalizeAlias(input)),
    getByYamlKind: (yamlKind) => byYamlKind.get(yamlKind),
    all: () => all,
    supportsVerb: (kind, verb) => byKind.get(kind)?.supportedVerbs.has(verb) ?? false,
    typesForVerb: (verb) => all.filter((info) => info.supportedVerbs.has(verb)),
  };
}

let cached: Registry | undefined;

/** The process-wide registry singleton, built lazily on first use. */
export function defaultRegistry(): Registry {
  if (cached === undefined) cached = buildRegistry();
  return cached;
}
