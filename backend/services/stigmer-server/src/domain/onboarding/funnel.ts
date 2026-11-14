/**
 * How far the organizations made in a window got on the journey from a
 * first agent to their users: the operator's count behind
 * getOnboardingFunnel. It answers where newcomers stop ("40 made, 31 picked
 * an agent, 12 added a key"), with counts only: no names, addresses or
 * identifiers leave this module.
 *
 * The cohort is the top-level organizations made in the window: the
 * organization list index's rows holding no `parent_org` (a child
 * organization is a customer's, made by its parent, not a newcomer), read
 * newest first from the window's start, with the rows made after its end
 * passed over after decoding. A row with no creation stamp is never in a
 * window. Each counted organization's steps are progress.ts's rule over
 * facts.ts's read, the same the console's card shows, with the
 * organization's creator (its `created_by` stamp) left out of the people
 * who joined, as the card leaves out the person looking at it.
 *
 * An organization whose creator signs in with an address the operator
 * lists as internal (boot/internal-accounts.ts) is left out and counted as
 * excluded, so a team trying its own sign-up and a paid tester never read
 * as newcomers. A window holding more than {@link FUNNEL_CAP}
 * organizations is refused with a narrower one suggested, so one answer
 * never reads the whole server.
 */
import { create, fromBinary } from "@bufbuild/protobuf";

import {
  GetOnboardingFunnelOutputSchema,
  OnboardingStepCountSchema,
} from "@stigmer/apis/ai/stigmer/platform/v1/onboarding_funnel_pb";
import type { GetOnboardingFunnelOutput } from "@stigmer/apis/ai/stigmer/platform/v1/onboarding_funnel_pb";
import { OrganizationSchema } from "@stigmer/apis/ai/stigmer/tenancy/organization/v1/api_pb";
import type { Organization } from "@stigmer/apis/ai/stigmer/tenancy/organization/v1/api_pb";
import type { OnboardingStepId } from "@stigmer/apis/ai/stigmer/tenancy/organization/v1/onboarding_pb";

import { isInternalAccount, type InternalAccounts } from "../../boot/internal-accounts.js";
import type { Logger } from "../../boot/logger.js";
import { invalidArgumentError } from "../../pipeline/errors.js";
import { createdByOf } from "../../pipeline/steps/authorization-facts.js";
import type { Store } from "../../store/interface.js";
import { listIndexInstantOfMillis, type ListIndexCursor } from "../../store/list-index.js";
import type { PrincipalDisplayResolver } from "../grant/access-lists.js";
import { organizationListIndex } from "../organization/list-index.js";
import type { ReportWindow } from "../run/usage.js";
import type { OnboardingFactsReader } from "./facts.js";
import { ONBOARDING_STEPS, stepsDone } from "./progress.js";

/** The most organizations one count reads. */
export const FUNNEL_CAP = 2000;

/** How many organization rows each read of the index takes. */
const PAGE = 500;

/** How many organizations are read at once. */
const CONCURRENCY = 8;

/** What the count reads through. */
export interface OnboardingFunnelDeps {
  readonly store: Pick<Store, "queryResources">;
  readonly facts: OnboardingFactsReader;
  /** Names an organization's creator: their sign-in address is read from their account. */
  readonly displayResolver: PrincipalDisplayResolver;
  readonly internalAccounts: InternalAccounts;
  readonly logger: Logger;
}

/** Counts the window's organizations at each step. */
export async function countOnboardingFunnel(
  deps: OnboardingFunnelDeps,
  window: ReportWindow,
): Promise<GetOnboardingFunnelOutput> {
  const cohort = await readCohort(deps, window);
  const creators = await deps.displayResolver.resolveIdentityAccounts([
    ...new Set(cohort.map((organization) => createdByOf(organization)).filter((id) => id !== "")),
  ]);
  const counted: Organization[] = [];
  let excluded = 0;
  for (const organization of cohort) {
    const email = creators.get(createdByOf(organization))?.email;
    if (isInternalAccount(deps.internalAccounts, email)) excluded += 1;
    else counted.push(organization);
  }

  const reached = new Map<OnboardingStepId, number>(ONBOARDING_STEPS.map((id) => [id, 0]));
  await forEachAtMost(CONCURRENCY, counted, async (organization) => {
    const facts = await deps.facts.read(organization.metadata?.id ?? "", createdByOf(organization));
    for (const id of stepsDone(facts)) reached.set(id, (reached.get(id) ?? 0) + 1);
  });

  return create(GetOnboardingFunnelOutputSchema, {
    organizations: counted.length,
    excluded,
    steps: ONBOARDING_STEPS.map((id) => create(OnboardingStepCountSchema, { id, reached: reached.get(id) ?? 0 })),
  });
}

/**
 * The top-level organizations made in the window, read newest first from
 * the window's start a page at a time; rows made after its end are passed
 * over and not counted against the cap.
 */
async function readCohort(deps: OnboardingFunnelDeps, window: ReportWindow): Promise<Organization[]> {
  const cohort: Organization[] = [];
  let after: ListIndexCursor | undefined;
  for (;;) {
    const rows = await deps.store.queryResources(organizationListIndex, {
      withoutKeys: ["parent_org"],
      ...(window.fromMs === undefined ? {} : { createdAtOrAfter: listIndexInstantOfMillis(window.fromMs) }),
      ...(after === undefined ? {} : { after }),
      limit: PAGE,
    });
    for (const row of rows) {
      let organization: Organization;
      try {
        organization = fromBinary(OrganizationSchema, row.data);
      } catch (error) {
        deps.logger.warn("Failed to unmarshal organization, skipping", {
          error: error instanceof Error ? error.message : String(error),
        });
        continue;
      }
      if (!inWindow(organization, window)) continue;
      cohort.push(organization);
      if (cohort.length > FUNNEL_CAP) {
        throw invalidArgumentError(
          `this window holds more than ${FUNNEL_CAP} new organizations, more than one count reads; ask for a narrower window`,
        );
      }
    }
    const last = rows[rows.length - 1];
    if (rows.length < PAGE || last === undefined) return cohort;
    after = last.cursor;
  }
}

/** Whether the organization was made in the window; one with no creation stamp never is. */
function inWindow(organization: Organization, window: ReportWindow): boolean {
  const created = organization.status?.audit?.specAudit?.createdAt;
  if (created === undefined) return false;
  const ms = Number(created.seconds) * 1000 + Math.floor(created.nanos / 1_000_000);
  if (window.fromMs !== undefined && ms < window.fromMs) return false;
  if (window.toMs !== undefined && ms > window.toMs) return false;
  return true;
}

/** Runs `work` over every item, at most `limit` at a time; the first rejection rejects. */
async function forEachAtMost<T>(limit: number, items: readonly T[], work: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  const lanes = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const item = items[next];
      next += 1;
      if (item !== undefined) await work(item);
    }
  });
  await Promise.all(lanes);
}
