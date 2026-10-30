/**
 * Parser: TypeDoc JSON → Domain model.
 *
 * Three-phase pipeline:
 *   1. Classify — walk each entry's exports, assign each to a domain and category
 *   2. Parse    — extract hooks, components, interfaces, types with full detail
 *   3. Link     — associate Props/Return interfaces with their hook/component
 */

import * as fs from "node:fs/promises";
import type {
  TypeDocProject,
  Reflection,
  TypeDocType,
  CommentDisplayPart,
  ExternalTarget,
} from "./typedoc-types";
import { ReflectionKind, isExternalTarget } from "./typedoc-types";
import type {
  Domain,
  Hook,
  Component,
  TypeDef,
  Field,
  Param,
  CommentPart,
  TypeRef,
} from "./model";
import {
  serializeType,
  toAnchor,
  flattenCommentParts,
  extractExamples,
} from "./mdx-utils";

// ---------------------------------------------------------------------------
// Domain metadata — display titles and descriptions for each SDK domain.
// This is the only hand-maintained data; everything else comes from TypeDoc.
// ---------------------------------------------------------------------------

const DOMAIN_META: Record<string, { title: string; description: string }> = {
  core: {
    title: "Core",
    description:
      "Provider setup, SDK client access, and deployment mode utilities.",
  },
  session: {
    title: "Session",
    description:
      "Hooks for session lifecycle, message history, conversation state, and usage tracking.",
  },
  run: {
    title: "Run",
    description:
      "Hooks and components for real-time streaming, tool calls, approvals, messages, and the Files a run returns.",
  },
  composer: {
    title: "Composer",
    description:
      "The unified message input with model selection, workspace, and files.",
  },
  agent: {
    title: "Agent",
    description:
      "Hooks and components for agent definitions, search, setup orchestration, and detail views.",
  },
  runner: {
    title: "Runner",
    description:
      "Hooks and components for runner lifecycle, fleet management, local launch, and picker.",
  },
  skill: {
    title: "Skill",
    description:
      "Hooks and components for domain knowledge, search, picker, and detail views.",
  },
  library: {
    title: "Library",
    description:
      "Hooks and components for resource browsing, YAML detection, apply flow, and visibility.",
  },
  vault: {
    title: "Vault",
    description:
      "Hooks and components for My vault and shared vaults, their secrets and logins, the vault picker, and the session value pool.",
  },
  environment: {
    title: "Environment",
    description:
      "Hooks and components for Environments, the packages and network access a conversation's sandbox gets, with which one applies and why, the picker, the fields, the form and the detail view.",
  },
  "connect-link": {
    title: "Connect link",
    description:
      "The page and callback a Connect link's customer signs in through, with no Stigmer account.",
  },
  workspace: {
    title: "Workspace",
    description:
      "Hooks and components for file entries, folder browsing, and code editing.",
  },
  models: {
    title: "Models",
    description: "Hooks and components for model registry data and selector.",
  },
  organization: {
    title: "Organization",
    description:
      "Hooks and components for organization creation and management.",
  },
  grant: {
    title: "Grants",
    description:
      "Who has which role on what, and the gates that read it.",
  },
  access: {
    title: "Manage Access",
    description:
      "The unified Manage access experience — one dialog composing visibility and explicit people-grants, with a kebab hook and a button trigger.",
  },
  "agent-chat": {
    title: "Agent Chat",
    description:
      "The chat as one component, as a page, a docked panel or a corner popup. Also imports from `@stigmer/react-sdk/chat`, the lightest entry.",
  },
  "chat-link": {
    title: "Chat Links",
    description:
      "Hooks and components for an agent's chat links — the chat-link dialog, the chat a link's visitors see, and the web channel draft behind both.",
  },
  "federation-issuer": {
    title: "Federation Issuer",
    description:
      "Hooks and components for registering federation issuers, the outside issuers whose tokens Stigmer accepts.",
  },
  "identity-account": {
    title: "Identity Account",
    description:
      "Hooks for identity account lookup and profile resolution.",
  },
  invitation: {
    title: "Invitation",
    description:
      "Hooks and components for invite link creation, listing, and redemption.",
  },
  "oauth-app": {
    title: "OAuth App",
    description:
      "Hooks and components for OAuth app creation, listing, editing, and deletion.",
  },
  "api-key": {
    title: "API Key",
    description:
      "Hooks and components for API key creation, listing, and deletion.",
  },
  sidebar: {
    title: "Sidebar",
    description:
      "The console's navigation chrome — workspace and settings sidebars that hosts wire to their own router and user menu.",
  },
  "resource-workbench": {
    title: "Resource Workbench",
    description:
      "Layout shell and collection hooks for building resource management consoles.",
  },
  "resource-creation": {
    title: "Resource Creation",
    description:
      "Hooks and components for template-driven resource creation flows.",
  },
  "resource-detail": {
    title: "Resource Detail",
    description:
      "Hooks and components for resource detail views, header chrome, and tab navigation.",
  },
  settings: {
    title: "Settings",
    description:
      "Pre-composed settings sections for organization console embedding.",
  },
  "version-history": {
    title: "Version History",
    description:
      "Components for resource version diffs, timeline, and rollback controls.",
  },
  "dependency-graph": {
    title: "Dependency Graph",
    description:
      "Hooks and components for visualizing agent specification dependencies.",
  },
  dashboard: {
    title: "Dashboard",
    description:
      "Hooks for dashboard metrics, activity feeds, and analytics data.",
  },
  charts: {
    title: "Charts",
    description:
      "Small inline-SVG charts drawn from the theme's chart tokens, each with a screen-reader table of its data.",
  },
  github: {
    title: "GitHub",
    description:
      "Hooks and components for OAuth connection, repository search, and picker.",
  },
  upload: {
    title: "Upload",
    description:
      "Hooks and components for the chat box's uploads as Files and chip display.",
  },
  file: {
    title: "File",
    description:
      "Hooks that read a File by id (its name, type and size) and mint its download link when asked.",
  },
  billing: {
    title: "Billing",
    description:
      "Hooks and components for subscription plans, payment methods, and invoices.",
  },
  usage: {
    title: "Usage",
    description:
      "Hooks and components for organization-level token usage reporting.",
  },
  error: {
    title: "Error",
    description:
      "Components for structured error display and troubleshooting guidance.",
  },
  user: {
    title: "User",
    description:
      "Components for user profile display and account menu embedding.",
  },
  activity: {
    title: "Activity",
    description:
      "Hooks for recent activity feeds and session history.",
  },
  // Excluded domains — metadata kept for completeness
  test: {
    title: "Test",
    description:
      "Sample data factories for unit tests, Storybook, and preview scenarios.",
  },
  "action-menu": {
    title: "Action Menu",
    description:
      "Compound dropdown menu component with keyboard navigation.",
  },
  tabs: {
    title: "Tabs",
    description:
      "Generic tabbed layout primitive.",
  },
  feedback: {
    title: "Feedback",
    description:
      "Toast notification mounting and theming helper.",
  },
  "empty-state": {
    title: "Empty State",
    description:
      "Empty state pattern components with action prompts.",
  },
  "inline-edit": {
    title: "Inline Edit",
    description:
      "Inline editing primitive for text fields and labels.",
  },
  "model-catalog": {
    title: "Model Catalog",
    description:
      "Platform-operator console for the model registry baseline.",
  },
  licenses: {
    title: "Licenses",
    description:
      "Platform-operator console for issuing Stigmer licenses and their renewal calendar.",
  },
  "plan-catalog": {
    title: "Plan Catalog",
    description:
      "Platform-operator console for the Stigmer Cloud plans organizations subscribe to.",
  },
};

