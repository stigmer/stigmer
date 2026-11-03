package ai.stigmer.sdk;

import ai.stigmer.agentic.run.v1.Run;
import ai.stigmer.agentic.session.v1.ContentBlock;
import ai.stigmer.agentic.session.v1.ListSessionEventsRequest;
import ai.stigmer.agentic.session.v1.SessionEvent;
import ai.stigmer.agentic.session.v1.SessionEventList;
import ai.stigmer.agentic.session.v1.SessionQueryControllerGrpc;
import ai.stigmer.agentic.session.v1.StigmerRunStatusEvent;
import ai.stigmer.agentic.session.v1.StreamSessionEventsRequest;
import ai.stigmer.agentic.session.v1.StreamSessionEventsResponse;
import ai.stigmer.sdk.gen.ErrorCode;
import ai.stigmer.sdk.gen.RunInput;
import ai.stigmer.sdk.gen.StigmerException;
import com.google.protobuf.Descriptors;
import com.google.protobuf.Message;
import io.grpc.Channel;
import io.grpc.Context;
import io.grpc.Status;
import io.grpc.StatusRuntimeException;

import java.time.Duration;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.Iterator;
import java.util.List;
import java.util.Objects;
import java.util.Set;
import java.util.concurrent.TimeUnit;
import java.util.function.Function;

/**
 * Sending a message and waiting for the agent's answer, in one call: the
 * body of {@link StigmerClient#sendAndWait} and
 * {@link StigmerClient#waitForTurn}.
 *
 * <p>A turn is a run: the wait creates it ({@code run.create}, as every turn
 * starts) and follows the session's event log ({@code streamEvents}) until
 * the turn ends or waits for a person's answer. It is the Java form of the
 * TypeScript client's {@code sendAndWait} and {@code waitForTurn}
 * ({@code sdk/typescript/src/session-events.ts}), with the same rules and
 * outcome.
 *
 * <p>The reading is split from the driving. {@link Reader} is pure: it takes
 * stream frames one at a time and folds only what an answer needs, the three
 * rules of the shared fold ({@code backend/libs/ts/session-log/src/fold.ts}),
 * which is the reference:
 * <ul>
 *   <li>a turn has ended when its newest {@code stigmer.run.status} phase is
 *       completed, failed, cancelled or terminated;</li>
 *   <li>it waits when the session is idle with stop reason
 *       {@code requires_action} naming one of its tool uses that asks for
 *       permission and has neither a confirmation nor a result;</li>
 *   <li>its answer is the text of its last stored message on its primary
 *       thread, the text blocks joined with nothing between them.</li>
 * </ul>
 * It reads stored events only (a preview is never the answer) and each event
 * once, by id. The cases in {@code test/fixtures/turns}, which the
 * TypeScript, Go and Python clients read too, hold it to the fold.
 *
 * <p>The driver opens the stream from the place it was given, reconnects
 * from the last place delivered with a backoff from 500 ms up to 5 s, and
 * throws on a code a reconnect cannot fix (not found, permission denied,
 * unauthenticated, invalid argument, failed precondition). Each stream runs
 * in a cancellable {@link Context}, cancelled the moment the reader decides
 * and on an error or the timeout, so a returned wait leaves nothing open on
 * the server. The timeout bounds the whole wait, reconnections included:
 * each stream gets the time that remains, which is why the driver builds
 * its own query stub from the channel rather than the generated
 * {@code streamEvents}, which takes no deadline.
 */
final class TurnWaiter {

    private static final Set<String> ENDED_PHASES = Set.of("completed", "failed", "cancelled", "terminated");

    private static final Set<Status.Code> FINAL_CODES = Set.of(
            Status.Code.NOT_FOUND,
            Status.Code.PERMISSION_DENIED,
            Status.Code.UNAUTHENTICATED,
            Status.Code.INVALID_ARGUMENT,
            Status.Code.FAILED_PRECONDITION);

    static final Duration BACKOFF_BASE = Duration.ofMillis(500);
    static final Duration BACKOFF_MAX = Duration.ofSeconds(5);

