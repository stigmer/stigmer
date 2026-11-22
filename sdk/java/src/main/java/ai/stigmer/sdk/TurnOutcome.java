package ai.stigmer.sdk;

import java.util.List;

/**
 * How a waited-for turn stands when {@link StigmerClient#sendAndWait} or
 * {@link StigmerClient#waitForTurn} returns.
 *
 * @param runId     the run that is the turn
 * @param sessionId the session the turn runs in
 * @param phase     completed, failed, cancelled or terminated once the turn
 *                  ended, or {@link #WAITING} when it waits for an answer to
 *                  its {@code asks} or {@code customToolUses}
 * @param answer    the text of the turn's last message on its primary thread;
 *                  "" when it wrote none
 * @param stopCause why the turn ended, once it has; "" otherwise
 * @param error     what went wrong, when the turn failed or was stopped with
 *                  a reason; "" otherwise
 * @param asks      the tool uses that wait for a person's approval, when the
 *                  phase is {@link #WAITING}; empty once the turn ended
 * @param lastSeq   the log's place when the wait returned: pass it to
 *                  {@link StigmerClient#waitForTurn} to resume after
 *                  answering the asks and custom tool uses
 * @param customToolUses the calls of the host app's own tools that wait for
 *                  its answer, when the phase is {@link #WAITING}; empty once
 *                  the turn ended. They are never asks: an approval does not
 *                  answer one
 */
public record TurnOutcome(
        String runId,
        String sessionId,
        String phase,
        String answer,
        String stopCause,
        String error,
        List<TurnAsk> asks,
        long lastSeq,
        List<TurnCustomToolUse> customToolUses) {

    /** The phase of a turn that waits for an answer: a person's to its asks, or the host app's to its custom tool uses. */
    public static final String WAITING = "waiting";

    public TurnOutcome {
        asks = List.copyOf(asks);
        customToolUses = List.copyOf(customToolUses);
    }

    /**
     * An outcome with no custom tool uses: the form this record had before it
     * carried them, kept so code that built one still compiles.
     */
    public TurnOutcome(String runId, String sessionId, String phase, String answer, String stopCause, String error, List<TurnAsk> asks, long lastSeq) {
        this(runId, sessionId, phase, answer, stopCause, error, asks, lastSeq, List.of());
    }
}
