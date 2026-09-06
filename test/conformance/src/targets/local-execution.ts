// Local execution target: the OSS server + Temporal + TS runner (Class B).
// Born as local-ts-execution during the TS rewrite (stigmer-cloud program
// 20260822.01, D4 #18) and renamed to plain `local-execution` when the Go
// server retired (D4 #25) — there is one local implementation now.
// Domain: conformance targets (execution engine).
//
// Boot order is load-bearing: Temporal must be up before the server (so the
// TemporalManager's initial connect flips the engine-state provider to
// connected), and the server before the runner (which streams status back
// to it). teardown() reverses it.
import { awaitGrpcReady } from "../harness/grpc-ready";
import { createTransport, makeClients, type ConformanceClients } from "../harness/clients";
import { McpToolFixture } from "../harness/mcp-server";
import { MockLlmProxy } from "../harness/mock-llm";
import { ensureRunnerBuilt } from "../harness/runner-build";
import { spawnRunner, type RunningRunner } from "../harness/runner-process";
import { spawnServer, type RunningServer } from "../harness/server-process";
import { spawnTemporal, type RunningTemporal } from "../harness/temporal";
import { ensureTsServerEntry } from "../harness/ts-build";
import { uniqueOrg } from "../support/naming";
import type { CapabilityFlags, PrivilegedScope, TargetProfile, TenancyContext } from "./target";

export class LocalExecutionTarget implements TargetProfile {
  readonly name: string = "local-execution";
  // The retired local-go-execution matrix plus exactly ONE deliberate
  // difference: workflowChildApprovalForwarding is true here (the D4
  // ratified parity-plus delta, #23) where the Go server never sent it.
  readonly capabilities: CapabilityFlags = {
    multiTenant: false,
    externalOrgLookup: false,
    organizationEnumeration: true,
    versionTagging: false,
    skillArtifactTransferLane: true,
    // True since D4 #23: this server's agent-execution workflow emits the
    // child_approval_required signal from its HITL loop (DD-012 identity-only
    // sender), so a gated agent_call child surfaces at the parent workflow's
    // pending_approvals. The retired Go OSS server never sent it — this was
    // the one ratified capability divergence of the TS port.
    workflowChildApprovalForwarding: true,
    // True since D4 #22 ported the schedule clock (tick workflow +
    // reconciler on the schedule_stigmer queue).
    scheduleFiring: true,
    // Single-tenant OSS: the reserved-label write guard is cloud-only
    // (stigmer-cloud#320), so the caller may create labeled candidates.
    clientReservedLabelWrites: true,
    firstPartyMemoryCapture: true,
    clientPublicVisibilityWrites: true,
    // No channel runtime in this edition (T02 §0-b): the engine this target
    // provisions is the agent/workflow execution engine, not a channel
    // delivery runtime — the refusal posture is identical to `local`.
    channelMessaging: false,
    // The org BYOA lane is UNIMPLEMENTED on OSS by design (stigmer#558) —
    // the suite pins the three refusals here.
    orgOAuthAppConfiguration: false,
    // No billing engine at all — executions run unmetered (DD-001 boundary).
    billingGates: false,
    // The cloud-capability surfaces (E1): absent by DD-001, as on local.
    billingLedger: false,
    sideChannelProxy: false,
    publicLane: false,
    // No PlatformClient surface in this edition — the controllers are
    // unrouted and the serving edge composes zero caller guards (the
    // 20260902.02 empty state), so the enforcement arms skip.
    platformClientTokens: false,
    // Single-operator trusted-local posture, as on `local` — the runner's
    // STIGMER_TOKEN is a proxy bearer the server never verifies.
    requiresAuthentication: false,
    // No platform identity tenant on the single-operator posture; the OSS
    // OIDC lane is a different contract (target.ts).
    directLogin: false,
  };

  private temporal: RunningTemporal | undefined;
  private server: RunningServer | undefined;
  private runner: RunningRunner | undefined;
  private mockLlm: MockLlmProxy | undefined;
  private mcpTools: McpToolFixture | undefined;
  private conformanceClients: ConformanceClients | undefined;

