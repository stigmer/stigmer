package ai.stigmer.sdk;

import ai.stigmer.iam.platformclient.v1.MintUserTokenRequest;
import ai.stigmer.iam.platformclient.v1.MintUserTokenResponse;
import ai.stigmer.iam.platformclient.v1.PlatformClientTokenControllerGrpc;
import ai.stigmer.sdk.gen.ErrorCode;
import ai.stigmer.sdk.gen.StigmerException;
import io.grpc.ManagedChannel;
import io.grpc.ManagedChannelBuilder;
import io.grpc.Status;
import io.grpc.StatusRuntimeException;
import io.grpc.netty.shaded.io.grpc.netty.NettyChannelBuilder;

import java.time.Instant;
import java.util.Objects;
import java.util.concurrent.TimeUnit;

/**
 * PlatformClient token-minting helper for platform builder backends.
 *
 * <p>A minimal, purpose-built client for minting Stigmer-signed user JWTs.
 * It does NOT replace the main {@link StigmerClient} — use that with an API
 * key for resource management.
 *
 * <p>The returned tokens are passed to the React SDK's {@code StigmerProvider}
 * via {@code getAccessToken} to authenticate browser-based API calls.
 *
 * <pre>{@code
 * try (PlatformClientAuth auth = PlatformClientAuth.builder("api.stigmer.ai:443")
 *         .clientId(System.getenv("STIGMER_CLIENT_ID"))
 *         .clientSecret(System.getenv("STIGMER_CLIENT_SECRET"))
 *         .build()) {
 *     MintUserTokenResult result = auth.mintUserToken(MintUserTokenInput.builder()
 *         .userId("user-123")
 *         .userEmail("jane@acme.com")
 *         .userName("Jane Doe")
 *         .build());
 *     System.out.println(result.accessToken());
 * }
 * }</pre>
 */
public final class PlatformClientAuth implements AutoCloseable {

    private static final long SHUTDOWN_TIMEOUT_SECONDS = 5;

    private final PlatformClientTokenControllerGrpc.PlatformClientTokenControllerBlockingStub tokenStub;
    private final String clientId;
    private final String clientSecret;
    private final ManagedChannel channel;

    private PlatformClientAuth(ManagedChannel channel, String clientId, String clientSecret) {
        this.channel = channel;
        this.clientId = clientId;
        this.clientSecret = clientSecret;
        this.tokenStub = PlatformClientTokenControllerGrpc.newBlockingStub(channel);
    }

    /** Creates a new builder with the given Stigmer API target address. */
    public static Builder builder(String baseUrl) {
        return new Builder(baseUrl);
    }

    /**
     * Mints a user-scoped JWT for browser-based access to Stigmer resources.
     *
     * @param input the user identity and optional org scope
     * @return the minted token with metadata
     * @throws StigmerException with {@link ErrorCode#UNAUTHENTICATED} if credentials are invalid
     * @throws StigmerException with {@link ErrorCode#NOT_FOUND} if the user doesn't exist and
     *         JIT provisioning is disabled
     * @throws StigmerException with {@link ErrorCode#FAILED_PRECONDITION} if the secret has expired
     * @throws StigmerException with {@link ErrorCode#PERMISSION_DENIED} if the origin is not allowed
     */
    public MintUserTokenResult mintUserToken(MintUserTokenInput input) {
        String userId = input.userId();
        if (userId == null || userId.isEmpty()) {
            throw new StigmerException(
                    ErrorCode.INVALID_ARGUMENT,
                    "mintUserToken: userId is required — this is the platform's stable identifier for the user",
                    Status.Code.INVALID_ARGUMENT);
        }

        MintUserTokenRequest request = MintUserTokenRequest.newBuilder()
                .setClientId(clientId)
                .setClientSecret(clientSecret)
                .setUserId(userId)
                .setUserEmail(input.userEmail())
                .setUserName(input.userName())
                .setOrgId(input.orgId())
                .build();

        try {
            MintUserTokenResponse response = tokenStub.mintUserToken(request);
            return new MintUserTokenResult(
                    response.getAccessToken(),
                    response.getTokenType(),
                    response.getExpiresIn(),
                    Instant.now().plusSeconds(response.getExpiresIn()));
        } catch (StatusRuntimeException e) {
            throw StigmerException.wrap(e);
        }
    }

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

    /** Builder for {@link PlatformClientAuth}. */
    public static final class Builder {
        private final String baseUrl;
        private String clientId;
        private String clientSecret;
        private boolean insecure;

        private Builder(String baseUrl) {
            this.baseUrl = Objects.requireNonNull(baseUrl, "baseUrl must not be null");
        }

        /** Sets the PlatformClient client_id (stgm_cid_ prefix). */
        public Builder clientId(String clientId) {
            this.clientId = clientId;
            return this;
        }

        /** Sets the PlatformClient client_secret (stgm_cs_ prefix). Server-only. */
        public Builder clientSecret(String clientSecret) {
            this.clientSecret = clientSecret;
            return this;
        }

        /** Disables TLS. Use only for local development. */
        public Builder insecure() {
            this.insecure = true;
            return this;
        }

        /**
         * Builds the {@link PlatformClientAuth}.
         *
         * @throws IllegalArgumentException if clientId or clientSecret is missing or empty
         */
        public PlatformClientAuth build() {
            if (clientId == null || clientId.isEmpty()) {
                throw new IllegalArgumentException(
                        "stigmer: clientId is required — find it in the Stigmer Console under IAM > Platform Clients");
            }
            if (clientSecret == null || clientSecret.isEmpty()) {
                throw new IllegalArgumentException(
                        "stigmer: clientSecret is required — the secret is shown once at creation time. "
                                + "If lost, rotate via the Console or CLI");
            }

            ManagedChannelBuilder<?> channelBuilder;
            if (insecure) {
                channelBuilder = ManagedChannelBuilder.forTarget(baseUrl).usePlaintext();
            } else {
                channelBuilder = NettyChannelBuilder.forTarget(baseUrl).useTransportSecurity();
            }

            ManagedChannel channel = channelBuilder.build();
            return new PlatformClientAuth(channel, clientId, clientSecret);
        }
    }
}
