# Enterprise Authorization Coverage Inventory

This document is the coverage inventory for the RPCs the Enterprise identity unit serves (`src/extension/enterprise-identity.ts`): every method of the FederationIssuer, Invitation and Team services, classified by the proto annotation it carries and by what its handler runs. It is the Enterprise half of the open-source server's own inventory and reads the same way: the "How to read the tables" section of stigmer/stigmer's `backend/services/stigmer-server/docs/authorization-coverage.md` defines the columns and the markers, and this document uses them unchanged. It MUST be updated whenever a method is added or removed, a `config`, `is_public` or `is_skip_authorization` annotation changes, or a guard it names is renamed.

The unit's own test (`src/extension/__tests__/enterprise-identity.test.ts`) holds it to the served server: the rows are exactly the methods the unit binds, each row's annotation is the descriptor's (for a `config` row, its permission, its resource kind, the field or id its target is read from, and whether it carries its own copy), every row that is not `config` names what guards it, and every `guard:` names a step or a guard function declared once in the three kinds' own code, or a step of `@stigmer/server`'s.

In short:

- **Annotation** is what the method's proto declares: `config: <permission> on <resource_kind>` with the field the target is resolved from and whether `error_msg` is set, `is_public`, `is_skip_authorization`, or `none`.
- **Handler** is what the unit runs. Every handler here is the composition's unary chain (`src/rpc/unary-chain.ts`), whose Authorize step reads the method's own descriptor, so every row is `chain-with-Authorize`.
- **Every row that is not `config` names what guards it**, with `guard: <Name>` (a step or a guard function, named by its factory or function where the step's own name repeats across kinds), `driver: <Seam>` or `by design: <reason>`. A list lane is `config` on its organization and then narrowed by the list read scope, so no row here needs a driver.
- **Every row that is not `config` and whose request names no organization says how an organization being deleted is refused there**, with the open-source inventory's fourth marker: `deleting: <Name>`, the step or function that refuses it (declared in the three kinds' own code or the library's), or `deleting: inert, <reason>`. A request that names an organization meets the library's deleting rule before any handler runs, so its row needs none.

## FederationIssuer

| Method | Annotation | Handler |
|---|---|---|
| FederationIssuerCommandController.apply | none | chain-with-Authorize (guard: AuthorizeResolvedTarget — `can_create_federation_issuer` on the request's organization, create's own question and copy, before the slug is resolved; the create or update arm then runs its own chain under its own annotation) |
| FederationIssuerCommandController.create | config: can_create_federation_issuer on organization (field metadata.org), error_msg yes | chain-with-Authorize |
| FederationIssuerCommandController.update | config: can_edit on federation_issuer (field resource.metadata.id), error_msg yes | chain-with-Authorize |
| FederationIssuerCommandController.rename | config: can_delete on federation_issuer (field resource_id), error_msg yes | chain-with-Authorize (the library's rename chain, `renameResource`, over this table's `modifyById`; a service account refused before the load, a provider being deleted after it) |
| FederationIssuerCommandController.delete | config: can_delete on federation_issuer (field resource_id), error_msg yes | chain-with-Authorize |
| FederationIssuerQueryController.get | config: can_view on federation_issuer (field value), error_msg yes | chain-with-Authorize |
| FederationIssuerQueryController.getByReference | is_skip_authorization | chain-with-Authorize (guard: newLoadIssuerByReferenceStep, then guard: AuthorizeResolvedTarget — the loaded row is authorized as `get`; a missing slug or id is NOT_FOUND only to a caller who holds `can_create_federation_issuer` on the organization, and `get`'s denial to anyone else) |
| FederationIssuerQueryController.list | config: can_view on organization (field org), error_msg yes | chain-with-Authorize |

## Invitation

| Method | Annotation | Handler |
|---|---|---|
| InvitationCommandController.create | config: can_grant_access on organization (field metadata.org), error_msg yes | chain-with-Authorize |
| InvitationCommandController.revoke | config: can_edit on invitation (field value), error_msg yes | chain-with-Authorize |
| InvitationCommandController.redeem | is_skip_authorization | chain-with-Authorize (by design: the token is the authorization; guard: newRefuseNonPersonCallerStep, guard: refuseBoundElsewhere and guard: refuseExistingMember — only a person may redeem, never through a credential bound to another organization (a limited API key, a minted user token, a federated token naming another tenant), and never into an organization where they already hold a role; deleting: organizationRefusal — the link's organization is read through the in-process organization lane, which answers not found for one being deleted, so the link is refused as gone) |
| InvitationQueryController.get | config: can_view on invitation (field value), error_msg yes | chain-with-Authorize |
| InvitationQueryController.list | config: can_view_access on organization (field org), error_msg yes | chain-with-Authorize |
| InvitationQueryController.getByToken | is_public | chain-with-Authorize (by design: the acceptance page's preview of the invitation its token names, shown before the person signs in; deleting: inert, the delete's pre-delete slot removes every invitation of the organization before it answers, and the purge any written after) |

## Team

| Method | Annotation | Handler |
|---|---|---|
| TeamCommandController.create | config: can_create_team on organization (field metadata.org), error_msg yes | chain-with-Authorize |
| TeamCommandController.update | config: can_edit on team (field resource.metadata.id), error_msg yes | chain-with-Authorize |
| TeamCommandController.rename | config: can_delete on team (field resource_id), error_msg yes | chain-with-Authorize (the library's rename chain, `renameResource`, over this table's `modifyById`) |
| TeamCommandController.delete | config: can_delete on team (field resource_id), error_msg yes | chain-with-Authorize |
| TeamQueryController.get | config: can_view on team (field value), error_msg yes | chain-with-Authorize |
| TeamQueryController.getByReference | is_skip_authorization | chain-with-Authorize (guard: newLoadTeamByReferenceStep, then guard: AuthorizeResolvedTarget — the loaded row is authorized as `get`; a missing slug or id is NOT_FOUND only to a caller who holds `can_view` on the organization, and `get`'s denial to anyone else) |
| TeamQueryController.list | config: can_view on organization (field org), error_msg yes | chain-with-Authorize |

## Refusals beside authorization

Two creates and one update run a step that is not an authorization question and that this inventory's columns do not carry: the growth gate (`src/iam/growth-gate.ts`). A host whose right to grow can end fills it, and the hosts that cannot leave it out:

- **Who fills it.** A self-hosted Enterprise server fills it from its license (`src/license/growth.ts`). A host with no license leaves it out.
- **Where it runs.** Last in the shaping steps of `TeamCommandController.create` (after the plan gate), `FederationIssuerCommandController.create` and `FederationIssuerCommandController.update`, before anything is written. `FederationIssuerCommandController.apply` reaches it through the arm it runs. The same check refuses `OrganizationCommandController.create` on the library's `org-create:pre-side-effect-gate`.
- **What it refuses with.** Once the license and its grace period have ended, `FAILED_PRECONDITION` with the reason `LICENSE_RENEWAL_REQUIRED`, as the contract documents on each of these commands.
- **What it never touches.** Invitations, their redeem, team members, every delete and every read.

One more step runs on the same slot, ahead of the growth gate, and only when the operator set `STIGMER_ORGANIZATION_CREATORS`: `OrganizationCreators` (`src/editions/organization-creators.ts`), registered by the license unit (`src/editions/enterprise.ts`). It admits the server acting as itself and a child organization (whose parent's admins `ValidateChildOrganization` has already asked), and refuses any other caller whose account is not listed with `PERMISSION_DENIED` and the reason `ORGANIZATION_CREATOR_NOT_LISTED`, as the contract documents on `OrganizationCommandController.create` and `apply`, before anything is written.
