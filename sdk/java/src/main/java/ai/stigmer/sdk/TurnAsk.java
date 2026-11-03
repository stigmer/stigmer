package ai.stigmer.sdk;

/**
 * A tool use that waits for a person's answer, as {@link TurnOutcome#asks()}
 * lists it. Answer it with the session's {@code confirmToolUse} or
 * {@code grantPermission}, which take its {@code id}.
 *
 * @param id   the tool use's event id
 * @param name the tool's name
 */
public record TurnAsk(String id, String name) {}
