package ai.stigmer.sdk;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertDoesNotThrow;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * StigmerClient construction. The key rule is the Go SDK's: a key is
 * required, except on a plaintext connection to a local server, where
 * {@code builder()} leaves it out; a given key must not be null or empty.
 * What reaches the wire is pinned in {@code StigmerChannelTest}.
 */
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
    void builder_noKey_insecure_buildsSuccessfully() {
        try (StigmerClient client = StigmerClient.builder()
                .baseUrl("localhost:7234")
                .insecure()
                .build()) {
            assertNotNull(client);
        }
    }

    @Test
    void builder_noKey_tls_isRefusedNamingTheFix() {
        IllegalStateException e = assertThrows(IllegalStateException.class,
                () -> StigmerClient.builder().build());
        assertTrue(e.getMessage().contains("insecure() for a local server"), e.getMessage());
    }

    @Test
    void builder_emptyApiKey_isRefusedEvenWhenInsecure() {
        assertThrows(IllegalArgumentException.class,
                () -> StigmerClient.builder("").insecure().build());
    }

    @Test
    void builder_defaultTarget_buildsSuccessfully() {
        try (StigmerClient client = StigmerClient.builder("stk_test_key").build()) {
            assertNotNull(client);
        }
    }

    @Test
    void builder_customBaseUrl_buildsSuccessfully() {
        try (StigmerClient client = StigmerClient.builder("stk_test_key")
                .baseUrl("localhost:9090")
                .insecure()
                .build()) {
            assertNotNull(client);
        }
    }

    @Test
    void builder_insecure_buildsSuccessfully() {
        try (StigmerClient client = StigmerClient.builder("stk_test_key")
                .insecure()
                .build()) {
            assertNotNull(client);
        }
    }

    @Test
    void close_isIdempotent() {
        StigmerClient client = StigmerClient.builder("stk_test_key")
                .insecure()
                .build();
        assertDoesNotThrow(() -> {
            client.close();
            client.close();
        });
    }

    @Test
    void subClients_areAccessible() {
        try (StigmerClient client = StigmerClient.builder("stk_test_key")
                .insecure()
                .build()) {
            assertNotNull(client.agent);
            assertNotNull(client.run);
            assertNotNull(client.apiKey);
            assertNotNull(client.channel);
            assertNotNull(client.grant);
            assertNotNull(client.identityAccount);
            assertNotNull(client.federationIssuer);
            assertNotNull(client.oauthapp);
            assertNotNull(client.organization);
            assertNotNull(client.plugin);
            assertNotNull(client.session);
            assertNotNull(client.skill);
            assertNotNull(client.vault);
            assertNotNull(client.billing());
            assertNotNull(client.search());
            assertNotNull(client.github());
        }
    }
}
