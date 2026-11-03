package ai.stigmer.sdk;

import ai.stigmer.sdk.gen.ErrorCode;
import ai.stigmer.sdk.gen.GeneratedClient;
import ai.stigmer.sdk.gen.StigmerException;
import ai.stigmer.sdk.internal.transport.StigmerChannel;
import io.grpc.ManagedChannel;

import java.time.Duration;
import java.util.Objects;
import java.util.concurrent.TimeUnit;

/**
 * Top-level Stigmer API client.
 *
 * <p>Extends the code-generated {@link GeneratedClient} so every resource
 * sub-client (agents, sessions, plugins, oauthApps, …) is inherited
 * automatically — new resource clients added by codegen appear on this
 * class without manual wiring.
 *
 * <p>On top of the generated resource clients, {@code StigmerClient} adds:
 * <ul>
 *   <li>Configuration and gRPC channel setup</li>
 *   <li>{@link #billing()} billing account, Stripe and model catalog client</li>
 *   <li>Cross-resource {@link #search()} client</li>
 *   <li>{@link #github()} OAuth integration client</li>
 *   <li>{@link #tokens()} user token minting client</li>
 *   <li>{@link #sendAndWait} and {@link #waitForTurn}: send a message and
 *       wait for the agent's answer</li>
 * </ul>
 *
 * <pre>{@code
 * // keys read "stk_…"
 * try (StigmerClient client = StigmerClient.builder(System.getenv("STIGMER_API_KEY")).build()) {
 *     Agent agent = client.agent.create(AgentInput.builder()
 *         .name("my-agent")
 *         .org("my-org")
 *         .instructions("You are a helpful assistant")
 *         .build());
 * }
 * }</pre>
 *
 * <p>On your machine, {@code stigmer up} serves on {@code localhost:7234} and
 * needs no key; a plaintext connection may leave it out and then sends no
 * {@code authorization} header:
 *
 * <pre>{@code
 * StigmerClient client = StigmerClient.builder()
 *     .baseUrl("localhost:7234")
 *     .insecure()
 *     .build();
 * }</pre>
 */
public final class StigmerClient extends GeneratedClient implements AutoCloseable {

    private static final String DEFAULT_TARGET = "api.stigmer.ai:443";
    private static final long SHUTDOWN_TIMEOUT_SECONDS = 5;

    private final ManagedChannel grpcChannel;
    private final BillingClient billing;
    private final SearchClient search;
    private final GitHubClient github;
    private final TokenClient tokens;
    private final RunnerAdapter runnerAdapter;
    private final TurnWaiter turns;

    private StigmerClient(ManagedChannel channel, RunnerAdapter runnerAdapter) {
        super(channel);
        this.grpcChannel = channel;
        this.billing = new BillingClient(channel);
        this.search = new SearchClient(channel);
        this.github = new GitHubClient(channel);
        this.tokens = new TokenClient(channel);
        this.runnerAdapter = runnerAdapter;
        this.turns = new TurnWaiter(channel, this.run::create, TurnWaiter.BACKOFF_BASE, TurnWaiter.BACKOFF_MAX);
    }

    /**
     * Creates a builder that authenticates with an API key, sent as
     * {@code Authorization: Bearer <key>} on every request.
     *
     * @throws NullPointerException     if {@code apiKey} is null
     * @throws IllegalArgumentException if {@code apiKey} is empty
     */
    public static Builder builder(String apiKey) {
        Objects.requireNonNull(apiKey, "stigmer: API key must not be null");
        if (apiKey.isEmpty()) {
            throw new IllegalArgumentException("stigmer: API key must not be empty");
        }
        return new Builder(apiKey);
    }

    /**
     * Creates a builder with no API key, for a local server on a plaintext
     * connection: {@link Builder#build()} refuses it unless
     * {@link Builder#insecure()} was called. No {@code authorization} header
     * is sent.
     */
    public static Builder builder() {
        return new Builder(null);
    }

    /**
     * The skill field carries push routing over the artifact transfer lane
     * (stigmer#675): {@code client.skill.push} simply works for any valid
     * skill size. Called from GeneratedClient's constructor — builds from
     * the channel alone, per the hook's contract.
     */
    @Override
    protected ai.stigmer.sdk.gen.SkillClient newSkillClient(io.grpc.Channel channel) {
        return new RoutedSkillClient(channel);
    }

    /**
     * The file field carries uploads routed by size over the same transfer
     * lane: {@code client.file} is a {@link RoutedFileClient}, whose
     * {@code uploadFile} works for any file the server accepts. Called from
     * GeneratedClient's constructor — builds from the channel alone, per the
     * hook's contract.
     */
    @Override
    protected ai.stigmer.sdk.gen.FileClient newFileClient(io.grpc.Channel channel) {
        return new RoutedFileClient(channel);
    }

    // -- Extra clients (not code-generated) ------------------------------------

