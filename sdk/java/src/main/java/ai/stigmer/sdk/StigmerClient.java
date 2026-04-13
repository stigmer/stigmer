package ai.stigmer.sdk;

import ai.stigmer.sdk.gen.AgentClient;
import ai.stigmer.sdk.gen.AgentExecutionClient;
import ai.stigmer.sdk.gen.AgentInstanceClient;
import ai.stigmer.sdk.gen.ApiKeyClient;
import ai.stigmer.sdk.gen.EnvironmentClient;
import ai.stigmer.sdk.gen.ExecutionContextClient;
import ai.stigmer.sdk.gen.GeneratedClient;
import ai.stigmer.sdk.gen.IamPolicyClient;
import ai.stigmer.sdk.gen.IdentityAccountClient;
import ai.stigmer.sdk.gen.IdentityProviderClient;
import ai.stigmer.sdk.gen.McpServerClient;
import ai.stigmer.sdk.gen.OAuthAppClient;
import ai.stigmer.sdk.gen.OrganizationClient;
import ai.stigmer.sdk.gen.ProjectClient;
import ai.stigmer.sdk.gen.SessionClient;
import ai.stigmer.sdk.gen.SkillClient;
import ai.stigmer.sdk.gen.WorkflowClient;
import ai.stigmer.sdk.gen.WorkflowExecutionClient;
import ai.stigmer.sdk.gen.WorkflowInstanceClient;
import ai.stigmer.sdk.internal.transport.StigmerChannel;
import io.grpc.ManagedChannel;

import java.util.Objects;
import java.util.concurrent.TimeUnit;

/**
 * Top-level Stigmer API client.
 *
 * <p>Provides typed access to all Stigmer platform resources via sub-client
 * accessor methods. Create one with the builder and use try-with-resources
 * to ensure the underlying gRPC connection is closed.
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
public final class StigmerClient implements AutoCloseable {

    private static final String DEFAULT_TARGET = "api.stigmer.ai:443";
    private static final long SHUTDOWN_TIMEOUT_SECONDS = 5;

    private final ManagedChannel channel;
    private final GeneratedClient generated;
    private final SearchClient search;
    private final GitHubClient github;

    private StigmerClient(Builder builder) {
        this.channel = StigmerChannel.create(new StigmerChannel.Config(
                builder.baseUrl, builder.apiKey, builder.insecure));
        this.generated = new GeneratedClient(channel);
        this.search = new SearchClient(channel);
        this.github = new GitHubClient(channel);
    }

    /** Creates a new builder. The API key is required for all requests. */
    public static Builder builder(String apiKey) {
        return new Builder(apiKey);
    }

    // -- Resource sub-client accessors ----------------------------------------

    public AgentClient agents() { return generated.agent; }
    public AgentExecutionClient agentExecutions() { return generated.agentExecution; }
    public AgentInstanceClient agentInstances() { return generated.agentInstance; }
    public ApiKeyClient apiKeys() { return generated.apiKey; }
    public EnvironmentClient environments() { return generated.environment; }
    public ExecutionContextClient executionContexts() { return generated.executionContext; }
    public IamPolicyClient iamPolicies() { return generated.iamPolicy; }
    public IdentityAccountClient identityAccounts() { return generated.identityAccount; }
    public IdentityProviderClient identityProviders() { return generated.identityProvider; }
    public McpServerClient mcpServers() { return generated.mcpServer; }
    public OAuthAppClient oauthApps() { return generated.oauthapp; }
    public OrganizationClient organizations() { return generated.organization; }
    public ProjectClient projects() { return generated.project; }
    public SessionClient sessions() { return generated.session; }
    public SkillClient skills() { return generated.skill; }
    public WorkflowClient workflows() { return generated.workflow; }
    public WorkflowExecutionClient workflowExecutions() { return generated.workflowExecution; }
    public WorkflowInstanceClient workflowInstances() { return generated.workflowInstance; }

    // -- Search ---------------------------------------------------------------

    /** Returns the cross-resource search client. */
    public SearchClient search() { return search; }

    // -- GitHub ---------------------------------------------------------------

    /** Returns the GitHub OAuth integration client. */
    public GitHubClient github() { return github; }

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

        /** Builds the {@link StigmerClient}. */
        public StigmerClient build() {
            return new StigmerClient(this);
        }
    }
}
