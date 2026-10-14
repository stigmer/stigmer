package ai.stigmer.sdk.gen;

import ai.stigmer.agentic.schedule.v1.ListSchedulesRequest;
import ai.stigmer.agentic.schedule.v1.Schedule;
import ai.stigmer.agentic.schedule.v1.ScheduleList;
import ai.stigmer.agentic.schedule.v1.ScheduleQueryControllerGrpc;
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
 * schedule's listAll walks the next page token to the end from the token its
 * input names, keeps the list's filters on every page, and reads a page only
 * as the iteration reaches it. A real gRPC server serves five schedules two
 * at a time and records each request.
 */
@DisplayName("Generated page iterator")
class PageIteratorTest {

    private final List<ListSchedulesRequest> requests = new ArrayList<>();
    private Server grpcServer;
    private ManagedChannel channel;

    private final class PagedSchedules extends ScheduleQueryControllerGrpc.ScheduleQueryControllerImplBase {
        @Override
        public void list(ListSchedulesRequest request, StreamObserver<ScheduleList> responseObserver) {
            requests.add(request);
            int start = request.getPageToken().isEmpty() ? 0 : Integer.parseInt(request.getPageToken());
            int end = Math.min(start + 2, 5);
            ScheduleList.Builder page = ScheduleList.newBuilder();
            for (int i = start; i < end; i++) {
                page.addEntries(Schedule.newBuilder().setMetadata(ApiResourceMetadata.newBuilder().setId("sch_" + i)));
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
        grpcServer = NettyServerBuilder.forPort(0).addService(new PagedSchedules()).build().start();
        channel = ManagedChannelBuilder.forTarget("localhost:" + grpcServer.getPort()).usePlaintext().build();
    }

    @AfterEach
    void stop() throws Exception {
        channel.shutdownNow();
        channel.awaitTermination(5, TimeUnit.SECONDS);
        grpcServer.shutdownNow();
        grpcServer.awaitTermination(5, TimeUnit.SECONDS);
    }

    private static List<String> ids(Iterable<Schedule> schedules) {
        List<String> ids = new ArrayList<>();
        for (Schedule s : schedules) {
            ids.add(s.getMetadata().getId());
        }
        return ids;
    }

    @Test
    @DisplayName("walks every page, keeping the list's filters")
    void walksEveryPage() {
        ListSchedulesRequest input = ListSchedulesRequest.newBuilder()
                .setOrg("acme").putLabels("team", "support").setPageSize(2).build();
        assertEquals(List.of("sch_0", "sch_1", "sch_2", "sch_3", "sch_4"), ids(new ScheduleClient(channel).listAll(input)));
        assertEquals(List.of("", "2", "4"), requests.stream().map(ListSchedulesRequest::getPageToken).toList());
        assertTrue(requests.stream().allMatch(r -> r.getOrg().equals("acme")
                && r.getLabelsMap().get("team").equals("support") && r.getPageSize() == 2));
    }

    @Test
    @DisplayName("starts from the token its input names")
    void startsFromTheInputToken() {
        ListSchedulesRequest input = ListSchedulesRequest.newBuilder().setPageToken("4").build();
        assertEquals(List.of("sch_4"), ids(new ScheduleClient(channel).listAll(input)));
    }

    @Test
    @DisplayName("reads a page only as the iteration reaches it")
    void readsLazily() {
        Iterator<Schedule> it = new ScheduleClient(channel).listAll(ListSchedulesRequest.getDefaultInstance()).iterator();
        assertEquals(0, requests.size());
        it.next();
        assertEquals(1, requests.size());
    }
}
