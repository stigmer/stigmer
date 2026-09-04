// Cloud execution target: the Java stigmer-service with its execution engine
// reachable — the Class B twin of `cloud`, and the cloud twin of
// `local-execution`.
// Domain: conformance targets (execution engine).
//
// Composes rather than forks: the connect-only identity/tenancy machinery is
// delegated to CloudTarget (CLOUD_ENV contract, real orgs, PlatformClient
// minting), and this target adds exactly what `local-execution` adds to
// `local` — the TS-owned engine trio (runner, mock LLM proxy, MCP tool
// fixture). The fixtures stay TS-pure per DD-002 (no cross-language coupling
// with the Go integration harness), which is what lets the execution suites
// program `llmProxy()` per test identically on both editions.
//
// The runner boots as a PRODUCTION embedded runner of the primary conformance
// user: spawnRunner's cloudBootstrap hands it the user's JWT and no Temporal
// address, so the runner's own bootstrap lane (getRunnerBootstrapConfig)
// discovers the Temporal coordinates and mints its embedded_runner proxy
// token — the same single authenticated door a desktop embedder uses. That
// identity choice is load-bearing: runner credentials carry the user as `sub`
// (see StigmerTokenType in stigmer-cloud), so FGA authorizes the runner as the
// owner of every execution the suites create, and the per-execution
// ExecutionContext decrypt rides the runner's ordinary scoped-token exchange
// (getRunnerScopedToken, issue #156). Nothing here is test-only plumbing.
//
// setup() boot order mirrors local-execution: fixtures before the runner
// (their URLs must be known when it boots); the service itself is already up
// (the hermetic launcher or a pre-provisioned endpoint owns its lifecycle).
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient, type Client } from "@connectrpc/connect";
import { BillingCommandController } from "@stigmer/protos/ai/stigmer/billing/v1/command_pb";
import { CLOUD_ENV } from "../harness/cloud-env";
import { createTransport, type ConformanceClients } from "../harness/clients";
import { McpToolFixture } from "../harness/mcp-server";
import { MockLlmProxy } from "../harness/mock-llm";
import { ensureRunnerBuilt } from "../harness/runner-build";
import { spawnRunner, type RunningRunner } from "../harness/runner-process";
import { CloudTarget } from "./cloud";
import type { CapabilityFlags, TargetProfile, TenancyContext } from "./target";

// The credit seed for a provisioned execution org, mirroring the integration
// harness's ProvisionTestBillingAccount ($100 in micro-USD): cloud authorizes
// billing INSIDE the agent-execution workflow (InvokeAgentExecutionWorkflow →
// ExecutionBillingService) before any work is dispatched, so the zero-balance
// account an org create provisions — sufficient for Class A CRUD — denies
// every Class B run with "Insufficient credits to start execution".
const TENANCY_SEED_CREDITS_MICROS = 100_000_000n;

// The integration module's log dir — where the hermetic launcher already
// writes stigmer-service.log, and what the CI lane uploads on failure. Each
// suite file's runner logs beside it, named for the file so a red run's
// artifact tells the whole story (repo root is four levels up from
// test/conformance/src/targets/).
const RUNNER_LOG_DIR = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../../..",
  "test/integration/.test-output/logs",
);

export class CloudExecutionTarget implements TargetProfile {
  readonly name = "cloud-execution";

  // Same service, same edition differences: capabilities are delegated to the
  // inner CloudTarget verbatim (having an engine is not a CapabilityFlag —
  // the same reasoning local-execution records). This target was the FIRST
  // with both the child_approval_required signal and a runner to drive it
  // (DD-012); since D4 #23 the TS server's HITL loop emits the same signal,
  // so local-execution runs the identical forwarding round-trip.
  private readonly cloud = new CloudTarget();

  private runner: RunningRunner | undefined;
  private mockLlm: MockLlmProxy | undefined;
  private mcpTools: McpToolFixture | undefined;
  private billingCommand: Client<typeof BillingCommandController> | undefined;

  get capabilities(): CapabilityFlags {
    return this.cloud.capabilities;
  }

