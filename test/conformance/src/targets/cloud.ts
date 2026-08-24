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
import { CLOUD_ENV, mintCloudUserToken } from "../harness/cloud-env";
import { createTransport, makeClients, type ConformanceClients } from "../harness/clients";
import { awaitGrpcReady } from "../harness/grpc-ready";
import { uniqueName, uniqueOrg } from "../support/naming";
import type { CapabilityFlags, PrivilegedScope, TargetProfile, TenancyContext } from "./target";

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
