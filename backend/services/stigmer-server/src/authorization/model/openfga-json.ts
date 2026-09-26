/**
 * The reader of the compiled authorization model: OpenFGA's own JSON
 * (data/authorization-model.json, written by `make gen-authorization-model`
 * from the `.fga` files under fga/model) turned into the evaluator's
 * vocabulary (rewrite.ts), one entry per type in the file's order.
 *
 * The file is OpenFGA's format, not this server's, so it is read as
 * `unknown` and refused loudly (strict-json.ts): every key the compiled
 * model carries is listed below, and any other key, at any depth, is a
 * thrown fault naming where. It runs when model/index.ts loads, so a model
 * this server cannot evaluate fails the boot and every test that imports
 * the model, never an answer.
 *
 * What is accepted, which is what the compiled model uses:
 *   - `schema_version` "1.2" and `type_definitions`;
 *   - per type: `type`, `relations`, and `metadata.{module, relations,
 *     source_info.file}`;
 *   - per relation's metadata: `directly_related_user_types[]`, each an
 *     object type (`{type}`) or a userset (`{type, relation}`);
 *   - per rewrite node: `this`, `computedUserset.relation`,
 *     `tupleToUserset.{tupleset,computedUserset}.relation`, `union.child`
 *     and `intersection.child`, nested to any depth (the evaluator
 *     recurses through any nesting).
 *
 * What is refused by name, because the evaluator does not implement it
 * and the day the model needs it is a design act: `difference` (`but
 * not`), conditions (a `conditions` map, or a type reference carrying
 * `condition`), wildcards (`type:*`), a `computedUserset` that names
 * another object, and any schema version but 1.2.
 *
 * What is re-asserted, though OpenFGA's validator proved it when the file
 * was compiled, because the file is committed data and a hand edit must
 * fail here rather than in an answer: every computed target and tupleset
 * is a relation of its own type; every subject type names a declared type,
 * and a userset subject a relation that type declares; and a relation
 * lists direct subject types exactly when its rewrite has a `this` node,
 * which is where the evaluator reads that list from.
 *
 * Relations come out sorted by name (the canonical file sorts keys; the
 * evaluator only looks relations up). A union's or an intersection's
 * children keep the file's order: the evaluator short-circuits in that
 * order, so it is what the cost of a check rides on.
 *
 * The reader imports nothing but the vocabulary and the strict-read
 * helpers, so the reader and the evaluator stay a self-contained pair.
 */
import { list, record, text } from "../strict-json.js";
import type { Rewrite, SubjectType } from "./rewrite.js";

/** The only schema version this reader accepts: the modular DSL's. */
export const SUPPORTED_SCHEMA_VERSION = "1.2";

/** One type of the compiled model, in the evaluator's vocabulary. */
export interface ModelType {
  /** The FGA type name: an `ApiResourceKind` member name (`agent`, `identity_account`). */
  readonly type: string;
  /** The `.fga` file the type is defined in, relative to the server package (`fga/model/agentic/agent.fga`). */
  readonly source: string;
  /** Every relation the type defines, sorted by name. */
  readonly relations: ReadonlyMap<string, Rewrite>;
}

/** Where the `.fga` files live, relative to the server package; `source_info.file` is relative to it. */
const MODEL_SOURCE_DIR = "fga/model";

/**
 * Reads a parsed compiled model. `where` names the file in every message.
 * Throws on anything the module header says is refused or re-asserted.
 */
export function readOpenFgaModel(
  value: unknown,
  where = "authorization-model.json",
): ReadonlyArray<ModelType> {
  const root = record(value, where, ["schema_version", "type_definitions", "conditions"]);
  if (root["conditions"] !== undefined) {
    throw new Error(`${where}: conditions are not evaluated by this server`);
  }
  const version = text(root["schema_version"], `${where}: schema_version`);
  if (version !== SUPPORTED_SCHEMA_VERSION) {
    throw new Error(
      `${where}: schema_version '${version}' is not ${SUPPORTED_SCHEMA_VERSION}, the only version this server reads`,
    );
  }

  const types: ModelType[] = [];
  const seen = new Set<string>();
  list(root["type_definitions"], `${where}: type_definitions`).forEach((entry, index) => {
    const parsed = readType(entry, `${where}: type_definitions[${index}]`);
    if (seen.has(parsed.type)) {
      throw new Error(`${where}: type '${parsed.type}' is defined twice`);
    }
    seen.add(parsed.type);
    types.push(parsed);
  });
  assertReferencesResolve(types, where);
  return types;
}

