// The tenancies and people of a target whose primary ENFORCES the model.
// Domain: conformance harness.
//
// The Cloud and Enterprise targets drive a server that authenticates every
// caller and authorizes every row, with real people on it. Both make those
// people the same way, and this module is that way, written once:
//
//   - A tenancy is a real organization the primary creates and so owns,
//     named by its id as every resource is, and deleted by that id at
//     cleanup. Only what this target made is deleted, without widening
//     TenancyContext beyond the shape the suites share with the local
//     targets.
//   - A person is an access token for a fresh subject from the issuer the
//     server trusts, then `provisionMyAccount` through clients presenting it:
//     the console's first sign-in, over the wire, so the person is a real
//     account before any grant names them. Where the token comes from is the
//     target's business (the Cloud's direct-login tenant, Enterprise's
//     loopback issuer); nothing else differs.
//   - A newcomer holds nothing. Neither server makes a person a member of
//     anything at sign-in (open source's membership rules do, which is why
//     its enforcing lane is a different builder, enforcing-lane.ts), so the
//     outsider needs no revoking and the colleague is one ordinary grant:
//     `member` on the tenancy's organization, made by the primary as its
//     owner through Grant create, the Members page's call.
import type { GrantSpec } from "@stigmer/protos/ai/stigmer/iam/grant/v1/spec_pb";

import { createUniqueOrganization } from "../support/organizations";
import type { TenancyContext } from "../targets/target";
import type { ConformanceClients } from "./clients";
import { organizationRoleGrant } from "./enforcing-lane";

// How long a person's token lives: a whole run on one mint, since a target
// holds its founder for every suite file it serves.
export const PERSON_TOKEN_TTL_SECONDS = 8 * 60 * 60;

export interface ProvisionedPerson {
  // The person's access token, bound to no organization.
  readonly token: string;
  // The identity account the first sign-in made: the principal a grant names.
  readonly accountId: string;
}

// A person from a fresh subject's token: the first sign-in a console runs
// (provisionMyAccount), through the clients that present the token.
export async function provisionPerson(
  token: string,
  presenting: (token: string) => Pick<ConformanceClients, "identityAccountCommand">,
): Promise<ProvisionedPerson> {
  const account = await presenting(token).identityAccountCommand.provisionMyAccount({});
  const accountId = account.metadata?.id ?? "";
  if (accountId === "") {
    throw new Error("provisionMyAccount answered no account for a fresh person");
  }
  return { token, accountId };
}

// The ordinary grant that makes an identity a `member` of an
// organization — the Members-page grant, through GrantCommandController.
// create as the org's owner (never bootstrapGrant, which is the operator
// lane for grants the ordinary create cannot express). The general form,
// any role, is the enforcing lane's `organizationRoleGrant`.
export function organizationMemberGrant(organizationId: string, identityAccountId: string): GrantSpec {
  return organizationRoleGrant(organizationId, identityAccountId, "member");
}

export interface PrimaryPeopleDeps {
  // The primary caller, who founds and owns every tenancy.
  founder(): ConformanceClients;
  // An access token for a fresh subject from the issuer the server trusts.
  // `caller` names the target method asking, for the target's refusal
  // before setup.
  freshToken(caller: string): Promise<string>;
  // Clients presenting exactly the given bearer against the primary.
  clientsPresenting(token: string): ConformanceClients;
}

export class PrimaryPeople {
  // The organizations provisioned, keyed by the id a TenancyContext names
  // (the value repeats it).
  private readonly organizationIds = new Map<string, string>();

  constructor(private readonly deps: PrimaryPeopleDeps) {}

  async provisionTenancy(): Promise<TenancyContext> {
    const { id } = await createUniqueOrganization(this.deps.founder().organizationCommand, "tenancy");
    this.organizationIds.set(id, id);
    return { org: id };
  }

  // Deletes the tenancy's organization once; a tenancy this target did not
  // provision, or already released, is left alone.
  async cleanupTenancy(context: TenancyContext): Promise<void> {
    const id = this.organizationIds.get(context.org);
    if (id === undefined) return;
    this.organizationIds.delete(context.org);
    await this.deps.founder().organizationCommand.delete({ value: id });
  }

  // The organization id behind a tenancy this target provisioned — what a
  // grant names. `caller` names the method asking, for the refusal.
  organizationIdOf(tenancy: TenancyContext, caller: string): string {
    const organizationId = this.organizationIds.get(tenancy.org);
    if (organizationId === undefined) {
      throw new Error(
        `${caller}: tenancy "${tenancy.org}" was not provisioned by this target (provisionTenancy() first)`,
      );
    }
    return organizationId;
  }

  // A brand-new person holding no grant on any organization: the outsider
  // for isolation assertions.
  async provisionIdentity(): Promise<ConformanceClients> {
    const person = await this.newPerson("provisionIdentity");
    return this.deps.clientsPresenting(person.token);
  }

  // A brand-new person granted exactly `member` on the tenancy, by the
  // founder: the colleague, past the organization-level checks and subject
  // to every resource-level rule.
  async provisionMember(tenancy: TenancyContext): Promise<ConformanceClients> {
    const organizationId = this.organizationIdOf(tenancy, "provisionMember");
    const person = await this.newPerson("provisionMember");
    await this.deps.founder().grantCommand.create(organizationMemberGrant(organizationId, person.accountId));
    return this.deps.clientsPresenting(person.token);
  }

  // Forgets every tenancy, at the target's teardown.
  forget(): void {
    this.organizationIds.clear();
  }

  private async newPerson(caller: string): Promise<ProvisionedPerson> {
    return provisionPerson(await this.deps.freshToken(caller), (token) => this.deps.clientsPresenting(token));
  }
}
