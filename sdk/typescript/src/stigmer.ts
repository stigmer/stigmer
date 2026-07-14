import { ActivityClient } from "./activity.js";
import { BillingClient } from "./billing.js";
import { GeneratedClient } from "./gen/client.js";
import { GitHubClient } from "./github.js";
import { PlatformClient } from "./platform.js";
import { SearchClient } from "./search.js";
import { createStigmerTransport } from "./transport.js";
import {
  validateConfig,
  type StigmerConfig,
  type TokenProvider,
} from "./config.js";
import { ExecutionTarget } from "@stigmer/protos/ai/stigmer/agentic/session/v1/enum_pb";

type ExecutionTargetOption = StigmerConfig["executionTarget"];

/**
 * Top-level Stigmer API client.
 *
 * Extends the code-generated {@link GeneratedClient} so every resource
 * sub-client (agent, session, mcpServer, oauthapp, …) is inherited
 * automatically — new resource clients added by codegen appear on this
 * class without manual wiring.
 *
 * On top of the generated resource clients, `Stigmer` adds:
 * - Configuration and transport setup ({@link StigmerConfig})
 * - {@link billing} credit management and Stripe integration client
 * - Cross-resource {@link search} client
 * - {@link github} OAuth integration client
 *
 * @example
 * ```typescript
 * const stigmer = new Stigmer({
 *   baseUrl: "https://api.stigmer.ai",
 *   apiKey: "sk_live_abc123",
 * });
 *
 * const agent = await stigmer.agent.get("agent-id");
 * ```
 */
export class Stigmer extends GeneratedClient {
  /**
   * Base URL of the connected Stigmer API server.
   *
   * Exposed so downstream code (e.g., system env var resolution) can
   * derive the gRPC address for MCP server subprocesses without
   * requiring the host application to pass it separately.
   */
  readonly baseUrl: string;

  /**
   * Custom `fetch` implementation provided at construction time.
   *
   * `undefined` when the caller did not supply one (the global
   * `fetch` should be used instead). Exposed so non-transport
   * HTTP calls (e.g., model registry fetch) can use the same
   * implementation that the gRPC transport uses, which is critical
   * in Tauri where the global `fetch` is restricted by CSP/CORS.
   */
  readonly fetch: typeof globalThis.fetch | undefined;

  /**
   * Default execution target for sessions and workflow executions.
   *
   * When set, `session.create()` and `workflowExecution.create()`
   * apply this as the default when the per-call input does not
   * specify an explicit `executionTarget`.
   *
   * `undefined` means the server decides (LOCAL for OSS, CLOUD for
   * managed).
   */
  readonly defaultExecutionTarget: ExecutionTarget | undefined;

  readonly activity: ActivityClient;
  readonly billing: BillingClient;
  readonly platform: PlatformClient;
  readonly search: SearchClient;
  readonly github: GitHubClient;

  private readonly _tokenProvider: TokenProvider;

  constructor(config: StigmerConfig) {
    validateConfig(config);

    const transport = config.customTransport ?? createStigmerTransport(config);
    super(transport);

    this.baseUrl = config.baseUrl;
    this.fetch = config.fetch;
    this.defaultExecutionTarget = toExecutionTarget(config.executionTarget);
    this._tokenProvider = config.apiKey
      ? () => config.apiKey!
      : config.getAccessToken ?? (() => null);

    this.activity = new ActivityClient(transport);
    this.billing = new BillingClient(transport);
    this.platform = new PlatformClient(transport);
    this.search = new SearchClient(transport);
    this.github = new GitHubClient(transport);

    if (this.defaultExecutionTarget != null) {
      this._applyExecutionTargetDefaults();
    }
  }

  /**
   * Wrap `session.create/apply` — and the one-call bootstrap path on
   * `agentExecution.create` (an embedded `sessionSpec` defines the
   * session to auto-create) — so that the client-level
   * `defaultExecutionTarget` is applied when the per-call input
   * does not specify one.
   *
   * WorkflowExecutionInput does not yet have `executionTarget` in
   * codegen; that will be wired once the codegen schema is updated.
   */
  private _applyExecutionTargetDefaults(): void {
    const target = this.defaultExecutionTarget!;
    const origSessionCreate = this.session.create.bind(this.session);
    const origSessionApply = this.session.apply.bind(this.session);
    const origExecutionCreate = this.agentExecution.create.bind(
      this.agentExecution,
    );

    this.session.create = (input) =>
      origSessionCreate(applySessionDefault(input, target));
    this.session.apply = (input) =>
      origSessionApply(applySessionDefault(input, target));
    this.agentExecution.create = (input) =>
      origExecutionCreate(
        input.sessionSpec
          ? { ...input, sessionSpec: applySessionDefault(input.sessionSpec, target) }
          : input,
      );
  }

  /**
   * Retrieve the current authentication credential.
   *
   * Returns the static API key or calls the dynamic token provider,
   * depending on how the client was configured. Returns `null` when
   * the token provider signals "no auth for this request."
   *
   * Used by system env var resolution to derive `STIGMER_API_KEY`
   * for MCP server subprocesses without prompting the user.
   */
  async getAuthCredential(): Promise<string | null> {
    return await this._tokenProvider();
  }
}

function toExecutionTarget(
  opt: ExecutionTargetOption,
): ExecutionTarget | undefined {
  switch (opt) {
    case "local":
      return ExecutionTarget.LOCAL;
    case "cloud":
      return ExecutionTarget.CLOUD;
    default:
      return undefined;
  }
}

function applySessionDefault<T extends { executionTarget?: ExecutionTarget }>(
  input: T,
  target: ExecutionTarget,
): T {
  if (
    input.executionTarget == null ||
    input.executionTarget === ExecutionTarget.UNSPECIFIED
  ) {
    return { ...input, executionTarget: target };
  }
  return input;
}