    private final Channel channel;
    private final Function<RunInput, Run> createRun;
    private final Duration backoffBase;
    private final Duration backoffMax;

    TurnWaiter(Channel channel, Function<RunInput, Run> createRun, Duration backoffBase, Duration backoffMax) {
        this.channel = Objects.requireNonNull(channel, "channel must not be null");
        this.createRun = Objects.requireNonNull(createRun, "createRun must not be null");
        this.backoffBase = backoffBase;
        this.backoffMax = backoffMax;
    }

    TurnOutcome sendAndWait(SendAndWaitInput input, Duration timeout) {
        Objects.requireNonNull(input, "input must not be null");
        if (input.org().isEmpty()) {
            throw invalid("sendAndWait: org is required — the organization the turn runs in, by id or slug");
        }
        if (input.sessionId().isEmpty() == (input.sessionSpec() == null)) {
            throw invalid("sendAndWait: exactly one of sessionId or sessionSpec is required"
                    + " — the session the turn continues, or the one to start");
        }
        long deadline = deadlineOf(timeout);
        long afterSeq = input.sessionId().isEmpty() ? 0 : newestSeq(input.sessionId(), deadline);
        RunInput.Builder run = RunInput.builder()
                .org(input.org())
                .name(input.name().isEmpty() ? "run-" + System.currentTimeMillis() : input.name())
                .message(input.message())
                .runConfig(input.runConfig())
                .fileIds(input.fileIds());
        if (input.sessionSpec() != null) {
            run.sessionSpec(input.sessionSpec());
        } else {
            run.sessionId(input.sessionId());
        }
        Run created = createRun.apply(run.build());
        String sessionId = created.getSpec().hasSessionId() ? created.getSpec().getSessionId() : "";
        if (sessionId.isEmpty()) {
            sessionId = input.sessionId();
        }
        if (sessionId.isEmpty()) {
            throw new StigmerException(ErrorCode.INTERNAL, "the created run names no session", Status.Code.INTERNAL);
        }
        return waitIn(sessionId, created.getMetadata().getId(), afterSeq, deadline);
    }

    TurnOutcome waitForTurn(String sessionId, String runId, long afterSeq, Duration timeout) {
        return waitIn(sessionId, runId, afterSeq, deadlineOf(timeout));
    }

    private long newestSeq(String sessionId, long deadline) {
        SessionQueryControllerGrpc.SessionQueryControllerBlockingStub stub =
                withDeadline(SessionQueryControllerGrpc.newBlockingStub(channel), deadline);
        try {
            SessionEventList page = stub.listEvents(ListSessionEventsRequest.newBuilder()
                    .setSessionId(sessionId)
                    .setOrder("desc")
                    .setPageSize(1)
                    .build());
            return page.getEventsCount() == 0 ? 0 : page.getEvents(0).getSeq();
        } catch (StatusRuntimeException e) {
            if (e.getStatus().getCode() == Status.Code.DEADLINE_EXCEEDED) {
                throw timedOut();
            }
            throw StigmerException.wrap(e);
        }
    }

    private TurnOutcome waitIn(String sessionId, String runId, long afterSeq, long deadline) {
        Reader reader = new Reader(runId);
        long[] place = {afterSeq};
        int failures = 0;
        while (true) {
            if (remainingNanos(deadline) <= 0) {
                throw timedOut();
            }
            Context.CancellableContext call = Context.current().withCancellation();
            try {
                boolean[] delivered = {false};
                Boolean decided = call.call(() -> followOnce(sessionId, reader, place, deadline, delivered));
                if (decided) {
                    return reader.outcome(sessionId);
                }
                if (delivered[0]) {
                    failures = 0;
                }
            } catch (StatusRuntimeException e) {
                Status.Code code = e.getStatus().getCode();
                if (code == Status.Code.DEADLINE_EXCEEDED) {
                    throw timedOut();
                }
                if (FINAL_CODES.contains(code)) {
                    throw StigmerException.wrap(e);
                }
            } catch (RuntimeException e) {
                throw e;
            } catch (Exception e) {
                throw new IllegalStateException(e);
            } finally {
                call.cancel(null);
            }
            long pause = Math.min(backoffMax.toNanos(), backoffBase.toNanos() << Math.min(failures, 20));
            if (deadline != Long.MAX_VALUE && remainingNanos(deadline) <= pause) {
                sleepNanos(Math.max(0, remainingNanos(deadline)));
                throw timedOut();
            }
            sleepNanos(pause);
            failures++;
        }
    }