  async setup(): Promise<void> {
    const entry = await ensureTsServerEntry();
    const runnerEntry = await ensureRunnerBuilt();

    // 1. Temporal first: the TemporalManager's initial connect only flips the
    //    engine-state provider if the frontend is serving already.
    this.temporal = await spawnTemporal();

    // 2. The TS server (node entry, same env contract as the Go binary),
    //    pointed at the live Temporal frontend.
    this.server = await spawnServer(process.execPath, {
      args: [entry],
      temporalHostPort: this.temporal.hostPort,
      env: {
        // The schedule failure-streak override the Go target pins — makes
        // the auto-pause provable in two fires (active since #22 ported
        // the schedule clock).
        STIGMER_SCHEDULES_MAX_CONSECUTIVE_FAILURES: "2",
        ...this.extraServerEnv(),
      },
    });
    this.conformanceClients = makeClients(createTransport(this.server.baseUrl));
    await awaitGrpcReady(this.conformanceClients, () => this.server?.logTail() ?? "(no server)");

    // 3. Mock LLM proxy before the runner, so its URL is known when the runner
    //    boots; the lever agent-execution suites program per test.
    this.mockLlm = new MockLlmProxy();
    await this.mockLlm.start();

    // 3b. MCP tool fixture: the tool surface a HITL agent run dispatches to;
    //     torn down last (with the proxy) because it must outlive executions.
    this.mcpTools = new McpToolFixture();
    await this.mcpTools.start();

    // 4. Runner last: it dials the server's gRPC endpoint to stream status back,
    //    and the mock proxy for LLM calls.
    this.runner = await spawnRunner({
      entryPath: runnerEntry,
      temporalHostPort: this.temporal.hostPort,
      backendEndpoint: this.server.baseUrl,
      proxy: { endpoint: this.mockLlm.url(), token: "conformance-mock-token" },
      // Share the server's local artifact store so a storage-key attachment the
      // server wrote resolves when the runner reads it back (#285).
      artifactDir: this.server.artifactBaseDir,
      artifactServeUrl: this.server.artifactServeUrl,
    });
  }

  // The storage-driver seam: local-postgres-execution overrides this to
  // inject DATABASE_URL (winning over the harness's DB_PATH — the
  // documented config precedence). EVERYTHING else about the target is
  // inherited, so the capability matrix is byte-identical by construction,
  // not by copy discipline (DD-011: the driver must be wire-invisible).
  protected extraServerEnv(): Record<string, string> {
    return {};
  }

  llmProxy(): MockLlmProxy {
    if (this.mockLlm === undefined) {
      throw new Error("LocalExecutionTarget.setup() must be called before llmProxy()");
    }
    return this.mockLlm;
  }

  mcpFixture(): McpToolFixture {
    if (this.mcpTools === undefined) {
      throw new Error("LocalExecutionTarget.setup() must be called before mcpFixture()");
    }
    return this.mcpTools;
  }

  clients(): ConformanceClients {
    if (this.conformanceClients === undefined) {
      throw new Error("LocalExecutionTarget.setup() must be called before clients()");
    }
    return this.conformanceClients;
  }

  anonymousClients(): ConformanceClients {
    return makeClients(createTransport(this.serverBaseUrl()));
  }

  clientsPresenting(bearerToken: string): ConformanceClients {
    return makeClients(createTransport(this.serverBaseUrl(), { bearerToken }));
  }

  private serverBaseUrl(): string {
    if (this.server === undefined) {
      throw new Error("LocalExecutionTarget.setup() must be called before building clients");
    }
    return this.server.baseUrl;
  }

  async provisionTenancy(): Promise<TenancyContext> {
    // No auth and no bootstrap org: a unique slug is a fully isolated scope.
    return { org: uniqueOrg() };
  }

  async cleanupTenancy(): Promise<void> {
    // No-op: resources are removed by fixtures and the per-file teardown.
  }

  // Single-tenant and deliberately unguarded: the one implicit caller IS the
  // operator, so the ordinary clients and a fresh slug satisfy the privileged
  // contract (stigmer#547).
  async provisionPrivilegedScope(): Promise<PrivilegedScope> {
    return { clients: this.clients(), context: { org: uniqueOrg() }, cleanup: async () => {} };
  }

  async teardown(): Promise<void> {
    // Reverse boot order: runner, then the LLM/MCP fixtures, then server, then Temporal.
    await this.runner?.stop();
    await this.mockLlm?.close();
    await this.mcpTools?.close();
    await this.server?.stop();
    await this.temporal?.stop();
    this.runner = undefined;
    this.mockLlm = undefined;
    this.mcpTools = undefined;
    this.server = undefined;
    this.temporal = undefined;
    this.conformanceClients = undefined;
  }
}