function readType(value: unknown, where: string): ModelType {
  const entry = record(value, where, ["type", "relations", "metadata"]);
  const type = text(entry["type"], `${where}.type`);
  const at = `${where} (${type})`;
  const metadata = record(entry["metadata"], `${at}.metadata`, [
    "module",
    "relations",
    "source_info",
  ]);
  text(metadata["module"], `${at}.metadata.module`);
  const sourceInfo = record(metadata["source_info"], `${at}.metadata.source_info`, ["file"]);
  const file = text(sourceInfo["file"], `${at}.metadata.source_info.file`);

  const directTypes = readDirectTypes(metadata["relations"], `${at}.metadata.relations`);
  const rewrites =
    entry["relations"] === undefined ? {} : record(entry["relations"], `${at}.relations`);

  for (const relation of directTypes.keys()) {
    if (!(relation in rewrites)) {
      throw new Error(`${at}.metadata.relations.${relation}: metadata for a relation ${type} does not define`);
    }
  }

  const relations = new Map<string, Rewrite>();
  for (const name of Object.keys(rewrites).sort()) {
    const subjects = directTypes.get(name);
    const rewrite = readRewrite(rewrites[name], `${at}.relations.${name}`, subjects);
    const hasThis = containsThis(rewrite);
    if (hasThis && subjects === undefined) {
      throw new Error(`${at}.relations.${name}: a direct relation with no directly_related_user_types`);
    }
    if (!hasThis && subjects !== undefined) {
      throw new Error(`${at}.relations.${name}: directly_related_user_types on a relation with no direct node`);
    }
    relations.set(name, rewrite);
  }
  return { type, source: `${MODEL_SOURCE_DIR}/${file}`, relations };
}

/** Each relation's direct subject types; a relation whose metadata is `{}` lists none and is absent. */
function readDirectTypes(value: unknown, where: string): ReadonlyMap<string, ReadonlyArray<SubjectType>> {
  const out = new Map<string, ReadonlyArray<SubjectType>>();
  if (value === undefined) {
    return out;
  }
  for (const [relation, meta] of Object.entries(record(value, where))) {
    const entry = record(meta, `${where}.${relation}`, ["directly_related_user_types"]);
    if (entry["directly_related_user_types"] === undefined) {
      continue;
    }
    const at = `${where}.${relation}.directly_related_user_types`;
    out.set(
      relation,
      list(entry["directly_related_user_types"], at).map((item, index) =>
        readSubjectType(item, `${at}[${index}]`),
      ),
    );
  }
  return out;
}

function readSubjectType(value: unknown, where: string): SubjectType {
  const entry = record(value, where, ["type", "relation", "wildcard", "condition"]);
  if (entry["wildcard"] !== undefined) {
    throw new Error(`${where}: wildcard subject types are not evaluated by this server`);
  }
  if (entry["condition"] !== undefined) {
    throw new Error(`${where}: conditional subject types are not evaluated by this server`);
  }
  const type = text(entry["type"], `${where}.type`);
  return entry["relation"] === undefined
    ? { form: "object", type }
    : { form: "userset", type, relation: text(entry["relation"], `${where}.relation`) };
}

/**
 * One rewrite node. `subjects` is the relation's direct list, which a
 * `this` node takes; it is checked against the node's presence by the
 * caller.
 */
