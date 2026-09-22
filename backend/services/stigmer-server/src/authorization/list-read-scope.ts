/**
 * The built-in list read scope — open source's driver for the list-read
 * seam (extensions/list-read-scope.ts), composed under the built-in
 * posture (posture.ts). The cloud's driver asks OpenFGA `can_view` for
 * every candidate a list lane offers and ListObjects for the enumeration
 * lanes; this one asks the same question of the same model, evaluated by
 * the same evaluator the built-in Authorizer uses (evaluator.ts), over
 * the tuples each candidate's row would have had — derived from the
 * facts the candidate already carries (`ListEntryMeta` is the row's
 * `RowAuthorizationFacts`; facts.ts), so a list never reads a candidate's
 * row a second time. A self-host's lists show a person exactly what a
 * `get` would let them read.
 *
 * Both verbs ask under the LISTING context, `allow: false` — the public
 * wildcard suppressed, the cloud's own posture (its Java
 * listAuthorizedResourceIds set it): a legacy PUBLIC row reads for any
 * signed-in person on a point check and never expands into an outsider's
 * listing; the organization's own people still reach it through the
 * org-viewer shape public also emits.
 *
 *   - `restrictListEntries`: one derived source for the caller, seeded
 *     with every candidate's facts; one `checkRelation` per unique id —
 *     one evaluator walk per candidate, never shared, because the walk's
 *     memo and its cycle detector are one object and a shared walk would
 *     read a second candidate's in-flight resolution of the same pair as
 *     a cycle. The candidates run concurrently: the only shared state is
 *     the source, whose promise memo dedupes the loads (the person's rows
 *     once; each distinct parent once — an execution list reads its
 *     distinct SESSIONS, entry 9's parent-check exactly). The kept set is
 *     a subset of the offered ids; order is the lane's.
 *   - `authorizedResourceIds`: the kind scanned, decoded and evaluated
 *     the same way. There is no tuple index to enumerate from and the
 *     answer is genuinely not "everything" (private blueprints exist), so
 *     the verb costs one scan of the kind — the console library rides
 *     it (blueprints have no list RPC; the library is a search), measured
 *     and recorded rather than assumed. A row that does not decode is
 *     skipped with a warning, the `loadAll*` idiom every lane follows: no
 *     lane can show it either.
 *
 * The `internal` class — the server acting as itself over the in-process
 * transport — is answered by the seam, not here: `restrictListByReadScope`
 * returns the org-narrowed rows for the class before any driver is asked
 * (extensions/list-read-scope.ts, the header's contract line), the
 * Authorize step's trust-domain rule applied to a list answer. So this
 * driver's `restrictListEntries` REFUSES the class (`internal-caller-offered`):
 * being offered it means a caller reached the driver around the one
 * consumption idiom, and evaluating the server as a person would return
 * a quiet short list — the failure shape stigmer#1207 fixed. The
 * enumeration verb has no helper in front of it and keeps its own arm:
 * every id of the kind, as the built-in directory answers the class with
 * every organization. No in-process edge reaches an enumeration lane
 * today; the arm is pinned so a future one meets the rule.
 *
 * Faults THROW and are never an empty answer (the seam: an empty set means
 * "authorized to see nothing"; an outage is the pipeline's sanitized
 * INTERNAL). A kind the model does not declare, like the internal class
 * above, is a consumer bug by the seam's contract and faults through the
 * evaluator, loud; the model declares exactly the open-source tier, so no
 * served lane can reach it.
 *
 * Logging. One debug line per call — kind, offered, kept, elapsed — what
 * an operator needs to answer "why is Alice's list short" beside the
 * Authorizer's per-denial lines; never the token.
 */
import { fromBinary } from "@bufbuild/protobuf";

