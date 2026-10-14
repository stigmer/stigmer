package ai.stigmer.sdk;

import ai.stigmer.billing.v1.BillingQueryControllerGrpc;
import ai.stigmer.billing.v1.ListModelPricingBaselinesInput;
import ai.stigmer.billing.v1.ModelPricingBaseline;
import ai.stigmer.billing.v1.ModelPricingBaselinesResponse;
import ai.stigmer.commons.apiresource.apiresourcekind.ApiResourceKind;
import ai.stigmer.search.v1.SearchRequest;
import ai.stigmer.search.v1.SearchResponse;
import ai.stigmer.search.v1.SearchResult;
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

/**
 * Pins the hand-written page iterators: search's queryAll walks the next
 * page token to the end from the token its params name and carries the
 * query's kinds, organization, text and page size onto every page; the
 * billing catalog's listModelPricingBaselinesAll walks every page with the
 * history flag kept. A real gRPC server serves five rows two at a time and
 * records each request.
 */
@DisplayName("Hand-written page iterators")
class HandWrittenPagesTest {

    private static final int ROWS = 5;
    private static final int PAGE = 2;

    private final List<SearchRequest> searches = new ArrayList<>();
    private final List<ListModelPricingBaselinesInput> catalogReads = new ArrayList<>();
    private Server grpcServer;
    private ManagedChannel channel;

    private static int start(String token) {
        return token.isEmpty() ? 0 : Integer.parseInt(token);
    }

    private static String next(int end) {
        return end < ROWS ? Integer.toString(end) : "";
    }

    private final class PagedSearch extends SearchServiceGrpc.SearchServiceImplBase {
        @Override
        public void search(SearchRequest request, StreamObserver<SearchResponse> out) {
            searches.add(request);
            int from = start(request.getPageToken());
            int end = Math.min(from + PAGE, ROWS);
            SearchResponse.Builder page = SearchResponse.newBuilder().setNextPageToken(next(end));
            for (int i = from; i < end; i++) {
                page.addEntries(SearchResult.newBuilder().setId("agt_" + i));
            }
            out.onNext(page.build());
            out.onCompleted();
        }
    }

    private final class PagedCatalog extends BillingQueryControllerGrpc.BillingQueryControllerImplBase {
        @Override
        public void listModelPricingBaselines(
                ListModelPricingBaselinesInput request, StreamObserver<ModelPricingBaselinesResponse> out) {
            catalogReads.add(request);
            int from = start(request.getPageToken());
            int end = Math.min(from + PAGE, ROWS);
            ModelPricingBaselinesResponse.Builder page =
                    ModelPricingBaselinesResponse.newBuilder().setNextPageToken(next(end));
            for (int i = from; i < end; i++) {
                page.addEntries(ModelPricingBaseline.newBuilder().setModelId("model-" + i));
            }
            out.onNext(page.build());
            out.onCompleted();
        }
    }

    @BeforeEach
    void start() throws Exception {
        grpcServer = NettyServerBuilder.forPort(0)
                .addService(new PagedSearch())
                .addService(new PagedCatalog())
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
    @DisplayName("queryAll walks every page from the params' token, keeping the query on each")
    void queryAll() {
        SearchClient.SearchParams params = SearchClient.SearchParams.builder()
                .org("acme")
                .kinds(List.of(ApiResourceKind.agent))
                .query("triage")
                .pageSize(PAGE)
                .pageToken("1")
                .build();
        List<String> ids = new ArrayList<>();
        for (SearchResult result : new SearchClient(channel).queryAll(params)) {
            ids.add(result.getId());
        }
        assertEquals(List.of("agt_1", "agt_2", "agt_3", "agt_4"), ids);
        List<String> tokens = new ArrayList<>();
        for (SearchRequest request : searches) {
            tokens.add(request.getPageToken());
            assertEquals("acme", request.getOrg());
            assertEquals(List.of(ApiResourceKind.agent), request.getKindsList());
            assertEquals("triage", request.getQuery());
            assertEquals(PAGE, request.getPageSize());
        }
        assertEquals(List.of("1", "3"), tokens);
    }

    @Test
    @DisplayName("listModelPricingBaselinesAll walks every page with the history flag kept")
    void catalogAll() {
        List<String> models = new ArrayList<>();
        for (ModelPricingBaseline baseline : new BillingClient(channel).listModelPricingBaselinesAll(true)) {
            models.add(baseline.getModelId());
        }
        assertEquals(List.of("model-0", "model-1", "model-2", "model-3", "model-4"), models);
        List<String> tokens = new ArrayList<>();
        for (ListModelPricingBaselinesInput read : catalogReads) {
            tokens.add(read.getPageToken());
            assertEquals(true, read.getIncludeHistory());
        }
        assertEquals(List.of("", "2", "4"), tokens);
    }
}
