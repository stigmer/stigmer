// Enterprise target: a licensed Stigmer Enterprise server, booted from source
// as its own process.
// Domain: conformance targets.
//
// A managed target, like the local ones: it owns the server's process, its
// storage and its issuer. What it spawns is Enterprise's own test entry
// (ee/server/test/conformance/licensed-server.ts): the shipped entry's
// composition with a license that process signs for itself, run under the
// repository root's tsx. Spawning a file by path is not importing it, so
// nothing here reaches into ee/ (ee/README.md).
//
// The posture is the one a licensed server must run in, and the Cloud's
// shape on a different engine:
//
//   - Postgres: a licensed server refuses any other store, so every server
//     this target spawns gets a throwaway database (harness/postgres.ts,
//     CONFORMANCE_POSTGRES_URL).
//   - Signed-in callers: a licensed edition refuses to boot without the
//     require-authentication posture, so the primary signs its people in
//     through the harness's loopback issuer (STIGMER_OIDC_ISSUER), and the
//     server's built-in Authorizer enforces the model on every row.
//   - Many organizations, real people: the primary IS this target's
//     enforcing lane, as the Cloud's is. A person is an issuer token for a
//     fresh subject, then provisionMyAccount; a tenancy is an organization
//     the founder creates and deletes by id (harness/people.ts, which the
//     Cloud target shares). An Enterprise newcomer holds nothing, so the
//     open-source sibling lane, which revokes the membership open source
//     grants every arrival, is not this target's.
//
// The license the primary runs on is current and sets no organization
// limit, because the suites create an organization per tenancy. Its
// outbound posture is the operator's opt-in, STIGMER_OUTBOUND_EGRESS=relaxed:
// the shared suite's sign-in arms dial login servers and MCP servers the
// harness runs on this machine, which Enterprise's strict default refuses
// by design. Strict is proven by Enterprise's own composed suite
// (ee/server/src/editions/__tests__/enterprise-host-wiring.postgres.test.ts).
// A sibling takes the terms, the egress posture and the creators rule the
// suite names in its env (STIGMER_TEST_LICENSE_TERMS and the server's own
// variables), with its own database.
//
// An organization's federation issuer is an outside provider the server
// reads over HTTPS, so the target can start one (startOutsideIssuer): the
// harness's local issuer serving TLS with a certificate for 127.0.0.1 that
// setup mints once (the runner's loopback certificate, imported by path as
// the harness imports the runner's IPC protocol) and the primary trusts
// through NODE_EXTRA_CA_CERTS, the hand-off the runner gives its own
// child. That variable is the target's own for this server, which dials
// nothing else over TLS, so a developer's value is not passed on.
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { ServerEdition } from "@stigmer/apis/ai/stigmer/platform/v1/server_info_pb";
import {
  startLocalOidcIssuer,
  type LocalOidcIssuer,
} from "@stigmer/test-support/local-oidc-issuer";
import {
  spawnServer,
  type ProvisionedStorage,
  type RunningServer,
} from "@stigmer/test-support/server-process";
import { ensureEnterpriseServerEntry, tsxLoaderUrl } from "@stigmer/test-support/ts-build";
import {
  mintLoopbackCertificate,
  type LoopbackCertificate,
} from "../../../../backend/services/runner/src/agent-proxy/loopback-certificate";
import {
  createTransport,
  makeClients,
  type ConformanceClients,
  type PresentingOptions,
} from "../harness/clients";
import { newPrimaryEnforcingLane } from "../harness/enforcing-lane";
import { awaitGrpcReady } from "../harness/grpc-ready";
import { PERSON_TOKEN_TTL_SECONDS, PrimaryPeople, provisionPerson } from "../harness/people";
import { provisionPostgresStorage } from "../harness/postgres";
import { freshSubject, optInToMemory } from "../support/identityaccounts";
import { uniqueName } from "../support/naming";
import type {
  CapabilityFlags,
  EnforcingLane,
  SiblingServer,
  SpawnSiblingOptions,
  TargetProfile,
  TenancyContext,
} from "./target";

