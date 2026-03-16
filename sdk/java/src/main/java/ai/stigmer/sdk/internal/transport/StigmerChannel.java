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
 */
public final class StigmerChannel {

    private StigmerChannel() {}

    /** Creates a {@link ManagedChannel} from the given configuration. */
    public static ManagedChannel create(Config config) {
        Objects.requireNonNull(config.target, "target must not be null");
        Objects.requireNonNull(config.apiKey, "apiKey must not be null");

        ManagedChannelBuilder<?> builder;
        if (config.insecure) {
            builder = ManagedChannelBuilder.forTarget(config.target).usePlaintext();
        } else {
            builder = NettyChannelBuilder.forTarget(config.target).useTransportSecurity();
        }

        builder.intercept(new ApiKeyInterceptor(config.apiKey));

        return builder.build();
    }

    /** Connection configuration for the Stigmer gRPC channel. */
    public static final class Config {
        final String target;
        final String apiKey;
        final boolean insecure;

        public Config(String target, String apiKey, boolean insecure) {
            this.target = target;
            this.apiKey = apiKey;
            this.insecure = insecure;
        }
    }
}
