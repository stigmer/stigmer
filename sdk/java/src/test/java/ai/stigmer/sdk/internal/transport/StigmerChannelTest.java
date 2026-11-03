package ai.stigmer.sdk.internal.transport;

import ai.stigmer.agentic.skill.v1.GetArtifactRequest;
import ai.stigmer.agentic.skill.v1.GetArtifactResponse;
import ai.stigmer.agentic.skill.v1.SkillQueryControllerGrpc;
import com.google.protobuf.ByteString;
import io.grpc.ManagedChannel;
import io.grpc.Metadata;
import io.grpc.Server;
import io.grpc.ServerCall;
import io.grpc.ServerCallHandler;
import io.grpc.ServerInterceptor;
import io.grpc.ServerInterceptors;
import io.grpc.netty.shaded.io.grpc.netty.NettyServerBuilder;
import io.grpc.stub.StreamObserver;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.TimeUnit;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;

/**
 * Transport pins: the channel factory must receive responses above
 * grpc-java's 4MB default (stigmer#702 — the server's limit is 10MB, and an
 * invisible client-side library default below it refused responses the
 * server would happily serve with "gRPC message exceeds maximum size").
 *
 * <p>The key pins: a channel with no key, allowed only on plaintext (a local
 * server), sends no {@code authorization} header; one with a key sends its
 * bearer; a keyless TLS channel is refused. The served fake records each
 * call's headers, so the tests read what reached the wire.
 */
@DisplayName("StigmerChannel")
class StigmerChannelTest {

    private static final int FIVE_MB = 5 * 1024 * 1024;

    private Server server;
    private ManagedChannel channel;
    private final List<String> authorizations = new ArrayList<>();

    private static final Metadata.Key<String> AUTHORIZATION =
            Metadata.Key.of("authorization", Metadata.ASCII_STRING_MARSHALLER);

    /** Records each call's authorization header (null when absent). */
    private final ServerInterceptor headerRecorder = new ServerInterceptor() {
        @Override
        public <ReqT, RespT> ServerCall.Listener<ReqT> interceptCall(
                ServerCall<ReqT, RespT> call, Metadata headers,
                ServerCallHandler<ReqT, RespT> next) {
            authorizations.add(headers.get(AUTHORIZATION));
            return next.startCall(call, headers);
        }
    };

    /** Serves a getArtifact response above the 4MB grpc-java default. */
    private static final class OversizedArtifactService
            extends SkillQueryControllerGrpc.SkillQueryControllerImplBase {
        @Override
        public void getArtifact(GetArtifactRequest request,
                                StreamObserver<GetArtifactResponse> responseObserver) {
            byte[] artifact = new byte[FIVE_MB];
            responseObserver.onNext(GetArtifactResponse.newBuilder()
                    .setArtifact(ByteString.copyFrom(artifact))
                    .build());
            responseObserver.onCompleted();
        }
    }

    @BeforeEach
    void startServer() throws Exception {
        server = NettyServerBuilder.forPort(0)
                .addService(ServerInterceptors.intercept(
                        new OversizedArtifactService(), headerRecorder))
                .build()
                .start();
    }

    @AfterEach
    void stop() throws Exception {
        if (channel != null) {
            channel.shutdownNow();
            channel.awaitTermination(5, TimeUnit.SECONDS);
        }
        server.shutdownNow();
        server.awaitTermination(5, TimeUnit.SECONDS);
    }

    @Test
    @DisplayName("receives responses above grpc-java's 4MB default cap (stigmer#702)")
    void receivesResponsesAboveGrpcDefaultCap() {
        channel = StigmerChannel.create(new StigmerChannel.Config(
                "localhost:" + server.getPort(), "test-api-key", true));

        GetArtifactResponse response = SkillQueryControllerGrpc.newBlockingStub(channel)
                .getArtifact(GetArtifactRequest.newBuilder()
                        .setArtifactStorageKey("skills/org/skill/hash.zip")
                        .build());

        assertEquals(FIVE_MB, response.getArtifact().size(),
                "a 5MB artifact must arrive intact through the SDK channel");
    }

    private void oneCall() {
        SkillQueryControllerGrpc.newBlockingStub(channel)
                .getArtifact(GetArtifactRequest.newBuilder()
                        .setArtifactStorageKey("k")
                        .build());
    }

    @Test
    @DisplayName("a keyless plaintext channel sends no authorization header")
    void keylessPlaintextSendsNoAuthorization() {
        channel = StigmerChannel.create(new StigmerChannel.Config(
                "localhost:" + server.getPort(), null, true));
        oneCall();
        assertEquals(1, authorizations.size());
        assertNull(authorizations.get(0));
    }

    @Test
    @DisplayName("a keyed channel sends its bearer")
    void keyedChannelSendsBearer() {
        channel = StigmerChannel.create(new StigmerChannel.Config(
                "localhost:" + server.getPort(), "stk_test_key", true));
        oneCall();
        assertEquals("Bearer stk_test_key", authorizations.get(0));
    }

    @Test
    @DisplayName("a keyless TLS channel is refused")
    void keylessTlsIsRefused() {
        assertThrows(IllegalArgumentException.class, () -> StigmerChannel.create(
                new StigmerChannel.Config("localhost:" + server.getPort(), null, false)));
    }
}
