package ai.stigmer.sdk;

import ai.stigmer.sdk.gen.GeneratedClient;
import ai.stigmer.sdk.internal.transport.StigmerChannel;
import io.grpc.ManagedChannel;

import java.util.Objects;
import java.util.concurrent.TimeUnit;

/**
 * Top-level Stigmer API client.
 *
 * <p>Extends the code-generated {@link GeneratedClient} so every resource
 * sub-client (agents, sessions, mcpServers, oauthApps, …) is inherited
 * automatically — new resource clients added by codegen appear on this
 * class without manual wiring.
 *
 * <p>On top of the generated resource clients, {@code StigmerClient} adds:
 * <ul>
 *   <li>Configuration and gRPC channel setup</li>
 *   <li>{@link #billing()} credit management and Stripe integration client</li>
 *   <li>Cross-resource {@link #search()} client</li>
 *   <li>{@link #github()} OAuth integration client</li>
 * </ul>
 *
 * <pre>{@code
 * try (StigmerClient client = StigmerClient.builder("sk_live_abc123").build()) {
 *     Agent agent = client.agents().create(AgentInput.builder()
 *         .name("my-agent")
 *         .org("my-org")
 *         .instructions("You are a helpful assistant")
 *         .build());
 * }
 * }</pre>
 */
public final class StigmerClient extends GeneratedClient implements AutoCloseable {

    private static final String DEFAULT_TARGET = "api.stigmer.ai:443";
    private static final long SHUTDOWN_TIMEOUT_SECONDS = 5;

    private final ManagedChannel channel;
    private final BillingClient billing;
    private final SearchClient search;
    private final GitHubClient github;
    private final RunnerAdapter runnerAdapter;

    private StigmerClient(ManagedChannel channel, RunnerAdapter runnerAdapter) {
        super(channel);
        this.channel = channel;
        this.billing = new BillingClient(channel);
        this.search = new SearchClient(channel);
        this.github = new GitHubClient(channel);
        this.runnerAdapter = runnerAdapter;
    }

    /** Creates a new builder. The API key is required for all requests. */
    public static Builder builder(String apiKey) {
        return new Builder(apiKey);
    }

    // -- Extra clients (not code-generated) ------------------------------------

    /** Returns the billing client for credit management and Stripe integration. */
    public BillingClient billing() { return billing; }

    /** Returns the cross-resource search client. */
    public SearchClient search() { return search; }

    /** Returns the GitHub OAuth integration client. */
    public GitHubClient github() { return github; }

    /**
     * Returns the runner adapter, or {@code null} if none was configured.
     * Used internally by create methods to trigger runner lifecycle callbacks
     * when executionTarget is LOCAL.
     */
    public RunnerAdapter runnerAdapter() { return runnerAdapter; }

    // -- Lifecycle ------------------------------------------------------------

    /**
     * Shuts down the underlying gRPC channel gracefully. Waits up to
     * {@value #SHUTDOWN_TIMEOUT_SECONDS} seconds for in-flight RPCs to
     * complete, then forces shutdown.
     */
    @Override
    public void close() {
        if (channel.isShutdown()) {
            return;
        }
        channel.shutdown();
        try {
            if (!channel.awaitTermination(SHUTDOWN_TIMEOUT_SECONDS, TimeUnit.SECONDS)) {
                channel.shutdownNow();
            }
        } catch (InterruptedException e) {
            channel.shutdownNow();
            Thread.currentThread().interrupt();
        }
    }

    // -- Builder --------------------------------------------------------------

    /** Builder for {@link StigmerClient}. */
    public static final class Builder {
        private final String apiKey;
        private String baseUrl = DEFAULT_TARGET;
        private boolean insecure;
        private RunnerAdapter runnerAdapter;

        private Builder(String apiKey) {
            this.apiKey = Objects.requireNonNull(apiKey, "stigmer: API key must not be null");
            if (apiKey.isEmpty()) {
                throw new IllegalArgumentException("stigmer: API key must not be empty");
            }
        }

        /** Sets the gRPC target address (host:port). Default is {@code api.stigmer.ai:443}. */
        public Builder baseUrl(String baseUrl) {
            this.baseUrl = Objects.requireNonNull(baseUrl, "baseUrl must not be null");
            return this;
        }

        /** Disables TLS. Use only for local development. */
        public Builder insecure() {
            this.insecure = true;
            return this;
        }

        /**
         * Sets the runner adapter for local execution lifecycle management.
         *
         * <p>When executionTarget is LOCAL, the SDK automatically calls adapter
         * methods after session/execution creation and on terminal phase
         * detection. Cloud consumers omit this setting entirely.
         */
        public Builder runnerAdapter(RunnerAdapter adapter) {
            this.runnerAdapter = adapter;
            return this;
        }

        /** Builds the {@link StigmerClient}. */
        public StigmerClient build() {
            ManagedChannel channel = StigmerChannel.create(new StigmerChannel.Config(
                    baseUrl, apiKey, insecure));
            return new StigmerClient(channel, runnerAdapter);
        }
    }
}
