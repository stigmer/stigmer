package ai.stigmer.sdk;

import org.junit.jupiter.api.Test;

import java.util.ArrayList;
import java.util.List;

import static org.junit.jupiter.api.Assertions.*;

class RunnerAdapterTest {

    /** Mock adapter that records all lifecycle calls. */
    static class MockRunnerAdapter implements RunnerAdapter {
        final List<String> sessionsCreated = new ArrayList<>();
        final List<String> sessionsTerminated = new ArrayList<>();
        final List<String> executionsCreated = new ArrayList<>();
        final List<String> executionsTerminated = new ArrayList<>();

        @Override
        public void onSessionCreated(String sessionId) {
            sessionsCreated.add(sessionId);
        }

        @Override
        public void onSessionTerminated(String sessionId) {
            sessionsTerminated.add(sessionId);
        }

        @Override
        public void onWorkflowExecutionCreated(String executionId) {
            executionsCreated.add(executionId);
        }

        @Override
        public void onWorkflowExecutionTerminated(String executionId) {
            executionsTerminated.add(executionId);
        }
    }

    @Test
    void mockAdapter_recordsCalls() throws Exception {
        MockRunnerAdapter adapter = new MockRunnerAdapter();

        adapter.onSessionCreated("ses-1");
        adapter.onSessionCreated("ses-2");
        adapter.onSessionTerminated("ses-1");
        adapter.onWorkflowExecutionCreated("wfexec-1");
        adapter.onWorkflowExecutionTerminated("wfexec-1");

        assertEquals(List.of("ses-1", "ses-2"), adapter.sessionsCreated);
        assertEquals(List.of("ses-1"), adapter.sessionsTerminated);
        assertEquals(List.of("wfexec-1"), adapter.executionsCreated);
        assertEquals(List.of("wfexec-1"), adapter.executionsTerminated);
    }

    @Test
    void builder_withRunnerAdapter_setsAdapter() {
        MockRunnerAdapter adapter = new MockRunnerAdapter();

        try (StigmerClient client = StigmerClient.builder("sk_test_key")
                .runnerAdapter(adapter)
                .build()) {
            assertSame(adapter, client.runnerAdapter());
        }
    }

    @Test
    void builder_withoutRunnerAdapter_returnsNull() {
        try (StigmerClient client = StigmerClient.builder("sk_test_key").build()) {
            assertNull(client.runnerAdapter());
        }
    }

    @Test
    void interface_isImplementable() {
        RunnerAdapter adapter = new RunnerAdapter() {
            @Override
            public void onSessionCreated(String sessionId) {}
            @Override
            public void onSessionTerminated(String sessionId) {}
            @Override
            public void onWorkflowExecutionCreated(String executionId) {}
            @Override
            public void onWorkflowExecutionTerminated(String executionId) {}
        };

        assertDoesNotThrow(() -> {
            adapter.onSessionCreated("test");
            adapter.onSessionTerminated("test");
            adapter.onWorkflowExecutionCreated("test");
            adapter.onWorkflowExecutionTerminated("test");
        });
    }
}
