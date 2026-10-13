# Enterprise Authorization Coverage Inventory

This document is the coverage inventory for the RPCs the Enterprise identity unit serves (`src/extension/enterprise-identity.ts`): every method of the IdentityProvider, Invitation and Team services, classified by the proto annotation it carries and by what its handler runs. It is the Enterprise half of the open-source server's own inventory and reads the same way: the "How to read the tables" section of stigmer/stigmer's `backend/services/stigmer-server/docs/authorization-coverage.md` defines the columns and the markers, and this document uses them unchanged. It MUST be updated whenever a method is added or removed, a `config`, `is_public` or `is_skip_authorization` annotation changes, or a guard it names is renamed.

The unit's own test (`src/extension/__tests__/enterprise-identity.test.ts`) holds it to the served server: the rows are exactly the methods the unit binds, each row's annotation is the descriptor's (for a `config` row, its permission, its resource kind, the field or id its target is read from, and whether it carries its own copy), every row that is not `config` names what guards it, and every `guard:` names a step or a guard function declared once in the three kinds' own code, or a step of `@stigmer/server`'s.

In short:

- **Annotation** is what the method's proto declares: `config: <permission> on <resource_kind>` with the field the target is resolved from and whether `error_msg` is set, `is_public`, `is_skip_authorization`, or `none`.
- **Handler** is what the unit runs. Every handler here is the composition's unary chain (`src/rpc/unary-chain.ts`), whose Authorize step reads the method's own descriptor, so every row is `chain-with-Authorize`.
- **Every row that is not `config` names what guards it**, with `guard: <Name>` (a step or a guard function, named by its factory or function where the step's own name repeats across kinds), `driver: <Seam>` or `by design: <reason>`. A list lane is `config` on its organization and then narrowed by the list read scope, so no row here needs a driver.
- **Every row that is not `config` and whose request names no organization says how an organization being deleted is refused there**, with the open-source inventory's fourth marker: `deleting: <Name>`, the step or function that refuses it (declared in the three kinds' own code or the library's), or `deleting: inert, <reason>`. A request that names an organization meets the library's deleting rule before any handler runs, so its row needs none.

## IdentityProvider

| Method | Annotation | Handler |
|---|---|---|
| IdentityProviderCommandController.apply | none | chain-with-Authorize (guard: AuthorizeResolvedTarget — `can_create_idp` on the request's organization, create's own question and copy, before the slug is resolved; the create or update arm then runs its own chain under its own annotation) |
| IdentityProviderCommandController.create | config: can_create_idp on organization (field metadata.org), error_msg yes | chain-with-Authorize (guard: OwnersDecideSsoRequired — a provider that sets `sso_required` also needs `can_assign_roles` on the organization, its owners; the host's SsoPlanGate when it fills one; `src/iam/provider/sso-required-steps.ts`) |
| IdentityProviderCommandController.update | config: can_edit on identity_provider (field metadata.id), error_msg yes | chain-with-Authorize (guard: OwnersDecideSsoRequired when the update changes `sso_required`; the host's SsoPlanGate when it turns it on) |
| IdentityProviderCommandController.rename | config: can_delete on identity_provider (field resource_id), error_msg yes | chain-with-Authorize (the library's rename chain, `renameResource`, over this table's `modifyById`; a service account refused before the load, a provider being deleted after it) |
| IdentityProviderCommandController.delete | config: can_delete on identity_provider (field resource_id), error_msg yes | chain-with-Authorize (guard: OwnersDecideSsoRequired when the provider sets `sso_required`: deleting it ends the requirement) |
| IdentityProviderCommandController.createAccessMove | is_skip_authorization | chain-with-Authorize (by design: moves only the caller's own access, so a signed-in person alone may ask, a service account or any other class refused; the organization must have a live SSO provider, and the library's move door refuses an owner; `src/iam/access-move/handlers.ts`) |
| IdentityProviderCommandController.redeemAccessMove | is_skip_authorization | chain-with-Authorize (by design: the single-use ticket is the authorization, as an invitation's token is; the redeemer must be the account the organization's SSO provider made, PERMISSION_DENIED otherwise; the move runs through the library's `bootstrapMoveOrgAccess` acting for the redeemer) |
| IdentityProviderQueryController.get | config: can_view on identity_provider (field value), error_msg yes | chain-with-Authorize |
| IdentityProviderQueryController.getByReference | is_skip_authorization | chain-with-Authorize (guard: newLoadProviderByReferenceStep, then guard: AuthorizeResolvedTarget — the loaded row is authorized as `get`; a missing slug or id is NOT_FOUND only to a caller who holds `can_create_idp` on the organization, and `get`'s denial to anyone else) |
| IdentityProviderQueryController.listByOrg | config: can_view on organization (field org), error_msg yes | chain-with-Authorize |
| IdentityProviderQueryController.previewSsoRequirement | config: can_assign_roles on organization (field org), error_msg yes | chain-with-Authorize (only the organization's owners decide how its members sign in; `src/iam/provider/requirement-preview.ts`) |
| IdentityProviderQueryController.getSsoProvider | is_public | chain-with-Authorize (by design: the login page's SSO discovery, asked before anyone signs in; it answers only what sign-in needs and never reads the caller; deleting: inert, the delete's pre-delete slot removes every identity provider of the organization before it answers, and the purge any written after) |

## Invitation

| Method | Annotation | Handler |
|---|---|---|
| InvitationCommandController.create | config: can_grant_access on organization (field metadata.org), error_msg yes | chain-with-Authorize |
| InvitationCommandController.revoke | config: can_edit on invitation (field value), error_msg yes | chain-with-Authorize |
| InvitationCommandController.redeem | is_skip_authorization | chain-with-Authorize (by design: the token is the authorization; guard: newRefuseNonPersonCallerStep, guard: refuseBoundElsewhere and guard: refuseExistingMember — only a person may redeem, never through a credential bound to another organization (a limited API key, a PlatformClient user token, a federated token naming another tenant), and never into an organization where they already hold a role; deleting: organizationRefusal — the link's organization is read through the in-process organization lane, which answers not found for one being deleted, so the link is refused as gone) |
| InvitationQueryController.get | config: can_view on invitation (field value), error_msg yes | chain-with-Authorize |
| InvitationQueryController.listByOrg | config: can_view_access on organization (field org), error_msg yes | chain-with-Authorize |
| InvitationQueryController.getByToken | is_public | chain-with-Authorize (by design: the acceptance page's preview of the invitation its token names, shown before the person signs in; deleting: inert, the delete's pre-delete slot removes every invitation of the organization before it answers, and the purge any written after) |

## Team

| Method | Annotation | Handler |
|---|---|---|
| TeamCommandController.create | config: can_create_team on organization (field metadata.org), error_msg yes | chain-with-Authorize |
| TeamCommandController.update | config: can_edit on team (field metadata.id), error_msg yes | chain-with-Authorize |
| TeamCommandController.rename | config: can_delete on team (field resource_id), error_msg yes | chain-with-Authorize (the library's rename chain, `renameResource`, over this table's `modifyById`) |
| TeamCommandController.delete | config: can_delete on team (field resource_id), error_msg yes | chain-with-Authorize |
| TeamQueryController.get | config: can_view on team (field value), error_msg yes | chain-with-Authorize |
| TeamQueryController.getByReference | is_skip_authorization | chain-with-Authorize (guard: newLoadTeamByReferenceStep, then guard: AuthorizeResolvedTarget — the loaded row is authorized as `get`; a missing slug or id is NOT_FOUND only to a caller who holds `can_view` on the organization, and `get`'s denial to anyone else) |
| TeamQueryController.listByOrg | config: can_view on organization (field org), error_msg yes | chain-with-Authorize |

## Refusals beside authorization

Two creates and one update run a step that is not an authorization question and that this inventory's columns do not carry: the growth gate (`src/iam/growth-gate.ts`). A host whose right to grow can end fills it, and the hosts that cannot leave it out:

- **Who fills it.** A self-hosted Enterprise server fills it from its license (`src/license/growth.ts`). A host with no license leaves it out.
- **Where it runs.** Last in the shaping steps of `TeamCommandController.create` (after the plan gate), `IdentityProviderCommandController.create` and `IdentityProviderCommandController.update`, before anything is written. `IdentityProviderCommandController.apply` reaches it through the arm it runs. The same check refuses `OrganizationCommandController.create` on the library's `org-create:pre-side-effect-gate`.
- **What it refuses with.** Once the license and its grace period have ended, `FAILED_PRECONDITION` with the reason `LICENSE_RENEWAL_REQUIRED`, as the contract documents on each of these commands.
- **What it never touches.** Invitations, their redeem, team members, every delete and every read.