// Proto qualified-name → docs/sdk/resources/ slug
const PROTO_TYPE_TO_SLUG: Record<string, string> = {
  Session: "session",
  Agent: "agent",
  Run: "run",
  Vault: "vault",
  Skill: "skill",
  ApiKey: "api-key",
  Organization: "organization",
  Project: "project",
  Grant: "grant",
  IdentityAccount: "identity-account",
  FederationIssuer: "federation-issuer",
};

// Source-path segments that map to non-obvious domain slugs
const SOURCE_PATH_OVERRIDES: Record<string, string> = {
  root: "core",
  internal: "core",
  search: "library",
};

// Domains excluded from generated documentation: internal UI primitives
// and test utilities that are not part of the public SDK surface, plus
// platform-operator-only surfaces — the docs site's audience is Stigmer
// customers, who can never reach those consoles (they are gated on
// platform:stigmer permissions). Operator surfaces are whole modules by
// design (model-catalog, licenses), so exclusion stays
// domain-level: a new operator export lands in an operator module and is
// excluded automatically, with nothing to remember per symbol.
const EXCLUDED_DOMAINS = new Set([
  "test",
  "action-menu",
  "tabs",
  "feedback",
  "empty-state",
  "inline-edit",
  "model-catalog",
  "licenses",
  "plan-catalog",
]);

