/**
 * Parser: TypeDoc JSON → Domain model.
 *
 * Three-phase pipeline:
 *   1. Classify — walk project children, assign each to a domain and category
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
  session: {
    title: "Session",
    description:
      "Hooks for session lifecycle, message history, conversation state, and usage tracking.",
  },
  execution: {
    title: "Execution",
    description:
      "Hooks and components for real-time streaming, tool calls, approvals, messages, and artifacts.",
  },
  agent: {
    title: "Agent",
    description:
      "Hooks and components for agent definitions, search, setup orchestration, and detail views.",
  },
  "agent-instance": {
    title: "Agent Instance",
    description:
      "Hooks for deployed agent instances bound to an environment.",
  },
  "mcp-server": {
    title: "MCP Server",
    description:
      "Hooks and components for MCP server connections, setup, credentials, and tool management.",
  },
  skill: {
    title: "Skill",
    description:
      "Hooks and components for knowledge attachments, search, picker, and detail views.",
  },
  environment: {
    title: "Environment",
    description:
      "Hooks and components for configuration, variables, secrets, and session environment pools.",
  },
  composer: {
    title: "Composer",
    description:
      "The unified message input with model selection, workspace, and attachments.",
  },
  workspace: {
    title: "Workspace",
    description:
      "Hooks and components for file entries, folder browsing, and code editing.",
  },
  "api-key": {
    title: "API Key",
    description:
      "Hooks and components for API key creation, listing, and deletion.",
  },
  attachment: {
    title: "Attachment",
    description:
      "Hooks and components for file upload handling and chip display.",
  },
  organization: {
    title: "Organization",
    description: "Hooks and components for organization creation.",
  },
  github: {
    title: "GitHub",
    description:
      "Hooks and components for OAuth connection, repository search, and picker.",
  },
  library: {
    title: "Library",
    description:
      "Hooks and components for resource browsing, YAML detection, apply flow, and visibility.",
  },
  models: {
    title: "Models",
    description: "Hooks and components for model registry data and selector.",
  },
  core: {
    title: "Core",
    description:
      "Provider setup, SDK client access, and deployment mode utilities.",
  },
  error: {
    title: "Error",
    description:
      "Components for structured error display and troubleshooting guidance.",
  },
  "oauth-app": {
    title: "OAuth App",
    description:
      "Hooks and components for OAuth app creation, listing, editing, and deletion.",
  },
  "iam-policy": {
    title: "IAM Policy",
    description:
      "Hooks and components for access control bindings, role assignment, and org membership.",
  },
  "identity-provider": {
    title: "Identity Provider",
    description:
      "Hooks and components for federated identity provider setup and management.",
  },
  invitation: {
    title: "Invitation",
    description:
      "Hooks and components for invite link creation, listing, and redemption.",
  },
  usage: {
    title: "Usage",
    description:
      "Hooks and components for organization-level usage reporting and cost breakdown.",
  },
};

// Proto qualified-name → docs/sdk/resources/ slug
const PROTO_TYPE_TO_SLUG: Record<string, string> = {
  Session: "session",
  Agent: "agent",
  AgentExecution: "agent-execution",
  AgentInstance: "agent-instance",
  Workflow: "workflow",
  WorkflowExecution: "workflow-execution",
  WorkflowInstance: "workflow-instance",
  Environment: "environment",
  McpServer: "mcp-server",
  Skill: "skill",
  ApiKey: "api-key",
  Organization: "organization",
  Project: "project",
  IamPolicy: "iam-policy",
  IdentityAccount: "identity-account",
  IdentityProvider: "identity-provider",
  ExecutionContext: "execution-context",
};

// Source-path segments that map to non-obvious domain slugs
const SOURCE_PATH_OVERRIDES: Record<string, string> = {
  root: "core",
  internal: "core",
  search: "library",
};

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

  const classified = classifyExports(project.children, warnings);

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
      parseDomain(slug, items, reflectionById, exportDomainMap, warnings),
    );
  }

  domains.sort((a, b) => a.slug.localeCompare(b.slug));

  return { domains, warnings };
}

// ---------------------------------------------------------------------------
// Phase 1 — Classification
// ---------------------------------------------------------------------------

interface ClassifiedExports {
  hooks: Reflection[];
  components: Reflection[];
  interfaces: Reflection[];
  typeAliases: Reflection[];
  variables: Reflection[];
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
  children: Reflection[],
  warnings: string[],
): Map<string, ClassifiedExports> {
  const result = new Map<string, ClassifiedExports>();

  for (const child of children) {
    const domain = getDomain(child);
    if (domain === "external") continue;

    if (!result.has(domain)) {
      result.set(domain, {
        hooks: [],
        components: [],
        interfaces: [],
        typeAliases: [],
        variables: [],
      });
    }
    const bucket = result.get(domain)!;

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
  warnings: string[],
): Domain {
  const meta = DOMAIN_META[slug] ?? { title: slug, description: "" };

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
    if (target.packageName === "@stigmer/protos") {
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

  if (isExternalTarget(type.target) && type.target.packageName === "@stigmer/protos") {
    const slug = mapProtoToResourceSlug(type.target.qualifiedName);
    if (slug) return `/docs/sdk/resources/${slug}`;
  }

  return null;
}

function mapProtoToResourceSlug(qualifiedName: string): string | null {
  const rootName = qualifiedName.split(".")[0];
  return PROTO_TYPE_TO_SLUG[rootName] ?? null;
}
