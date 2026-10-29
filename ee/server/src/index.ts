/**
 * The public surface of Stigmer Enterprise as a package: one barrel, the
 * shape of `@stigmer/server`'s own, so what the package offers is read in
 * this one file and a later change to it is a reviewed change to a
 * versioned API. Named exports only: a clash between two modules is a
 * compile error here, never a silent shadow.
 *
 * What never leaves through it:
 *
 *   - the server's own composition from a license verdict
 *     (editions/enterprise.ts), and the two pieces it builds from a verified
 *     license: the status it reports and the growth freeze. The composition
 *     takes a trusted-key ring and a clock for its own tests; exported, these
 *     would be a documented way to stand up a licensed server over a key the
 *     caller made, while the trusted keys are compiled in with no way to add
 *     one. The identity unit itself composes with no key, by design: a host
 *     that brings its own authority composes it over its own ports;
 *   - the process entry (editions/enterprise-entry.ts), which starts a server
 *     when it loads, so nothing this barrel imports may reach it: importing
 *     the package has no side effect;
 *   - the handlers, the store adapter classes and the chain internals; a host
 *     composes the unit through its builder and ports.
 */

// ─── The Enterprise identity unit ────────────────────────────────────────────

export { ENTERPRISE_IDENTITY_UNIT, newEnterpriseIdentityExtension } from "./extension/enterprise-identity.js";
export type { EnterpriseIdentityPorts } from "./extension/enterprise-identity.js";
export { newGrowthGateStep } from "./iam/growth-gate.js";
export type { GrowthGate } from "./iam/growth-gate.js";
export type { TeamPlanGate } from "./iam/team/plan-gate.js";

// ─── Its Postgres side: the adapters over a host's pool, and the schema chain ─

export { newEnterprisePostgres } from "./schema/enterprise-postgres.js";
export type { EnterprisePostgres, EnterpriseSchema } from "./schema/enterprise-postgres.js";
export {
  ENTERPRISE_MIGRATION_LOCK_KEY,
  ENTERPRISE_MIGRATIONS,
  ENTERPRISE_SCHEMA,
  ENTERPRISE_SCHEMA_VERSION,
  runEnterpriseMigrations,
} from "./schema/enterprise-migrations.js";
export type { EnterpriseMigrationOptions } from "./schema/enterprise-migrations.js";

// ─── The license: the verifier, and the state a verified license is in ───────

export { verifyLicenseTicket } from "./license/verify.js";
export type { LicenseRefusal, LicenseRefusalKind, LicenseVerification } from "./license/verify.js";
export { EXPIRING_WINDOW_DAYS, isLapsed, licenseStateAt } from "./license/state.js";
export type { VerifiedLicenseState } from "./license/state.js";

// ─── The contract kits: the cases any adapter of the unit's ports must pass ──

export { identityAccountServiceContract } from "./iam/account/port-contract.js";
export type {
  IdentityAccountServiceContractFixture,
  IdentityAccountServiceUnderTest,
} from "./iam/account/port-contract.js";
export { federationIssuerStoreContract } from "./iam/issuer/store-contract.js";
export type { FederationIssuerStoreContractFixture } from "./iam/issuer/store-contract.js";
export { teamStoreContract } from "./iam/team/store-contract.js";
export type { TeamStoreContractFixture } from "./iam/team/store-contract.js";
export { invitationStoreContract } from "./iam/invitation/store-contract.js";
export type { InvitationStoreContractFixture } from "./iam/invitation/store-contract.js";
export { signInGrantLedgerContract } from "./iam/federation/sign-in-grants-contract.js";
export type { SignInGrantLedgerContractFixture } from "./iam/federation/sign-in-grants-contract.js";

// ─── Host building blocks ────────────────────────────────────────────────────
//
// The edition-neutral plumbing the unit runs on, which a host composing the
// unit beside units of its own uses too: the unary chain, the in-process
// transport, the transaction scaffold and the pool, the token and discovery
// helpers, the grant path and the repairs. They are exported as one group
// so that moving any of them into `@stigmer/server`, where the library may
// already carry an equivalent, removes lines here and nothing else.

export { runUnaryChain } from "./rpc/unary-chain.js";
export type { TransportRef } from "./rpc/transport-ref.js";
export { inTransaction, withTransaction } from "./postgres/transaction.js";
export { newCompositionPool } from "./postgres/pool.js";
export { audienceMatches, decodeJwt, verifiesRs256 } from "./verifiers/jwt.js";
export { newJwksKeyCache } from "./verifiers/jwks.js";
export type { JwksKeyCache } from "./verifiers/jwks.js";
export { readDiscoveryDocument } from "./verifiers/oidc-discovery.js";
export { normalizeIssuerUrl } from "./iam/issuer/issuer-url.js";
export { newGrantPathClient } from "./iam/grant/grant-path-client.js";
export type { GrantPathClient } from "./iam/grant/grant-path-client.js";
export { isPersonCaller, newKindMetaGrantScope } from "./iam/grant/roles.js";
export { resolveCreateRace } from "./iam/account/port.js";
export type { IdentityAccountService, NewAccountRequest } from "./iam/account/port.js";
export { newInProcessOrganizationLookup, reconcileOrganizationLinks } from "./iam/organization-links.js";
export type { OrganizationLinkDeps } from "./iam/organization-links.js";
export { reconcileOwnerRows } from "./iam/owner-rows.js";
export type { OwnerRowKind } from "./iam/owner-rows.js";
export { lateChildOrganizations } from "./extension/late-child-organizations.js";