// Built-in type names that should never get a typeDescriptionLink
const BUILTIN_TYPES = new Set([
  "Error",
  "Promise",
  "Record",
  "Partial",
  "Omit",
  "Pick",
  "Required",
  "Readonly",
  "Array",
  "Map",
  "Set",
  "Date",
  "RegExp",
  "Element",
  "ReactNode",
  "ReactElement",
  "CSSProperties",
  "HTMLAttributes",
  "RefObject",
  "Ref",
]);

/**
 * The import path of each entry sdk/react/typedoc.json documents, by the
 * module name TypeDoc gives it. A name two entries export is declared in one
 * and a reference in the other: the root re-exports everything ./headless
 * does, so ./headless holds only references.
 */
const ENTRY_IMPORT_PATHS: Readonly<Record<string, string>> = {
  index: "@stigmer/react-sdk",
  chat: "@stigmer/react-sdk/chat",
  headless: "@stigmer/react-sdk/headless",
  console: "@stigmer/react-sdk/console",
};
const ROOT_IMPORT_PATH = "@stigmer/react-sdk";
const HEADLESS_MODULE = "headless";

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface ParseResult {
  domains: Domain[];
  warnings: string[];
}

export async function parseTypeDocJson(
  apiJsonPath: string,
): Promise<ParseResult> {
  const raw = await fs.readFile(apiJsonPath, "utf-8");
  const project = JSON.parse(raw) as TypeDocProject;

  const warnings: string[] = [];

  // Phase 1: Index all reflections and classify exports
  const reflectionById = new Map<number, Reflection>();
  indexReflections(project.children, reflectionById);

  // Unwrap the entries' Module containers (kind 2); a single-entry run
  // places the exports at the top level instead.
  const { exports: topLevelExports, headlessIds } = readEntries(project.children);

  const classified = classifyExports(topLevelExports, warnings);

  // Drop excluded domains before parsing
  for (const slug of EXCLUDED_DOMAINS) {
    classified.delete(slug);
  }

  // Build export-name → domain-slug map for link resolution
  const exportDomainMap = new Map<string, string>();
  for (const [domain, items] of classified) {
    for (const r of [
      ...items.hooks,
      ...items.components,
      ...items.interfaces,
      ...items.typeAliases,
      ...items.variables,
    ]) {
      exportDomainMap.set(r.name, domain);
    }
  }

  // Phase 2 + 3: Parse and link each domain
  const domains: Domain[] = [];
  for (const [slug, items] of classified) {
    domains.push(
      parseDomain(slug, items, reflectionById, exportDomainMap, headlessIds, warnings),
    );
  }

  domains.sort((a, b) => a.slug.localeCompare(b.slug));

  return { domains, warnings };
}

// ---------------------------------------------------------------------------
// Phase 1 — Classification
// ---------------------------------------------------------------------------

interface ClassifiedExports {
  /** The entries the domain's exports import from; one, or the page cannot say. */
  importPaths: Set<string>;
  hooks: Reflection[];
  components: Reflection[];
  interfaces: Reflection[];
  typeAliases: Reflection[];
  variables: Reflection[];
}

/** An export with the entry it imports from. */
interface EntryExport {
  reflection: Reflection;
  importPath: string;
}

