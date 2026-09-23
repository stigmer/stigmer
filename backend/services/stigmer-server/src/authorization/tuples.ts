/**
 * The tuple vocabulary of the built-in authorizer — the OpenFGA notions
 * the cloud's model is written in (object, relation, subject; a subject
 * being an object or a userset `type:id#relation`), typed once so the
 * evaluator, the derivation and the store-test kit speak one language. The
 * model declares no wildcard subject and no condition: every reader of a
 * row is an account or the holder of a relation on an object, which is
 * why a check needs no context parameter. Nothing here is
 * stored: open source derives every tuple from a row (derived-tuples.ts)
 * or reads it from an IamPolicy row, and this module only names what a
 * tuple IS.
 *
 * `Person` is the caller as the evaluator sees them: the account id the
 * IamPolicy rows name, and every string a creator stamp may carry for the
 * same human — the account id and the account's issuer subject (rows the
 * 3.14.x verifiers stamped with the raw `sub`). A tuple naming
 * `identity_account:<x>` matches the person when `x` is one of the
 * aliases; rows are read by the account id alone, because every row open
 * source writes names an account (domain/iampolicy/role-lifecycle.ts).
 * The type is named here; the construction (`personFor`, `resolvePerson`)
 * is person.ts's, so this module stays vocabulary with no I/O.
 *
 * The string forms (`agent:x`, `organization:acme#viewer`) are the
 * notation the cloud's store tests and the IamPolicy proto both use; parse
 * and format are here so the kit and the tests never spell them a second
 * way. The wildcard notation `type:*` is refused by the parser: the model
 * has no line that admits one, so a fixture or a policy that spells it is
 * a mistake to surface, never a subject to carry.
 */
import type { Message } from "@bufbuild/protobuf";

/** The FGA type name of the kind every person is: `identity_account:<id>`. */
export const ACCOUNT_TYPE = "identity_account";

/** `type:id` — an object of the model. */
export interface ObjectRef {
  readonly type: string;
  readonly id: string;
}

/** The subject (the FGA "user") of a tuple. */
export type Subject =
  /** `type:id` — an object, including a person as `identity_account:<id>`. */
  | { readonly form: "object"; readonly object: ObjectRef }
  /** `type:id#relation` — everyone who holds `relation` on the object. */
  | {
      readonly form: "userset";
      readonly object: ObjectRef;
      readonly relation: string;
    };

export interface Tuple {
  readonly object: ObjectRef;
  readonly relation: string;
  readonly subject: Subject;
}

/**
 * Where the evaluator reads tuples from: every tuple on `object` with
 * `relation`. A source MAY return only the tuples that can concern the
 * person it was built for (the product source reads the person's own
 * rows; a fixture source knows no person and returns them all) — the
 * evaluator is correct over either, because a tuple whose subject is
 * another person is never a match. It MUST NOT omit a userset or an
 * object subject on the pair, which is how the person may be reached
 * indirectly. Faults propagate; "absent" is the empty array.
 */
export interface TupleSource {
  tuplesOf(object: ObjectRef, relation: string): Promise<ReadonlyArray<Tuple>>;
}

/** A declaration's derived-relation rule reads related rows through this (default_of needs the blueprint). */
export interface RowLoader {
  /** The decoded row, or undefined when there is none or the kind is not declared. */
  load(object: ObjectRef): Promise<Message | undefined>;
}

/** The caller as the model sees them. */
export interface Person {
  /** The id the IamPolicy rows name. */
  readonly accountId: string;
  /** Every string a creator stamp may carry for this person; always contains `accountId`. */
  readonly aliases: ReadonlySet<string>;
}

// ---------------------------------------------------------------------------
// The string notation.
// ---------------------------------------------------------------------------

/** `type:id` → ObjectRef; the id may itself contain `:` (issuer subjects do). */
export function parseObjectRef(text: string): ObjectRef {
  const colon = text.indexOf(":");
  if (colon <= 0) {
    throw new Error(`not an object reference: '${text}'`);
  }
  return { type: text.slice(0, colon), id: text.slice(colon + 1) };
}

export function formatObjectRef(object: ObjectRef): string {
  return `${object.type}:${object.id}`;
}

/**
 * `type:id` or `type:id#relation` → Subject. `type:*` is refused (the
 * module header): no line of the model admits a wildcard subject.
 */
export function parseSubject(text: string): Subject {
  const hash = text.indexOf("#");
  if (hash > 0) {
    return {
      form: "userset",
      object: parseObjectRef(text.slice(0, hash)),
      relation: text.slice(hash + 1),
    };
  }
  const object = parseObjectRef(text);
  if (object.id === "*") {
    throw new Error(
      `wildcard subject '${text}' is not admitted: the model declares no wildcard line`,
    );
  }
  return { form: "object", object };
}

export function formatSubject(subject: Subject): string {
  switch (subject.form) {
    case "object":
      return formatObjectRef(subject.object);
    case "userset":
      return `${formatObjectRef(subject.object)}#${subject.relation}`;
    default: {
      const exhaustive: never = subject;
      throw new Error(`unknown subject form: ${JSON.stringify(exhaustive)}`);
    }
  }
}

/** `object#relation@subject` — the IamPolicy proto's own tuple notation. */
export function formatTuple(tuple: Tuple): string {
  return `${formatObjectRef(tuple.object)}#${tuple.relation}@${formatSubject(tuple.subject)}`;
}

/** The memo and fixture key of an (object, relation) pair. */
export function pairKey(object: ObjectRef, relation: string): string {
  return `${formatObjectRef(object)}#${relation}`;
}

/** A source over a fixed tuple list — the store-test kit's and the unit tests' fixture. */
export function newInMemoryTupleSource(
  tuples: ReadonlyArray<Tuple>,
): TupleSource {
  const byPair = new Map<string, Tuple[]>();
  for (const tuple of tuples) {
    const key = pairKey(tuple.object, tuple.relation);
    const held = byPair.get(key);
    if (held === undefined) {
      byPair.set(key, [tuple]);
    } else {
      held.push(tuple);
    }
  }
  return {
    tuplesOf(object, relation) {
      return Promise.resolve(byPair.get(pairKey(object, relation)) ?? []);
    },
  };
}
