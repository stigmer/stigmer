# Task T01: Integration Architecture Plan — Stigmer × Planton

**Created**: 2026-02-18
**Updated**: 2026-02-18 (v3 — open questions resolved, Decision 6 revised after FGA analysis)
**Status**: Approved Architecture — Ready for Implementation

## Research Summary

Deep Research report analyzed 8 real-world case studies (Stripe Connect, Twilio subaccounts, Auth0 Organizations, Okta multi-tenancy, Temporal Cloud namespaces, AWS Step Functions + STS, OpenAI API, Vercel/Netlify) and 6 identity federation patterns.

Full report: `research.saas-platform-integration-identity-federation/04.report.gpt.md`

## Architectural Review Findings

The initial plan proposed introducing "Platform Tenant" and "Workspace" as new hierarchy levels. After DDD review, this was **rejected** for the following reasons:

1. **Workspace is a synonym for Organization.** Both are isolation boundaries where resources live. Introducing a synonym fractures the ubiquitous language.
2. **The Stripe/Twilio case studies were misread.** Their "connected accounts" / "subaccounts" are the same entity type as their normal accounts — just with a parent relationship. They did NOT introduce a new hierarchy level.
3. **Resource addressing would break.** Going from `org/slug` (2 levels) to `platform/workspace/slug` (3 levels) would require rewriting `ApiResourceReference`, every API endpoint, every CLI command, and every resource reference.
4. **Token Exchange (RFC 8693) and SCIM are YAGNI.** For a single integration partner that we also control, the signed JWT approach provides all needed security properties. SCIM is designed for enterprise directory sync, not platform-to-platform integration.

### Post-v2 Correction: Decision 6 (User Identity)

The v2 plan stated "no shadow users — external identity is an audit attribute, not a domain entity." This was **revised** after analyzing Stigmer's FGA architecture:

- Stigmer's OpenFGA model uses `identity_account:<id>` as the **only** principal type for authorization tuples.
- `RequestAuthorizationService.authorize()` hard-rejects empty identity account IDs.
- Organization membership is stored as `organization:<org_id>#member@identity_account:<user_id>`.
- Resource access resolves transitively through org membership: `member from organization`.

**Without an `identity_account` entity, a federated user cannot participate in FGA authorization at all.** The v2 critique confused authentication behavior (logging in) with authorization behavior (being the subject of permission checks). An entity that participates in FGA is not anemic — it carries real domain behavior.

---

## Revised Architecture: Organization Stays, No New Hierarchy

### Core Principle

**Organization remains the single isolation boundary and the single resource addressing level.** The integration with Planton is achieved by adding a *management mode* and an *identity provider* concept — not a new hierarchy.

### Decision 1: Product Positioning — Hybrid, but Lightweight

Stigmer serves both direct users and embedding platforms. The difference is **how organizations are created and operated**, not what kind of entity they are.

- **Self-managed orgs**: User signs up, creates org, manages it directly via Stigmer UI/CLI/API.
- **Platform-managed orgs**: Created programmatically by an external platform (Planton) via an identity provider. Operated by the platform on behalf of its users.

Both are Organizations. Same data model. Same isolation. Same resource addressing.

### Decision 2: Organization Model — Add Management Mode

Extend the existing Organization with:

| Field | Type | Purpose |
|---|---|---|
| `management_mode` | enum: `SELF_MANAGED`, `PLATFORM_MANAGED` | How this org is operated |
| `identity_provider_ref` | string (nullable) | Which identity provider authenticates requests for this org |
| `external_org_id` | string (nullable) | Maps to the platform's org identifier |

For self-managed orgs, the new fields are null. For platform-managed orgs, they point to the managing credential and the external identifier.

### Decision 3: IdentityProvider — New First-Class Concept

An `IdentityProvider` represents an external platform's trust relationship with Stigmer.

| Field | Purpose |
|---|---|
| `slug` | e.g., `planton` |
| `display_name` | e.g., "Planton" |
| `jwks_uri` | Where to fetch the platform's signing keys (NOT Auth0 — see Decision 5) |
| `allowed_issuers` | JWT `iss` values Stigmer will accept |
| `expected_audience` | JWT `aud` value (e.g., `stigmer-api`) |
| `rate_limit_budget` | Shared rate limit across all orgs managed by this credential |
| `status` | `ACTIVE`, `SUSPENDED`, `REVOKED` |

