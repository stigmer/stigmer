// Cloud target: the Java stigmer-service as an external endpoint.
// Domain: conformance targets.
//
// Connect-only by design: the target never boots anything. It reads the
// environment published through the CLOUD_ENV contract — by the hermetic
// global setup (global-setup-cloud.ts, the `npm run test:cloud` path) or by
// whoever pre-provisioned a deployed endpoint — and drives it as the primary
// conformance user over an authenticated gRPC transport.
//
// Tenancy is real here, unlike the local targets: each provisioned scope is an
// organization created via the production RPC, whose creation grants the
// primary user ownership (IAM policies) and provisions a zero-balance billing
// account — sufficient for the Class A (CRUD) domains.
import {
  CLOUD_ENV,
  EDGE_AUTHENTICATION,
  mintCloudUserToken,
  resolveEdgeAuthentication,
} from "../harness/cloud-env";
import { createTransport, makeClients, type ConformanceClients } from "../harness/clients";
import {
  newDirectLoginTenant,
  readDirectLoginTenantMaterial,
} from "../harness/direct-login-tenant";
import { awaitGrpcReady } from "../harness/grpc-ready";
import { uniqueName, uniqueOrg } from "../support/naming";
import type {
  CapabilityFlags,
  DirectLoginTenant,
  PrivilegedScope,
  TargetProfile,
  TenancyContext,
} from "./target";

const ORG_API_VERSION = "tenancy.stigmer.ai/v1";
const ORG_KIND = "Organization";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === "") {
    throw new Error(
      `${name} is not set: the cloud target is connect-only and expects a provisioned ` +
        "environment. Run the suite via `npm run test:cloud` (hermetic boot), or set the " +
        "CLOUD_ENV variables to point at an existing endpoint.",
    );
  }
  return value;
}

export class CloudTarget implements TargetProfile {
  readonly name = "cloud";
  readonly capabilities: CapabilityFlags = {
    multiTenant: true,
    externalOrgLookup: true,
    organizationEnumeration: false,
    versionTagging: true,
    // Cloud carries the transfer lane over pre-signed R2 URLs
    // (stigmer-cloud#438) — the full mint → PUT → push-by-ref →
    // download-URL pin block runs against this target.
    skillArtifactTransferLane: true,
    workflowChildApprovalForwarding: true,
    // The hermetic cloud env boots Temporal and the Java service runs the
    // schedule clock (T04 slice 2) — triggers fire for real.
    scheduleFiring: true,
    // GuardReservedLabelsStep (stigmer-cloud#320, platform-wide since
    // stigmer-cloud#386) rejects reserved-label writes from the ordinary
    // conformance user — the suite pins that rejection where this is false.
    // Operator-lane assertions run through provisionPrivilegedScope
    // (stigmer#547) instead.
    clientReservedLabelWrites: false,
    // The primary conformance user is a PlatformClient-minted token —
    // the credential class DD-002 D4 deliberately excludes; the suite
    // pins the create-gate refusal instead (see target.ts).
    firstPartyMemoryCapture: false,
    clientPublicVisibilityWrites: false,
    // The cloud channel runtime serves installs, conversation participation,
    // and proactive messaging for real — the OSS refusal pins are gated off
    // here (their full behavior needs live provider workspaces; see target.ts).
    channelMessaging: true,
    // Cloud implements the org BYOA lane for real; the OSS UNIMPLEMENTED
    // pins gate off here (full behavior needs a real vendor OAuth app — the
    // channelMessaging coverage split).
    orgOAuthAppConfiguration: true,
    // The Java billing engine authorizes execution credits natively; the TS
    // composition serves the same gates through the C5 billing facade.
    billingGates: true,
    // The whole cloud suite authenticates with PlatformClient-minted user
    // tokens, and the minting client's contract is enforced on every
    // serving-edge request: by the Java interceptor natively, and by the
    // composition's platform-client caller guard (entry 20260902.02).
    platformClientTokens: true,
    // Every non-public RPC needs a credential: the Java interceptor's
    // require-authentication posture natively, and the TS composition's
    // through the registry point its cloud-core unit declares (entry
    // 20260904.02) — the same byte-pinned refusal on both.
    requiresAuthentication: true,
    // The platform tenant's tokens are verified and their subject resolved to
    // the ida_ at position 1: Java's Auth0 decoder + RequestCallerIdentityMapper
    // natively, the composition's direct-idp verifier (stigmer-cloud#604).
    directLogin: true,
  };

  private grpcBaseUrl: string | undefined;
  private conformanceClients: ConformanceClients | undefined;
  private operatorClients: ConformanceClients | undefined;
  // Org slug -> resource id, so cleanupTenancy can delete by id without
  // widening TenancyContext beyond the shape the suites share with local
  // targets.
  private readonly provisionedOrgIds = new Map<string, string>();

  // Present only when the environment carries an operator credential — the
  // hermetic bootstrap always mints one; pre-provisioned/deployed endpoints
  // deliberately never do (the stigmer#547 permanent-skip ruling), so the
  // method itself is absent there and privileged-lane assertions skip.
  provisionPrivilegedScope?: () => Promise<PrivilegedScope>;

  // Present only when the environment hands over the platform tenant's
  // signing key (CLOUD_ENV.directLogin*) — the readout substrate's mock
  // tenant does; the hermetic launcher and every deployed endpoint never do
  // (a real tenant's key is not conformance's to hold), so the method is
  // absent there and the direct-login suite skips with the reason below.
  directLoginTenant?: () => DirectLoginTenant;

