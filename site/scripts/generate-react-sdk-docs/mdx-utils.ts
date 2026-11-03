/**
 * Stateless utility functions for MDX generation.
 *
 * - Type serialization  (TypeDoc type → human-readable string)
 * - Text escaping        (MDX content, JS string literals)
 * - Comment rendering    (CommentPart[] → MDX text)
 * - Example extraction   (TypeDoc blockTags → code string)
 */

import type { TypeDocType, Comment, CommentDisplayPart } from "./typedoc-types";
import type { CommentPart } from "./model";

// ---------------------------------------------------------------------------
// Type serialization — TypeDoc type → display string
// ---------------------------------------------------------------------------

export function serializeType(type: TypeDocType): string {
  switch (type.type) {
    case "intrinsic":
      return type.name;

    case "literal":
      return type.value === null ? "null" : JSON.stringify(type.value);

    case "union":
      return type.types.map(serializeType).join(" | ");

    case "intersection":
      return type.types.map(serializeType).join(" & ");

    case "array": {
      const inner = serializeType(type.elementType);
      const needsParens =
        type.elementType.type === "union" ||
        type.elementType.type === "intersection";
      return needsParens ? `(${inner})[]` : `${inner}[]`;
    }

    case "reference": {
      let s = type.name;
      if (type.typeArguments?.length) {
        s += `<${type.typeArguments.map(serializeType).join(", ")}>`;
      }
      return s;
    }

    case "reflection": {
      const decl = type.declaration;
      if (decl.signatures && decl.signatures.length > 0) {
        const sig = decl.signatures[0];
        const params = (sig.parameters ?? [])
          .filter((p) => p.name !== "this")
          .map((p) => {
            const pType = p.type ? serializeType(p.type) : "unknown";
            const opt = p.flags.isOptional ? "?" : "";
            return `${p.name}${opt}: ${pType}`;
          })
          .join(", ");
        const ret = sig.type ? serializeType(sig.type) : "void";
        return `(${params}) => ${ret}`;
      }
      if (decl.children && decl.children.length > 0) {
        const fields = decl.children.map((c) => {
          const ct = c.type ? serializeType(c.type) : "unknown";
          const opt = c.flags.isOptional ? "?" : "";
          return `${c.name}${opt}: ${ct}`;
        });
        return `{ ${fields.join("; ")} }`;
      }
      return "object";
    }

    case "tuple":
      return `[${(type.elements ?? []).map(serializeType).join(", ")}]`;

    case "namedTupleMember": {
      const opt = type.isOptional ? "?" : "";
      return `${type.name}${opt}: ${serializeType(type.element)}`;
    }

    case "typeOperator":
      return `${type.operator} ${serializeType(type.target)}`;

    case "query":
      return `typeof ${serializeType(type.queryType)}`;

    case "predicate":
      return type.targetType
        ? `${type.name} is ${serializeType(type.targetType)}`
        : type.name;

    case "conditional":
      return [
        serializeType(type.checkType),
        "extends",
        serializeType(type.extendsType),
        "?",
        serializeType(type.trueType),
        ":",
        serializeType(type.falseType),
      ].join(" ");

    case "indexedAccess":
      return `${serializeType(type.objectType)}[${serializeType(type.indexType)}]`;

    case "mapped":
      return "object";

    case "templateLiteral": {
      const parts = type.tail
        .map(([t, s]) => `\${${serializeType(t)}}${s}`)
        .join("");
      return `\`${type.head}${parts}\``;
    }

    case "optional":
      return `${serializeType(type.elementType)} | undefined`;

    case "rest":
      return `...${serializeType(type.elementType)}`;

    case "unknown":
      return type.name;

    default:
      return "unknown";
  }
}

// ---------------------------------------------------------------------------
// Text escaping
// ---------------------------------------------------------------------------

/** Escape characters that have special meaning in MDX text content. */
export function escapeMdx(text: string): string {
  return text
    .replace(/\{/g, "\\{")
    .replace(/\}/g, "\\}")
    .replace(/<(?=[a-zA-Z0-9/!])/g, "\\<");
}

/** Escape characters for a JavaScript double-quoted string literal. */
export function escapeJsString(text: string): string {
  return text
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\n/g, " ");
}

// ---------------------------------------------------------------------------
// Anchors
// ---------------------------------------------------------------------------

/** Convert an export name to a heading anchor (Fumadocs lowercases headings). */
export function toAnchor(name: string): string {
  return name.toLowerCase();
}

// ---------------------------------------------------------------------------
// Comment rendering
// ---------------------------------------------------------------------------

/** Render parsed CommentPart[] to an MDX-safe string. */
export function renderCommentParts(parts: CommentPart[]): string {
  return parts
    .map((part) => {
      switch (part.kind) {
        case "text":
          return escapeMdx(part.text);
        case "code":
          return part.text;
        case "link":
          if (part.target) return `[\`${part.text}\`](${part.target})`;
          return `\`${part.text}\``;
        default:
          return "";
      }
    })
    .join("");
}

// ---------------------------------------------------------------------------
// TypeDoc comment helpers
// ---------------------------------------------------------------------------

/** Flatten TypeDoc comment display parts to a plain string (for field descriptions). */
export function flattenCommentParts(
  parts: CommentDisplayPart[] | undefined,
): string {
  if (!parts || parts.length === 0) return "";
  return parts
    .map((p) => p.text)
    .join("")
    .trim();
}

/** One `@example` as the reference renders it: its fence's attributes and its code. */
export interface Example {
  /** What followed the language on the author's fence line (`title="App.tsx"`), or "" for none. */
  readonly meta: string;
  readonly code: string;
}

/** Where an example was written, for the error that refuses it: the export and its source file. */
export interface ExampleOwner {
  readonly name: string;
  readonly sources?: readonly { readonly fileName: string }[];
}

/** One fence and nothing else: its language, its attributes, its code. */
const WHOLE_FENCE = /^```(\w*)([^\n]*)\n([\s\S]*?)\n?```$/;

/**
 * Every `@example` of a TypeDoc comment. An example is exactly one fence,
 * whose line is kept (the reference writes ```` ```tsx <meta> ````), or bare
 * code with no fence, rendered as `tsx`. Anything else (prose around a
 * fence, or two fences) throws, naming the export and its file: rendered
 * whole, it would put a fence inside a fence.
 */
export function extractExamples(comment: Comment | undefined, owner: ExampleOwner): Example[] {
  if (!comment?.blockTags) return [];

  const results: Example[] = [];
  for (const tag of comment.blockTags) {
    if (tag.tag !== "@example" || !tag.content.length) continue;

    const raw = tag.content
      .map((p) => p.text)
      .join("")
      .trim();
    if (raw === "") continue;

    if (!raw.includes("```")) {
      results.push({ meta: "", code: raw });
      continue;
    }
    const fence = WHOLE_FENCE.exec(raw);
    if (fence === null || fence[3].includes("```")) {
      const file = owner.sources?.[0]?.fileName ?? "an unknown file";
      throw new Error(
        `@example on ${owner.name} (${file}) must be one code fence or bare code: move prose above the tag, and give each example its own @example`,
      );
    }
    const code = fence[3].trim();
    if (code !== "") results.push({ meta: fence[2].trim(), code });
  }

  return results;
}

/** An example as the reference writes it: a `tsx` fence carrying the author's attributes. */
export function renderExample(example: Example): string {
  const meta = example.meta === "" ? "" : ` ${example.meta}`;
  return `\`\`\`tsx${meta}\n${example.code}\n\`\`\`\n\n`;
}