**Capability**: An identity provider grants the registered platform the ability to:
- Create platform-managed organizations
- Call Stigmer APIs within those organizations on behalf of its users
- Pass user identity as a signed JWT assertion

### Decision 4: Resource Addressing — Unchanged

```
org-slug/resource-slug
```

Examples:
- `acme/deploy-k8s-cluster` (agent in a platform-managed org)
- `my-company/code-reviewer` (agent in a self-managed org)

`ApiResourceReference` stays exactly as it is: `org` + `kind` + `slug`. No changes.

### Decision 5: Auth — Service Credential + Signed JWT Assertion

#### IdP Context

Both Planton and Stigmer use Auth0, but with **separate tenants**:

| System | Auth0 Tenant | JWKS | Audience |
|---|---|---|---|
| Planton | `planton-prod.us.auth0.com` | Auth0-managed | `https://api.planton.ai/` |
| Stigmer | `stigmer-prod.us.auth0.com` | Auth0-managed | `https://api.stigmer.ai/` |

These are independent trust boundaries. Auth0 tokens from one tenant cannot be used with the other (different signing keys, different audiences).

#### Why Auth0 Doesn't Solve Cross-Platform Auth Automatically

- **Forwarding user tokens fails**: A Planton user's Auth0 token has `aud: https://api.planton.ai/`. If Stigmer accepted it, any service the user calls could replay it against Stigmer — confused deputy vulnerability.
- **Auth0 M2M (Client Credentials) loses user context**: The token says "Planton backend" but not "on behalf of user X." We need user identity for FGA.
- **Auth0 Token Exchange**: Auth0 doesn't natively support RFC 8693 token exchange across tenants.

#### The Approach: Platform-Signed JWT Assertions

Planton signs its **own** short-lived JWTs for Stigmer calls. This is independent of Auth0 — Planton generates its own signing key pair and exposes a JWKS endpoint.

```
┌──────────────┐     service cred + signed JWT assertion     ┌──────────────┐
│ Planton │ ──────────────────────────────────────────► │   Stigmer    │
│               │                                             │              │
│  user auth'd  │  JWT claims:                                │  validates:  │
│  via PC's     │    iss: planton                       │   signature  │
│  own Auth0    │    aud: stigmer-api                         │   iss/aud    │
│               │    sub: pc-user-stable-id                   │   expiry     │
│               │    org: planton-org-id (→ Stigmer org)      │   org match  │
│               │    email: user@example.com (optional)       │              │
│               │    exp: short TTL (5 minutes)               │  extracts:   │
│               │    jti: unique request ID                   │   subject    │
│               │                                             │   for FGA    │
└──────────────┘                                              └──────────────┘
```

**End-to-end flow:**