/**
 * The declared exports of every entry, each with its import path, and the
 * ids of the declarations ./headless re-exports. Throws on an entry this
 * generator does not know, so a new entry in typedoc.json is never
 * documented under the wrong import path.
 */
function readEntries(children: Reflection[]): { exports: EntryExport[]; headlessIds: Set<number> } {
  const exports: EntryExport[] = [];
  const headlessIds = new Set<number>();
  for (const child of children) {
    if (child.kind !== ReflectionKind.Module) {
      exports.push({ reflection: child, importPath: ROOT_IMPORT_PATH });
      continue;
    }
    const importPath = ENTRY_IMPORT_PATHS[child.name];
    if (importPath === undefined) {
      throw new Error(
        `TypeDoc documented an entry named "${child.name}" that ENTRY_IMPORT_PATHS ` +
          `(site/scripts/generate-react-sdk-docs/parser.ts) does not name: add its import path.`,
      );
    }
    for (const reflection of child.children ?? []) {
      if (reflection.kind === ReflectionKind.Reference) {
        if (child.name === HEADLESS_MODULE && reflection.target !== undefined) headlessIds.add(reflection.target);
        continue;
      }
      exports.push({ reflection, importPath });
    }
  }
  return { exports, headlessIds };
}

function indexReflections(
  reflections: Reflection[],
  map: Map<number, Reflection>,
): void {
  for (const r of reflections) {
    if (map.has(r.id)) continue;
    map.set(r.id, r);
    if (r.children) indexReflections(r.children, map);
    if (r.signatures) indexReflections(r.signatures, map);
    if (r.parameters) indexReflections(r.parameters, map);
  }
}

function classifyExports(
  children: EntryExport[],
  warnings: string[],
): Map<string, ClassifiedExports> {
  const result = new Map<string, ClassifiedExports>();

  for (const { reflection: child, importPath } of children) {
    const domain = getDomain(child);
    if (domain === "external") continue;

    if (!result.has(domain)) {
      result.set(domain, {
        importPaths: new Set(),
        hooks: [],
        components: [],
        interfaces: [],
        typeAliases: [],
        variables: [],
      });
    }
    const bucket = result.get(domain)!;
    bucket.importPaths.add(importPath);

    switch (child.kind) {
      case ReflectionKind.Function:
        if (child.name.startsWith("use")) {
          bucket.hooks.push(child);
        } else if (/^[A-Z]/.test(child.name)) {
          bucket.components.push(child);
        } else {
          // camelCase non-hook function (utility)
          bucket.variables.push(child);
        }
        break;
      case ReflectionKind.Interface:
        bucket.interfaces.push(child);
        break;
      case ReflectionKind.TypeAlias:
        bucket.typeAliases.push(child);
        break;
      case ReflectionKind.Variable:
        bucket.variables.push(child);
        break;
      case 8: // Enum — re-exported proto enums, skip silently
      case 16: // EnumMember
        break;
      default:
        warnings.push(
          `Skipped export with unhandled kind ${child.kind}: ${child.name}`,
        );
    }
  }

  return result;
}

function getDomain(reflection: Reflection): string {
  const fileName = reflection.sources?.[0]?.fileName ?? "";

  // Monorepo-relative paths: sdk/react/src/session/useSession.ts
  const sdkSrcPrefix = "sdk/react/src/";
  const prefixIdx = fileName.indexOf(sdkSrcPrefix);
  if (prefixIdx >= 0) {
    const relative = fileName.substring(prefixIdx + sdkSrcPrefix.length);
    return domainFromRelativePath(relative);
  }

  // Src-relative paths: session/useSession.ts (older TypeDoc config)
  const srcIdx = fileName.indexOf("src/");
  if (srcIdx >= 0) {
    const relative = fileName.substring(srcIdx + 4);
    return domainFromRelativePath(relative);
  }

  // No sources or outside sdk/react/src/ — re-exported external type
  return "external";
}

function domainFromRelativePath(relative: string): string {
  const slashIdx = relative.indexOf("/");
  if (slashIdx === -1) {
    return SOURCE_PATH_OVERRIDES["root"] ?? "core";
  }
  const segment = relative.substring(0, slashIdx);
  return SOURCE_PATH_OVERRIDES[segment] ?? segment;
}

