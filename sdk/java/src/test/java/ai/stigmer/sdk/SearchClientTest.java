package ai.stigmer.sdk;

import ai.stigmer.search.v1.SearchRequest;
import ai.stigmer.search.v1.SearchResponse;
import ai.stigmer.search.v1.SearchServiceGrpc;
import io.grpc.ManagedChannel;
import io.grpc.ManagedChannelBuilder;
import io.grpc.Server;
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
import static org.junit.jupiter.api.Assertions.assertThrows;

/**
 * Pins what SearchClient sends for the organization: a search that names
 * none sends an empty org, which searches every organization the caller can
 * see (a server that holds one organization fills its own), so the builder
 * no longer refuses it. A real gRPC server captures the request.
 */
@DisplayName("SearchClient organization")
class SearchClientTest {

    private final List<SearchRequest> requests = new ArrayList<>();
    private Server grpcServer;
    private ManagedChannel channel;

    private final class FakeSearchService extends SearchServiceGrpc.SearchServiceImplBase {
        @Override
        public void search(SearchRequest request, StreamObserver<SearchResponse> responseObserver) {
            requests.add(request);
            responseObserver.onNext(SearchResponse.getDefaultInstance());
            responseObserver.onCompleted();
        }
    }

    @BeforeEach
    void start() throws Exception {
        grpcServer = NettyServerBuilder.forPort(0)
                .addService(new FakeSearchService())
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
    @DisplayName("a search that names no organization sends an empty org")
    void noOrganization() {
        new SearchClient(channel).query(SearchClient.SearchParams.builder().query("helper").build());
        assertEquals(1, requests.size());
        assertEquals("", requests.get(0).getOrg());
    }

    @Test
    @DisplayName("a named organization is sent as named")
    void namedOrganization() {
        new SearchClient(channel).query(SearchClient.SearchParams.builder().org("acme").build());
        assertEquals("acme", requests.get(0).getOrg());
    }

    @Test
    @DisplayName("a null organization is a caller bug, refused at once")
    void nullOrganization() {
        assertThrows(NullPointerException.class, () -> SearchClient.SearchParams.builder().org(null));
    }
}
