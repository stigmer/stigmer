package ai.stigmer.sdk;

import ai.stigmer.iam.token.v1.MintUserTokenRequest;
import ai.stigmer.iam.token.v1.MintUserTokenResponse;
import ai.stigmer.iam.token.v1.TokenServiceGrpc;
import ai.stigmer.sdk.gen.ErrorCode;
import ai.stigmer.sdk.gen.StigmerException;
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

import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.TimeUnit;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertSame;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * Pins what {@link TokenClient#mintUserToken} sends and returns: the
 * organization and the person's identity reach the token service as given,
 * the result carries the token and an expiry computed at call time, an empty
 * organization or user id is refused before any request, and a server
 * refusal surfaces as a {@link StigmerException} with the server's code. A
 * real gRPC server captures the requests.
 */
@DisplayName("TokenClient mintUserToken")
class TokenClientTest {

    private final List<MintUserTokenRequest> requests = new ArrayList<>();
    private Status refusal;
    private Server grpcServer;
    private ManagedChannel channel;

    private final class FakeTokenService extends TokenServiceGrpc.TokenServiceImplBase {
        @Override
        public void mintUserToken(MintUserTokenRequest request,
                                  StreamObserver<MintUserTokenResponse> responseObserver) {
            requests.add(request);
            if (refusal != null) {
                responseObserver.onError(refusal.asRuntimeException());
                return;
            }
            responseObserver.onNext(MintUserTokenResponse.newBuilder()
                    .setAccessToken("minted-token")
                    .setTokenType("Bearer")
                    .setExpiresIn(3600)
                    .build());
            responseObserver.onCompleted();
        }
    }

    @BeforeEach
    void start() throws Exception {
        grpcServer = NettyServerBuilder.forPort(0)
                .addService(new FakeTokenService())
                .build()
                .start();
        channel = ManagedChannelBuilder.forTarget("localhost:" + grpcServer.getPort())
                .usePlaintext()
                .build();
    }

    @AfterEach
    void stop() throws Exception {
        channel.shutdownNow();
        channel.awaitTermination(5, TimeUnit.SECONDS);
        grpcServer.shutdownNow();
        grpcServer.awaitTermination(5, TimeUnit.SECONDS);
    }

    @Test
    @DisplayName("sends the organization and the person's identity, and returns the token with its expiry")
    void mintsForTheNamedOrganization() {
        Instant before = Instant.now();
        MintUserTokenResult result = new TokenClient(channel).mintUserToken(MintUserTokenInput.builder()
                .org("acme")
                .userId("user-123")
                .userEmail("jane@acme.com")
                .userName("Jane Doe")
                .build());
        Instant after = Instant.now();

        assertEquals(1, requests.size());
        MintUserTokenRequest sent = requests.get(0);
        assertEquals("acme", sent.getOrg());
        assertEquals("user-123", sent.getUserId());
        assertEquals("jane@acme.com", sent.getUserEmail());
        assertEquals("Jane Doe", sent.getUserName());

        assertEquals("minted-token", result.accessToken());
        assertEquals("Bearer", result.tokenType());
        assertEquals(3600, result.expiresIn());
        assertFalse(result.expiresAt().isBefore(before.plusSeconds(3600)), result.expiresAt().toString());
        assertFalse(result.expiresAt().isAfter(after.plusSeconds(3600)), result.expiresAt().toString());
        assertFalse(result.toString().contains("minted-token"), result.toString());
    }

    @Test
    @DisplayName("an email and name left unset are sent empty")
    void optionalProfileFieldsSentEmpty() {
        new TokenClient(channel).mintUserToken(MintUserTokenInput.builder()
                .org("acme")
                .userId("user-123")
                .userEmail(null)
                .build());

        assertEquals("", requests.get(0).getUserEmail());
        assertEquals("", requests.get(0).getUserName());
    }

    @Test
    @DisplayName("an empty organization is refused before any request")
    void emptyOrgRefused() {
        StigmerException ex = assertThrows(StigmerException.class, () ->
                new TokenClient(channel).mintUserToken(MintUserTokenInput.builder()
                        .userId("user-123")
                        .build()));
        assertEquals(ErrorCode.INVALID_ARGUMENT, ex.getCode());
        assertTrue(ex.getMessage().contains("org is required"), ex.getMessage());
        assertTrue(requests.isEmpty());
    }

    @Test
    @DisplayName("a null organization is refused before any request")
    void nullOrgRefused() {
        StigmerException ex = assertThrows(StigmerException.class, () ->
                new TokenClient(channel).mintUserToken(MintUserTokenInput.builder()
                        .org(null)
                        .userId("user-123")
                        .build()));
        assertEquals(ErrorCode.INVALID_ARGUMENT, ex.getCode());
        assertTrue(requests.isEmpty());
    }

    @Test
    @DisplayName("an empty user id is refused before any request")
    void emptyUserIdRefused() {
        StigmerException ex = assertThrows(StigmerException.class, () ->
                new TokenClient(channel).mintUserToken(MintUserTokenInput.builder()
                        .org("acme")
                        .userId("")
                        .build()));
        assertEquals(ErrorCode.INVALID_ARGUMENT, ex.getCode());
        assertTrue(ex.getMessage().contains("userId is required"), ex.getMessage());
        assertTrue(requests.isEmpty());
    }

    @Test
    @DisplayName("a null user id is refused before any request")
    void nullUserIdRefused() {
        StigmerException ex = assertThrows(StigmerException.class, () ->
                new TokenClient(channel).mintUserToken(MintUserTokenInput.builder()
                        .org("acme")
                        .userId(null)
                        .build()));
        assertEquals(ErrorCode.INVALID_ARGUMENT, ex.getCode());
        assertTrue(requests.isEmpty());
    }

    @Test
    @DisplayName("a server refusal surfaces as a StigmerException with the server's code")
    void serverRefusalSurfaces() {
        refusal = Status.PERMISSION_DENIED.withDescription("unauthorized to mint user tokens for this organization");

        StigmerException ex = assertThrows(StigmerException.class, () ->
                new TokenClient(channel).mintUserToken(MintUserTokenInput.builder()
                        .org("acme")
                        .userId("user-123")
                        .build()));
        assertEquals(ErrorCode.PERMISSION_DENIED, ex.getCode());
        assertEquals(Status.Code.PERMISSION_DENIED, ex.getGrpcCode());
        assertEquals("unauthorized to mint user tokens for this organization", ex.getMessage());
        assertEquals(1, requests.size());
    }

    @Test
    @DisplayName("the top-level client serves one token client")
    void stigmerClientServesTokens() {
        try (StigmerClient client = StigmerClient.builder("stgm_test_key")
                .baseUrl("localhost:" + grpcServer.getPort())
                .insecure()
                .build()) {
            assertSame(client.tokens(), client.tokens());
            client.tokens().mintUserToken(MintUserTokenInput.builder()
                    .org("acme")
                    .userId("user-123")
                    .build());
            assertEquals(1, requests.size());
        }
    }
}