1. User authenticates to Planton (via Planton's Auth0 — normal flow)
2. User triggers an action that needs Stigmer (e.g., run an agent)
3. Planton backend:
   - Knows the user (from their Auth0 session)
   - Mints a short-lived JWT for Stigmer (signed with Planton's own private key, NOT Auth0's key)
   - Calls Stigmer API with that JWT + identity provider identifier
4. Stigmer:
   - Reads identity provider identifier → finds `IdentityProvider` config
   - Fetches JWKS from the credential's `jwks_uri` (Planton's endpoint, NOT Auth0's endpoint)
   - Validates JWT signature, `iss`, `aud`, `exp`
   - Extracts `sub` (user) and `org` claims
   - JIT-provisions `identity_account` if needed (see Decision 6)
   - Runs FGA authorization check using the `identity_account`
   - Executes the request

**Stigmer validates:**
1. Signature via JWKS from the identity provider's `jwks_uri`
2. `iss` matches `allowed_issuers` on the identity provider
3. `aud` matches `expected_audience`
4. `exp` is in the future (short TTL, minutes not days)
5. `org` claim maps to a platform-managed organization linked to this identity provider

**When would we add token exchange (RFC 8693)?** Only if a second embedding platform appears whose auth system cannot sign JWTs directly, forcing Stigmer to operate its own STS. Not before.

### Decision 6: User Identity — Federated Identity Accounts (REVISED)

Stigmer creates lightweight `identity_account` entities for platform-proxied users via **JIT (Just-In-Time) provisioning**. These are federated identities — they participate in FGA authorization but do not have credentials in Stigmer's Auth0 tenant.

#### Why This Is Required

Stigmer's OpenFGA authorization model hard-requires `identity_account` entities:
- All FGA tuples use `identity_account:<id>` as the principal type
- `RequestAuthorizationService` rejects empty identity account IDs
- Organization membership: `organization:<org_id>#member@identity_account:<user_id>`
- Resource access resolves through: `member from organization`

Without an `identity_account`, a federated user cannot be authorized to do anything.

#### Federated Identity Account Model

| Field | Value | Source |
|---|---|---|
| `id` | `ida_<ulid>` (Stigmer-generated) | Stigmer |
| `idp_id` | Planton user stable ID (from JWT `sub`) | JWT |
| `email` | From JWT `email` claim (optional, for display) | JWT |
| `is_machine_account` | `false` | Stigmer |
| `provisioning_mode` | `FEDERATED` | Stigmer |
| `provisioned_by` | Service credential ID | Stigmer |

#### New Enum: `IdentityAccountProvisioningMode`

| Value | Meaning |
|---|---|
| `DIRECT` | User signed up via Stigmer's Auth0 (existing behavior) |
| `FEDERATED` | User provisioned via identity provider on behalf of external platform |
| `MACHINE` | M2M client credentials (replaces the current `isMachineAccount` boolean) |

#### JIT Provisioning Flow

1. Planton sends request with signed JWT (`sub: pc-user-123`)
2. Stigmer validates JWT via identity provider's JWKS
3. Stigmer looks up `identity_account` by `idp_id = pc-user-123` AND `provisioned_by = <identity_provider_id>`
4. If not found → create new `identity_account` with `provisioning_mode = FEDERATED`
5. If org membership FGA tuple doesn't exist → create `organization:<org>#member@identity_account:<new_id>`
6. Proceed with normal FGA authorization check

#### What Federated Accounts Can and Cannot Do

| Capability | Supported |
|---|---|
| Be the principal in FGA authorization checks | Yes |
| Hold org membership (member, admin, owner) | Yes |
| Own resources they create | Yes |
| Appear in audit trails with stable identity | Yes |
| Log into Stigmer's UI directly | No (no Auth0 credentials in Stigmer's tenant) |
| Reset password / manage profile in Stigmer | No |
| Exist without ever being used | No (JIT — created on first interaction only) |

#### Why This Is Not the "Anemic Shadow User" That Was Previously Rejected

| T01 v2 "shadow user" (rejected) | Federated identity account (approved) |
|---|---|
| Created proactively via SCIM sync | Created on-demand (JIT) at first interaction |
| No behavior — exists "just in case" | Participates in FGA authorization (real behavior) |
| Duplicates IdP state | Stores only mapping + provenance, no credentials |
| Requires sync infrastructure | Zero sync infrastructure — provisioned from JWT claims |
| Anemic: can't log in, has no credentials, no behavior | Not anemic: is the principal in authorization decisions |

### Decision 7: Organization Lifecycle — Event-Driven Sync

Planton → Stigmer, one-way sync:

| Planton Event | Stigmer Action |
|---|---|
| Org created | Create new Organization (`PLATFORM_MANAGED`, linked to identity provider) |
| Org renamed / slug changed | Update Organization metadata (internal ID stays stable) |
| Org suspended | Set org status to suspended; reject new executions, allow in-flight to complete |
| Org deletion initiated | Soft-delete: suspend + start retention window |
| Retention expired | Hard-delete organization and associated data |

**Source of truth**: Planton. Sync is strictly one-way.

**Backfill**: One-time migration creates Stigmer organizations for all existing Planton orgs.

**Edge case**: If an execution request arrives before the org is provisioned, Stigmer returns a clear error (not found / not yet provisioned). No silent state creation.

### Decision 8: Billing — Aggregate by Service Credential

