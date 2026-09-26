/**
 * The OpenFGA store-test kit: runs a `.fga.yaml` document (the format
 * `fga model test` reads: fixture tuples, then named tests with `check`
 * and `list_objects` assertions) against the built-in evaluator. The
 * documents are the model's own suites (fga/tests/), which the real
 * engine runs too (`make test-authorization-model`), so every assertion
 * answered here is answered by OpenFGA over the same compiled model: the
 * proof that the evaluator and the engine mean one thing.
 *
 * One case per named test. A case asserts every `check`, relation by
 * relation, and every `list_objects`, and fails on the first disagreement
 * with a message in the document's own words. Nothing is skipped: the
 * built-in model declares every type a document can name.
 *
 * `list_objects` is evaluated exactly. An object holds a relation only
 * through a tuple on that object: a direct tuple, a tupleset link, or a
 * computed relation that bottoms out in one of those, which are the only
 * forms the model uses (the reader refuses wildcards, the one form that
 * would grant without a tuple on the object). So the objects of the asked
 * type that the document's tuples name are the complete candidate set;
 * each is checked, and the kept ones are compared with the expectation as
 * a set, the way OpenFGA answers it (in no order). This is also how the
 * server's list scope works: rows first, then checks.
 *
 * The parser is strict on purpose (strict-json.ts): an unknown key
 * anywhere is a thrown fault, so a change to the format upstream is loud
 * here rather than half-run. The model declares no condition, so a
 * tuple's `condition` and a check's `context` are among the keys refused.
 */
import assert from "node:assert/strict";

import { checkRelation } from "../evaluator.js";
import type { Model } from "../model/index.js";
import { list, optionalList, record, text } from "../strict-json.js";
import type { Person, Tuple } from "../tuples.js";
import {
  ACCOUNT_TYPE,
  formatObjectRef,
  newInMemoryTupleSource,
  parseObjectRef,
  parseSubject,
} from "../tuples.js";

// ---------------------------------------------------------------------------
// The document, typed exactly as the suites use the format.
// ---------------------------------------------------------------------------

export interface StoreTestTuple {
  readonly user: string;
  readonly relation: string;
  readonly object: string;
}

export interface StoreTestCheck {
  readonly user: string;
  readonly object: string;
  readonly assertions: Readonly<Record<string, boolean>>;
}

export interface StoreTestListObjects {
  readonly user: string;
  readonly type: string;
  readonly assertions: Readonly<Record<string, ReadonlyArray<string>>>;
}

export interface StoreTest {
  readonly name: string;
  readonly check: ReadonlyArray<StoreTestCheck>;
  readonly list_objects: ReadonlyArray<StoreTestListObjects>;
}

export interface StoreTestDocument {
  readonly name: string;
  readonly tuples: ReadonlyArray<StoreTestTuple>;
  readonly tests: ReadonlyArray<StoreTest>;
}

/**
 * Parses a loaded YAML value into a document, refusing anything the
 * format the suites use does not carry (`sourceName` names the file in
 * every message).
 */
export function parseStoreTestDocument(
  value: unknown,
  sourceName: string,
): StoreTestDocument {
  const root = record(value, sourceName, [
    "name",
    "model_file",
    "tuples",
    "tests",
  ]);
  return {
    name: text(root["name"], `${sourceName}: name`),
    tuples: list(root["tuples"], `${sourceName}: tuples`).map((entry, index) =>
      parseTuple(entry, `${sourceName}: tuples[${index}]`),
    ),
    tests: list(root["tests"], `${sourceName}: tests`).map((entry, index) =>
      parseTest(entry, `${sourceName}: tests[${index}]`),
    ),
  };
}

function parseTuple(value: unknown, where: string): StoreTestTuple {
  const entry = record(value, where, ["user", "relation", "object"]);
  return {
    user: text(entry["user"], `${where}.user`),
    relation: text(entry["relation"], `${where}.relation`),
    object: text(entry["object"], `${where}.object`),
  };
}

function parseTest(value: unknown, where: string): StoreTest {
  const entry = record(value, where, ["name", "check", "list_objects"]);
  return {
    name: text(entry["name"], `${where}.name`),
    check: optionalList(entry["check"], `${where}.check`).map((item, index) =>
      parseCheck(item, `${where}.check[${index}]`),
    ),
    list_objects: optionalList(
      entry["list_objects"],
      `${where}.list_objects`,
    ).map((item, index) =>
      parseListObjects(item, `${where}.list_objects[${index}]`),
    ),
  };
}