import type { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import type { Logger } from "../boot/logger.js";
import type { IamPolicyStore } from "../domain/iampolicy/store.js";
import type { CallerIdentity } from "../extensions/identity.js";
import type {
  ListEntryMeta,
  ListReadScope,
} from "../extensions/list-read-scope.js";
import { kindEnumName } from "../pipeline/apiresource-meta.js";
import type { Store } from "../store/interface.js";
import { newDerivedTupleSource } from "./derived-tuples.js";
import { AuthorizationEvaluationError, checkRelation } from "./evaluator.js";
import type { RowFacts } from "./facts.js";
import { rowFactsOf, rowFactsOfEntry } from "./facts.js";
import type { Model } from "./model/index.js";
import { builtInModel } from "./model/index.js";
import type { KindDeclaration } from "./model/rewrite.js";
import type { AccountsByCaller } from "./person.js";
import { resolvePerson } from "./person.js";
import type { CheckContext, ObjectRef, Person } from "./tuples.js";

/** The relation every list lane reads through (the cloud's LIST_RELATION). */
const LIST_RELATION = "can_view";

/** The listing context: the public wildcard suppressed (the module header). */
const LISTING: CheckContext = { allow: false };

export interface BuiltInListReadScopeDeps {
  readonly store: Store;
  /** The port the grant path writes through — the person's rows are read from the same instance. */
  readonly policies: IamPolicyStore;
  /** The account port: the caller's account, and the parent hops that land on one. */
  readonly accounts: AccountsByCaller;
  readonly logger: Logger;
  /** The declarations to evaluate; the built-in model unless a test says otherwise. */
  readonly model?: Model;
}

export function newBuiltInListReadScope(
  deps: BuiltInListReadScopeDeps,
): ListReadScope {
  const model = deps.model ?? builtInModel;

  /** The candidates the caller may view, each answered by its own walk over one seeded source. */
  async function visibleAmong(
    caller: CallerIdentity,
    kind: ApiResourceKind,
    candidates: ReadonlyArray<RowFacts>,
  ): Promise<ReadonlySet<string>> {
    if (candidates.length === 0) {
      return new Set();
    }
    const started = performance.now();
    const person: Person = await resolvePerson(deps.accounts, caller);
    const source = newDerivedTupleSource(
      {
        store: deps.store,
        policies: deps.policies,
        accounts: deps.accounts,
        model,
      },
      person,
      { facts: candidates },
    );
    const type = kindEnumName(kind);
    const answers = await Promise.all(
      candidates.map(async (facts) => {
        const object: ObjectRef = { type, id: facts.id };
        const allowed = await checkRelation(
          { model, source },
          object,
          LIST_RELATION,
          person,
          LISTING,
        );
        return allowed ? facts.id : undefined;
      }),
    );
    const kept = new Set<string>();
    for (const id of answers) {
      if (id !== undefined) {
        kept.add(id);
      }
    }
    deps.logger.debug("list scope evaluated candidates", {
      account: person.accountId,
      kind: type,
      offered: candidates.length,
      kept: kept.size,
      elapsedMs: Math.round(performance.now() - started),
    });
    return kept;
  }

  /** The declaration a verb evaluates against; an undeclared kind is the evaluator's own fault, raised before any read. */
  function requireDeclared(kind: ApiResourceKind): KindDeclaration {
    const declaration = model.byKind(kind);
    if (declaration === undefined) {
      throw new AuthorizationEvaluationError(
        "undeclared-target-kind",
        `no declaration for kind '${kindEnumName(kind)}' — a list lane asked the scope about a kind the model does not declare`,
      );
    }
    return declaration;
  }

  /** Every row of `kind` the store holds, as facts; a row that does not decode is skipped. */
  async function everyRowOf(declaration: KindDeclaration): Promise<RowFacts[]> {
    const kind = declaration.kind;
    const rows = await deps.store.listResources(kind);
    const facts: RowFacts[] = [];
    for (const bytes of rows) {
      try {
        facts.push(rowFactsOf(kind, fromBinary(declaration.schema, bytes)));
      } catch (error) {
        deps.logger.warn("list scope skipped a row that does not decode", {
          kind: kindEnumName(kind),
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
    return facts;
  }

  return {
    async restrictListEntries(
      caller: CallerIdentity,
      kind: ApiResourceKind,
      entries: ReadonlyArray<ListEntryMeta>,
    ): Promise<ReadonlySet<string>> {
      requireDeclared(kind);
      if (caller.callerClass === "internal") {
        throw new AuthorizationEvaluationError(
          "internal-caller-offered",
          `the internal caller class was offered to the list scope for kind '${kindEnumName(kind)}' — the shared helper answers that class before any driver; a list lane reached the driver around it`,
        );
      }
      // One candidate per unique id: a lane offers each row once, and a
      // duplicate would only spend a walk to learn the same answer.
      const unique = new Map<string, RowFacts>();
      for (const entry of entries) {
        if (!unique.has(entry.id)) {
          unique.set(entry.id, rowFactsOfEntry(kind, entry));
        }
      }
      return visibleAmong(caller, kind, [...unique.values()]);
    },

    async authorizedResourceIds(
      caller: CallerIdentity,
      kind: ApiResourceKind,
    ): Promise<ReadonlySet<string>> {
      const candidates = await everyRowOf(requireDeclared(kind));
      if (caller.callerClass === "internal") {
        return new Set(candidates.map((facts) => facts.id));
      }
      return visibleAmong(caller, kind, candidates);
    },
  };
}
