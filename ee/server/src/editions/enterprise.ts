/**
 * The self-hosted Enterprise server as a composition: the units a license
 * key decides, built from the boot's own config and logger, for the
 * library's process body (`runServer`) to compose and start exactly as the
 * shipped open-source server is (`editions/enterprise-entry.ts` is the entry).
 *
 * The verdict, decided once at boot:
 *
 *   - no key: the open-source edition's one unit, so the server is the
 *     shipped open-source server, one organization and all;
 *   - a key that does not verify: the boot is refused with the verifier's
 *     sentence (an unknown key, a signature that does not match, contents
 *     that do not read, or a ticket that is not one), which the entry
 *     reports and exits 1 on. A silent fall back to open source would sign
 *     every single-sign-on person out over a typo;
 *   - a verified key on SQLite: refused, because the Enterprise tables live
 *     in Postgres beside the library's own;
 *   - a verified key on Postgres: two units, below.
 *
 * `enterprise-license` declares the edition and the organization limit the
 * license grants (none when it grants no limit; a limit of one is the
 * library's single-organization server, which makes its organization at
 * the first start and fills it into every request that names none), reports the license's
 * state (`drivers.licenseStatus`), signs the server's own tokens (guest,
 * share and integrator user tokens) with open source's ring on its key
 * ladder (`STIGMER_PLATFORM_TOKEN_KEY`, else `~/.stigmer/platform-token.key`,
 * else generated and kept there; a server run as several replicas sets the
 * variable so they share one key), which the library generates unasked for
 * open source alone, registers the grant scope every host
 * registers beside the identity unit (iam/policy/roles.ts; a single-instance
 * driver, so never inside that unit), refuses a new organization once the
 * license and its grace period have ended (after the library's own limit
 * on `org-create:pre-side-effect-gate`), and fills the account service from
 * the hand-over. `enterprise-identity` is the identity unit
 * (extension/enterprise-identity.ts), unchanged in what it registers, over
 * the Postgres side built here, the account service, the guarded fetch,
 * the operator's issuer reserved and the same growth gate. The license is
 * read from the clock at each growth act, so a server that is never
 * restarted still lapses; everything else stays as composed at boot.
 *
 * The host duties the identity unit's header asks of every host, as this
 * host meets them (editions/__tests__/enterprise-host-wiring.postgres.test.ts pins
 * each by composing):
 *
 *   - its adapters behind their ports: the five stores and the `ee` schema
 *     over one `enterprise` pool on `DATABASE_URL` (postgres/pool.ts), the
 *     chain run by the unit's own start;
 *   - every URL a person writes is dialed under one egress posture, the
 *     operator's choice (editions/enterprise-config.ts): strict by default,
 *     public addresses only, because anyone who signs in may found an
 *     organization and write a provider's or an MCP server's URL that the
 *     server itself dials (a provider's documents, an MCP or plugin install
 *     probe, a vault sign-in; a run's own MCP connections leave from the
 *     runner, which this does not govern); relaxed
 *     on the operator's word, private and loopback too, link-local always
 *     refused. `enterprise-license` registers it as the library's
 *     `drivers.outboundEgress` (MCP and plugin probes, vault sign-ins), and
 *     the identity unit's guarded fetch dials through the same policy;
 *   - the issuers this host's own lanes claim are reserved: the operator's
 *     OIDC issuer (`STIGMER_OIDC_ISSUER`), which the unit compares in its
 *     canonical form, so a provider naming it with a trailing slash is
 *     refused too;
 *   - its own sign-in lane ahead of the federated lane: the library's OIDC
 *     lane is built into the composition, ahead of every unit's verifier;
 *   - the direct-account provisioning never serves a federated caller: the
 *     library refuses one before it reads the subject;
 *   - no unit declares the require-authentication posture: the library's
 *     own refusal of an edition above open source with no sign-in names
 *     the variable an operator sets;
 *   - the permission history: no unit registers `drivers.iamPolicyStore`,
 *     so the library's own policy store serves, and the edition this host
 *     declares opens it to record every access row change in the row's
 *     transaction (the library's `iam_policy_history`, beside its rows).
 *     The same edition serves the history back (the library's
 *     `listAccessHistory`), so no unit serves a reader either. A lapsed
 *     license keeps its edition, so it keeps recording and reading
 *     (editions/__tests__/enterprise-permission-history.postgres.test.ts,
 *     editions/__tests__/enterprise-access-history.postgres.test.ts).
 *
 * The pool closes with the process: the library has no unit stop hook, and
 * a process exit ends its connections. A test passes its own pool and owns
 * it.
 */
import type { DescMessage } from "@bufbuild/protobuf";
import type { Pool } from "pg";

import { nodeGuardedFetch } from "@stigmer/outbound/dial";
import { ServerEdition } from "@stigmer/protos/ai/stigmer/platform/v1/server_info_pb";
import type {
  GateSlotName,
  KeyLoaderOptions,
  PipelineStep,
  ServerBoot,
  ServerExtension,
} from "@stigmer/server";
import {
  openSourceEdition,
  openSourcePlatformTokenKeyRing,
  relaxedEgressPolicy,
  strictEgressPolicy,
} from "@stigmer/server";

