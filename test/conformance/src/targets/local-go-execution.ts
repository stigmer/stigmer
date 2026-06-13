// Local OSS execution target: Go stigmer-server + Temporal + TS runner.
// Domain: conformance targets (execution engine).
//
// This is the local-go target with its execution engine provisioned. The Go
// server is a pure orchestrator: on create it persists an execution then starts
// a Temporal workflow that dispatches the real work to the TS runner on the
// `stigmer_runner` queue (default `global` routing). Proving an execution
// therefore requires all three processes rendezvousing on Temporal.
//
// Having an execution engine is NOT an edition difference (cloud has one too),
// so it is not a CapabilityFlag — capabilities here are identical to local-go.
// The distinction is purely that this target *provisions* the engine, which is
// why it is selected only by the heavier execution test config, not the
// dependency-light CRUD one (DD-002).
//
// setup() is written so the load-bearing boot order reads top-to-bottom:
// Temporal must be up before the server boots (so InitialConnect injects the
// workflowCreator synchronously), and the server must be up before the runner
// (which streams status back to it). teardown() reverses that order.
import { ensureServerBinary } from "../harness/go-build";
import { awaitGrpcReady } from "../harness/grpc-ready";
import { createTransport, makeClients, type ConformanceClients } from "../harness/clients";
import { McpToolFixture } from "../harness/mcp-server";
import { MockLlmProxy } from "../harness/mock-llm";
import { ensureRunnerBuilt } from "../harness/runner-build";
import { spawnRunner, type RunningRunner } from "../harness/runner-process";
import { spawnServer, type RunningServer } from "../harness/server-process";
import { spawnTemporal, type RunningTemporal } from "../harness/temporal";
import { uniqueOrg } from "../support/naming";
import type { CapabilityFlags, TargetProfile, TenancyContext } from "./target";

export class LocalGoExecutionTarget implements TargetProfile {
  readonly name = "local-go-execution";
  // Identical to local-go: this is the same Go server, only with its engine running.
  readonly capabilities: CapabilityFlags = {
    multiTenant: false,
    externalOrgLookup: false,
    versionTagging: false,
    secretRedaction: false,
  };

  private temporal: RunningTemporal | undefined;
  private server: RunningServer | undefined;
  private runner: RunningRunner | undefined;
  private mockLlm: MockLlmProxy | undefined;
  private mcpTools: McpToolFixture | undefined;
  private conformanceClients: ConformanceClients | undefined;

  async setup(): Promise<void> {
    const binary = await ensureServerBinary();
    const runnerEntry = await ensureRunnerBuilt();

    // 1. Temporal first: the server's workflowCreator is only injected if its
    //    initial connection succeeds, so the frontend must be serving already.
    this.temporal = await spawnTemporal();

    // 2. Go server, pointed at the live Temporal frontend.
    this.server = await spawnServer(binary, { temporalHostPort: this.temporal.hostPort });
    this.conformanceClients = makeClients(createTransport(this.server.baseUrl));
    await awaitGrpcReady(this.conformanceClients, () => this.server?.logTail() ?? "(no server)");

    // 3. Mock LLM proxy before the runner, so its URL is known when the runner
    //    boots. Inert for WorkflowExecution (set_vars/wait never call the LLM);
    //    the lever for agent-execution runs, which suites program per test.
    this.mockLlm = new MockLlmProxy();
    await this.mockLlm.start();

    // 3b. MCP tool fixture: the tool surface a HITL agent run dispatches to. The
    //     runner connects to it live at each execution's setup (no discovery), so
    //     it only has to be listening before any execution starts — but it must
    //     outlive every execution, so it is torn down last (with the proxy).
    this.mcpTools = new McpToolFixture();
    await this.mcpTools.start();

    // 4. Runner last: it dials the server's gRPC endpoint to stream status back,
    //    and the mock proxy for LLM calls.
    this.runner = await spawnRunner({
      entryPath: runnerEntry,
      temporalHostPort: this.temporal.hostPort,
      backendEndpoint: this.server.baseUrl,
      proxy: { endpoint: this.mockLlm.url(), token: "conformance-mock-token" },
    });
  }

  llmProxy(): MockLlmProxy {
    if (this.mockLlm === undefined) {
      throw new Error("LocalGoExecutionTarget.setup() must be called before llmProxy()");
    }
    return this.mockLlm;
  }

  mcpFixture(): McpToolFixture {
    if (this.mcpTools === undefined) {
      throw new Error("LocalGoExecutionTarget.setup() must be called before mcpFixture()");
    }
    return this.mcpTools;
  }

  clients(): ConformanceClients {
    if (this.conformanceClients === undefined) {
      throw new Error("LocalGoExecutionTarget.setup() must be called before clients()");
    }
    return this.conformanceClients;
  }

  async provisionTenancy(): Promise<TenancyContext> {
    // No auth and no bootstrap org: a unique slug is a fully isolated scope.
    return { org: uniqueOrg() };
  }

  async cleanupTenancy(): Promise<void> {
    // No-op: resources are removed by fixtures and the per-file teardown.
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
