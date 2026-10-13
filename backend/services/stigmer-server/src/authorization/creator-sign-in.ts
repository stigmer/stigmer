/**
 * An automation acting as its creator, held to the creator's sign-in. A
 * schedule fires, an evaluator's AI judge grades and an eval's tries run as
 * the person who created the row (schedule-fire-caller.ts,
 * grading-caller.ts, plugin-eval-caller.ts beside this file), read from a
 * creation stamp nothing changes. When the row's organization requires its
 * people to sign in a particular way (extensions/organization-sign-in-rule.ts)
 * and the creator's account does not count there, the automation must not
 * keep acting as someone the organization no longer admits: each mint asks
 * the credential binding's `signInRefusal` for the row's organization once
 * the creator is resolved, and a refusal is the mint's own deterministic
 * refusal, worded so the creator learns why and what to do. A schedule then
 * pauses with that copy instead of failing at the launch gate on every
 * tick.
 *
 * With no rule composed the binding answers nothing, so every mint answers
 * exactly as before. A read fault propagates as the infrastructure throw
 * each seam already treats it as.
 */
import type { AuthzRefusal } from "../extensions/authorizer.js";
import type { CredentialBinding } from "../extensions/credential-binding.js";
import type { CallerIdentity } from "../extensions/identity.js";

/** What a mint asks: the binding's sign-in refusal alone. */
export type CreatorSignInCheck = Pick<CredentialBinding, "signInRefusal">;

/** The refusal `creator` meets in `org`, or undefined when there is none or no check is composed. */
export function creatorSignInRefusal(
  check: CreatorSignInCheck | undefined,
  creator: CallerIdentity,
  org: string,
): Promise<AuthzRefusal | undefined> {
  return check === undefined
    ? Promise.resolve(undefined)
    : check.signInRefusal(creator, org);
}

/**
 * The copy of a mint's refusal: the rule's own sentence, then what it means
 * for this automation. `noun` names the row as its owner calls it
 * ("schedule", "evaluator", "plugin eval").
 */
export function refusedCreatorMessage(
  noun: string,
  id: string,
  refusal: AuthzRefusal,
): string {
  return `${refusal.message} The ${noun} ${id} runs as the account that created it, which this organization no longer admits; make it again while signed in the way the organization requires.`;
}
