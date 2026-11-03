package ai.stigmer.sdk;

import ai.stigmer.agentic.run.v1.Run;
import ai.stigmer.agentic.run.v1.RunCommandControllerGrpc;
import ai.stigmer.agentic.session.v1.AgentMessageEvent;
import ai.stigmer.agentic.session.v1.AgentToolUseEvent;
import ai.stigmer.agentic.session.v1.ContentBlock;
import ai.stigmer.agentic.session.v1.ListSessionEventsRequest;
import ai.stigmer.agentic.session.v1.SessionEvent;
import ai.stigmer.agentic.session.v1.SessionEventList;
import ai.stigmer.agentic.session.v1.SessionQueryControllerGrpc;
import ai.stigmer.agentic.session.v1.SessionStatusIdleEvent;
import ai.stigmer.agentic.session.v1.StigmerRunStatusEvent;
import ai.stigmer.agentic.session.v1.StopReason;
import ai.stigmer.agentic.session.v1.StreamSessionEventsRequest;
import ai.stigmer.agentic.session.v1.StreamSessionEventsResponse;
import ai.stigmer.sdk.gen.ErrorCode;
import ai.stigmer.sdk.gen.ResourceRef;
import ai.stigmer.sdk.gen.RunInput;
import ai.stigmer.sdk.gen.StigmerException;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import com.google.protobuf.util.JsonFormat;
import io.grpc.ManagedChannel;
import io.grpc.ManagedChannelBuilder;
import io.grpc.Server;
import io.grpc.Status;
import io.grpc.netty.shaded.io.grpc.netty.NettyServerBuilder;
import io.grpc.stub.ServerCallStreamObserver;
import io.grpc.stub.StreamObserver;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.DynamicTest;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.TestFactory;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Deque;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.stream.Stream;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * Pins {@link StigmerClient#sendAndWait} and {@link StigmerClient#waitForTurn}
 * ({@link TurnWaiter}).
 *
 * <p>The reader is held to the shared turn cases in {@code test/fixtures/turns},
 * which the TypeScript client reads through the fold itself: a rule that
 * drifts here fails naming the case. The driver runs against a fake served on
 * a local Netty port, as {@code RoutedFileClientTest} serves its fake: it
 * checks the org and the session before any call, names the run
 * {@code run-<epoch ms>}, reads from the newest place of an existing session,
 * reconnects from the last place delivered after a drop, ends on a code a
 * reconnect cannot fix, cancels its stream once the turn is decided, and stops
 * at its timeout across reconnections.
 */
@DisplayName("TurnWaiter")
class TurnWaiterTest {

    private static final Path TURNS = Path.of("..", "..", "test", "fixtures", "turns");

    @TestFactory
    Stream<DynamicTest> readerHoldsTheSharedTurnCases() throws IOException {
        List<Path> files;
        try (Stream<Path> listed = Files.list(TURNS)) {
            files = listed.filter(p -> p.toString().endsWith(".json")).sorted().toList();
        }
        assertTrue(files.size() >= 10, "the shared turn cases in " + TURNS.toAbsolutePath());
        return files.stream().map(file -> DynamicTest.dynamicTest(file.getFileName().toString(), () -> {
            JsonObject c = JsonParser.parseString(Files.readString(file)).getAsJsonObject();
            String description = c.get("description").getAsString();
            TurnWaiter.Reader reader = new TurnWaiter.Reader(c.get("runId").getAsString());
            boolean decided = false;
            for (JsonElement raw : c.getAsJsonArray("frames")) {
                StreamSessionEventsResponse.Builder frame = StreamSessionEventsResponse.newBuilder();
                JsonFormat.parser().merge(raw.toString(), frame);
                if (reader.read(frame.build())) {
                    decided = true;
                    break;
                }
            }
            JsonObject expect = c.getAsJsonObject("expect");
            assertEquals(expect.get("decided").getAsBoolean(), decided, description);
            if (!decided) {
                return;
            }
            TurnOutcome outcome = reader.outcome("ses_1");
            List<TurnAsk> asks = new ArrayList<>();
            for (JsonElement ask : expect.getAsJsonArray("asks")) {
                asks.add(new TurnAsk(ask.getAsJsonObject().get("id").getAsString(), ask.getAsJsonObject().get("name").getAsString()));
            }
            assertEquals(
                    List.of(expect.get("phase").getAsString(), expect.get("answer").getAsString(),
                            expect.get("stopCause").getAsString(), expect.get("error").getAsString(),
                            asks, Long.parseLong(expect.get("lastSeq").getAsString()), c.get("runId").getAsString()),
                    List.of(outcome.phase(), outcome.answer(), outcome.stopCause(), outcome.error(),
                            outcome.asks(), outcome.lastSeq(), outcome.runId()),
                    description);
        }));
    }

    // -- The driver, against a served fake -----------------------------------

    /** One stream: frames, then an error, or a hold until the client cancels. */
    private record Step(List<StreamSessionEventsResponse> frames, Status error, boolean hold) {}

    private static final class Fake {
        final Deque<Step> steps = new ArrayDeque<>();
        final List<StreamSessionEventsRequest> requests = new CopyOnWriteArrayList<>();
        final List<Run> created = new CopyOnWriteArrayList<>();
        final CountDownLatch cancelled = new CountDownLatch(1);
        volatile long newest;
        volatile int lists;

        final SessionQueryControllerGrpc.SessionQueryControllerImplBase query =
                new SessionQueryControllerGrpc.SessionQueryControllerImplBase() {
                    @Override
                    public void listEvents(ListSessionEventsRequest request, StreamObserver<SessionEventList> out) {
                        lists++;
                        SessionEventList.Builder page = SessionEventList.newBuilder();
                        if (newest != 0) {
                            page.addEvents(SessionEvent.newBuilder().setSeq(newest));
                        }
                        out.onNext(page.build());
                        out.onCompleted();
                    }

                    @Override
                    public void streamEvents(StreamSessionEventsRequest request, StreamObserver<StreamSessionEventsResponse> out) {
                        requests.add(request);
                        Step step;
                        synchronized (steps) {
                            step = steps.isEmpty() ? new Step(List.of(), null, true) : steps.removeFirst();
                        }
                        ServerCallStreamObserver<StreamSessionEventsResponse> call =
                                (ServerCallStreamObserver<StreamSessionEventsResponse>) out;
                        call.setOnCancelHandler(cancelled::countDown);
                        step.frames().forEach(out::onNext);
                        if (step.error() != null) {
                            out.onError(step.error().asRuntimeException());
                        } else if (!step.hold()) {
                            out.onCompleted();
                        }
                    }
                };

        final RunCommandControllerGrpc.RunCommandControllerImplBase command =
                new RunCommandControllerGrpc.RunCommandControllerImplBase() {
                    @Override
                    public void create(Run request, StreamObserver<Run> out) {
                        created.add(request);
                        String session = request.getSpec().hasSessionId() ? request.getSpec().getSessionId() : "ses_new";
                        Run.Builder run = Run.newBuilder();
                        run.getMetadataBuilder().setId("run_1");
                        run.getSpecBuilder().setSessionId(session);
                        out.onNext(run.build());
                        out.onCompleted();
                    }
                };
    }

    private Server server;
    private ManagedChannel channel;
    private StigmerClient client;

    private TurnWaiter serve(Fake fake) throws IOException {
        server = NettyServerBuilder.forPort(0).addService(fake.query).addService(fake.command).build().start();
        channel = ManagedChannelBuilder.forTarget("localhost:" + server.getPort()).usePlaintext().build();
        client = StigmerClient.builder().baseUrl("localhost:" + server.getPort()).insecure().build();
        return new TurnWaiter(channel, client.run::create, Duration.ofMillis(5), Duration.ofMillis(20));
    }

    @AfterEach
    void stop() throws InterruptedException {
        if (client != null) {
            client.close();
        }
        if (channel != null) {
            channel.shutdownNow().awaitTermination(5, TimeUnit.SECONDS);
        }
        if (server != null) {
            server.shutdownNow().awaitTermination(5, TimeUnit.SECONDS);
        }
    }

    private static StreamSessionEventsResponse frame(long seq, String runId, SessionEvent.Builder event) {
        return StreamSessionEventsResponse.newBuilder()
                .setEvent(event.setSeq(seq).setSessionId("ses_1").setRunId(runId))
                .build();
    }

    private static StreamSessionEventsResponse message(long seq, String id, String text) {
        return frame(seq, "run_1", SessionEvent.newBuilder().setAgentMessage(AgentMessageEvent.newBuilder()
                .setId(id).addContent(ContentBlock.newBuilder().setType("text").setText(text))));
    }

    private static StreamSessionEventsResponse status(long seq, String id, String phase) {
        return frame(seq, "run_1", SessionEvent.newBuilder().setStigmerRunStatus(StigmerRunStatusEvent.newBuilder()
                .setId(id).setPhase(phase)));
    }

    private static void assertCancelled(Fake fake) throws InterruptedException {
        assertTrue(fake.cancelled.await(5, TimeUnit.SECONDS), "the stream was left open after the wait returned");
    }

    @Test
    @DisplayName("checks the org and the session before any call")
    void checksItsInputBeforeAnyCall() throws IOException {
        Fake fake = new Fake();
        TurnWaiter waiter = serve(fake);
        RunInput.SessionSpecInput spec = RunInput.SessionSpecInput.builder().agentRef(ResourceRef.of("acme", "greeter")).build();
        for (SendAndWaitInput input : List.of(
                SendAndWaitInput.builder().sessionId("ses_1").message("hi").build(),
                SendAndWaitInput.builder().org("acme").message("hi").build(),
                SendAndWaitInput.builder().org("acme").sessionId("ses_1").sessionSpec(spec).message("hi").build())) {
            StigmerException e = assertThrows(StigmerException.class, () -> waiter.sendAndWait(input, null));
            assertEquals(ErrorCode.INVALID_ARGUMENT, e.getCode());
        }
        assertEquals(List.of(0, 0, 0), List.of(fake.lists, fake.created.size(), fake.requests.size()));
    }

    @Test
    @DisplayName("reconnects from the last place delivered and cancels its stream once decided")
    void reconnectsAndCancels() throws Exception {
        Fake fake = new Fake();
        fake.newest = 7;
        fake.steps.add(new Step(List.of(message(8, "m8", "Working.")), Status.UNAVAILABLE, false));
        fake.steps.add(new Step(List.of(message(9, "m9", "Hello."), status(10, "st10", "completed")), null, true));
        TurnWaiter waiter = serve(fake);
        TurnOutcome outcome = waiter.sendAndWait(
                SendAndWaitInput.builder().org("acme").sessionId("ses_1").message("hi").build(), null);
        assertEquals(List.of("completed", "Hello.", "run_1", "ses_1", 10L),
                List.of(outcome.phase(), outcome.answer(), outcome.runId(), outcome.sessionId(), outcome.lastSeq()));
        assertCancelled(fake);
        assertEquals(List.of(7L, 8L), fake.requests.stream().map(StreamSessionEventsRequest::getAfterSeq).toList());
        assertTrue(fake.created.get(0).getMetadata().getName().matches("run-\\d+"), fake.created.get(0).getMetadata().getName());
        assertEquals("acme", fake.created.get(0).getMetadata().getOrg());
    }

    @Test
    @DisplayName("in a new session reads the whole log and keeps a given name")
    void newSessionReadsTheWholeLog() throws Exception {
        Fake fake = new Fake();
        fake.steps.add(new Step(List.of(message(1, "m1", "Hi."), status(2, "st2", "completed")), null, true));
        TurnWaiter waiter = serve(fake);
        RunInput.SessionSpecInput spec = RunInput.SessionSpecInput.builder().agentRef(ResourceRef.of("acme", "greeter")).build();
        TurnOutcome outcome = waiter.sendAndWait(
                SendAndWaitInput.builder().org("acme").sessionSpec(spec).name("mine").message("hi").build(), null);
        assertCancelled(fake);
        assertEquals(0, fake.lists);
        assertTrue(fake.requests.get(0).hasAfterSeq());
        assertEquals(0L, fake.requests.get(0).getAfterSeq());
        assertEquals(List.of("ses_new", "mine"), List.of(outcome.sessionId(), fake.created.get(0).getMetadata().getName()));
    }

    @Test
    @DisplayName("ends on a code a reconnect cannot fix, without retrying")
    void endsOnAFinalCode() throws IOException {
        Fake fake = new Fake();
        fake.steps.add(new Step(List.of(), Status.PERMISSION_DENIED, false));
        TurnWaiter waiter = serve(fake);
        StigmerException e = assertThrows(StigmerException.class, () -> waiter.waitForTurn("ses_1", "run_1", 0, null));
        assertEquals(ErrorCode.PERMISSION_DENIED, e.getCode());
        assertEquals(1, fake.requests.size());
    }

    @Test
    @DisplayName("the timeout bounds the wait across reconnects, and the stream is cancelled")
    void timeoutAcrossReconnects() throws Exception {
        Fake fake = new Fake();
        fake.steps.add(new Step(List.of(), Status.UNAVAILABLE, false));
        fake.steps.add(new Step(List.of(), Status.UNAVAILABLE, false));
        fake.steps.add(new Step(List.of(), null, true));
        TurnWaiter waiter = serve(fake);
        long start = System.nanoTime();
        StigmerException e = assertThrows(StigmerException.class,
                () -> waiter.waitForTurn("ses_1", "run_1", 0, Duration.ofMillis(500)));
        assertEquals(Status.Code.DEADLINE_EXCEEDED, e.getGrpcCode());
        assertTrue(System.nanoTime() - start < TimeUnit.SECONDS.toNanos(3));
        assertEquals(3, fake.requests.size());
        assertCancelled(fake);
    }

    @Test
    @DisplayName("returns the asks of a waiting turn")
    void returnsTheAsks() throws Exception {
        Fake fake = new Fake();
        StreamSessionEventsResponse ask = frame(3, "run_1", SessionEvent.newBuilder().setAgentToolUse(AgentToolUseEvent.newBuilder()
                .setId("t3").setName("Bash").setEvaluatedPermission("ask")));
        StreamSessionEventsResponse idle = frame(4, "", SessionEvent.newBuilder().setSessionStatusIdle(SessionStatusIdleEvent.newBuilder()
                .setId("i4").setStopReason(StopReason.newBuilder().setType("requires_action").addEventIds("t3"))));
        fake.steps.add(new Step(List.of(ask, idle), null, true));
        TurnWaiter waiter = serve(fake);
        TurnOutcome outcome = waiter.waitForTurn("ses_1", "run_1", 2, null);
        assertCancelled(fake);
        assertEquals(List.of(TurnOutcome.WAITING, List.of(new TurnAsk("t3", "Bash")), 4L),
                List.of(outcome.phase(), outcome.asks(), outcome.lastSeq()));
    }

    @Test
    @DisplayName("the client's own methods reach the same waiter")
    void clientMethods() throws Exception {
        Fake fake = new Fake();
        fake.steps.add(new Step(List.of(message(1, "m1", "Hi."), status(2, "st2", "completed")), null, true));
        serve(fake);
        TurnOutcome outcome = client.waitForTurn("ses_1", "run_1", 0, Duration.ofSeconds(5));
        assertEquals(Map.of("phase", "completed", "answer", "Hi."), Map.of("phase", outcome.phase(), "answer", outcome.answer()));
        assertCancelled(fake);
    }
}
