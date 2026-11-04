/**
 * Stateless utility functions for MDX generation.
 *
 * - Type serialization  (TypeDoc type → human-readable string)
 * - Text escaping        (MDX content, JS string literals)
 * - Comment rendering    (CommentPart[] → MDX text)
 * - Example extraction   (TypeDoc blockTags → code string)
 * - Signatures           (TypeDoc call signature → a declaration that compiles)
 */

import { SETUP_MARKERS } from "../../src/lib/snippet-setup.mjs";
import type { TypeDocType, Comment, CommentDisplayPart, ExternalTarget, Reflection } from "./typedoc-types";
import { isExternalTarget } from "./typedoc-types";
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
      return type.types.map(serializeMember).join(" | ");

    case "intersection":
      return type.types.map(serializeMember).join(" & ");

    case "array": {
      // `keyof T[]` is `keyof (T[])`, so an operator's element is wrapped too.
      const element = type.elementType;
      const wrap = element.type === "union" || element.type === "intersection" || element.type === "typeOperator";
      return wrap ? `(${serializeType(element)})[]` : `${serializeMember(element)}[]`;
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

/**
 * A type as a member of a union or intersection: a function type or a
 * conditional type in parentheses, since `() => void | null` reads as a
 * function returning `void | null`.
 */
export function serializeMember(type: TypeDocType): string {
  const text = serializeType(type);
  const isFunction = type.type === "reflection" && (type.declaration.signatures?.length ?? 0) > 0;
  return isFunction || type.type === "conditional" ? `(${text})` : text;
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

/** The lines that end a docs fence's hidden setup, in every language the site knows. */
const SETUP_MARKER_LINES = new Set(Object.values(SETUP_MARKERS));

/**
 * Every `@example` of a TypeDoc comment. An example is exactly one fence,
 * whose line is kept (the reference writes ```` ```tsx <meta> ````), or bare
 * code with no fence, rendered as `tsx`. Anything else (prose around a
 * fence, or two fences) throws, naming the export and its file: rendered
 * whole, it would put a fence inside a fence.
 *
 * An example holds no hidden setup either: a `// ---cut---` line throws.
 * The example also ships in the kit's type declarations, where an editor
 * shows it on hover with nothing hidden, so it carries everything it needs
 * (`docs/STYLE.md`, "Code examples compile").
 */
export function extractExamples(comment: Comment | undefined, owner: ExampleOwner): Example[] {
  if (!comment?.blockTags) return [];

  const file = owner.sources?.[0]?.fileName ?? "an unknown file";
  const results: Example[] = [];
  for (const tag of comment.blockTags) {
    if (tag.tag !== "@example" || !tag.content.length) continue;

    const raw = tag.content
      .map((p) => p.text)
      .join("")
      .trim();
    if (raw === "") continue;

    let example: Example;
    if (!raw.includes("```")) {
      example = { meta: "", code: raw };
    } else {
      const fence = WHOLE_FENCE.exec(raw);
      if (fence === null || fence[3].includes("```")) {
        throw new Error(
          `@example on ${owner.name} (${file}) must be one code fence or bare code: move prose above the tag, and give each example its own @example`,
        );
      }
      example = { meta: fence[2].trim(), code: fence[3].trim() };
    }
    if (example.code.split("\n").some((line) => SETUP_MARKER_LINES.has(line.trim()))) {
      throw new Error(
        `@example on ${owner.name} (${file}) has a hidden-setup line ("---cut---"): an editor shows a kit's example whole, so write what it takes as given in the example itself (a literal, or a component's typed props)`,
      );
    }
    if (example.code !== "") results.push(example);
  }

  return results;
}

/** An example as the reference writes it: a `tsx` fence carrying the author's attributes. */
export function renderExample(example: Example): string {
  const meta = example.meta === "" ? "" : ` ${example.meta}`;
  return `\`\`\`tsx${meta}\n${example.code}\n\`\`\`\n\n`;
}

// ---------------------------------------------------------------------------
// Signatures — TypeDoc call signature → a declaration that compiles
// ---------------------------------------------------------------------------

/** One parameter of a signature, as the reference declares it. */
export interface SignatureParameter {
  readonly name: string;
  readonly type: string;
  /** Whether a caller may leave it out: TypeDoc flags it optional, or it has a default value. */
  readonly optional: boolean;
  /** The type as a union member, for `T | undefined` (see renderSignature). */
  readonly memberType: string;
  readonly rest: boolean;
}

/** A type a signature names, and the module a reader imports it from. */
export interface TypeImport {
  readonly name: string;
  readonly from: string;
}

/** A function's signature as the reference renders it. */
export interface Signature {
  readonly name: string;
  /** Each type parameter as written: `TData`, `T extends Base = Base`. */
  readonly typeParameters: readonly string[];
  readonly parameters: readonly SignatureParameter[];
  readonly returnType: string;
  /** The types it names that the reader imports from a package of their own, sorted. */
  readonly imports: readonly TypeImport[];
}

/**
 * The module a reader imports a type from, or null when they need no import
 * line for it: a global, a type the kit itself exports, or one no package
 * they install exports (which the docs snippet gate then reports at its
 * page). TypeDoc names the package a type is declared in, which is not
 * always the one a reader installs (`type-imports.ts` decides).
 */
export type TypeImportResolver = (name: string, target: ExternalTarget) => string | null;

/** A call signature's parameter as the reference names it: a destructured one is `options`. */
export function parameterName(p: Reflection): string {
  return p.name === "__namedParameters" ? "options" : p.name;
}

/** Whether a caller may leave a parameter out: optional, or given a default value. */
export function isParameterOptional(p: Reflection): boolean {
  return p.flags.isOptional === true || p.defaultValue !== undefined;
}

/**
 * The signature of an exported function, from its TypeDoc call signature:
 * its type parameters as written, each parameter optional when a caller may
 * leave it out, and the import of every type it names that the reader takes
 * from a package they install, resolved by `resolve`.
 */
export function signatureOf(name: string, sig: Reflection, resolve: TypeImportResolver): Signature {
  const types: TypeDocType[] = [];
  const typeParameters = (sig.typeParameters ?? []).map((tp) => {
    let text = tp.name;
    if (tp.type) {
      types.push(tp.type);
      text += ` extends ${serializeType(tp.type)}`;
    }
    if (tp.default) {
      types.push(tp.default);
      text += ` = ${serializeType(tp.default)}`;
    }
    return text;
  });
  const parameters = (sig.parameters ?? [])
    .filter((p) => p.name !== "this")
    .map((p): SignatureParameter => {
      if (p.type) types.push(p.type);
      return {
        name: parameterName(p),
        type: p.type ? serializeType(p.type) : "unknown",
        memberType: p.type ? serializeMember(p.type) : "unknown",
        optional: isParameterOptional(p),
        rest: p.flags.isRest === true,
      };
    });
  if (sig.type) types.push(sig.type);

  const imports = new Map<string, string>();
  for (const ref of externalReferences(types)) {
    const from = resolve(ref.name, ref.target);
    if (from === null) continue;
    const seen = imports.get(ref.name);
    if (seen !== undefined && seen !== from) {
      throw new Error(`the signature of ${name} names two types called ${ref.name}, from ${seen} and ${from}: the reference cannot import both`);
    }
    imports.set(ref.name, from);
  }

  return {
    name,
    typeParameters,
    parameters,
    returnType: sig.type ? serializeType(sig.type) : "void",
    imports: [...imports]
      .map(([n, from]) => ({ name: n, from }))
      .sort((a, b) => a.from.localeCompare(b.from) || a.name.localeCompare(b.name)),
  };
}

/** Every reference to another package's type within some types, in the order met. */
function externalReferences(types: TypeDocType[]): { name: string; target: ExternalTarget }[] {
  const found: { name: string; target: ExternalTarget }[] = [];
  const visit = (value: unknown): void => {
    if (Array.isArray(value)) {
      for (const v of value) visit(v);
      return;
    }
    if (typeof value !== "object" || value === null) return;
    const node = value as Record<string, unknown>;
    if (node.type === "reference" && isExternalTarget(node.target as ExternalTarget | number | undefined)) {
      found.push({ name: node.name as string, target: node.target as ExternalTarget });
    }
    // A reference's `target` is where it points, not a type; a type
    // operator's (`readonly T[]`) is the type it applies to.
    for (const [key, child] of Object.entries(node)) if (key !== "target" || node.type !== "reference") visit(child);
  };
  visit(types);
  return found;
}

/**
 * A signature as the reference writes it: a `tsx` fence holding the
 * function's declaration, which the docs snippet gate compiles as an ambient
 * one. The imports of the types it names sit above the fence's `---cut---`
 * marker, so the page shows only the declaration (a signature is read, not
 * copied) and the gate still finds every type. A type the kit exports needs
 * no line: the gate imports it from the page's entry, as the reader does.
 *
 * A parameter a caller may leave out is written `name?: T`, unless a
 * required parameter follows it (legal in source as a default value,
 * inexpressible with `?`): then it is `name: T | undefined`.
 */
export function renderSignature(signature: Signature): string {
  const lines: string[] = [];
  const byModule = new Map<string, string[]>();
  for (const { name, from } of signature.imports) byModule.set(from, [...(byModule.get(from) ?? []), name]);
  for (const [from, names] of byModule) lines.push(`import type { ${names.join(", ")} } from "${from}";`);
  if (lines.length > 0) lines.push(SETUP_MARKERS.tsx);

  const lastRequired = signature.parameters.findLastIndex((p) => !p.optional && !p.rest);
  const params = signature.parameters
    .map((p, i) => {
      if (p.rest) return `...${p.name}: ${p.type}`;
      if (!p.optional) return `${p.name}: ${p.type}`;
      return i < lastRequired ? `${p.name}: ${p.memberType} | undefined` : `${p.name}?: ${p.type}`;
    })
    .join(", ");
  const generics = signature.typeParameters.length > 0 ? `<${signature.typeParameters.join(", ")}>` : "";
  lines.push(`function ${signature.name}${generics}(${params}): ${signature.returnType}`);
  return `\`\`\`tsx\n${lines.join("\n")}\n\`\`\`\n\n`;
}
