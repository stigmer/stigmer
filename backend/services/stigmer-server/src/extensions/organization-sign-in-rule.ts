/**
 * The organization sign-in rule driver point: an organization may require
 * that the people who act in it signed in a particular way. Single
 * instance, registered as `drivers.organizationSignInRule`.
 *
 * Open source has one way to sign in and registers no rule: every answer
 * the credential binding gives stays as it was, byte for byte. An edition
 * that lets an organization connect its own single sign-on provider fills
 * it (Stigmer Enterprise: an organization whose SSO provider sets
 * `sso_required` counts only the accounts that provider signed in).
 *
 * The rule can only refuse. The credential binding asks it after every
 * other question has admitted the caller, and it answers either nothing or
 * the refusal the caller reads (authorization/credential-binding.ts). It
 * can never admit someone the composed Authorizer refused, and it is not a
 * way to replace the binding: the binding stays the composition's own,
 * never a unit's (extensions/credential-binding.ts says why).
 *
 * The contract:
 *   - Asked about people only: the binding asks for callers of class
 *     `user`, whatever the transport, so a request the server composes for
 *     a person, and an automation that acts as its creator, gets that
 *     person's answer. Every other class (a service account, a run's own
 *     credential, the platform's pipelines, the server itself, an edition's
 *     own lanes) is never asked.
 *   - `requiringOrgs` is cheap and read on every check: an implementation
 *     answers it from memory, so a server where no organization requires
 *     anything pays one set lookup per check. The binding asks `refusal`
 *     only for an organization in that set.
 *   - `refusal` may read (the caller's account, a policy row); the binding
 *     remembers its answer for the life of the request's identity, so it
 *     is asked at most once per organization per request. A read fault
 *     throws, and the binding answers it as an authorization outage, never
 *     as an admission.
 *   - Whom it holds is the rule's to say. The binding asks about every
 *     person reaching a row of a requiring organization, its own people or
 *     not (a child organization's member reading what the organization
 *     shares down, say); a rule that holds only the organization's own
 *     people answers nothing for anyone else, as Enterprise's does.
 */
import type { AuthzRefusal } from "./authorizer.js";
import type { CallerIdentity } from "./identity.js";

/** The organization sign-in rule (single-instance point, ExtensionDrivers.organizationSignInRule). */
export interface OrganizationSignInRule {
  /** The ids of the organizations that require anything of how their people signed in. */
  requiringOrgs(): Promise<ReadonlySet<string>>;
  /**
   * The refusal `caller` meets in `org`, one of `requiringOrgs`, or
   * undefined when the caller's sign-in counts there. Throws on a read
   * fault.
   */
  refusal(
    caller: CallerIdentity,
    org: string,
  ): Promise<AuthzRefusal | undefined>;
}
