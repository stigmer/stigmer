/**
 * The evaluator — OpenFGA's check, over the built-in model and a tuple
 * source, small because the model uses four rewrite forms and nothing
 * else (model/rewrite.ts). `checkRelation(object, relation, person, context)`
 * answers "does this person hold this relation on this object" the way
 * the cloud's engine answers it over stored tuples, so the two editions
 * share one meaning of authorization.
 *
 * The walk, in the order a `.fga` line reads:
 *   - `this`: the tuples on (object, relation). A tuple counts only if
 *     its subject's TYPE is in the line's restriction list — the check
 *     OpenFGA makes at write time, made here at read time, so a derived
 *     tuple the model no longer admits denies instead of allowing. An
 *     object subject matches when it names one of the person's aliases;
 *     a userset subject is resolved on its own object; the wildcard is
 *     honoured only under its condition (`allow_public` reads the
 *     context's `allow`; an unknown condition is a fault).
 *   - `computed`: the same object, another relation.
 *   - `from`: every object the tupleset relation links to (again within
 *     the tupleset line's type restriction), resolved for the relation.
 *   - `union`: the first true member wins; members are tried in the
 *     line's order, so the cheap arms the model lists first (the person's
 *     own owner tuple) are read before the hops.
 *
 * Bounds and faults. Every (object, relation) pair is resolved once per
 * check (the memo — a diamond such as `owner` reached through `viewer`
 * and through `can_edit` reads the source once). A pair re-entered while
 * it is being resolved is a cycle in the declarations, which is a bug,
 * and a resolution deeper than MAX_RESOLUTION_DEPTH is the same class of
 * bug; both throw, because the alternative — a quiet `false` — would turn
 * a broken transcript into a lockout nobody can see. A kind the model does
 * not declare is a fault as the check's TARGET (the driver refuses
 * unserved kinds before evaluation, so reaching here is a registry gap)
 * and simply an object with no relations when reached through a tuple
 * (`identity_provider#platform_user`, which no open-source tuple names).
 * A relation the kind does not declare is `false` — the ruled answer for
 * a wire question the model has no line for, where OpenFGA
 * itself answers a validation error.
 *
 * The evaluator does no I/O of its own and knows no store: the source
 * owns every read, and a fault it raises propagates through untouched,
 * so the driver above can fold it into `unavailable` and never into a
 * denial.
 */
import type { Model } from "./model/index.js";
import type { Rewrite, SubjectType } from "./model/rewrite.js";
import type {
  CheckContext,
  ObjectRef,
  Person,
  Subject,
  TupleSource,
} from "./tuples.js";
import {
  ACCOUNT_TYPE,
  ALLOW_PUBLIC_CONDITION,
  formatObjectRef,
  pairKey,
} from "./tuples.js";

/**
 * OpenFGA's default resolution-depth limit (its `resolveNodeLimit`), so
 * the bound here is the oracle's own and not a number chosen locally. The
 * deepest real chain in the model is under ten: an instance's `viewer
 * from default_of` to its blueprint, the blueprint's `admin from
 * organization`, then the organization's four-rung ladder.
 */
export const MAX_RESOLUTION_DEPTH = 25;

/**
 * The faults an evaluation can raise. Two are consumer bugs by the seam
 * contracts (a kind the model does not declare; the `internal` class
 * offered to the list scope's restrict verb, which the shared helper
 * answers before any driver); the rest are the model's own.
 */
export type EvaluationFault =
  | "undeclared-target-kind"
  | "internal-caller-offered"
  | "resolution-depth-exceeded"
  | "resolution-cycle"
  | "unknown-condition";

/** A fault in the model or its evaluation — never a denial; the driver maps it to `unavailable`. */
export class AuthorizationEvaluationError extends Error {
  readonly reason: EvaluationFault;

  constructor(reason: EvaluationFault, message: string) {
    super(message);
    this.name = "AuthorizationEvaluationError";
    this.reason = reason;
  }
}

export interface EvaluationDeps {
  readonly model: Model;
  readonly source: TupleSource;
}

export async function checkRelation(
  deps: EvaluationDeps,
  object: ObjectRef,
  relation: string,
  person: Person,
  context: CheckContext,
): Promise<boolean> {
  if (deps.model.byType(object.type) === undefined) {
    throw new AuthorizationEvaluationError(
      "undeclared-target-kind",
      `no declaration for kind '${object.type}' (target ${formatObjectRef(object)})`,
    );
  }
  return new Walk(deps, person, context).resolve(object, relation, 0);
}

/** One check's state: the memo and the in-progress set, over one source. */
class Walk {
  private readonly memo = new Map<string, Promise<boolean>>();
  private readonly inProgress = new Set<string>();

