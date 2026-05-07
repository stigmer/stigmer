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

/** Extract all @example blocks from a TypeDoc comment, stripping outer fences. */
export function extractExamples(
  comment: Comment | undefined,
): string[] {
  if (!comment?.blockTags) return [];

  const results: string[] = [];
  for (const tag of comment.blockTags) {
    if (tag.tag !== "@example" || !tag.content.length) continue;

    const raw = tag.content
      .map((p) => p.text)
      .join("")
      .trim();

    const fenceMatch = raw.match(/^```\w*\n([\s\S]*)\n```$/);
    const code = fenceMatch ? fenceMatch[1].trim() : raw;
    if (code) results.push(code);
  }

  return results;
}
