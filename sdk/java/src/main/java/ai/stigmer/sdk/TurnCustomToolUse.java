package ai.stigmer.sdk;

import com.google.protobuf.Struct;

/**
 * A call of one of the host app's own tools (the session's
 * {@code custom_tools}) that waits for the host's answer, as
 * {@link TurnOutcome#customToolUses()} lists it. Answer it with the
 * session's {@code answerCustomToolUse}, which takes its {@code id}; an
 * approval never answers it.
 *
 * @param id    the custom tool use's event id
 * @param name  the tool's name, as the session declares it
 * @param input the call's input, which matched the tool's input schema
 */
public record TurnCustomToolUse(String id, String name, Struct input) {}
