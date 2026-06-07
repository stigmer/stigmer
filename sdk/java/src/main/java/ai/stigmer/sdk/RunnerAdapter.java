package ai.stigmer.sdk;

/**
 * Adapter interface that abstracts runner lifecycle management from SDK
 * consumers.
 *
 * <p>When {@code executionTarget} is LOCAL, a consumer drives the adapter at
 * the appropriate lifecycle points so it never manages runner processes
 * directly — the adapter handles it transparently.
 *
 * <p>Sessions and workflow executions have different lifecycles. A session is
 * a long-lived, multi-turn conversation with no terminal phase, so its worker
 * is tied to whether the session is open (in use): {@code onSessionOpened}
 * when the session is opened, {@code onSessionClosed} when it is closed. A
 * workflow execution runs to a terminal phase, so its worker is tied to
 * creation and completion.
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
 *     public void onSessionOpened(String sessionId) {
 *         myRunner.addSession(sessionId);
 *     }
 *     // ... other methods
 * };
 *
 * try (StigmerClient client = StigmerClient.builder("sk_live_...")
 *         .runnerAdapter(adapter)
 *         .build()) {
 *     // adapter drives the runner lifecycle for local sessions/executions
 * }
 * }</pre>
 */
public interface RunnerAdapter {

    /**
     * Called when a local session is opened (engaged).
     * The adapter should ensure a runner worker is polling the session's task
     * queue. Must be idempotent: it may be called again for an already-open
     * session (e.g. on re-open).
     *
     * @param sessionId the server-assigned session identifier
     * @throws Exception if the runner cannot be started
     */
    void onSessionOpened(String sessionId) throws Exception;

    /**
     * Called when a local session is closed (no longer in use).
     * The adapter should tear down the session's runner worker.
     *
     * @param sessionId the session identifier to close
     * @throws Exception if cleanup fails
     */
    void onSessionClosed(String sessionId) throws Exception;

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