  constructor(
    private readonly deps: EvaluationDeps,
    private readonly person: Person,
    private readonly context: CheckContext,
  ) {}

  resolve(
    object: ObjectRef,
    relation: string,
    depth: number,
  ): Promise<boolean> {
    const key = pairKey(object, relation);
    if (this.inProgress.has(key)) {
      throw new AuthorizationEvaluationError(
        "resolution-cycle",
        `'${key}' re-entered while being resolved — the declarations cycle`,
      );
    }
    if (depth > MAX_RESOLUTION_DEPTH) {
      throw new AuthorizationEvaluationError(
        "resolution-depth-exceeded",
        `resolving '${key}' exceeded ${MAX_RESOLUTION_DEPTH} hops`,
      );
    }
    const held = this.memo.get(key);
    if (held !== undefined) {
      return held;
    }
    const declaration = this.deps.model.byType(object.type);
    const rewrite = declaration?.relations.get(relation);
    if (declaration === undefined || rewrite === undefined) {
      return Promise.resolve(false);
    }
    this.inProgress.add(key);
    const result = this.evaluate(rewrite, object, relation, depth).finally(() =>
      this.inProgress.delete(key),
    );
    this.memo.set(key, result);
    return result;
  }

  private async evaluate(
    rewrite: Rewrite,
    object: ObjectRef,
    relation: string,
    depth: number,
  ): Promise<boolean> {
    switch (rewrite.node) {
      case "this": {
        const tuples = await this.deps.source.tuplesOf(object, relation);
        for (const tuple of tuples) {
          if (await this.subjectHolds(tuple.subject, rewrite.subjects, depth)) {
            return true;
          }
        }
        return false;
      }
      case "computed":
        return this.resolve(object, rewrite.relation, depth + 1);
      case "from": {
        const linkTypes = this.objectTypesOf(object, rewrite.tupleset);
        const links = await this.deps.source.tuplesOf(object, rewrite.tupleset);
        for (const link of links) {
          if (
            link.subject.form === "object" &&
            linkTypes.has(link.subject.object.type) &&
            (await this.resolve(
              link.subject.object,
              rewrite.relation,
              depth + 1,
            ))
          ) {
            return true;
          }
        }
        return false;
      }
      case "union": {
        for (const member of rewrite.members) {
          if (await this.evaluate(member, object, relation, depth)) {
            return true;
          }
        }
        return false;
      }
      default: {
        const exhaustive: never = rewrite;
        throw new Error(`unknown rewrite node: ${JSON.stringify(exhaustive)}`);
      }
    }
  }

  /** Whether one direct tuple's subject reaches the person, within the line's type restriction. */
  private async subjectHolds(
    subject: Subject,
    restriction: ReadonlyArray<SubjectType>,
    depth: number,
  ): Promise<boolean> {
    switch (subject.form) {
      case "object":
        return (
          subject.object.type === ACCOUNT_TYPE &&
          restriction.some(
            (allowed) =>
              allowed.form === "object" && allowed.type === ACCOUNT_TYPE,
          ) &&
          this.person.aliases.has(subject.object.id)
        );
      case "userset":
        return (
          restriction.some(
            (allowed) =>
              allowed.form === "userset" &&
              allowed.type === subject.object.type &&
              allowed.relation === subject.relation,
          ) && (await this.resolve(subject.object, subject.relation, depth + 1))
        );
      case "wildcard": {
        const allowed = restriction.some(
          (entry) =>
            entry.form === "wildcard" &&
            entry.type === subject.type &&
            entry.condition === subject.condition,
        );
        return allowed && this.conditionHolds(subject.condition);
      }
      default: {
        const exhaustive: never = subject;
        throw new Error(`unknown subject form: ${JSON.stringify(exhaustive)}`);
      }
    }
  }

  private conditionHolds(condition: string | undefined): boolean {
    switch (condition) {
      case ALLOW_PUBLIC_CONDITION:
        return this.context.allow;
      default:
        throw new AuthorizationEvaluationError(
          "unknown-condition",
          `the model declares no condition '${String(condition)}'`,
        );
    }
  }

  /** The object types the tupleset line admits — `[organization]`, `[session]` — from its `this` nodes. */
  private objectTypesOf(
    object: ObjectRef,
    tupleset: string,
  ): ReadonlySet<string> {
    const rewrite = this.deps.model
      .byType(object.type)
      ?.relations.get(tupleset);
    const types = new Set<string>();
    const collect = (node: Rewrite): void => {
      if (node.node === "this") {
        for (const subject of node.subjects) {
          if (subject.form === "object") {
            types.add(subject.type);
          }
        }
      } else if (node.node === "union") {
        node.members.forEach(collect);
      }
    };
    if (rewrite !== undefined) {
      collect(rewrite);
    }
    return types;
  }
}