// ---------------------------------------------------------------------------
// Phase 2 — Parsing
// ---------------------------------------------------------------------------

function parseDomain(
  slug: string,
  items: ClassifiedExports,
  reflectionById: Map<number, Reflection>,
  exportDomainMap: Map<string, string>,
  headlessIds: Set<number>,
  warnings: string[],
): Domain {
  const meta = DOMAIN_META[slug] ?? { title: slug, description: "" };
  if (items.importPaths.size !== 1) {
    throw new Error(
      `The ${slug} domain's exports import from ${[...items.importPaths].join(" and ")}: ` +
        `a page names one entry, so the domain's folder belongs to one.`,
    );
  }
  const [importPath] = items.importPaths;

  // The page's hooks and helpers that ./headless also exports; a domain with
  // none of them says nothing about it. Its components are never there, and a
  // component a `memo` or `forwardRef` wraps is a variable, so a PascalCase
  // variable counts as one unless it is a context.
  const isComponent = (name: string) => /^[A-Z]/.test(name) && !/^[A-Z0-9_]+$/.test(name) && !name.endsWith("Context");
  const behaviour = [...items.hooks, ...items.variables.filter((r) => !isComponent(r.name))];
  const headless = behaviour.some((r) => headlessIds.has(r.id))
    ? {
        rootOnly: behaviour
          .filter((r) => !headlessIds.has(r.id))
          .map((r) => r.name)
          .sort((a, b) => a.localeCompare(b)),
      }
    : null;

  const hooks = items.hooks
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((r) => parseHook(r, slug, reflectionById, exportDomainMap));

  const components = items.components
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((r) => parseComponent(r, slug, reflectionById, exportDomainMap));

  // Parse all type-level exports
  const allTypes: TypeDef[] = [
    ...items.interfaces.map((r) =>
      parseInterface(r, slug, reflectionById, exportDomainMap),
    ),
    ...items.typeAliases.map((r) =>
      parseTypeAlias(r, slug, reflectionById, exportDomainMap),
    ),
    ...items.variables.map((r) =>
      parseVariable(r, slug, reflectionById, exportDomainMap),
    ),
  ];

  // Phase 3: Link associated types
  linkAssociatedTypes(hooks, components, allTypes, warnings);

  const standaloneTypes = allTypes
    .filter((t) => t.associatedExport === null)
    .sort((a, b) => a.name.localeCompare(b.name));

  return {
    slug,
    title: meta.title,
    description: meta.description,
    importPath,
    headless,
    hooks,
    components,
    types: standaloneTypes,
  };
}

function parseHook(
  reflection: Reflection,
  currentDomain: string,
  reflectionById: Map<number, Reflection>,
  exportDomainMap: Map<string, string>,
): Hook {
  const sig = reflection.signatures?.[0];
  const comment = sig?.comment;

  const description = comment?.summary
    ? convertCommentParts(
        comment.summary,
        reflectionById,
        exportDomainMap,
        currentDomain,
      )
    : [];

  const parameters: Param[] = (sig?.parameters ?? []).map((p) => ({
    name: p.name === "__namedParameters" ? "options" : p.name,
    typeString: p.type ? serializeType(p.type) : "unknown",
    description: flattenCommentParts(p.comment?.summary),
    required: !p.flags.isOptional,
  }));

  return {
    name: reflection.name,
    description,
    parameters,
    returnType: extractReturnType(sig?.type),
    returnInterface: null,
    examples: extractExamples(comment),
    sourceUrl: reflection.sources?.[0]?.url ?? "",
  };
}

function parseComponent(
  reflection: Reflection,
  currentDomain: string,
  reflectionById: Map<number, Reflection>,
  exportDomainMap: Map<string, string>,
): Component {
  const sig = reflection.signatures?.[0];
  const comment = sig?.comment;
  const hasProps = (sig?.parameters?.length ?? 0) > 0;

  return {
    name: reflection.name,
    description: comment?.summary
      ? convertCommentParts(
          comment.summary,
          reflectionById,
          exportDomainMap,
          currentDomain,
        )
      : [],
    hasProps,
    propsInterface: null,
    examples: extractExamples(comment),
    sourceUrl: reflection.sources?.[0]?.url ?? "",
  };
}

