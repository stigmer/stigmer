// Moves an organization onto the Cloud's Team plan the way a customer does:
// a card saved, then the plan changed.
// Domain: conformance harness (cloud).
//
// The Cloud gates teams by plan (the team lane's plan port), and every
// tenancy the cloud target provisions is on Free, so the team arms run on an
// organization this module moves. Every step is a call the console or Stripe
// makes, through the clients and the webhook lane the target already hands
// the suites:
//
//   1. the organization's owner opens a payment-method setup session, which
//      makes the organization's Stripe customer (on the run's fake Stripe);
//   2. the customer's id is read back from the billing account, so no
//      control client is needed and the move works wherever the webhook lane
//      is published;
//   3. the suite, as Stripe, posts a signed `payment_method.attached` for
//      that customer, which saves the card on the account;
//   4. the owner changes the plan to the catalog's `team` row, read by slug.
//
// The plan's prices and the subscription's periods are the billing suites'
// to pin, not this move's; a step that does not answer as above throws with
// what it saw, since a team arm on Free would only repeat the plan refusal.
import type { ConformanceClients } from "./clients";
import { paymentMethodAttached, postStripeWebhook, signedEvent } from "./fake-stripe";
import type { StripeWebhookLane } from "../targets/target";

// The catalog slug of the plan whose entitlements include teams.
export const TEAM_PLAN_SLUG = "team";

// Where the setup session would send the browser; nothing follows them.
const SETUP_RETURN_URLS = {
  successUrl: "https://conformance.stigmer.test/billing/saved",
  cancelUrl: "https://conformance.stigmer.test/billing/back",
} as const;

export type PlanMoveClients = Pick<
  ConformanceClients,
  "billingCommand" | "billingQuery" | "planQuery" | "subscriptionCommand"
>;

export async function moveToTeamPlan(
  owner: PlanMoveClients,
  webhook: StripeWebhookLane,
  org: string,
): Promise<void> {
  await owner.billingCommand.createPaymentMethodSetupSession({ org, ...SETUP_RETURN_URLS });
  const customer = (await owner.billingQuery.getBillingAccount({ org })).stripeCustomerId;
  if (customer === "") {
    throw new Error(`moveToTeamPlan(${org}): the setup session left the billing account with no Stripe customer`);
  }
  const posted = await postStripeWebhook(
    webhook.baseUrl,
    signedEvent(paymentMethodAttached(`pm_conf_team_${org}`, customer), webhook.signingSecret),
  );
  if (posted.status !== 200) {
    throw new Error(
      `moveToTeamPlan(${org}): the webhook lane answered ${posted.status} to payment_method.attached: ${posted.body}`,
    );
  }
  const { entries } = await owner.planQuery.list({});
  const team = entries.find((plan) => plan.metadata?.slug === TEAM_PLAN_SLUG);
  const planId = team?.metadata?.id ?? "";
  if (planId === "") {
    throw new Error(`moveToTeamPlan(${org}): the catalog lists no '${TEAM_PLAN_SLUG}' plan`);
  }
  await owner.subscriptionCommand.changePlan({ org, planId });
}
