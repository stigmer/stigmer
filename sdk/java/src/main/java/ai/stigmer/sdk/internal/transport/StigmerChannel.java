package ai.stigmer.sdk.internal.transport;

import io.grpc.ManagedChannel;
import io.grpc.ManagedChannelBuilder;
import io.grpc.netty.shaded.io.grpc.netty.NettyChannelBuilder;

import java.util.Objects;

/**
 * Factory for creating a configured gRPC {@link ManagedChannel} to the
 * Stigmer API server.
 *
 * <p>TLS is enabled by default using the system trust store. Use
 * {@link Config#insecure} for plaintext connections during local development.
 *
 * <p>The key rule is the Go SDK's: only a plaintext connection, which is a
 * local server's, may go without a key, and then no {@code authorization}
 * header is sent at all. A keyless TLS channel is refused.
 */
public final class StigmerChannel {

    /**
     * Client receive cap, raised to the server's own 10MB message limit
     * (stigmer#702). grpc-java's default is 4MB — an invisible library
     * default BELOW the platform's documented behavior, so responses the
     * server would happily serve (e.g. a 4–10MB skill getArtifact) died
     * client-side with "gRPC message exceeds maximum size". The server
     * stays the single limiting authority.
     */
    static final int MAX_INBOUND_MESSAGE_SIZE = 10 * 1024 * 1024;

    private StigmerChannel() {}

    /** Creates a {@link ManagedChannel} from the given configuration. */
    public static ManagedChannel create(Config config) {
        Objects.requireNonNull(config.target, "target must not be null");
        if (config.apiKey == null && !config.insecure) {
            throw new IllegalArgumentException(
                    "stigmer: an API key is required on a TLS connection");
        }

        ManagedChannelBuilder<?> builder;
        if (config.insecure) {
            builder = ManagedChannelBuilder.forTarget(config.target).usePlaintext();
        } else {
            builder = NettyChannelBuilder.forTarget(config.target).useTransportSecurity();
        }

        builder.maxInboundMessageSize(MAX_INBOUND_MESSAGE_SIZE);
        if (config.apiKey != null) {
            builder.intercept(new ApiKeyInterceptor(config.apiKey));
        }

        return builder.build();
    }

    /** Connection configuration for the Stigmer gRPC channel. */
    public static final class Config {
        final String target;
        final String apiKey;
        final boolean insecure;

        /**
         * @param apiKey the API key sent as {@code Authorization: Bearer};
         *               {@code null} only when {@code insecure}
         */
        public Config(String target, String apiKey, boolean insecure) {
            this.target = target;
            this.apiKey = apiKey;
            this.insecure = insecure;
        }
    }
}