  async setup(): Promise<void> {
    const runnerEntry = await ensureRunnerBuilt();

    // 1. Connect to the provisioned service first — its address and the
    //    primary user token are also what the runner bootstraps against.
    await this.cloud.setup();

    // 2. Fixtures before the runner, so their URLs are known when it boots.
    this.mockLlm = new MockLlmProxy();
    await this.mockLlm.start();
    this.mcpTools = new McpToolFixture();
    await this.mcpTools.start();

    // 3. Runner last: embedded-runner bootstrap as the primary user (see the
    //    module doc). The proxy token is a placeholder — cloudBootstrap's user
    //    JWT wins for STIGMER_TOKEN, and the mock proxy ignores bearers.
    const backendEndpoint = requireCloudEnv(CLOUD_ENV.address);
    const primaryToken = requireCloudEnv(CLOUD_ENV.token);
    // Billing writes authenticate as the primary user — the owner of every
    // org this target provisions, which is who the integration harness's
    // org_helpers fund standalone orgs as (ownerConn).
    this.billingCommand = createClient(
      BillingCommandController,
      createTransport(backendEndpoint, { bearerToken: primaryToken }),
    );
    this.runner = await spawnRunner({
      entryPath: runnerEntry,
      backendEndpoint,
      cloudBootstrap: { token: primaryToken },
      proxy: { endpoint: this.mockLlm.url(), token: "conformance-cloud-bootstrap" },
      // Artifacts presign against the real service's HTTP port (MinIO-backed)
      // while LLM traffic stays on the mock — the presign-capable artifact
      // lane (stigmer#803) that lets attachment materialization run against
      // cloud. The runner authenticates presigns with its adopted
      // embedded_runner credential (the same lane production runners use).
      artifactProxy: { endpoint: requireCloudEnv(CLOUD_ENV.httpAddress) },
      logFile: join(RUNNER_LOG_DIR, `conformance-runner-${runnerLogLabel()}.log`),
    });
  }

  llmProxy(): MockLlmProxy {
    if (this.mockLlm === undefined) {
      throw new Error("CloudExecutionTarget.setup() must be called before llmProxy()");
    }
    return this.mockLlm;
  }

  mcpFixture(): McpToolFixture {
    if (this.mcpTools === undefined) {
      throw new Error("CloudExecutionTarget.setup() must be called before mcpFixture()");
    }
    return this.mcpTools;
  }

  clients(): ConformanceClients {
    return this.cloud.clients();
  }

  anonymousClients(): ConformanceClients {
    return this.cloud.anonymousClients();
  }

  clientsPresenting(bearerToken: string): ConformanceClients {
    return this.cloud.clientsPresenting(bearerToken);
  }

  edgeAuthenticationBypass(): string | undefined {
    return this.cloud.edgeAuthenticationBypass();
  }

  async provisionTenancy(): Promise<TenancyContext> {
    const context = await this.cloud.provisionTenancy();
    await this.fundTenancy(context.org);
    return context;
  }

  // The billing-denial suite's precondition: a real org whose billing account
  // exists at the zero balance the org create provisions — the funding step
  // above deliberately skipped. Everything else (FGA tuples, membership) is
  // identical to provisionTenancy, so a later fundTenancy on the same org
  // turns it into the funded shape exactly.
  provisionUnfundedTenancy(): Promise<TenancyContext> {
    return this.cloud.provisionTenancy();
  }

  cleanupTenancy(context: TenancyContext): Promise<void> {
    return this.cloud.cleanupTenancy(context);
  }

  provisionIdentity(): Promise<ConformanceClients> {
    return this.cloud.provisionIdentity();
  }

  async teardown(): Promise<void> {
    // Reverse boot order: runner, then the fixtures it dials, then the client
    // connection. The environment itself outlives us (global-setup owns it).
    await this.runner?.stop();
    await this.mockLlm?.close();
    await this.mcpTools?.close();
    await this.cloud.teardown();
    this.runner = undefined;
    this.mockLlm = undefined;
    this.mcpTools = undefined;
    this.billingCommand = undefined;
  }

  // Seeds the fresh org's billing account so the workflow-level billing gate
  // authorizes runs (see TENANCY_SEED_CREDITS_MICROS). Billing accounts are
  // keyed by the execution's metadata.org — the slug — which is also what the
  // integration suite passes. Public as the TargetProfile optional verb: the
  // billing-denial suite funds an unfunded org as its negative control (the
  // deliberate zero-credit suite this comment used to name as missing).
  async fundTenancy(org: string): Promise<void> {
    if (this.billingCommand === undefined) {
      throw new Error("CloudExecutionTarget.setup() must be called before provisionTenancy()");
    }
    await this.billingCommand.getOrCreateBillingAccount({ orgId: org });
    await this.billingCommand.adjustCredits({
      orgId: org,
      amountMicros: TENANCY_SEED_CREDITS_MICROS,
      reason: "conformance execution tenancy seed",
      idempotencyKey: `conformance-seed-${org}`,
    });
  }
}

// One log per runner spawn. Files run serially (fileParallelism: false) and
// each file boots its own target, so worker-pid + boot time is a unique,
// chronologically sortable key — enough to line a log up with a red file.
function runnerLogLabel(): string {
  return `${process.pid}-${Date.now()}`;
}

function requireCloudEnv(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === "") {
    throw new Error(
      `${name} is not set: the cloud-execution target expects a provisioned environment. ` +
        "Run the suite via `npm run test:cloud-execution` (hermetic boot), or set the " +
        "CLOUD_ENV variables to point at an existing endpoint.",
    );
  }
  return value;
}
