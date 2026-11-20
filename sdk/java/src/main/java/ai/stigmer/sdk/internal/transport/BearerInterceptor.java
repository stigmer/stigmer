package ai.stigmer.sdk.internal.transport;

import io.grpc.CallOptions;
import io.grpc.Channel;
import io.grpc.ClientCall;
import io.grpc.ClientInterceptor;
import io.grpc.Metadata;
import io.grpc.MethodDescriptor;

import java.util.function.Supplier;

/**
 * gRPC interceptor that attaches {@code Authorization: Bearer <token>} to
 * every outgoing request, unary and streaming alike.
 *
 * <p>The token comes from a supplier asked once per call: an API key's
 * supplier returns the key, and {@code builder().tokenProvider(…)} passes the
 * caller's own, so a minted token that expires is fetched again (a
 * {@code TokenCache} keeps it until it nearly does). The supplier is asked
 * before the call is created, so an exception it throws (a refused mint)
 * reaches the caller unchanged and nothing is sent.
 */
final class BearerInterceptor implements ClientInterceptor {

    private static final Metadata.Key<String> AUTH_KEY =
            Metadata.Key.of("authorization", Metadata.ASCII_STRING_MARSHALLER);

    private final Supplier<String> token;

    BearerInterceptor(Supplier<String> token) {
        this.token = token;
    }

    @Override
    public <ReqT, RespT> ClientCall<ReqT, RespT> interceptCall(
            MethodDescriptor<ReqT, RespT> method,
            CallOptions callOptions,
            Channel next) {
        String value = token.get();
        if (value == null || value.isEmpty()) {
            throw new IllegalStateException(
                    "stigmer: the token provider returned no token: it must return the bearer token");
        }
        String bearer = "Bearer " + value;
        return new io.grpc.ForwardingClientCall.SimpleForwardingClientCall<>(next.newCall(method, callOptions)) {
            @Override
            public void start(Listener<RespT> responseListener, Metadata headers) {
                headers.put(AUTH_KEY, bearer);
                super.start(responseListener, headers);
            }
        };
    }
}