// How long a spawned server may take to print its ready line. The entry
// transpiles Enterprise from source on every boot, so it starts slower than
// the library's built entry; the harness's 20 s default (server-process.ts)
// was missed on a loaded machine while every test passed. It stays inside
// the suites' 60 s hook budget.
const ENTERPRISE_READY_TIMEOUT_MS = 45_000;

export class EnterpriseTarget implements TargetProfile {
  readonly name = "enterprise";
  // The license unit declares the Enterprise edition once a key verifies.
  readonly edition: ServerEdition = ServerEdition.enterprise;

  readonly capabilities: CapabilityFlags = {
    multiTenant: true,
    // Many organizations, up to the license's limit, which the primary's
    // license does not set.
    singleOrganization: false,
    // The built-in Authorizer enforces the model on the primary, which is
    // therefore this target's enforcing lane (enforcingLane below).
    enforcingAuthorizer: true,
    // Library features every edition serves.
    versionTagging: true,
    skillArtifactTransferLane: true,
    // No Temporal and no runner behind this target, as on the plain local
    // target: routines cannot fire, and no runner acts for anyone.
    routineFiring: false,
    runnerActsAsRunCreator: false,
    // The reserved-label guard admits the platform operator only, and this
    // server has none: the founder is an ordinary signed-in person, so the
    // suite pins the guard's refusal.
    clientReservedLabelWrites: false,
    // The founder signs in as a person, as the Cloud's console person does,
    // and opts in to memory on their own account at setup.
    firstPartyMemoryCapture: true,
    // The Cloud's own surfaces: no channel runtime, billing, plans, proxy,
    // public lane, guest minting or metering in Enterprise.
    channelMessaging: false,
    billingGates: false,
    billingEngine: false,
    billingPlans: false,
    sideChannelProxy: false,
    publicLane: false,
    guestMinting: false,
    cloudTargetRefusesLocalPrograms: false,
    runModelCallsMetered: false,
    // The primary is an enforcing lane that mints user tokens.
    userTokens: true,
    // The license requires the require-authentication posture.
    requiresAuthentication: true,
    // The platform's own identity tenant is the Cloud's; Enterprise signs
    // people in through the operator's issuer and creates no organization at
    // sign-up, the two things the direct-login suite pins.
    directLogin: false,
    // The Enterprise identity unit composes federation.
    federatedIdentityAccounts: true,
    // The license unit registers every kind's kind_meta roles as the grant
    // scope.
    perResourceGrants: true,
    // The tuple-half queries need a relationship graph; no Enterprise unit
    // declares one, so the suite pins open source's refusal.
    authorizationQueries: false,
    // The Enterprise server keeps the access history and serves its read to
    // the organization's owners.
    accessHistory: "served",
    // A newcomer holds nothing: above open source a person joins by
    // invitation or by a grant, never by signing in.
    membershipOnArrival: false,
    // Cursor runs need no provider key here: no admission gates.
    cursorRunsAdmitted: true,
    // No engine on this target: no turn runs.
    claudeTurnsRun: false,
    // The primary runs on the license this target's entry signed.
    licenseStatus: "licensed",
    // The Enterprise identity unit serves teams, invitation links and an
    // organization's federation issuers, with no plan behind any of them.
    teams: "served",
    invitations: true,
    federationIssuers: true,
    // The operator's opt-in (the header says why).
    outboundEgress: "relaxed",
  };

  private server: RunningServer | undefined;
  private storage: ProvisionedStorage | undefined;
  private issuer: LocalOidcIssuer | undefined;
  // The outside issuers' certificate, and the directory holding the file
  // the primary trusts it from.
  private outsideCertificate: LoopbackCertificate | undefined;
  private trustDir: string | undefined;
  private conformanceClients: ConformanceClients | undefined;
  // The tenancies the founder creates and the people the issuer signs in.
  private readonly people = new PrimaryPeople({
    founder: () => this.clients(),
    freshToken: (caller) =>
      this.requireIssuer(caller).mint({
        sub: freshSubject(),
        email: `${uniqueName("person")}@conformance.example.com`,
        ttlSeconds: PERSON_TOKEN_TTL_SECONDS,
      }),
    clientsPresenting: (token) => this.clientsPresenting(token),
  });

