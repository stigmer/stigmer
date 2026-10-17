package ai.stigmer.sdk.gen;

import ai.stigmer.agentic.routine.v1.ListRoutinesRequest;
import ai.stigmer.agentic.routine.v1.Routine;
import ai.stigmer.agentic.routine.v1.RoutineList;
import ai.stigmer.agentic.routine.v1.RoutineQueryControllerGrpc;
import ai.stigmer.commons.apiresource.ApiResourceMetadata;
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
import java.util.Iterator;
import java.util.List;
import java.util.concurrent.TimeUnit;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * Pins the page iterator every generated client emits beside a paged list:
 * a routine's listAll walks the next page token to the end from the token its
 * input names, keeps the list's filters on every page, and reads a page only
 * as the iteration reaches it. A real gRPC server serves five routines two
 * at a time and records each request.
 */
@DisplayName("Generated page iterator")
class PageIteratorTest {

    private final List<ListRoutinesRequest> requests = new ArrayList<>();
    private Server grpcServer;
    private ManagedChannel channel;

    private final class PagedRoutines extends RoutineQueryControllerGrpc.RoutineQueryControllerImplBase {
        @Override
        public void list(ListRoutinesRequest request, StreamObserver<RoutineList> responseObserver) {
            requests.add(request);
            int start = request.getPageToken().isEmpty() ? 0 : Integer.parseInt(request.getPageToken());
            int end = Math.min(start + 2, 5);
            RoutineList.Builder page = RoutineList.newBuilder();
            for (int i = start; i < end; i++) {
                page.addEntries(Routine.newBuilder().setMetadata(ApiResourceMetadata.newBuilder().setId("rtn_" + i)));
            }
            if (end < 5) {
                page.setNextPageToken(Integer.toString(end));
            }
            responseObserver.onNext(page.build());
            responseObserver.onCompleted();
        }
    }

    @BeforeEach
    void start() throws Exception {
        grpcServer = NettyServerBuilder.forPort(0).addService(new PagedRoutines()).build().start();
        channel = ManagedChannelBuilder.forTarget("localhost:" + grpcServer.getPort()).usePlaintext().build();
    }

    @AfterEach
    void stop() throws Exception {
        channel.shutdownNow();
        channel.awaitTermination(5, TimeUnit.SECONDS);
        grpcServer.shutdownNow();
        grpcServer.awaitTermination(5, TimeUnit.SECONDS);
    }

    private static List<String> ids(Iterable<Routine> routines) {
        List<String> ids = new ArrayList<>();
        for (Routine r : routines) {
            ids.add(r.getMetadata().getId());
        }
        return ids;
    }

    @Test
    @DisplayName("walks every page, keeping the list's filters")
    void walksEveryPage() {
        ListRoutinesRequest input = ListRoutinesRequest.newBuilder()
                .setOrg("acme").putLabels("team", "support").setPageSize(2).build();
        assertEquals(List.of("rtn_0", "rtn_1", "rtn_2", "rtn_3", "rtn_4"), ids(new RoutineClient(channel).listAll(input)));
        assertEquals(List.of("", "2", "4"), requests.stream().map(ListRoutinesRequest::getPageToken).toList());
        assertTrue(requests.stream().allMatch(r -> r.getOrg().equals("acme")
                && r.getLabelsMap().get("team").equals("support") && r.getPageSize() == 2));
    }

    @Test
    @DisplayName("starts from the token its input names")
    void startsFromTheInputToken() {
        ListRoutinesRequest input = ListRoutinesRequest.newBuilder().setPageToken("4").build();
        assertEquals(List.of("rtn_4"), ids(new RoutineClient(channel).listAll(input)));
    }

    @Test
    @DisplayName("reads a page only as the iteration reaches it")
    void readsLazily() {
        Iterator<Routine> it = new RoutineClient(channel).listAll(ListRoutinesRequest.getDefaultInstance()).iterator();
        assertEquals(0, requests.size());
        it.next();
        assertEquals(1, requests.size());
    }
}
