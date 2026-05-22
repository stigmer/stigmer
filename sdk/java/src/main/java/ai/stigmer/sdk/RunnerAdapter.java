package ai.stigmer.sdk;

/**
 * Adapter interface that abstracts runner lifecycle management from SDK
 * consumers.
 *
 * <p>When {@code executionTarget} is LOCAL, the SDK client automatically
 * calls the adapter at the appropriate lifecycle points after session or
 * workflow execution creation. The consumer never manages runner processes
 * directly — the adapter handles it transparently.
 *
 * <p>Each environment provides its own implementation:
 * <ul>
 *   <li>Desktop app: wraps the embedded runner process</li>
 *   <li>CLI: wraps the daemon runner</li>
 *   <li>Customer self-hosted: wraps their own runner management API</li>
 *   <li>Cloud: no adapter needed (server handles provisioning)</li>
 * </ul>
 *
 * <pre>{@code
 * RunnerAdapter adapter = new RunnerAdapter() {
 *     @Override
 *     public void onSessionCreated(String sessionId) {
 *         myRunner.addSession(sessionId);
 *     }
 *     // ... other methods
 * };
 *
 * try (StigmerClient client = StigmerClient.builder("sk_live_...")
 *         .runnerAdapter(adapter)
 *         .build()) {
 *     // adapter called automatically on session/execution create
 * }
 * }</pre>
 */
public interface RunnerAdapter {

    /**
     * Called after a session is created with executionTarget=LOCAL.
     * The adapter should ensure a runner worker is active for the given session.
     *
     * @param sessionId the server-assigned session identifier
     * @throws Exception if the runner cannot be started
     */
    void onSessionCreated(String sessionId) throws Exception;

    /**
     * Called when a session reaches a terminal phase.
     * The adapter should clean up any runner resources allocated for the session.
     *
     * @param sessionId the session identifier to terminate
     * @throws Exception if cleanup fails
     */
    void onSessionTerminated(String sessionId) throws Exception;

    /**
     * Called after a workflow execution is created with executionTarget=LOCAL.
     * The adapter should ensure a runner worker is active for the given execution.
     *
     * @param executionId the server-assigned execution identifier
     * @throws Exception if the runner cannot be started
     */
    void onWorkflowExecutionCreated(String executionId) throws Exception;

    /**
     * Called when a workflow execution reaches a terminal phase.
     * The adapter should clean up any runner resources allocated for the execution.
     *
     * @param executionId the execution identifier to terminate
     * @throws Exception if cleanup fails
     */
    void onWorkflowExecutionTerminated(String executionId) throws Exception;
}
