/**
 * The OpenFGA store-test kit — runs a `.fga.yaml` store test (the format
 * `fga model test` reads: fixture tuples, then named tests with `check`
 * and `list_objects` assertions) against the built-in evaluator, so the
 * cloud's own model tests — written by the model's authors and run
 * against real OpenFGA in the cloud's CI — are the proof that this
 * evaluator answers the same model the same way. Open source runs the
 * kit over pinned copies of those documents (authorization/__tests__/
 * fixtures/fga/); the cloud runs it over the LIVE documents at the
 * re-pin, which is what makes the copies safe to hold.
 *
 * Shape: the port-contract kits' (store/port-contract.ts) — vitest-free,
 * node:assert, cases the consumer's framework iterates — because a
 * composition consumes it through the published barrel and vitest is a
 * devDependency that must not enter the barrel's runtime graph.
 *
 * What is run and what is reported. One case per named test; a case
 * asserts every `check` in the test whose object's kind the model
 * declares, relation by relation, and FAILS on the first disagreement
 * (the message names the check in the document's own words). Assertions
 * the kit does not run are returned as `skipped`, each with its reason,
 * so a consumer pins the list and a document that gains a scenario, or a
 * declaration that lands, is a visible diff and never a quietly smaller
 * proof. Three reasons: a check whose TARGET kind the model does not
 * declare (`undeclared-kind`) and every `list_objects` assertion
 * (`list-objects`, the list scope's proof) are known when the kit is
 * built; the third is known only from the walk. A document may grant
 * through a type the model does not declare — the cloud's platform
 * tenancy reaches people through `identity_provider:<idp>#platform_user`,
 * a kind this edition does not serve — and OpenFGA answers `true` where
 * a model without that type resolves the userset to nobody. The kit runs
 * every assertion over a recording view of the document's tuples, and an
 * assertion whose walk READ a tuple naming an undeclared type is
 * reported as `undeclared-subject-type` (the types named) instead of
 * being asserted, whatever it would have answered: decided from the
 * model and the data, per assertion, so the sibling arms of the same
 * check block still run and a union that is settled before it reaches
 * such a tuple runs too. Over a model that declares every type in the
 * file (the cloud's drift test, built from the live model) nothing is
 * recorded and everything runs — the same kit, no edition branch.
 * `skipped` is therefore complete once every case has run; a consumer
 * pins it after the cases, which is the order a test file declares them.
 *
 * The parser is strict on purpose: an unknown key anywhere is a thrown
 * fault, so a change to the format upstream is loud here rather than
 * half-run. The model declares no condition, so the format's `condition`
 * on a tuple and `context` on a check are among the keys refused: a
 * document that still carries them is written against a model this
 * evaluator does not answer, and saying so beats running it half-blind.
 */
import assert from "node:assert/strict";

import { checkRelation } from "./evaluator.js";
import type { Model } from "./model/index.js";
import type { Person, Subject, Tuple, TupleSource } from "./tuples.js";
import {
  ACCOUNT_TYPE,
  newInMemoryTupleSource,
  parseObjectRef,
  parseSubject,
} from "./tuples.js";

// ---------------------------------------------------------------------------
// The document, typed exactly as the cloud's files use the format.
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
 * format the cloud's files use does not carry (`sourceName` names the
 * file in every message).
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