  async setup(): Promise<void> {
    const entry = await ensureEnterpriseServerEntry();
    const issuer = await startLocalOidcIssuer();
    this.issuer = issuer;
    this.storage = await provisionPostgresStorage();
    const certificate = mintLoopbackCertificate();
    this.outsideCertificate = certificate;
    this.trustDir = await mkdtemp(join(tmpdir(), "stigmer-conformance-trust-"));
    const trustFile = join(this.trustDir, "outside-issuers.pem");
    await writeFile(trustFile, certificate.certPem);
    this.server = await spawnServer(process.execPath, {
      args: ["--import", tsxLoaderUrl(), entry],
      env: {
        ...this.storage.serverEnv,
        ...this.oidcEnv(issuer),
        STIGMER_OUTBOUND_EGRESS: "relaxed",
        NODE_EXTRA_CA_CERTS: trustFile,
      },
      readyTimeoutMs: ENTERPRISE_READY_TIMEOUT_MS,
    });
    // The founder: the first person, who founds every tenancy. The readiness
    // gate presents their token before the account exists (admitted
    // idp-shaped), then the first sign-in makes the account.
    const founderToken = await issuer.mint({
      sub: freshSubject(),
      email: `${uniqueName("founder")}@conformance.example.com`,
      ttlSeconds: PERSON_TOKEN_TTL_SECONDS,
    });
    const founder = this.clientsPresenting(founderToken);
    await awaitGrpcReady(founder, () => this.server?.logTail() ?? "(no server)");
    await provisionPerson(founderToken, () => founder);
    this.conformanceClients = founder;
    await optInToMemory(founder);
  }

  // The OIDC posture against the target's issuer.
  private oidcEnv(issuer: LocalOidcIssuer): Record<string, string> {
    return { STIGMER_OIDC_ISSUER: issuer.issuer, STIGMER_OIDC_AUDIENCE: issuer.audience };
  }

  // The harness's issuer the primary signs its people in with, which the
  // server reserves for itself.
  signInIssuer(): string {
    return this.requireIssuer("signInIssuer").issuer;
  }

  // An outside provider the primary trusts: the local issuer over TLS with
  // the certificate setup minted. The caller closes it.
  startOutsideIssuer(): Promise<LocalOidcIssuer> {
    if (this.outsideCertificate === undefined) {
      throw new Error("EnterpriseTarget.setup() must be called before startOutsideIssuer()");
    }
    return startLocalOidcIssuer({ tls: this.outsideCertificate });
  }

  private requireIssuer(caller: string): LocalOidcIssuer {
    if (this.issuer === undefined) {
      throw new Error(`EnterpriseTarget.setup() must be called before ${caller}()`);
    }
    return this.issuer;
  }

  // The primary enforces, so the lane is a view over this target's own
  // provisioning; the issuer mints its unprovisioned caller.
  async enforcingLane(): Promise<EnforcingLane> {
    const issuer = this.requireIssuer("enforcingLane");
    return newPrimaryEnforcingLane({
      clients: this.clients(),
      provisionTenancy: () => this.provisionTenancy(),
      cleanupTenancy: (context) => this.cleanupTenancy(context),
      provisionIdentity: () => this.provisionIdentity(),
      provisionMember: (tenancy) => this.provisionMember(tenancy),
      organizationIdOf: (tenancy) => this.people.organizationIdOf(tenancy, "enforcingLane"),
      unprovisionedBearer: () =>
        issuer.mint({
          sub: freshSubject(),
          email: `${uniqueName("lane-unprovisioned")}@conformance.example.com`,
        }),
      clientsPresenting: (bearerToken, options) => this.clientsPresenting(bearerToken, options),
      managedAgentsBaseUrl: () => this.httpBaseUrl(),
    });
  }