function parseCheck(value: unknown, where: string): StoreTestCheck {
  const entry = record(value, where, ["user", "object", "assertions"]);
  const assertions = record(entry["assertions"], `${where}.assertions`);
  const parsed: Record<string, boolean> = {};
  for (const [relation, expected] of Object.entries(assertions)) {
    if (typeof expected !== "boolean") {
      throw new Error(`${where}.assertions.${relation}: expected a boolean`);
    }
    parsed[relation] = expected;
  }
  return {
    user: text(entry["user"], `${where}.user`),
    object: text(entry["object"], `${where}.object`),
    assertions: parsed,
  };
}

function parseListObjects(value: unknown, where: string): StoreTestListObjects {
  const entry = record(value, where, ["user", "type", "assertions"]);
  const assertions = record(entry["assertions"], `${where}.assertions`);
  const parsed: Record<string, ReadonlyArray<string>> = {};
  for (const [relation, expected] of Object.entries(assertions)) {
    parsed[relation] = list(expected, `${where}.assertions.${relation}`).map(
      (item, index) => text(item, `${where}.assertions.${relation}[${index}]`),
    );
  }
  return {
    user: text(entry["user"], `${where}.user`),
    type: text(entry["type"], `${where}.type`),
    assertions: parsed,
  };
}

// ---------------------------------------------------------------------------
// The cases.
// ---------------------------------------------------------------------------

export interface StoreTestCase {
  /** `<document> :: <test name>`: the framework prints it as the test name. */
  readonly name: string;
  run(): Promise<void>;
}

/** The document's tests as runnable cases over `model`. */
export function storeTestCases(
  document: StoreTestDocument,
  model: Model,
): ReadonlyArray<StoreTestCase> {
  const tuples = document.tuples.map(tupleOf);
  const source = newInMemoryTupleSource(tuples);
  const deps = { model, source };

  return document.tests.map((test) => ({
    name: `${document.name} :: ${test.name}`,
    async run() {
      for (const item of test.check) {
        const object = parseObjectRef(item.object);
        const person = personOf(item.user);
        for (const [relation, expected] of Object.entries(item.assertions)) {
          const actual = await checkRelation(deps, object, relation, person);
          assert.equal(
            actual,
            expected,
            `${document.name} :: ${test.name}: ${item.user} ${relation} ${item.object} expected ${String(expected)}, got ${String(actual)}`,
          );
        }
      }
      for (const item of test.list_objects) {
        const person = personOf(item.user);
        const candidates = objectsOfType(tuples, item.type);
        for (const [relation, expected] of Object.entries(item.assertions)) {
          const kept: string[] = [];
          for (const candidate of candidates) {
            if (await checkRelation(deps, parseObjectRef(candidate), relation, person)) {
              kept.push(candidate);
            }
          }
          assert.deepEqual(
            kept.sort(),
            [...expected].sort(),
            `${document.name} :: ${test.name}: ${item.user} ${relation} objects of type ${item.type}`,
          );
        }
      }
    },
  }));
}

/** Every object of `type` a tuple is written on, each once, in first-seen order: the complete candidate set (the module header). */
export function objectsOfType(
  tuples: ReadonlyArray<Tuple>,
  type: string,
): ReadonlyArray<string> {
  const seen = new Set<string>();
  for (const tuple of tuples) {
    if (tuple.object.type === type) {
      seen.add(formatObjectRef(tuple.object));
    }
  }
  return [...seen];
}

function tupleOf(entry: StoreTestTuple): Tuple {
  return {
    object: parseObjectRef(entry.object),
    relation: entry.relation,
    subject: parseSubject(entry.user),
  };
}

/** The document's users are plain accounts; a user of another type is a format the kit does not run. */
function personOf(user: string): Person {
  const object = parseObjectRef(user);
  if (object.type !== ACCOUNT_TYPE || object.id === "*") {
    throw new Error(`store test users are accounts; got '${user}'`);
  }
  return { accountId: object.id, aliases: new Set([object.id]) };
}
