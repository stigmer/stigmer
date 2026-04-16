/**
 * Parser: TypeDoc JSON → Ink SDK reference model.
 *
 * Unlike the React SDK parser which splits exports into domains,
 * the Ink parser classifies exports into four categories on a single page:
 *   Provider & Transport → Components → Composed Views → Utilities
 */

import * as fs from "node:fs/promises";
import type { TypeDocProject, Reflection, TypeDocType, CommentDisplayPart } from "./typedoc-types";
import { ReflectionKind, isExternalTarget } from "./typedoc-types";
import {
  serializeType,
  flattenCommentParts,
  extractExamples,
} from "../generate-react-sdk-docs/mdx-utils";
import type { CommentPart, Field } from "../generate-react-sdk-docs/model";

// ---------------------------------------------------------------------------
// Ink-specific model
// ---------------------------------------------------------------------------

export type InkCategory = "provider" | "transport" | "component" | "composedView" | "utility";

export interface InkExport {
  name: string;
  category: InkCategory;
  description: CommentPart[];
  propsInterface: InkPropsInterface | null;
  examples: string[];
  sourceUrl: string;
  isReExport: boolean;
}

export interface InkPropsInterface {
  name: string;
  description: CommentPart[];
  fields: Field[];
}

export interface InkReference {
  title: string;
  description: string;
  exports: InkExport[];
}

// ---------------------------------------------------------------------------
// Classification rules
// ---------------------------------------------------------------------------

const PROVIDER_NAMES = new Set(["InkStigmerProvider"]);
const TRANSPORT_NAMES = new Set(["createNodeClient", "createNodeTransport"]);
const COMPOSED_VIEW_NAMES = new Set(["SessionView", "SessionApp"]);
const UTILITY_NAMES = new Set(["renderMarkdown"]);

function classifyFunction(name: string): InkCategory {
  if (PROVIDER_NAMES.has(name)) return "provider";
  if (TRANSPORT_NAMES.has(name)) return "transport";
  if (COMPOSED_VIEW_NAMES.has(name)) return "composedView";
  if (UTILITY_NAMES.has(name)) return "utility";
  return "component";
}

// ---------------------------------------------------------------------------
// Comment parsing (TypeDoc → CommentPart[])
// ---------------------------------------------------------------------------

function parseCommentParts(parts: CommentDisplayPart[] | undefined): CommentPart[] {
  if (!parts || parts.length === 0) return [];

  return parts.map((p): CommentPart => {
    if (p.kind === "inline-tag" && p.tag === "@link") {
      const linkTarget = isExternalTarget(p.target as number | { packageName: string; packagePath: string; qualifiedName: string } | undefined)
        ? null
        : typeof p.target === "number"
          ? null
          : null;
      return { kind: "link", text: p.text.trim(), target: linkTarget };
    }
    if (p.kind === "code") {
      return { kind: "code", text: p.text };
    }
    return { kind: "text", text: p.text };
  });
}

// ---------------------------------------------------------------------------
// Field extraction (interface children → Field[])
// ---------------------------------------------------------------------------

function parseField(child: Reflection): Field {
  const typeString = child.type ? serializeType(child.type as TypeDocType) : "unknown";
  const description = flattenCommentParts(child.comment?.summary);
  const required = !child.flags?.isOptional;

  let typeLink: string | null = null;
  if (child.type && (child.type as { type: string }).type === "reference") {
    const ref = child.type as { type: "reference"; target: unknown; name: string; package?: string };
    if (isExternalTarget(ref.target as number | { packageName: string; packagePath: string; qualifiedName: string } | undefined)) {
      const ext = ref.target as { packageName: string; qualifiedName: string };
      if (ext.packageName === "@stigmer/protos") {
        typeLink = `/docs/sdk/resources/agent-execution`;
      }
    }
  }

  return { name: child.name, typeString, description, required, typeLink };
}

// ---------------------------------------------------------------------------
// Source URL
// ---------------------------------------------------------------------------

function getSourceUrl(refl: Reflection): string {
  return refl.sources?.[0]?.url ?? "";
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function parseTypeDocJson(
  jsonPath: string,
): Promise<{ reference: InkReference; warnings: string[] }> {
  const raw = await fs.readFile(jsonPath, "utf-8");
  const project: TypeDocProject = JSON.parse(raw);
  const warnings: string[] = [];

  const functionMap = new Map<string, Reflection>();
  const interfaceMap = new Map<string, Reflection>();

  for (const child of project.children) {
    if (child.kind === ReflectionKind.Function) {
      functionMap.set(child.name, child);
    } else if (child.kind === ReflectionKind.Interface) {
      interfaceMap.set(child.name, child);
    }
  }

  const exports: InkExport[] = [];

  for (const [name, refl] of functionMap) {
    const category = classifyFunction(name);
    const sig = refl.signatures?.[0];
    const description = parseCommentParts(sig?.comment?.summary);
    const examples = extractExamples(sig?.comment);

    const isReExport = category === "transport";

    let propsInterface: InkPropsInterface | null = null;
    const propsName = `${name}Props`;
    const propsRefl = interfaceMap.get(propsName);
    if (propsRefl && propsRefl.children) {
      propsInterface = {
        name: propsName,
        description: parseCommentParts(propsRefl.comment?.summary),
        fields: propsRefl.children.map(parseField),
      };
    }

    // For utility functions, also check for NodeClientConfig
    if (name === "createNodeClient") {
      const configRefl = interfaceMap.get("NodeClientConfig");
      if (configRefl && configRefl.children) {
        propsInterface = {
          name: "NodeClientConfig",
          description: parseCommentParts(configRefl.comment?.summary),
          fields: configRefl.children.map(parseField),
        };
      }
    }

    exports.push({
      name,
      category,
      description,
      propsInterface,
      examples,
      sourceUrl: getSourceUrl(refl),
      isReExport,
    });
  }

  // Sort within each category: provider first, then alphabetical
  const ORDER: Record<InkCategory, number> = {
    provider: 0,
    transport: 1,
    component: 2,
    composedView: 3,
    utility: 4,
  };

  exports.sort((a, b) => {
    const catDiff = ORDER[a.category] - ORDER[b.category];
    if (catDiff !== 0) return catDiff;
    return a.name.localeCompare(b.name);
  });

  return {
    reference: {
      title: "Ink SDK Reference",
      description: "API reference for @stigmer/ink terminal UI components.",
      exports,
    },
    warnings,
  };
}
