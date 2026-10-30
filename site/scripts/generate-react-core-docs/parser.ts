/**
 * Parser: TypeDoc JSON of @stigmer/react-core → its reference model.
 *
 * The conversation core is hooks and the contexts they read, so the page is
 * ordered for that: contexts and providers first, then the hooks, then the
 * plain functions and constants. A hook's tables are the interfaces named for
 * it (`useSessionList` → `UseSessionListOptions` and `UseSessionListReturn`).
 * Types are not listed on their own: each appears as the table of the hook or
 * function that takes or returns it, and the React SDK reference, which
 * re-exports every name here, lists them all.
 */

import * as fs from "node:fs/promises";
import type { CommentDisplayPart, Reflection, TypeDocProject, TypeDocType } from "../generate-react-sdk-docs/typedoc-types";
import { ReflectionKind } from "../generate-react-sdk-docs/typedoc-types";
import { extractExamples, flattenCommentParts, serializeType } from "../generate-react-sdk-docs/mdx-utils";
import type { CommentPart, Field } from "../generate-react-sdk-docs/model";

export type CoreCategory = "context" | "hook" | "function" | "constant";

export interface CoreTable {
  /** What the table is: the options a hook takes, or what it returns. */
  readonly role: "Options" | "Returns";
  readonly name: string;
  readonly fields: Field[];
}

export interface CoreExport {
  readonly name: string;
  readonly category: CoreCategory;
  readonly description: CommentPart[];
  readonly tables: CoreTable[];
  readonly examples: string[];
}

export interface CoreReference {
  readonly title: string;
  readonly description: string;
  readonly exports: CoreExport[];
}

const ORDER: Record<CoreCategory, number> = { context: 0, hook: 1, function: 2, constant: 3 };

function parts(display: CommentDisplayPart[] | undefined): CommentPart[] {
  return (display ?? []).map((p): CommentPart => {
    if (p.kind === "inline-tag") return { kind: "link", text: p.text.trim(), target: null };
    if (p.kind === "code") return { kind: "code", text: p.text };
    return { kind: "text", text: p.text };
  });
}

function field(child: Reflection): Field {
  return {
    name: child.name,
    typeString: child.type ? serializeType(child.type as TypeDocType) : "unknown",
    description: flattenCommentParts(child.comment?.summary),
    required: !child.flags?.isOptional,
    typeLink: null,
  };
}

/** `useSessionList` → `UseSessionList`. */
function pascal(name: string): string {
  return name.charAt(0).toUpperCase() + name.slice(1);
}

function categoryOf(refl: Reflection): CoreCategory {
  if (refl.kind === ReflectionKind.Variable) return /Context$/.test(refl.name) ? "context" : "constant";
  if (/Provider$/.test(refl.name)) return "context";
  return /^use[A-Z]/.test(refl.name) ? "hook" : "function";
}

export async function parseTypeDocJson(jsonPath: string): Promise<CoreReference> {
  const project: TypeDocProject = JSON.parse(await fs.readFile(jsonPath, "utf-8"));
  const interfaces = new Map<string, Reflection>();
  for (const child of project.children) if (child.kind === ReflectionKind.Interface) interfaces.set(child.name, child);

  const table = (role: CoreTable["role"], name: string): CoreTable[] => {
    const refl = interfaces.get(name);
    return refl?.children?.length ? [{ role, name, fields: refl.children.map(field) }] : [];
  };

  const exports: CoreExport[] = [];
  for (const refl of project.children) {
    if (refl.kind !== ReflectionKind.Function && refl.kind !== ReflectionKind.Variable) continue;
    const category = categoryOf(refl);
    const comment = refl.kind === ReflectionKind.Function ? refl.signatures?.[0]?.comment : refl.comment;
    const base = pascal(refl.name);
    exports.push({
      name: refl.name,
      category,
      description: parts(comment?.summary),
      tables: category === "hook" ? [...table("Options", `${base}Options`), ...table("Returns", `${base}Return`)] : [],
      examples: extractExamples(comment),
    });
  }
  exports.sort((a, b) => ORDER[a.category] - ORDER[b.category] || a.name.localeCompare(b.name));

  return {
    title: "React core reference",
    description: "Every hook, context and helper @stigmer/react-core exports.",
    exports,
  };
}