import { newEnterpriseIdentityExtension } from "../extension/enterprise-identity.js";
import { newGrowthGateStep } from "../iam/growth-gate.js";
import { newKindMetaPolicyGrantScope } from "../iam/policy/roles.js";
import { newLicenseGrowthGate } from "../license/growth.js";
import { newLicenseStatusProvider } from "../license/status.js";
import { trustedLicenseKeys } from "../license/trusted-keys.js";
import { verifyLicenseTicket } from "../license/verify.js";
import { newCompositionPool } from "../postgres/pool.js";
import { newEnterprisePostgres } from "../schema/enterprise-postgres.js";
import { newEnterpriseAccounts } from "./enterprise-accounts.js";
import { OUTBOUND_EGRESS_VARIABLE, type EgressPosture } from "./enterprise-config.js";

/** The license unit's name, in boot logs and every registration error. */
export const ENTERPRISE_LICENSE_UNIT = "enterprise-license";

/** The variable open source's key ladder reads first (@stigmer/server, src/platformtoken/key-ring.ts). */
const PLATFORM_TOKEN_KEY_VARIABLE = "STIGMER_PLATFORM_TOKEN_KEY";

/** The refusal of a verified key on a server with no Postgres. */
export const ENTERPRISE_NEEDS_POSTGRES = "Stigmer Enterprise runs on Postgres; set DATABASE_URL";

export interface EnterpriseOptions {
  /** The pasted license key; absent or blank, the server is open source. */
  readonly licenseKey: string | undefined;
  /** The keys a ticket may be signed with; the compiled ring unless a test passes its own. */
  readonly ring?: ReadonlyMap<string, Uint8Array>;
  /** The wall clock the growth freeze reads; a test passes its own. */
  readonly clock?: () => Date;
  /** The Postgres pool; one over DATABASE_URL unless a test passes (and owns) its own. */
  readonly pool?: Pool;
  /** What the guarded fetch dials through; the pinned dialer, whose connect judges too, unless a test observes its dials. */
  readonly fetchImpl?: typeof fetch;
  /** Where the token key ladder looks; the process env and home unless a test keeps its key to itself. */
  readonly keyLoader?: KeyLoaderOptions;
  /** Which addresses a person-written URL may reach; strict unless the operator chose relaxed. */
  readonly egress?: EgressPosture;
}

/** The units the license key decides (the header's verdict). */
export async function composeEnterprise(
  boot: ServerBoot,
  options: EnterpriseOptions,
): Promise<ReadonlyArray<ServerExtension>> {
  const key = options.licenseKey?.trim() ?? "";
  if (key === "") {
    return [openSourceEdition];
  }
  const verdict = verifyLicenseTicket(key, options.ring ?? trustedLicenseKeys());
  if (!verdict.ok) {
    throw new Error(verdict.refusal.message);
  }
  const { config, logger } = boot;
  if (config.databaseUrl === "") {
    throw new Error(ENTERPRISE_NEEDS_POSTGRES);
  }
  const clock = options.clock ?? ((): Date => new Date());
  const pool =
    options.pool ??
    newCompositionPool({ name: "enterprise", connectionString: config.databaseUrl, logger });
  const postgres = newEnterprisePostgres(pool);
  const accounts = newEnterpriseAccounts();
  const growthGate = newLicenseGrowthGate({ claims: verdict.claims, clock });
  const egress = options.egress ?? "strict";
  const egressPolicy = egress === "relaxed" ? relaxedEgressPolicy() : strictEgressPolicy();
  const outboundFetch = nodeGuardedFetch(egressPolicy, { fetchImpl: options.fetchImpl });
  const maxOrgs = verdict.claims.entitlements?.limits?.maxOrgs;

  logger.info("Stigmer Enterprise license verified", {
    keyId: verdict.keyId,
    organizations: maxOrgs ?? "unlimited",
  });
  if (egress === "relaxed") {
    logger.warn(
      `${OUTBOUND_EGRESS_VARIABLE}=relaxed: URLs anyone signed in writes may reach this server's private network`,
    );
  }
  // Unset or empty, as the library's key ladder reads it.
  if (((options.keyLoader?.env ?? process.env)[PLATFORM_TOKEN_KEY_VARIABLE] ?? "") === "") {
    logger.warn(
      `${PLATFORM_TOKEN_KEY_VARIABLE} is not set: this server signs its own tokens with the key kept under its home directory; set it when the server runs as several replicas or its home does not last`,
    );
  }

  const license: ServerExtension = {
    name: ENTERPRISE_LICENSE_UNIT,
    edition: ServerEdition.enterprise,
    ...(maxOrgs === undefined ? {} : { orgLimit: maxOrgs }),
    drivers: {
      licenseStatus: newLicenseStatusProvider({ keyId: verdict.keyId, claims: verdict.claims }),
      platformTokenKeys: openSourcePlatformTokenKeyRing(options.keyLoader),
      outboundEgress: egressPolicy,
      policyGrantScope: newKindMetaPolicyGrantScope(),
    },
    gateSteps: new Map<GateSlotName, ReadonlyArray<PipelineStep<DescMessage>>>([
      ["org-create:pre-side-effect-gate", [newGrowthGateStep(growthGate)]],
    ]),
    onComposed(services): void {
      accounts.fill(services);
    },
  };
  const identity = newEnterpriseIdentityExtension({
    providers: postgres.providers,
    teams: postgres.teams,
    invitations: postgres.invitations,
    signInGrants: postgres.signInGrants,
    accessMoves: postgres.accessMoves,
    schema: postgres.schema,
    accounts: accounts.service,
    outboundFetch,
    reservedIssuers: config.oidcIssuer === "" ? [] : [config.oidcIssuer],
    logger,
    growthGate,
  });
  return [license, identity];
}
