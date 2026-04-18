package ai.stigmer.sdk;

import ai.stigmer.sdk.gen.ErrorCode;
import ai.stigmer.sdk.gen.StigmerException;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertDoesNotThrow;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertThrows;

class PlatformClientAuthTest {

    @Test
    void builder_nullClientId_throws() {
        assertThrows(IllegalArgumentException.class, () ->
                PlatformClientAuth.builder("localhost:9090")
                        .clientId(null)
                        .clientSecret("stgm_cs_xyz")
                        .insecure()
                        .build());
    }

    @Test
    void builder_emptyClientId_throws() {
        assertThrows(IllegalArgumentException.class, () ->
                PlatformClientAuth.builder("localhost:9090")
                        .clientId("")
                        .clientSecret("stgm_cs_xyz")
                        .insecure()
                        .build());
    }

    @Test
    void builder_missingClientSecret_throws() {
        assertThrows(IllegalArgumentException.class, () ->
                PlatformClientAuth.builder("localhost:9090")
                        .clientId("stgm_cid_abc")
                        .insecure()
                        .build());
    }

    @Test
    void builder_emptyClientSecret_throws() {
        assertThrows(IllegalArgumentException.class, () ->
                PlatformClientAuth.builder("localhost:9090")
                        .clientId("stgm_cid_abc")
                        .clientSecret("")
                        .insecure()
                        .build());
    }

    @Test
    void builder_validConfig_buildsSuccessfully() {
        try (PlatformClientAuth auth = PlatformClientAuth.builder("localhost:9090")
                .clientId("stgm_cid_abc")
                .clientSecret("stgm_cs_xyz")
                .insecure()
                .build()) {
            assertNotNull(auth);
        }
    }

    @Test
    void close_isIdempotent() {
        PlatformClientAuth auth = PlatformClientAuth.builder("localhost:9090")
                .clientId("stgm_cid_abc")
                .clientSecret("stgm_cs_xyz")
                .insecure()
                .build();
        assertDoesNotThrow(() -> {
            auth.close();
            auth.close();
        });
    }

    @Test
    void mintUserToken_emptyUserId_throwsStigmerException() {
        try (PlatformClientAuth auth = PlatformClientAuth.builder("localhost:9090")
                .clientId("stgm_cid_abc")
                .clientSecret("stgm_cs_xyz")
                .insecure()
                .build()) {
            StigmerException ex = assertThrows(StigmerException.class, () ->
                    auth.mintUserToken(MintUserTokenInput.builder()
                            .userId("")
                            .build()));
            assertEquals(ErrorCode.INVALID_ARGUMENT, ex.getCode());
        }
    }

    @Test
    void mintUserToken_nullUserId_throwsStigmerException() {
        try (PlatformClientAuth auth = PlatformClientAuth.builder("localhost:9090")
                .clientId("stgm_cid_abc")
                .clientSecret("stgm_cs_xyz")
                .insecure()
                .build()) {
            StigmerException ex = assertThrows(StigmerException.class, () ->
                    auth.mintUserToken(MintUserTokenInput.builder()
                            .userId(null)
                            .build()));
            assertEquals(ErrorCode.INVALID_ARGUMENT, ex.getCode());
        }
    }
}
