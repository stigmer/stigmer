/**
 * Data fixtures for share-agent-tour. `scenar pack` and `scenar render` wrap
 * every step of this tour in the exported `PreviewProviders`.
 *
 * The dialog itself is prop-driven (agent + share travel as props from
 * `steps.ts`); the one RPC it issues on mount is
 * `BillingCommandController.getOrCreateBillingAccount`, which feeds the
 * who-pays copy next to the serving toggle — so the fixture answers it with
 * a stable credit balance. Everything else (tool readiness, saves — never
 * reached in an inert playback) falls through to the router's
 * `unimplemented` response, which the hooks degrade from.
 */
import { create } from "@bufbuild/protobuf";
import { BillingCommandController } from "@stigmer/protos/ai/stigmer/billing/v1/command_pb";
import {
  BillingAccountSchema,
  CreditBalanceSchema,
} from "@stigmer/protos/ai/stigmer/billing/v1/billing_account_pb";
import { createStigmerPreview } from "../../_shared/stigmer-preview";

export const PreviewProviders = createStigmerPreview((router) => {
  router.service(BillingCommandController, {
    getOrCreateBillingAccount: () =>
      create(BillingAccountSchema, {
        balance: create(CreditBalanceSchema, {
          availableMicros: BigInt(42_180_000),
        }),
      }),
  });
});
