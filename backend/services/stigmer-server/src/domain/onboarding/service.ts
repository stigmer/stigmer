/**
 * The journey from a first agent to its users, as the two reads serve it:
 * one organization's steps (OrganizationQueryController.getOnboarding, the
 * console's first-steps card) and the operator's count over every new
 * organization (PlatformQueryController.getOnboardingFunnel). Both run
 * progress.ts's one rule over facts.ts's one read; the controllers only
 * authorize and hand the question here.
 *
 * The composition root builds one service over the composed ports and the
 * operator's internal-accounts setting (boot/internal-accounts.ts), so
 * every edition answers both reads over its own drivers. A read that fails
 * answers INTERNAL with the cause logged, never a step it could not see.
 */
import { ConnectError } from "@connectrpc/connect";

import type { GetOnboardingFunnelOutput } from "@stigmer/apis/ai/stigmer/platform/v1/onboarding_funnel_pb";
import type { OnboardingProgress } from "@stigmer/apis/ai/stigmer/tenancy/organization/v1/onboarding_pb";

import type { InternalAccounts } from "../../boot/internal-accounts.js";
import type { Logger } from "../../boot/logger.js";
import { internalError } from "../../pipeline/errors.js";
import type { ReportWindow } from "../run/usage.js";
import { newOnboardingFactsReader, type OnboardingFactsDeps } from "./facts.js";
import { countOnboardingFunnel } from "./funnel.js";
import { onboardingProgress } from "./progress.js";

/** Answers both onboarding reads. */
export interface OnboardingService {
  /** One organization's steps, with `leaveOut` (the one asking) left out of the people who joined. */
  progress(org: string, leaveOut: string): Promise<OnboardingProgress>;
  /** How far the window's new organizations got. */
  funnel(window: ReportWindow): Promise<GetOnboardingFunnelOutput>;
}

/** What the service reads through: the facts reader's ports, plus the operator's internal accounts. */
export interface OnboardingServiceDeps extends OnboardingFactsDeps {
  readonly internalAccounts: InternalAccounts;
  readonly logger: Logger;
}

export function newOnboardingService(deps: OnboardingServiceDeps): OnboardingService {
  const facts = newOnboardingFactsReader(deps);
  return {
    async progress(org, leaveOut) {
      return onboardingProgress(await answering(() => facts.read(org, leaveOut)));
    },
    funnel(window) {
      return answering(() =>
        countOnboardingFunnel(
          {
            store: deps.store,
            facts,
            displayResolver: deps.displayResolver,
            internalAccounts: deps.internalAccounts,
            logger: deps.logger,
          },
          window,
        ),
      );
    },
  };
}

/** The read's answer; a refusal it chose passes through, any other failure is INTERNAL. */
async function answering<T>(read: () => Promise<T>): Promise<T> {
  try {
    return await read();
  } catch (error) {
    if (error instanceof ConnectError) throw error;
    throw internalError(error, "failed to read onboarding");
  }
}