  async setup(): Promise<void> {
    this.grpcBaseUrl = requireEnv(CLOUD_ENV.address);
    const token = requireEnv(CLOUD_ENV.token);
    this.conformanceClients = makeClients(createTransport(this.grpcBaseUrl, { bearerToken: token }));
    await awaitGrpcReady(
      this.conformanceClients,
      () => "(cloud environment: see the launcher's stderr and stigmer-service-*.log)",
    );

    const operatorToken = process.env[CLOUD_ENV.operatorToken];
    if (operatorToken !== undefined && operatorToken !== "") {
      this.operatorClients = makeClients(
        createTransport(this.grpcBaseUrl, { bearerToken: operatorToken }),
      );
      this.provisionPrivilegedScope = () => this.createPrivilegedScope();
    }

    const tenantMaterial = readDirectLoginTenantMaterial();
    if (tenantMaterial !== undefined) {
      const tenant = newDirectLoginTenant(tenantMaterial);
      this.directLoginTenant = () => tenant;
    }
  }

  directLoginUnavailable(): string {
    return (
      `${CLOUD_ENV.directLoginIssuer} is unset — this environment does not hand conformance the platform ` +
      "tenant's signing key (the hermetic launcher runs in test security mode with no edge; a deployed " +
      "endpoint's real tenant key is never conformance's to hold), so the direct-login lane cannot be driven here"
    );
  }

  // Platform-operator power grants nothing at org level (the FGA model checks
  // platform capabilities against platform:stigmer only), so the operator
  // creates AND owns the scope's org; cleanup deletes it.
  private async createPrivilegedScope(): Promise<PrivilegedScope> {
    const operatorClients = this.operatorClients;
    if (operatorClients === undefined) {
      throw new Error("CloudTarget.setup() must run before provisionPrivilegedScope()");
    }
    const created = await operatorClients.organizationCommand.create({
      apiVersion: ORG_API_VERSION,
      kind: ORG_KIND,
      metadata: { name: uniqueOrg() },
    });
    const slug = created.metadata?.slug;
    const id = created.metadata?.id;
    if (slug === undefined || slug === "" || id === undefined || id === "") {
      throw new Error("operator organization create returned no slug/id; cannot provision the privileged scope");
    }
    return {
      clients: operatorClients,
      context: { org: slug },
      cleanup: async () => {
        await operatorClients.organizationCommand.delete({ value: id });
      },
    };
  }

  clients(): ConformanceClients {
    if (this.conformanceClients === undefined) {
      throw new Error("CloudTarget.setup() must be called before clients()");
    }
    return this.conformanceClients;
  }

  anonymousClients(): ConformanceClients {
    return makeClients(createTransport(this.requireBaseUrl("anonymousClients")));
  }

  clientsPresenting(bearerToken: string): ConformanceClients {
    return makeClients(createTransport(this.requireBaseUrl("clientsPresenting"), { bearerToken }));
  }

  private requireBaseUrl(caller: string): string {
    if (this.grpcBaseUrl === undefined) {
      throw new Error(`CloudTarget.setup() must be called before ${caller}()`);
    }
    return this.grpcBaseUrl;
  }

  // The environment's declared edge posture (CLOUD_ENV.edgeAuthentication;
  // unset = enforced). Read per call, not cached at setup: the value is
  // published by the global setup before any worker runs and never changes
  // within a run, and reading late keeps this target constructible in unit
  // tests that never call setup().
  edgeAuthenticationBypass(): string | undefined {
    if (resolveEdgeAuthentication() === EDGE_AUTHENTICATION.enforced) {
      return undefined;
    }
    return (
      "the hermetic launcher runs stigmer-service with STIGMER_SECURITY_MODE=test — " +
      "GrpcSecurityConfigBase is not loaded and a synthetic caller stands in for every request, " +
      "so the edge's require-authentication posture is unobservable here " +
      "(production Java's posture is covered by test/integration-security; entry 20260904.02 D-S1)"
    );
  }

  async provisionTenancy(): Promise<TenancyContext> {
    const created = await this.clients().organizationCommand.create({
      apiVersion: ORG_API_VERSION,
      kind: ORG_KIND,
      metadata: { name: uniqueOrg() },
    });
    const slug = created.metadata?.slug;
    const id = created.metadata?.id;
    if (slug === undefined || slug === "" || id === undefined || id === "") {
      throw new Error("organization create returned no slug/id; cannot provision tenancy");
    }
    this.provisionedOrgIds.set(slug, id);
    return { org: slug };
  }

  async cleanupTenancy(context: TenancyContext): Promise<void> {
    const id = this.provisionedOrgIds.get(context.org);
    if (id === undefined) return;
    this.provisionedOrgIds.delete(context.org);
    await this.clients().organizationCommand.delete({ value: id });
  }

  // Mints a brand-new user through the bootstrap PlatformClient. The fresh
  // identity holds no grants on any org this run provisioned, making it the
  // outsider for isolation assertions.
  async provisionIdentity(): Promise<ConformanceClients> {
    if (this.grpcBaseUrl === undefined) {
      throw new Error("CloudTarget.setup() must be called before provisionIdentity()");
    }
    const token = await mintCloudUserToken(
      this.grpcBaseUrl,
      {
        clientId: requireEnv(CLOUD_ENV.platformClientId),
        clientSecret: requireEnv(CLOUD_ENV.platformClientSecret),
      },
      uniqueName("conf-outsider"),
    );
    return makeClients(createTransport(this.grpcBaseUrl, { bearerToken: token }));
  }

  async teardown(): Promise<void> {
    // Connect-only: the environment's lifecycle belongs to whoever provisioned
    // it (the cloud global setup for hermetic runs).
    this.grpcBaseUrl = undefined;
    this.conformanceClients = undefined;
    this.operatorClients = undefined;
    this.provisionPrivilegedScope = undefined;
    this.provisionedOrgIds.clear();
  }
}