function parseInterface(
  reflection: Reflection,
  currentDomain: string,
  reflectionById: Map<number, Reflection>,
  exportDomainMap: Map<string, string>,
): TypeDef {
  const category = categorizeInterface(reflection.name);

  const fields: Field[] = (reflection.children ?? [])
    .filter((c) => c.kind === ReflectionKind.Property)
    .map((c) =>
      parseField(c, category, currentDomain, reflectionById, exportDomainMap),
    );

  return {
    name: reflection.name,
    description: reflection.comment?.summary
      ? convertCommentParts(
          reflection.comment.summary,
          reflectionById,
          exportDomainMap,
          currentDomain,
        )
      : [],
    category,
    fields,
    associatedExport: null,
    signature: null,
    examples: extractExamples(reflection.comment),
  };
}

function parseTypeAlias(
  reflection: Reflection,
  currentDomain: string,
  reflectionById: Map<number, Reflection>,
  exportDomainMap: Map<string, string>,
): TypeDef {
  // Object-shaped type aliases may have fields
  const fields: Field[] = [];
  if (
    reflection.type?.type === "reflection" &&
    reflection.type.declaration.children
  ) {
    for (const c of reflection.type.declaration.children) {
      fields.push(
        parseField(c, "other", currentDomain, reflectionById, exportDomainMap),
      );
    }
  }

  return {
    name: reflection.name,
    description: reflection.comment?.summary
      ? convertCommentParts(
          reflection.comment.summary,
          reflectionById,
          exportDomainMap,
          currentDomain,
        )
      : [],
    category: "other",
    fields,
    associatedExport: null,
    signature: null,
    examples: extractExamples(reflection.comment),
  };
}

function parseVariable(
  reflection: Reflection,
  currentDomain: string,
  reflectionById: Map<number, Reflection>,
  exportDomainMap: Map<string, string>,
): TypeDef {
  // Utility functions come through this path (camelCase kind-64 exports).
  // Build a signature string if the reflection has call signatures.
  let signature: string | null = null;
  let description: CommentPart[] = [];

  if (reflection.signatures && reflection.signatures.length > 0) {
    const sig = reflection.signatures[0];
    const params = (sig.parameters ?? [])
      .map((p) => {
        const pName = p.name === "__namedParameters" ? "options" : p.name;
        const opt = p.flags.isOptional ? "?" : "";
        const pType = p.type ? serializeType(p.type) : "unknown";
        return `${pName}${opt}: ${pType}`;
      })
      .join(", ");
    const ret = sig.type ? serializeType(sig.type) : "void";
    signature = `function ${reflection.name}(${params}): ${ret}`;

    description = sig.comment?.summary
      ? convertCommentParts(
          sig.comment.summary,
          reflectionById,
          exportDomainMap,
          currentDomain,
        )
      : [];
  } else {
    description = reflection.comment?.summary
      ? convertCommentParts(
          reflection.comment.summary,
          reflectionById,
          exportDomainMap,
          currentDomain,
        )
      : [];
  }

  const varComment = reflection.signatures?.[0]?.comment ?? reflection.comment;

  return {
    name: reflection.name,
    description,
    category: "other",
    fields: [],
    associatedExport: null,
    signature,
    examples: extractExamples(varComment),
  };
}

function parseField(
  reflection: Reflection,
  parentCategory: "props" | "return" | "other",
  currentDomain: string,
  reflectionById: Map<number, Reflection>,
  exportDomainMap: Map<string, string>,
): Field {
  const fieldType = reflection.type;
  return {
    name: reflection.name,
    typeString: fieldType ? serializeType(fieldType) : "unknown",
    description: flattenCommentParts(reflection.comment?.summary),
    required: parentCategory === "return" ? false : !reflection.flags.isOptional,
    typeLink: fieldType
      ? resolveTypeLink(fieldType, exportDomainMap, currentDomain)
      : null,
  };
}