- Stigmer bills Planton as a single customer
- Usage is aggregated by querying: "all execution usage where `identity_provider_ref = planton`"
- Per-org breakdowns available for Planton to bill its own customers

No new hierarchy or billing entity needed. It's a query filter on the identity provider, not a structural change.

### Decision 9: Security Boundaries

| Concern | Approach |
|---|---|
| Token lifetime | Short-lived (5 minutes) |
| Audience restriction | Every JWT scoped to `stigmer-api` audience |
| Org scoping | Every JWT bound to a specific org; Stigmer verifies the org is managed by the presenting credential |
| Blast radius | If Planton's signing key is compromised, only platform-managed orgs under that credential are affected. Self-managed orgs and other platforms are untouched. |
| Key rotation | JWKS endpoint; Stigmer caches and refreshes signing keys on schedule |
| Replay protection | Short TTL + `jti` claim for deduplication on state-changing operations |
| Provider revocation | Setting identity provider status to `REVOKED` immediately blocks all requests |

### Decision 10: Organization Slug Naming — No Prefix, Availability-Checked

Platform-managed orgs follow the same slug rules as self-managed orgs. No prefix. No namespace separation.

**Rationale:**

| Alternative Considered | Why Rejected |
|---|---|
| `pc-{slug}` prefix | Leaks integration detail into public resource addressing. Creates second-class citizen orgs. Every resource address carries the platform provenance: `pc-acme/deploy-agent`. |
| Namespace separation | Would require changes to resource addressing (`platform/org/resource` = 3 levels). Breaks the core principle. |
| Opaque IDs (Stripe/Twilio style) | Stigmer uses human-readable slugs for resource addressing. Opaque IDs destroy UX. |

**How it works:**

1. Planton calls `createOrganization` with a desired slug
2. Stigmer checks slug availability (existing `checkSlugAvailability` pattern)
3. If available → org created with that slug
4. If taken → Stigmer returns error, Planton retries with alternative
5. Planton can adopt its own naming convention (e.g., always use `planton-{name}`) — that's Planton's policy, not Stigmer's constraint

**How collision is handled:** The `external_org_id` field on Organization stores Planton's org ID. Planton always uses `external_org_id` for reverse lookup. If Planton's slug `acme` was taken and they created `acme-pc` instead, the mapping `external_org_id → slug` handles the mismatch transparently.

**Industry precedent:** GitHub, Heroku, and Netlify all use globally unique slugs with no platform prefix. First-come-first-served.

### Decision 11: Platform-Managed Org Visibility — Fully Visible

Platform-managed orgs are visible in Stigmer's UI and API like any other organization. No hiding, no special filtering.

**Rationale:** Platform-managed orgs are Organizations — same model, same isolation, same resource addressing. Hiding them creates a parallel universe of invisible orgs that still consume resources, appear in billing, and exist in the database. Access control is handled by FGA — only users with appropriate org membership see and interact with the org. This is an authorization concern, not a visibility concern.

### Decision 12: Branding — Default Stigmer, No White-Label

Platform-managed orgs display standard Stigmer branding. No white-labeling, no conditional theming.

**Rationale:** White-labeling is a product feature (CSS/theming infrastructure, brand-asset management, conditional rendering), not an integration requirement. When Planton calls Stigmer's API, the response is data — no branding. If a federated user somehow accesses Stigmer's UI directly, they see Stigmer. Revisit only if a paying customer explicitly requests white-label capability.

---

## Implementation Phases

### Phase 1: IdentityProvider and Platform-Managed Organizations

**Scope**: Extend Stigmer's organization model to support platform management.

**Implementation target: `stigmer-cloud` (Java). All of Phase 1 is TIER_CLOUD_ONLY. Protos live in `stigmer/apis/` (shared); controllers/storage/FGA go in `stigmer-cloud`.**

