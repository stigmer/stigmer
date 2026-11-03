package ai.stigmer.sdk;

import ai.stigmer.sdk.gen.RunInput;

import java.util.List;

/**
 * What {@link StigmerClient#sendAndWait} sends: the message, and where.
 *
 * <p>Its own type rather than the generated {@link RunInput}, which a caller
 * builds but nothing can read back: the wait checks the organization and
 * the session before any call and names the run itself. These are the
 * fields the turns a person sends use; for any other run field, create the
 * run with {@code client.run.create(RunInput)} and call
 * {@link StigmerClient#waitForTurn}.
 *
 * @param org         the organization the turn runs in, by id or slug
 * @param message     the message to send
 * @param sessionId   the session the turn continues; exactly one of this
 *                    and {@code sessionSpec}
 * @param sessionSpec the session to start
 * @param name        the run's name; {@code run-<epoch ms>} when empty
 * @param runConfig   the run's configuration, or null
 * @param fileIds     files the message carries
 */
public record SendAndWaitInput(
        String org,
        String message,
        String sessionId,
        RunInput.SessionSpecInput sessionSpec,
        String name,
        RunInput.RunConfigInput runConfig,
        List<String> fileIds) {

    public SendAndWaitInput {
        org = org == null ? "" : org;
        message = message == null ? "" : message;
        sessionId = sessionId == null ? "" : sessionId;
        name = name == null ? "" : name;
        fileIds = fileIds == null ? List.of() : List.copyOf(fileIds);
    }

    /** Starts a builder. */
    public static Builder builder() {
        return new Builder();
    }

    /** Builder for {@link SendAndWaitInput}. */
    public static final class Builder {
        private String org;
        private String message;
        private String sessionId;
        private RunInput.SessionSpecInput sessionSpec;
        private String name;
        private RunInput.RunConfigInput runConfig;
        private List<String> fileIds;

        private Builder() {}

        public Builder org(String org) { this.org = org; return this; }
        public Builder message(String message) { this.message = message; return this; }
        public Builder sessionId(String sessionId) { this.sessionId = sessionId; return this; }
        public Builder sessionSpec(RunInput.SessionSpecInput sessionSpec) { this.sessionSpec = sessionSpec; return this; }
        public Builder name(String name) { this.name = name; return this; }
        public Builder runConfig(RunInput.RunConfigInput runConfig) { this.runConfig = runConfig; return this; }
        public Builder fileIds(List<String> fileIds) { this.fileIds = fileIds; return this; }

        public SendAndWaitInput build() {
            return new SendAndWaitInput(org, message, sessionId, sessionSpec, name, runConfig, fileIds);
        }
    }
}