    private boolean followOnce(String sessionId, Reader reader, long[] place, long deadline, boolean[] delivered) {
        SessionQueryControllerGrpc.SessionQueryControllerBlockingStub stub =
                withDeadline(SessionQueryControllerGrpc.newBlockingStub(channel), deadline);
        Iterator<StreamSessionEventsResponse> frames = stub.streamEvents(StreamSessionEventsRequest.newBuilder()
                .setSessionId(sessionId)
                .setAfterSeq(place[0])
                .build());
        while (frames.hasNext()) {
            StreamSessionEventsResponse frame = frames.next();
            delivered[0] = true;
            if (frame.hasEvent() && frame.getEvent().getSeq() > place[0]) {
                place[0] = frame.getEvent().getSeq();
            }
            if (reader.read(frame)) {
                return true;
            }
        }
        return false;
    }

    private static <S extends io.grpc.stub.AbstractStub<S>> S withDeadline(S stub, long deadline) {
        return deadline == Long.MAX_VALUE ? stub : stub.withDeadlineAfter(Math.max(1, remainingNanos(deadline)), TimeUnit.NANOSECONDS);
    }

    private static long deadlineOf(Duration timeout) {
        return timeout == null ? Long.MAX_VALUE : System.nanoTime() + timeout.toNanos();
    }

    private static long remainingNanos(long deadline) {
        return deadline == Long.MAX_VALUE ? Long.MAX_VALUE : deadline - System.nanoTime();
    }

    private static void sleepNanos(long nanos) {
        try {
            TimeUnit.NANOSECONDS.sleep(nanos);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new StigmerException(ErrorCode.UNKNOWN, "the wait for the turn was interrupted", Status.Code.CANCELLED);
        }
    }

    private static StigmerException invalid(String message) {
        return new StigmerException(ErrorCode.INVALID_ARGUMENT, message, Status.Code.INVALID_ARGUMENT);
    }

    private static StigmerException timedOut() {
        return new StigmerException(ErrorCode.UNKNOWN,
                "the wait for the turn did not end within its timeout", Status.Code.DEADLINE_EXCEEDED);
    }

    /** Folds one turn's facts from stream frames (class comment). */
    static final class Reader {
        private final String runId;
        private final Set<String> seen = new HashSet<>();
        private final List<String[]> toolUses = new ArrayList<>();
        private final Set<String> answered = new HashSet<>();
        private long lastSeq;
        private StigmerRunStatusEvent status;
        private String answer = "";
        private boolean idle;
        private String stopReason = "";
        private List<String> waitingOn = List.of();

        Reader(String runId) {
            this.runId = runId;
        }