  // A second licensed server, on its own database, in the posture the
  // suite's env names: its OIDC issuer, and any license terms, egress
  // posture or creators rule (the header says which). Readiness is the
  // harness's one gate, presented with the bearer the suite supplied.
  //
  // `restart` stops the process and boots the same entry again over the
  // same database, in the env the restart names, awaiting readiness as a
  // spawn does: the operator's own path when a license runs out. A restart
  // that fails to come back releases the database, as a failed spawn does.
  async spawnSibling(options: SpawnSiblingOptions): Promise<SiblingServer> {
    const entry = await ensureEnterpriseServerEntry();
    const storage = await provisionPostgresStorage();
    const boot = (posture: SpawnSiblingOptions): Promise<RunningServer> =>
      spawnServer(process.execPath, {
        args: ["--import", tsxLoaderUrl(), entry],
        env: { ...storage.serverEnv, ...posture.env },
        readyTimeoutMs: ENTERPRISE_READY_TIMEOUT_MS,
      });
    // Released once, whichever of a failed boot or the teardown comes first.
    let released = false;
    const release = async (): Promise<void> => {
      if (released) return;
      released = true;
      await storage.release();
    };
    let server: RunningServer | undefined;
    try {
      server = await boot(options);
    } catch (error) {
      await release();
      throw error;
    }
    const current = (): RunningServer => {
      if (server === undefined) {
        throw new Error("the sibling is stopped: its restart did not come back");
      }
      return server;
    };
    const clientsPresenting = (
      bearerToken: string,
      presenting: PresentingOptions = {},
    ): ConformanceClients =>
      makeClients(createTransport(current().baseUrl, { ...presenting, bearerToken }));
    const teardown = async (): Promise<void> => {
      await server?.stop();
      server = undefined;
      await release();
    };
    const ready = async (posture: SpawnSiblingOptions): Promise<void> => {
      const running = current();
      try {
        await awaitGrpcReady(clientsPresenting(posture.readinessBearer), () => running.logTail());
      } catch (error) {
        await teardown();
        throw error;
      }
    };
    await ready(options);
    const restart = async (posture: SpawnSiblingOptions): Promise<void> => {
      await current().stop();
      server = undefined;
      try {
        server = await boot(posture);
      } catch (error) {
        await release();
        throw error;
      }
      await ready(posture);
    };
    return { clientsPresenting, managedAgentsBaseUrl: () => current().baseUrl, restart, teardown };
  }

  clients(): ConformanceClients {
    if (this.conformanceClients === undefined) {
      throw new Error("EnterpriseTarget.setup() must be called before clients()");
    }
    return this.conformanceClients;
  }

  anonymousClients(): ConformanceClients {
    return makeClients(createTransport(this.httpBaseUrl()));
  }

  clientsPresenting(bearerToken: string, options: PresentingOptions = {}): ConformanceClients {
    return makeClients(createTransport(this.httpBaseUrl(), { ...options, bearerToken }));
  }

  // The Managed Agents lane is on the unified port (target.ts).
  managedAgentsBaseUrl(): string {
    return this.httpBaseUrl();
  }

  // The library's own plain-HTTP lanes (the registry proxy) on the unified
  // port: Enterprise composes onto the library and serves them unchanged.
  httpBaseUrl(): string {
    if (this.server === undefined) {
      throw new Error("EnterpriseTarget.setup() must be called before httpBaseUrl()");
    }
    return this.server.baseUrl;
  }

  provisionTenancy(): Promise<TenancyContext> {
    return this.people.provisionTenancy();
  }

  // Every organization of a licensed server has teams: no plan to move to.
  provisionTeamsTenancy(): Promise<TenancyContext> {
    return this.provisionTenancy();
  }

  cleanupTenancy(context: TenancyContext): Promise<void> {
    return this.people.cleanupTenancy(context);
  }

  // A fresh person holding no grant anywhere: the outsider.
  provisionIdentity(): Promise<ConformanceClients> {
    return this.people.provisionIdentity();
  }

  // A fresh person holding exactly `member` on the tenancy: the colleague.
  provisionMember(tenancy: TenancyContext): Promise<ConformanceClients> {
    return this.people.provisionMember(tenancy);
  }

  async teardown(): Promise<void> {
    await this.server?.stop();
    this.server = undefined;
    await this.storage?.release();
    this.storage = undefined;
    await this.issuer?.close();
    this.issuer = undefined;
    if (this.trustDir !== undefined) {
      await rm(this.trustDir, { recursive: true, force: true });
    }
    this.trustDir = undefined;
    this.outsideCertificate = undefined;
    this.conformanceClients = undefined;
    this.people.forget();
  }
}
