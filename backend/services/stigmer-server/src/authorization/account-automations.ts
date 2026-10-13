/**
 * The automations that act as a person: the rows of an organization whose
 * work runs as the account that created them. A schedule fires as its
 * creator (schedule-fire-caller.ts), an evaluator's AI judge grades as its
 * creator (grading-caller.ts), and a plugin eval's or agent eval's tries
 * run as their creator (plugin-eval-caller.ts), each read from a creation
 * stamp nothing changes. So when that account stops counting in the
 * organization (it leaves, its access moves to another account, the
 * organization requires a sign-in it did not use), each of them stops, and
 * its owner needs the list to make them again.
 *
 * This is that list, for a set of accounts at once: one scan of each kind's
 * rows in the organization, each row's stamp resolved to an account the
 * way the mints resolve it (as an account id, and as the raw issuer subject
 * rows stamped before 3.15.0 carry), one resolution per distinct stamp. It
 * is asked when a person is about to move or has moved, and when an owner
 * previews a sign-in requirement, never per request, so a full scan of the
 * organization's rows of four kinds is its cost.
 *
 * Under the trusted-local posture, and wherever a composition registers its
 * own mints (the Cloud's run as per-organization system accounts), these
 * rows do not act as their creator, so the composition names only the kinds
 * whose built-in creator mint it composed (`kinds`), and the list never
 * names a row that keeps running.
 */
import type { DescMessage, Message } from "@bufbuild/protobuf";
import { fromBinary } from "@bufbuild/protobuf";

import { AgentEvalSchema } from "@stigmer/protos/ai/stigmer/agentic/agenteval/v1/api_pb";
import { EvaluatorSchema } from "@stigmer/protos/ai/stigmer/agentic/evaluator/v1/api_pb";
import { PluginEvalSchema } from "@stigmer/protos/ai/stigmer/agentic/plugineval/v1/api_pb";
import { ScheduleSchema } from "@stigmer/protos/ai/stigmer/agentic/schedule/v1/api_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import { accountForStamp } from "../domain/identityaccount/resolve.js";
import type { AccountsByCaller } from "../domain/identityaccount/resolve.js";
import { auditOf } from "../pipeline/steps/defaults.js";
import { metadataOf } from "../pipeline/steps/shapes.js";
import type { Store } from "../store/interface.js";

/** One automation that acts as an account. */
export interface AccountAutomation {
  readonly kind: ApiResourceKind;
  readonly id: string;
  readonly slug: string;
  readonly name: string;
  /** The account it acts as. */
  readonly accountId: string;
}

/** The automations a set of accounts created in one organization. */
export interface AccountAutomations {
  /** Every automation in `org` that acts as one of `accountIds`, kind by kind, in the store's order. */
  actingAs(
    org: string,
    accountIds: ReadonlySet<string>,
  ): Promise<ReadonlyArray<AccountAutomation>>;
}

/** The kinds whose rows act as their creator, with the schema each decodes with. */
const ACTING_KINDS: ReadonlyArray<{
  readonly kind: ApiResourceKind;
  readonly schema: DescMessage;
}> = [
  { kind: ApiResourceKind.schedule, schema: ScheduleSchema },
  { kind: ApiResourceKind.evaluator, schema: EvaluatorSchema },
  { kind: ApiResourceKind.plugin_eval, schema: PluginEvalSchema },
  { kind: ApiResourceKind.agent_eval, schema: AgentEvalSchema },
];

export interface AccountAutomationsDeps {
  readonly store: Pick<Store, "findAllByField">;
  /** The account port: a stamp is resolved as an account id, then as a direct subject. */
  readonly accounts: AccountsByCaller;
  /**
   * The kinds whose rows act as their creator in this composition: those
   * whose mint is the built-in creator mint. A kind a unit's mint serves
   * (the Cloud's system accounts) is left out, since its rows keep
   * running; absent, all four.
   */
  readonly kinds?: ReadonlySet<ApiResourceKind>;
}

export function newAccountAutomations(
  deps: AccountAutomationsDeps,
): AccountAutomations {
  return {
    async actingAs(org, accountIds) {
      if (org === "" || accountIds.size === 0) {
        return [];
      }
      const stamps = new Map<string, Promise<string | undefined>>();
      const accountOf = (stamp: string): Promise<string | undefined> => {
        let known = stamps.get(stamp);
        if (known === undefined) {
          known = accountForStamp(deps.accounts, stamp).then(
            (account) => account?.metadata?.id,
          );
          stamps.set(stamp, known);
        }
        return known;
      };
      const found: AccountAutomation[] = [];
      for (const { kind, schema } of ACTING_KINDS) {
        if (deps.kinds !== undefined && !deps.kinds.has(kind)) {
          continue;
        }
        const rows = await deps.store.findAllByField(
          kind,
          "metadata.org",
          org,
          schema,
        );
        for (const bytes of rows) {
          const row: Message = fromBinary(schema, bytes);
          const stamp = auditOf(schema, row)?.specAudit?.createdBy?.id ?? "";
          if (stamp === "") {
            continue;
          }
          const accountId = accountIds.has(stamp)
            ? stamp
            : await accountOf(stamp);
          if (accountId === undefined || !accountIds.has(accountId)) {
            continue;
          }
          const metadata = metadataOf(row);
          found.push({
            kind,
            id: metadata?.id ?? "",
            slug: metadata?.slug ?? "",
            name: metadata?.name ?? "",
            accountId,
          });
        }
      }
      return found;
    },
  };
}