    /** Returns the billing client for the billing account, Stripe and the model catalog. */
    public BillingClient billing() { return billing; }

    /** Returns the cross-resource search client. */
    public SearchClient search() { return search; }

    /** Returns the GitHub OAuth integration client. */
    public GitHubClient github() { return github; }

    /**
     * Returns the token client, which mints user tokens for people signed in
     * to an organization's own product. Requires this client's API key to
     * belong to a service account that administers the organization.
     */
    public TokenClient tokens() { return tokens; }

    /**
     * Returns the runner adapter, or {@code null} if none was configured.
     * Used internally by create methods to trigger runner lifecycle callbacks
     * when executionTarget is LOCAL.
     */
    public RunnerAdapter runnerAdapter() { return runnerAdapter; }

    // -- Turns ----------------------------------------------------------------

    /**
     * Sends a message as a new turn and waits for its answer, with no
     * timeout. See {@link #sendAndWait(SendAndWaitInput, Duration)}.
     */
    public TurnOutcome sendAndWait(SendAndWaitInput input) {
        return turns.sendAndWait(input, null);
    }

    /**
     * Sends a message as a new turn and waits for its answer.
     *
     * <p>The turn runs in the input's {@code sessionId}, or in a session
     * bootstrapped from its {@code sessionSpec}: exactly one of them is
     * required, and so is {@code org}, the organization the turn runs in;
     * both are checked before any call. An empty name becomes
     * {@code run-<epoch ms>}, as the console names its turns. For an existing
     * session the log's newest place is read first, so the wait sees only
     * this turn's events.
     *
     * <p>Returns when the turn ends (phase completed, failed, cancelled or
     * terminated) or waits for a person's answer (phase
     * {@link TurnOutcome#WAITING}, with its asks); answer each ask, then call
     * {@link #waitForTurn} with the outcome's {@code lastSeq}.
     *
     * @param timeout bounds the whole wait, reconnections included; null for none
     * @throws StigmerException with {@link ErrorCode#INVALID_ARGUMENT} for a
     *         missing org or session; the server's refusal of the run, or of
     *         the stream with a code a reconnect cannot fix; or, when the
     *         timeout passes, one whose {@code getGrpcCode()} is
     *         {@code DEADLINE_EXCEEDED}
     */
    public TurnOutcome sendAndWait(SendAndWaitInput input, Duration timeout) {
        return turns.sendAndWait(input, timeout);
    }

    /**
     * Waits for one turn of a session, with no timeout. See
     * {@link #waitForTurn(String, String, long, Duration)}.
     */
    public TurnOutcome waitForTurn(String sessionId, String runId, long afterSeq) {
        return turns.waitForTurn(sessionId, runId, afterSeq, null);
    }

    /**
     * Waits for one turn of a session: until it ends, or waits for an answer.
     *
     * @param afterSeq where in the log the turn's events begin, or later: a
     *                 previous outcome's {@code lastSeq} to resume after
     *                 answering its asks, or 0 to read the whole log
     * @param timeout  bounds the whole wait, reconnections included; null for none
     */
    public TurnOutcome waitForTurn(String sessionId, String runId, long afterSeq, Duration timeout) {
        return turns.waitForTurn(sessionId, runId, afterSeq, timeout);
    }

    // -- Lifecycle ------------------------------------------------------------

    /**
     * Shuts down the underlying gRPC channel gracefully. Waits up to
     * {@value #SHUTDOWN_TIMEOUT_SECONDS} seconds for in-flight RPCs to
     * complete, then forces shutdown.
     */
    @Override
    public void close() {
        if (grpcChannel.isShutdown()) {
            return;
        }
        grpcChannel.shutdown();
        try {
            if (!grpcChannel.awaitTermination(SHUTDOWN_TIMEOUT_SECONDS, TimeUnit.SECONDS)) {
                grpcChannel.shutdownNow();
            }
        } catch (InterruptedException e) {
            grpcChannel.shutdownNow();
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
            this.apiKey = apiKey;
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
         * methods after session/run creation and on terminal phase
         * detection. Cloud consumers omit this setting entirely.
         */
        public Builder runnerAdapter(RunnerAdapter adapter) {
            this.runnerAdapter = adapter;
            return this;
        }

        /**
         * Builds the {@link StigmerClient}.
         *
         * @throws IllegalStateException if no API key was given and the
         *                               connection is not {@link #insecure()}
         */
        public StigmerClient build() {
            if (apiKey == null && !insecure) {
                throw new IllegalStateException(
                        "stigmer: an API key is required on a TLS connection:"
                                + " use builder(apiKey), or insecure() for a local server");
            }
            ManagedChannel channel = StigmerChannel.create(new StigmerChannel.Config(
                    baseUrl, apiKey, insecure));
            return new StigmerClient(channel, runnerAdapter);
        }
    }
}
