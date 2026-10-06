package ai.stigmer.sdk;

import org.junit.jupiter.api.Test;

import java.util.ArrayList;
import java.util.List;

import static org.junit.jupiter.api.Assertions.*;

class RunnerAdapterTest {

    /** Mock adapter that records all lifecycle calls. */
    static class MockRunnerAdapter implements RunnerAdapter {
        final List<String> sessionsOpened = new ArrayList<>();
        final List<String> sessionsClosed = new ArrayList<>();

        @Override
        public void onSessionOpened(String sessionId) {
            sessionsOpened.add(sessionId);
        }

        @Override
        public void onSessionClosed(String sessionId) {
            sessionsClosed.add(sessionId);
        }
    }

    @Test
    void mockAdapter_recordsCalls() throws Exception {
        MockRunnerAdapter adapter = new MockRunnerAdapter();

        adapter.onSessionOpened("ses-1");
        adapter.onSessionOpened("ses-2");
        adapter.onSessionClosed("ses-1");

        assertEquals(List.of("ses-1", "ses-2"), adapter.sessionsOpened);
        assertEquals(List.of("ses-1"), adapter.sessionsClosed);
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
            public void onSessionOpened(String sessionId) {}
            @Override
            public void onSessionClosed(String sessionId) {}
        };

        assertDoesNotThrow(() -> {
            adapter.onSessionOpened("test");
            adapter.onSessionClosed("test");
        });
    }
}