- [x] Add `management_mode`, `identity_provider_ref`, `external_org_id` fields to Organization proto — done in `apis/ai/stigmer/tenancy/organization/v1/`
- [x] Design and implement `IdentityProvider` resource proto — done in `apis/ai/stigmer/iam/identityprovider/v1/`
- [x] Add `identity_provider = 21` to `ApiResourceKind` enum (id_prefix: `idp`) — done in `apis/ai/stigmer/commons/apiresource/apiresourcekind/`
- [x] Remove orphaned `credential = 20` from `ApiResourceKind` — no proto package existed
- [x] Generate Go stubs for all new/updated protos — done in `apis/stubs/go/`
- [ ] **[stigmer-cloud]** Implement IdentityProvider CRUD (controller, Temporal workflow, MongoDB repository, FGA tuple creation)
- [ ] **[stigmer-cloud]** Extend Organization creation/update to handle `management_mode` + `identity_provider_ref` immutability
- [ ] **[stigmer-cloud]** Validate platform_managed orgs require active `identity_provider_ref`; self_managed orgs reject it
- [ ] **[stigmer-cloud]** Block IdentityProvider deletion when platform-managed orgs reference it
- [ ] **[stigmer-cloud]** Ensure all existing org behavior (agents, skills, workflows, executions) works identically for platform-managed orgs

### Phase 2: Signed JWT Authentication + Federated Identity Accounts

**Scope**: Enable Planton to authenticate and pass user context, with JIT identity provisioning.

- [ ] Add `provisioning_mode` enum to IdentityAccount (`DIRECT`, `FEDERATED`, `MACHINE`)
- [ ] Add `provisioned_by` field to IdentityAccount (identity provider reference)
- [ ] Migrate existing `isMachineAccount` boolean to `provisioning_mode = MACHINE`
- [ ] Implement JWT assertion validation in Stigmer's auth layer (JWKS fetch, `iss`/`aud`/`exp`/`org` validation)
- [ ] Wire identity provider config to JWT validation (per-provider JWKS URI, allowed issuers)
- [ ] Implement JIT provisioning: on validated JWT, look up or create federated `identity_account`
- [ ] Implement JIT org membership: on first interaction with an org, create FGA membership tuple
- [ ] Propagate federated identity through execution pipeline (audit trail)
- [ ] Integration test: Planton user action → Stigmer execution → FGA check passes → audit trail shows full actor chain

### Phase 3: Organization Lifecycle Sync

**Scope**: Automate org provisioning tied to Planton org lifecycle.

- [ ] Design event/webhook contract between Planton and Stigmer
- [ ] Implement handlers for: org created, renamed, suspended, deletion initiated
- [ ] Implement two-phase deletion (suspend → retention window → hard delete)
- [ ] Build backfill migration for existing Planton orgs
- [ ] Add monitoring for sync failures and provisioning lag
- [ ] Handle race condition: execution request before org provisioned

### Phase 4: Billing and Usage Attribution

**Scope**: Per-org metering with identity-provider-level aggregation.

- [ ] Instrument execution pipeline for per-org usage metrics
- [ ] Build usage query API (filter by identity provider for platform-level rollups)
- [ ] Design billing integration with Planton

---

## What Changes in Each Product

### Stigmer Changes