function record(
  value: unknown,
  where: string,
  allowedKeys?: ReadonlyArray<string>,
): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${where}: expected a mapping`);
  }
  const entry = value as Record<string, unknown>;
  if (allowedKeys !== undefined) {
    for (const key of Object.keys(entry)) {
      if (!allowedKeys.includes(key)) {
        throw new Error(`${where}: unknown key '${key}'`);
      }
    }
  }
  return entry;
}

function list(value: unknown, where: string): ReadonlyArray<unknown> {
  if (!Array.isArray(value)) {
    throw new Error(`${where}: expected a list`);
  }
  return value as ReadonlyArray<unknown>;
}

function optionalList(value: unknown, where: string): ReadonlyArray<unknown> {
  return value === undefined ? [] : list(value, where);
}

function text(value: unknown, where: string): string {
  if (typeof value !== "string") {
    throw new Error(`${where}: expected a string`);
  }
  return value;
}

// ---------------------------------------------------------------------------
// The cases.
// ---------------------------------------------------------------------------

export interface StoreTestCase {
  /** `<document> :: <test name>` — the framework prints it as the test name. */
  readonly name: string;
  run(): Promise<void>;
}

export type StoreTestSkipReason =
  | "undeclared-kind"
  | "list-objects"
  | "undeclared-subject-type";

/** One assertion (or assertion group) the kit did not run, in the document's words. */
export interface StoreTestSkip {
  readonly document: string;
  readonly test: string;
  readonly subject: string;
  /** The check's object, or `<type>` for a list_objects assertion. */
  readonly object: string;
  /** The one relation, for a skip decided per assertion; absent for a group. */
  readonly relation?: string;
  readonly reason: StoreTestSkipReason;
  /** For `undeclared-subject-type`: the types the walk read that the model does not declare, sorted. */
  readonly types?: ReadonlyArray<string>;
}

export interface StoreTestKit {
  readonly cases: ReadonlyArray<StoreTestCase>;
  /** Complete once every case has run (the module header). */
  readonly skipped: ReadonlyArray<StoreTestSkip>;
}

/**
 * The document's tests as runnable cases over `model`, plus every
 * assertion group the kit does not run.
 */
export function storeTestCases(
  document: StoreTestDocument,
  model: Model,
): StoreTestKit {
  const source = newInMemoryTupleSource(document.tuples.map(tupleOf));
  const skipped: StoreTestSkip[] = [];
  const cases: StoreTestCase[] = [];

  for (const test of document.tests) {
    const runnable: StoreTestCheck[] = [];
    for (const item of test.check) {
      const object = parseObjectRef(item.object);
      if (model.byType(object.type) === undefined) {
        skipped.push({
          document: document.name,
          test: test.name,
          subject: item.user,
          object: item.object,
          reason: "undeclared-kind",
        });
      } else {
        runnable.push(item);
      }
    }
    for (const item of test.list_objects) {
      skipped.push({
        document: document.name,
        test: test.name,
        subject: item.user,
        object: `<${item.type}>`,
        reason: "list-objects",
      });
    }
    if (runnable.length === 0) {
      continue;
    }
    cases.push({
      name: `${document.name} :: ${test.name}`,
      async run() {
        for (const item of runnable) {
          const object = parseObjectRef(item.object);
          const person = personOf(item.user);
          for (const [relation, expected] of Object.entries(item.assertions)) {
            const recording = recordUndeclaredTypes(source, model);
            const actual = await checkRelation(
              { model, source: recording },
              object,
              relation,
              person,
            );
            if (recording.reached.size > 0) {
              skipped.push({
                document: document.name,
                test: test.name,
                subject: item.user,
                object: item.object,
                relation,
                reason: "undeclared-subject-type",
                types: [...recording.reached].sort(),
              });
              continue;
            }
            assert.equal(
              actual,
              expected,
              `${document.name} :: ${test.name}: ${item.user} ${relation} ${item.object} expected ${String(expected)}, got ${String(actual)}`,
            );
          }
        }
      },
    });
  }
  return { cases, skipped };
}

interface RecordingTupleSource extends TupleSource {
  /** The undeclared types named by the subjects of the tuples the walk read. */
  readonly reached: ReadonlySet<string>;
}

/**
 * A view of `inner` that records, for one walk, every subject type the
 * evaluator read that `model` does not declare. A person
 * (`identity_account:<id>`) is a subject the evaluator compares, never a
 * type it resolves, so it is not a "reach" whatever the model declares; a
 * userset or a parent object of an undeclared type is.
 */
function recordUndeclaredTypes(
  inner: TupleSource,
  model: Model,
): RecordingTupleSource {
  const reached = new Set<string>();
  return {
    reached,
    async tuplesOf(object, relation) {
      const tuples = await inner.tuplesOf(object, relation);
      for (const tuple of tuples) {
        const type = resolvedTypeOf(tuple.subject);
        if (type !== undefined && model.byType(type) === undefined) {
          reached.add(type);
        }
      }
      return tuples;
    },
  };
}

/** The type the evaluator would resolve a subject on, or undefined for a person. */
function resolvedTypeOf(subject: Subject): string | undefined {
  switch (subject.form) {
    case "object":
      return subject.object.type === ACCOUNT_TYPE
        ? undefined
        : subject.object.type;
    case "userset":
      return subject.object.type;
    default: {
      const exhaustive: never = subject;
      throw new Error(`unknown subject form: ${JSON.stringify(exhaustive)}`);
    }
  }
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
