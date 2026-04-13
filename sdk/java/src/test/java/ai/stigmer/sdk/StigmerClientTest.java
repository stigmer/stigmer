package ai.stigmer.sdk;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertDoesNotThrow;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertThrows;

class StigmerClientTest {

    @Test
    void builder_nullApiKey_throws() {
        assertThrows(NullPointerException.class, () -> StigmerClient.builder(null));
    }

    @Test
    void builder_emptyApiKey_throws() {
        assertThrows(IllegalArgumentException.class, () -> StigmerClient.builder(""));
    }

    @Test
    void builder_defaultTarget_buildsSuccessfully() {
        try (StigmerClient client = StigmerClient.builder("sk_test_key").build()) {
            assertNotNull(client);
        }
    }

    @Test
    void builder_customBaseUrl_buildsSuccessfully() {
        try (StigmerClient client = StigmerClient.builder("sk_test_key")
                .baseUrl("localhost:9090")
                .insecure()
                .build()) {
            assertNotNull(client);
        }
    }

    @Test
    void builder_insecure_buildsSuccessfully() {
        try (StigmerClient client = StigmerClient.builder("sk_test_key")
                .insecure()
                .build()) {
            assertNotNull(client);
        }
    }

    @Test
    void close_isIdempotent() {
        StigmerClient client = StigmerClient.builder("sk_test_key")
                .insecure()
                .build();
        assertDoesNotThrow(() -> {
            client.close();
            client.close();
        });
    }

    @Test
    void subClients_areAccessible() {
        try (StigmerClient client = StigmerClient.builder("sk_test_key")
                .insecure()
                .build()) {
            assertNotNull(client.agent);
            assertNotNull(client.agentExecution);
            assertNotNull(client.agentInstance);
            assertNotNull(client.apiKey);
            assertNotNull(client.environment);
            assertNotNull(client.executionContext);
            assertNotNull(client.iamPolicy);
            assertNotNull(client.identityAccount);
            assertNotNull(client.identityProvider);
            assertNotNull(client.mcpServer);
            assertNotNull(client.oauthapp);
            assertNotNull(client.organization);
            assertNotNull(client.project);
            assertNotNull(client.session);
            assertNotNull(client.skill);
            assertNotNull(client.workflow);
            assertNotNull(client.workflowExecution);
            assertNotNull(client.workflowInstance);
            assertNotNull(client.search());
            assertNotNull(client.github());
        }
    }
}