// ---------------------------------------------------------------------------
// Phase 3 — Linking
// ---------------------------------------------------------------------------

function linkAssociatedTypes(
  hooks: Hook[],
  components: Component[],
  allTypes: TypeDef[],
  warnings: string[],
): void {
  const typesByName = new Map<string, TypeDef>();
  for (const t of allTypes) typesByName.set(t.name, t);

  // Link return interfaces → hooks
  for (const hook of hooks) {
    const def = typesByName.get(hook.returnType.name);
    if (def && def.category === "return") {
      hook.returnInterface = def;
      def.associatedExport = hook.name;
    }
  }

  // Link props interfaces → components
  for (const component of components) {
    const propsName = `${component.name}Props`;
    const def = typesByName.get(propsName);
    if (def) {
      component.propsInterface = def;
      def.associatedExport = component.name;
    } else if (component.hasProps) {
      warnings.push(`Component ${component.name} has no props interface`);
    }
  }

  // Warn about hooks without descriptions
  for (const hook of hooks) {
    if (hook.description.length === 0) {
      warnings.push(`Hook ${hook.name} has no description`);
    }
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function categorizeInterface(name: string): "props" | "return" | "other" {
  if (name.endsWith("Props")) return "props";
  if (/^Use\w+Return$/.test(name)) return "return";
  return "other";
}

function extractReturnType(type: TypeDocType | undefined): TypeRef {
  if (!type) return { name: "void", typeString: "void" };
  return {
    name: type.type === "reference" ? type.name : serializeType(type),
    typeString: serializeType(type),
  };
}

function convertCommentParts(
  parts: CommentDisplayPart[],
  reflectionById: Map<number, Reflection>,
  exportDomainMap: Map<string, string>,
  currentDomain: string,
): CommentPart[] {
  return parts.map((part) => {
    switch (part.kind) {
      case "text":
        return { kind: "text" as const, text: part.text };
      case "code":
        return { kind: "code" as const, text: part.text };
      case "inline-tag": {
        if (part.tag === "@link") {
          const target = resolveLinkTarget(
            part.target,
            reflectionById,
            exportDomainMap,
            currentDomain,
          );
          return { kind: "link" as const, text: part.text, target };
        }
        return { kind: "text" as const, text: part.text };
      }
      default:
        return { kind: "text" as const, text: part.text };
    }
  });
}

function resolveLinkTarget(
  target: number | ExternalTarget | undefined,
  reflectionById: Map<number, Reflection>,
  exportDomainMap: Map<string, string>,
  currentDomain: string,
): string | null {
  if (target === undefined) return null;

  if (typeof target === "number") {
    const ref = reflectionById.get(target);
    if (!ref) return null;
    const domain = exportDomainMap.get(ref.name);
    if (!domain) return null;
    if (domain === currentDomain) return `#${toAnchor(ref.name)}`;
    return `/docs/sdk/react/${domain}#${toAnchor(ref.name)}`;
  }

  if (isExternalTarget(target)) {
    if (target.packageName === "@stigmer/apis") {
      const slug = mapProtoToResourceSlug(target.qualifiedName);
      if (slug) return `/docs/sdk/resources/${slug}`;
    }
  }

  return null;
}

function resolveTypeLink(
  type: TypeDocType,
  exportDomainMap: Map<string, string>,
  currentDomain: string,
): string | null {
  if (type.type !== "reference") return null;
  if (BUILTIN_TYPES.has(type.name)) return null;

  const domain = exportDomainMap.get(type.name);
  if (domain) {
    if (domain === currentDomain) return `#${toAnchor(type.name)}`;
    return `/docs/sdk/react/${domain}#${toAnchor(type.name)}`;
  }

  if (isExternalTarget(type.target) && type.target.packageName === "@stigmer/apis") {
    const slug = mapProtoToResourceSlug(type.target.qualifiedName);
    if (slug) return `/docs/sdk/resources/${slug}`;
  }

  return null;
}

function mapProtoToResourceSlug(qualifiedName: string): string | null {
  const rootName = qualifiedName.split(".")[0];
  return PROTO_TYPE_TO_SLUG[rootName] ?? null;
}