function readRewrite(
  value: unknown,
  where: string,
  subjects: ReadonlyArray<SubjectType> | undefined,
): Rewrite {
  const node = record(value, where, [
    "this",
    "computedUserset",
    "tupleToUserset",
    "union",
    "intersection",
    "difference",
  ]);
  const keys = Object.keys(node);
  if (keys.length !== 1) {
    throw new Error(`${where}: a rewrite node has exactly one form, found ${keys.length}`);
  }
  const form = keys[0];
  switch (form) {
    case "this":
      record(node["this"], `${where}.this`, []);
      return { node: "this", subjects: subjects ?? [] };
    case "computedUserset":
      return { node: "computed", relation: localRelation(node["computedUserset"], `${where}.computedUserset`) };
    case "tupleToUserset": {
      const ttu = record(node["tupleToUserset"], `${where}.tupleToUserset`, [
        "tupleset",
        "computedUserset",
      ]);
      return {
        node: "from",
        tupleset: localRelation(ttu["tupleset"], `${where}.tupleToUserset.tupleset`),
        relation: localRelation(ttu["computedUserset"], `${where}.tupleToUserset.computedUserset`),
      };
    }
    case "union":
    case "intersection": {
      const operator = record(node[form], `${where}.${form}`, ["child"]);
      const members = list(operator["child"], `${where}.${form}.child`).map((child, index) =>
        readRewrite(child, `${where}.${form}.child[${index}]`, subjects),
      );
      if (members.length === 0) {
        throw new Error(`${where}.${form}: an operator with no children`);
      }
      return { node: form, members };
    }
    case "difference":
      throw new Error(`${where}: 'but not' (difference) is not evaluated by this server`);
    default:
      throw new Error(`${where}: unknown rewrite form '${String(form)}'`);
  }
}

/** An `ObjectRelation` naming a relation of the same object: `object` must be unset. */
function localRelation(value: unknown, where: string): string {
  const entry = record(value, where, ["relation", "object"]);
  if (entry["object"] !== undefined) {
    throw new Error(`${where}: a relation on another object is not evaluated by this server`);
  }
  return text(entry["relation"], `${where}.relation`);
}

function containsThis(rewrite: Rewrite): boolean {
  switch (rewrite.node) {
    case "this":
      return true;
    case "computed":
    case "from":
      return false;
    case "union":
    case "intersection":
      return rewrite.members.some(containsThis);
    default: {
      const exhaustive: never = rewrite;
      throw new Error(`unknown rewrite node: ${JSON.stringify(exhaustive)}`);
    }
  }
}

/** The cross-type re-assertions of the module header. */
function assertReferencesResolve(types: ReadonlyArray<ModelType>, where: string): void {
  const byType = new Map(types.map((entry) => [entry.type, entry]));
  for (const entry of types) {
    for (const [name, rewrite] of entry.relations) {
      const at = `${where}: ${entry.type}#${name}`;
      walk(rewrite, (node) => {
        switch (node.node) {
          case "computed":
            if (!entry.relations.has(node.relation)) {
              throw new Error(`${at}: names relation '${node.relation}', which ${entry.type} does not define`);
            }
            return;
          case "from":
            if (!entry.relations.has(node.tupleset)) {
              throw new Error(`${at}: names tupleset '${node.tupleset}', which ${entry.type} does not define`);
            }
            return;
          case "this":
            for (const subject of node.subjects) {
              const target = byType.get(subject.type);
              if (target === undefined) {
                throw new Error(`${at}: admits subject type '${subject.type}', which the model does not define`);
              }
              if (subject.form === "userset" && !target.relations.has(subject.relation)) {
                throw new Error(
                  `${at}: admits '${subject.type}#${subject.relation}', which ${subject.type} does not define`,
                );
              }
            }
            return;
          case "union":
          case "intersection":
            return;
          default: {
            const exhaustive: never = node;
            throw new Error(`unknown rewrite node: ${JSON.stringify(exhaustive)}`);
          }
        }
      });
    }
  }
}

/** Visits every node of a rewrite, depth first, in order. */
function walk(rewrite: Rewrite, visit: (node: Rewrite) => void): void {
  visit(rewrite);
  if (rewrite.node === "union" || rewrite.node === "intersection") {
    for (const member of rewrite.members) {
      walk(member, visit);
    }
  }
}
