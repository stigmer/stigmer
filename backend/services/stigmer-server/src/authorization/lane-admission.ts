/**
 * Lane admission over the Authorizer seam — open source's rendering of
 * the cloud's decorator (stigmer-cloud `authorizer/lane-admission.ts`,
 * stigmer-cloud#709), composed around the built-in Authorizer under the
 * built-in authorization posture (boot/compose.ts).
 *
 * The OSS AuthorizeRunTarget step asks the Authorizer, for every caller
 * but the internal class, whether the caller may run what a session or
 * execution targets — the run-gate checks (`isRunGateCheck`, the
 * OSS-owned definition of that set: `can_execute` on the blueprints and
 * instances, `can_create_execution_in` on a session). A runner acting
 * for a WORKFLOW execution creates the workflow's child agent executions
 * (the `agent_call` activity), and it does so AS THE HUMAN whose workflow
 * it is (runnerauth/runner-subject-verifier.ts). Checked as that human,
 * a member running an organization-visible workflow that calls another
 * member's private agent would be refused at the child create — but
 * the parent workflow execution already passed its own run gate, and
 * the human's visibility of the agents a shared workflow calls is not
 * the question. The cloud admits its `workflow_sandbox` lane on exactly
 * these checks for exactly this reason; this decorator gives an
 * enforcing self-host the same answer, so a workflow behaves the same in
 * both editions (the parent program's rule: nothing diverges silently).
 *
 * Why a predicate and not a class set: the cloud keys its decorator on
 * `callerClass` because there the class IS the token type. In open
 * source the class is `runner` for every bound execution, and the
 * binding's KIND lives in the token, readable by the one function that
 * interprets runner tokens (`isWorkflowBoundRunner` in
 * runnerauth/built-in-runner-credential-provider.ts). Handing that
 * reading in as `isAdmittedLane` keeps this module free of token
 * knowledge and lets the cloud adopt the same shape later without a
 * second class name. An AGENT-bound runner is NOT admitted: a subagent
 * create is checked as the human, the cloud's `sandbox` posture.
 *
 * Narrow by construction: an admitted lane on any NON-run-gate check,
 * and any other caller on any check, delegate untouched. The cloud's
 * header records one caveat — a human who can view a workflow execution
 * can exchange for its token and replay it against the run gate. Open
 * source has no such caveat: under this posture the exchange is a mint
 * gate that answers only the run's own person (the built-in provider's
 * exchangeScopedToken, runnerauth/built-in-runner-credential-provider.ts),
 * so the only human who can hold a workflow's credential is the one whose
 * workflow it is — and their own run gate already passed.
 */
import type { CallerIdentity } from "../extensions/identity.js";
import type {
  Authorizer,
  AuthzCheck,
  AuthzDecision,
} from "../extensions/authorizer.js";
import { isRunGateCheck } from "../pipeline/steps/authorize-run-target.js";

const ADMITTED: AuthzDecision = { kind: "allow" };

/** Whether `caller` is a lane whose admission to CREATE a run was decided upstream. */
export type LaneAdmissionPredicate = (caller: CallerIdentity) => boolean;

export function newLaneAdmittedAuthorizer(
  inner: Authorizer,
  isAdmittedLane: LaneAdmissionPredicate,
): Authorizer {
  return {
    authorize(
      caller: CallerIdentity,
      check: AuthzCheck,
    ): Promise<AuthzDecision> {
      if (isRunGateCheck(check) && isAdmittedLane(caller)) {
        return Promise.resolve(ADMITTED);
      }
      return inner.authorize(caller, check);
    },
  };
}