        /** Folds one frame; returns whether the turn has ended or waits. */
        boolean read(StreamSessionEventsResponse frame) {
            if (!frame.hasEvent()) {
                // A preview: never the answer, never an end.
                return false;
            }
            SessionEvent event = frame.getEvent();
            lastSeq = Math.max(lastSeq, event.getSeq());
            if (event.getEventCase() == SessionEvent.EventCase.EVENT_NOT_SET) {
                return false;
            }
            if (event.hasUserMessage() && event.getRunId().isEmpty()) {
                // A message waiting in the session's queue: its run's copy
                // comes later under the same id, so it is not marked as read.
                return false;
            }
            String id = idOf(event);
            if (!id.isEmpty() && !seen.add(id)) {
                return false;
            }
            boolean ours = event.getRunId().equals(runId);
            switch (event.getEventCase()) {
                case SESSION_STATUS_RUNNING -> {
                    idle = false;
                    stopReason = "";
                    waitingOn = List.of();
                }
                case SESSION_STATUS_IDLE -> {
                    idle = true;
                    stopReason = event.getSessionStatusIdle().getStopReason().getType();
                    waitingOn = List.copyOf(event.getSessionStatusIdle().getStopReason().getEventIdsList());
                }
                case AGENT_MESSAGE -> {
                    if (ours && event.getThreadId().isEmpty()) {
                        answer = textOf(event.getAgentMessage().getContentList());
                    }
                }
                case STIGMER_RUN_STATUS -> {
                    if (ours) {
                        status = event.getStigmerRunStatus();
                    }
                }
                case AGENT_TOOL_USE -> {
                    if (ours) {
                        toolUses.add(new String[] {event.getAgentToolUse().getId(), event.getAgentToolUse().getName(),
                                event.getAgentToolUse().getEvaluatedPermission()});
                    }
                }
                case AGENT_MCP_TOOL_USE -> {
                    if (ours) {
                        toolUses.add(new String[] {event.getAgentMcpToolUse().getId(), event.getAgentMcpToolUse().getName(),
                                event.getAgentMcpToolUse().getEvaluatedPermission()});
                    }
                }
                case USER_TOOL_CONFIRMATION -> answered.add(event.getUserToolConfirmation().getToolUseId());
                case AGENT_TOOL_RESULT -> answered.add(event.getAgentToolResult().getToolUseId());
                case AGENT_MCP_TOOL_RESULT -> answered.add(event.getAgentMcpToolResult().getMcpToolUseId());
                default -> {
                    // Every other event bears on neither the answer nor the end.
                }
            }
            return ended() || waiting();
        }

        private boolean ended() {
            return status != null && ENDED_PHASES.contains(status.getPhase());
        }

        private List<TurnAsk> openAsks() {
            List<TurnAsk> asks = new ArrayList<>();
            for (String[] use : toolUses) {
                if (use[2].equals("ask") && !answered.contains(use[0])) {
                    asks.add(new TurnAsk(use[0], use[1]));
                }
            }
            return asks;
        }

        private boolean waiting() {
            if (!idle || !stopReason.equals("requires_action")) {
                return false;
            }
            return openAsks().stream().anyMatch(ask -> waitingOn.contains(ask.id()));
        }

        /** How the turn stands now. */
        TurnOutcome outcome(String sessionId) {
            boolean ended = ended();
            boolean waiting = !ended && waiting();
            String phase = waiting ? TurnOutcome.WAITING : status == null ? "" : status.getPhase();
            return new TurnOutcome(
                    runId,
                    sessionId,
                    phase,
                    answer,
                    status == null ? "" : status.getStopCause(),
                    status == null ? "" : status.getError(),
                    waiting ? openAsks() : List.of(),
                    lastSeq);
        }

        /** The id every event in the oneof carries. */
        private static String idOf(SessionEvent event) {
            Descriptors.OneofDescriptor oneof = SessionEvent.getDescriptor().getOneofs().stream()
                    .filter(o -> o.getName().equals("event"))
                    .findFirst()
                    .orElseThrow();
            Descriptors.FieldDescriptor field = event.getOneofFieldDescriptor(oneof);
            if (field == null || field.getJavaType() != Descriptors.FieldDescriptor.JavaType.MESSAGE) {
                return "";
            }
            Message inner = (Message) event.getField(field);
            Descriptors.FieldDescriptor idField = inner.getDescriptorForType().findFieldByName("id");
            return idField == null ? "" : (String) inner.getField(idField);
        }

        /** A content list's text blocks, joined with nothing between them. */
        private static String textOf(List<ContentBlock> content) {
            StringBuilder text = new StringBuilder();
            for (ContentBlock block : content) {
                if (block.getType().equals("text")) {
                    text.append(block.getText());
                }
            }
            return text.toString();
        }
    }
}
