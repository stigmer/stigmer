package ai.stigmer.sdk;

import ai.stigmer.agentic.skill.v1.CreateSkillArtifactUploadUrlRequest;
import ai.stigmer.agentic.skill.v1.PushSkillRequest;
import ai.stigmer.agentic.skill.v1.Skill;
import ai.stigmer.agentic.skill.v1.SkillArtifactUploadUrl;
import ai.stigmer.agentic.skill.v1.SkillCommandControllerGrpc;
import ai.stigmer.sdk.gen.StigmerException;
import com.google.protobuf.ByteString;
import com.sun.net.httpserver.HttpServer;
import io.grpc.ManagedChannel;
import io.grpc.ManagedChannelBuilder;
import io.grpc.Server;
import io.grpc.Status;
import io.grpc.netty.shaded.io.grpc.netty.NettyServerBuilder;
import io.grpc.stub.StreamObserver;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.net.InetSocketAddress;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicReference;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.junit.jupiter.api.Assertions.fail;

/**
 * Routing pins for RoutedSkillClient (stigmer#701), mirroring
 * sdk/go/skill_test.go: a real gRPC server captures pushes/mints and the
 * JDK's built-in HttpServer plays the staging endpoint — the whole lane
 * runs at full wire fidelity with zero test-only dependencies.
 */
@DisplayName("RoutedSkillClient push routing")
class RoutedSkillClientTest {

    private static final byte[] SMALL = new byte[1024];
    private static final byte[] LARGE = new byte[RoutedSkillClient.MAX_INLINE_ARTIFACT_BYTES + 1];

    private final List<PushSkillRequest> pushes = new ArrayList<>();
    private final AtomicInteger mints = new AtomicInteger();
    private final AtomicReference<byte[]> stagedBytes = new AtomicReference<>();
    private final AtomicReference<String> stagedContentType = new AtomicReference<>();

    private Server grpcServer;
    private HttpServer stagingServer;
    private ManagedChannel channel;
    /** Behavior knobs, set per test before the first RPC. */
    private volatile boolean mintUnimplemented;
    private volatile int stagingStatus = 200;

    private final class FakeSkillService extends SkillCommandControllerGrpc.SkillCommandControllerImplBase {
        @Override
        public void push(PushSkillRequest request, StreamObserver<Skill> responseObserver) {
            pushes.add(request);
            responseObserver.onNext(Skill.getDefaultInstance());
            responseObserver.onCompleted();
        }

        @Override
        public void createArtifactUploadUrl(CreateSkillArtifactUploadUrlRequest request,
                                            StreamObserver<SkillArtifactUploadUrl> responseObserver) {
            if (mintUnimplemented) {
                responseObserver.onError(Status.UNIMPLEMENTED.asRuntimeException());
                return;
            }
            mints.incrementAndGet();
            responseObserver.onNext(SkillArtifactUploadUrl.newBuilder()
                    .setUrl("http://localhost:" + stagingServer.getAddress().getPort() + "/staging/sau_t")
                    .setArtifactUploadRef("sau_t")
                    .setTtlSeconds(900)
                    .build());
            responseObserver.onCompleted();
        }
    }

    @BeforeEach
    void start() throws Exception {
        stagingServer = HttpServer.create(new InetSocketAddress("localhost", 0), 0);
        stagingServer.createContext("/staging", exchange -> {
            stagedBytes.set(exchange.getRequestBody().readAllBytes());
            stagedContentType.set(exchange.getRequestHeaders().getFirst("Content-Type"));
            byte[] body = stagingStatus >= 400 ? "staging slot expired".getBytes() : new byte[0];
            exchange.sendResponseHeaders(stagingStatus, body.length == 0 ? -1 : body.length);
            if (body.length > 0) {
                exchange.getResponseBody().write(body);
            }
            exchange.close();
        });
        stagingServer.start();

        grpcServer = NettyServerBuilder.forPort(0)
                .maxInboundMessageSize(11 * 1024 * 1024)
                .addService(new FakeSkillService())
                .build()
                .start();
        channel = ManagedChannelBuilder.forTarget("localhost:" + grpcServer.getPort())
                .usePlaintext()
                .maxInboundMessageSize(11 * 1024 * 1024)
                .build();
    }

    @AfterEach
    void stop() throws Exception {
        channel.shutdownNow();
        channel.awaitTermination(5, TimeUnit.SECONDS);
        grpcServer.shutdownNow();
        grpcServer.awaitTermination(5, TimeUnit.SECONDS);
        stagingServer.stop(0);
    }

    private RoutedSkillClient client() {
        return new RoutedSkillClient(channel);
    }

    @Test
    @DisplayName("keeps small artifacts inline — no mint, bytes in the request")
    void smallArtifactStaysInline() {
        client().push(PushSkillRequest.newBuilder()
                .setOrg("acme")
                .setArtifact(ByteString.copyFrom(SMALL))
                .build());

        assertEquals(0, mints.get());
        assertEquals(1, pushes.size());
        assertEquals(SMALL.length, pushes.get(0).getArtifact().size());
    }

    @Test
    @DisplayName("stages large artifacts over HTTP and pushes by reference, preserving the envelope")
    void largeArtifactRoutesViaUploadUrl() {
        client().push(PushSkillRequest.newBuilder()
                .setOrg("acme")
                .setArtifact(ByteString.copyFrom(LARGE))
                .setTag("stable")
                .setMessage("big")
                .build());

        assertEquals(1, mints.get());
        assertEquals(LARGE.length, stagedBytes.get().length);
        assertEquals("application/zip", stagedContentType.get());
        assertEquals(1, pushes.size());
        assertEquals(0, pushes.get(0).getArtifact().size());
        assertEquals("sau_t", pushes.get(0).getArtifactUploadRef());
        // The by-ref rewrite must not lose the rest of the request.
        assertEquals("stable", pushes.get(0).getTag());
        assertEquals("big", pushes.get(0).getMessage());
    }

    @Test
    @DisplayName("passes an explicit upload ref through untouched — the caller staged it")
    void explicitRefPassesThrough() {
        client().push(PushSkillRequest.newBuilder()
                .setOrg("acme")
                .setArtifactUploadRef("sau_mine")
                .build());

        assertEquals(0, mints.get());
        assertEquals("sau_mine", pushes.get(0).getArtifactUploadRef());
    }

    @Test
    @DisplayName("fails loud against servers that predate the transfer lane")
    void preLaneServerFailsLoud() {
        mintUnimplemented = true;

        try {
            client().push(PushSkillRequest.newBuilder()
                    .setOrg("acme")
                    .setArtifact(ByteString.copyFrom(LARGE))
                    .build());
            fail("expected StigmerException");
        } catch (StigmerException e) {
            assertTrue(e.getMessage().contains("upgrade stigmer-server"),
                    "the error must carry the recovery guidance: " + e.getMessage());
        }
        assertEquals(0, pushes.size());
    }

    @Test
    @DisplayName("surfaces the staging rejection body and never proceeds to push")
    void failedStagingPutSurfacesBodyAndNeverPushes() {
        stagingStatus = 404;

        try {
            client().push(PushSkillRequest.newBuilder()
                    .setOrg("acme")
                    .setArtifact(ByteString.copyFrom(LARGE))
                    .build());
            fail("expected StigmerException");
        } catch (StigmerException e) {
            assertTrue(e.getMessage().contains("HTTP 404: staging slot expired"),
                    "the rejection body must surface: " + e.getMessage());
        }
        assertEquals(0, pushes.size());
    }
}
