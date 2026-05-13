import { BillingClient } from "./billing";
import { GeneratedClient } from "./gen/client";
import { GitHubClient } from "./github";
import { PlatformClient } from "./platform";
import { SearchClient } from "./search";
import { createStigmerTransport } from "./transport";
import {
  validateConfig,
  type StigmerConfig,
  type TokenProvider,
} from "./config";

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
    this._tokenProvider = config.apiKey
      ? () => config.apiKey!
      : config.getAccessToken ?? (() => null);

    this.billing = new BillingClient(transport);
    this.platform = new PlatformClient(transport);
    this.search = new SearchClient(transport);
    this.github = new GitHubClient(transport);
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