1. **New fields on Organization**: `management_mode`, `identity_provider_ref`, `external_org_id`
2. **New resource**: `IdentityProvider` (configures trust with an external platform's identity assertions)
3. **New auth path**: JWT assertion validation alongside existing Stigmer auth
4. **New identity mode**: `FEDERATED` provisioning for identity accounts (JIT from JWT claims)
5. **New enum on IdentityAccount**: `provisioning_mode` replacing `isMachineAccount` boolean
6. **FGA integration**: Federated identity accounts participate in authorization identically to direct accounts
7. **No new hierarchy level. No workspace concept. No changes to resource addressing.**

### Planton Changes (For Reference — Not Part of Stigmer's Implementation Scope)

These are the steps Planton needs to implement on their side:

#### 1. One-Time Setup: Signing Key Infrastructure

- Generate an RSA or EC key pair for signing Stigmer-bound JWTs
- Expose the public key as a JWKS endpoint (e.g., `https://api.planton.ai/.well-known/stigmer-jwks.json`)
- This is a static JSON file or a simple API endpoint — no Auth0 configuration needed
- Key rotation: generate new key, publish both old and new in JWKS, remove old after TTL

#### 2. JWT Signing Utility (~50 lines of code)

When Planton's backend needs to call Stigmer on behalf of a user:

```
JWT claims:
  iss: "planton"
  aud: "stigmer-api"
  sub: <planton-user-identity-account-id>   (stable user ID)
  org: <planton-org-id>                      (maps to Stigmer org via external_org_id)
  email: <user-email>                        (optional, for display/audit)
  exp: now + 5 minutes                       (short-lived)
  jti: <uuid>                                (unique per request, for replay protection)
Signed with: Planton's private key (RSA256 or EC256)
```

#### 3. Org Lifecycle Side Effects

- On org creation → call Stigmer API to create platform-managed organization
- On org rename → call Stigmer API to update org metadata
- On org suspend → call Stigmer API to suspend org
- On org delete → call Stigmer API to initiate deletion

#### 4. What Planton Does NOT Need to Do

- No Auth0 configuration changes (signing key is independent of Auth0)
- No SCIM sync
- No user provisioning (Stigmer handles JIT provisioning from JWT claims)
- No token exchange protocol implementation
- No Stigmer SDK (standard HTTPS + JWT is sufficient)

---

## What We Deliberately Did NOT Do

| Avoided | Why |
|---|---|
| Workspace hierarchy | Organization already serves as isolation boundary. Adding workspaces would break resource addressing and fragment the ubiquitous language. |
| Platform Tenant entity | Billing and rate limiting are achievable by querying on identity provider. A structural entity is over-engineering. |
| Shadow Users via SCIM sync | Proactive user sync adds infrastructure for no benefit. JIT provisioning from JWT claims is simpler and creates users only when needed. |
| Auth0 Custom Token Exchange (RFC 8693) | Auth0's CTE feature handles this scenario natively (cross-platform token exchange with JIT user creation, Auth0-managed keys). However, it requires Auth0 Enterprise or B2B Pro plan, which neither product currently has. **Upgrade path**: if we move to Enterprise, migrate from custom JWT signing to CTE — this eliminates Planton's signing key management and Stigmer's custom JWT validation path entirely. Auth0 handles everything. |
| SCIM | Wrong tool. SCIM is for enterprise directory sync, not platform-to-platform integration. |
| Org slug prefix convention | Leaks integration details into resource addressing. Treats platform-managed orgs as second-class. |
| White-labeling | Product feature, not integration requirement. No paying customer has requested it. |
| Forwarding Planton's Auth0 tokens directly | Auth0 tokens are audience-bound. Planton's Auth0 tokens are for `https://api.planton.ai/`, not for Stigmer. Forwarding them would be a confused deputy vulnerability. Auth0 M2M tokens lose user identity. Neither option works for backend-to-backend-on-behalf-of-user calls. |

---

## Resolved Questions

| # | Question | Answer | Rationale |
|---|---|---|---|
| 1 | What IdP does Planton use? | Auth0 (`planton-prod.us.auth0.com`), separate tenant from Stigmer (`stigmer-prod.us.auth0.com`). | Both use Auth0 but on separate tenants. Auth0's Custom Token Exchange (RFC 8693) could handle cross-platform auth natively, but requires Enterprise/B2B Pro plan (not currently available). Using custom JWT signing instead — Planton signs its own JWTs with a self-managed key pair. |
| 2 | Should platform-managed orgs be visible? | Yes, fully visible. | Same entity type as all orgs. Access control via FGA, not visibility filtering. |
| 3 | Naming convention for org slugs? | No prefix. First-come-first-served. Availability-checked. | Industry standard (GitHub, Heroku). Prefix creates second-class citizens and leaks integration details. |
| 4 | Should users see Stigmer branding? | Yes, default Stigmer. No white-label. | White-labeling is scope creep. API responses carry no branding. UI shows Stigmer if directly accessed. |

---

## Session 2 Revision (2026-02-19): Architecture Significantly Simplified

> **Important**: The architecture below supersedes the Phase 2-4 descriptions above. Phase 1 proto work (completed in Session 1) remains valid. The authentication/integration approach has been fundamentally revised based on deep design discussion and external research.
>
> Full details: `checkpoints/2026-02-19-session-2.md`

### Summary of Changes

After deep design discussion and external research (ChatGPT Deep Research on SaaS-to-SaaS integration patterns, 10+ case studies), the authentication and integration architecture was significantly revised.

**Before (Session 1)**: Custom RSA key pair → JWKS on GitHub Pages → proxy mints custom JWTs → Stigmer validates against custom JWKS on every API call.

**After (Session 2)**: Planton's Auth0 JWT forwarded as-is → Stigmer token exchange endpoint validates against Auth0's public JWKS → Stigmer issues native token → all API calls use Stigmer token.

### Key Insight: Token Exchange Solves the Audience Problem

The Session 1 concern that "forwarding Auth0 tokens is a confused deputy vulnerability" was resolved by adding a token exchange endpoint. The external JWT (with `aud: api.planton.ai`) only goes to the token exchange endpoint, which is designed to accept external tokens. Stigmer issues its own token with `aud: stigmer-api` for API calls.

### Revised Implementation Phases

#### Phase 1 (Revised): IdentityProvider + Token Exchange (MVP Core)

**Stigmer side (`stigmer-cloud`)**:
- [ ] Add `userinfo_uri` field to IdentityProvider proto spec
- [ ] Implement IdentityProvider CRUD (controller, Temporal workflow, MongoDB repo, FGA tuples)
- [ ] Implement token exchange endpoint (validate external JWT via IdentityProvider JWKS, call UserInfo for profile, JIT provision identity_account with email/name/picture, auto-grant org membership, issue Stigmer-native token)
- [ ] Extend Organization CRUD for `management_mode` + `identity_provider_ref` immutability
- [ ] Add `provisioning_mode` enum to IdentityAccount (`DIRECT`, `FEDERATED`, `MACHINE`)
- [ ] Add `email`, `display_name`, `picture_url` fields to identity_account (updated on every token exchange)

#### Phase 2 (Revised): Proxy SDK + Planton Integration

**Stigmer side**:
- [ ] Build `stigmer-proxy-sdk` Go library (token exchange client, gRPC forwarding, user/org extraction, interceptor hooks)
- [ ] Build pre-built Docker image (SDK with zero interceptors for internal-only deployments)

**Planton side**:
- [ ] Write proxy program (~20 lines Go: import SDK, add authz interceptor, start server)
- [ ] Deploy proxy as internal service behind Planton's API gateway
- [ ] Integration testing end-to-end

#### Phase 3: Organization Lifecycle Sync (unchanged from above)

#### Phase 4 (Revised): Post-MVP Enhancements
- [ ] API key support through proxy (custom JWT minting fallback)
- [ ] Fine-grained role mapping (member/admin/owner from platform claims)
- [ ] Billing/usage attribution per IdentityProvider

### What Was Eliminated

| Eliminated | Why |
|---|---|
| Custom RSA key pair generation | Auth0's JWKS is already public and managed |
| JWKS publishing on GitHub Pages | IdentityProvider points to Auth0's `.well-known/jwks.json` |
| Custom JWT minting in proxy | Auth0 JWT forwarded directly to token exchange |
| Key rotation infrastructure | Auth0 handles key rotation automatically |
| Auth0 Actions for profile claims | OIDC UserInfo endpoint provides email/name/picture |
| API key support (MVP) | JWT-only covers web console + CLI; API keys deferred |
| 8+ proxy env vars | Proxy SDK config, primarily needs `STIGMER_ENDPOINT` |

### Design Decisions (Session 2)

Full list with rationale in `checkpoints/2026-02-19-session-2.md`:
- DD-01: Token Exchange over Direct JWT Acceptance
- DD-02: IdentityProvider Points to Auth0's Public JWKS
- DD-03: Proxy SDK with Interceptor Hooks (Not Config-Only Image)
- DD-04: Profile Data via OIDC UserInfo Endpoint
- DD-05: JWT-Only for MVP (API Keys Deferred)
- DD-06: Auto-Grant Org Membership (Behind Platform's Authz Boundary)
- DD-07: IdentityProvider Stores UserInfo URI
- DD-08: Federated Identity Account Must Store Profile Data
- DD-09: Two Auth Flows (User-Context and System-Level)
