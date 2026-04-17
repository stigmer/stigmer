package ai.stigmer.sdk;

import java.time.Instant;

/**
 * Result of a successful {@link PlatformClientAuth#mintUserToken} call.
 *
 * <p>Pass {@link #accessToken()} to the React SDK's {@code StigmerProvider}
 * via the {@code getAccessToken} callback to authenticate browser-based API calls.
 */
public final class MintUserTokenResult {

    private final String accessToken;
    private final String tokenType;
    private final int expiresIn;
    private final Instant expiresAt;

    MintUserTokenResult(String accessToken, String tokenType, int expiresIn, Instant expiresAt) {
        this.accessToken = accessToken;
        this.tokenType = tokenType;
        this.expiresIn = expiresIn;
        this.expiresAt = expiresAt;
    }

    /** Stigmer-signed JWT for browser-based API authentication. */
    public String accessToken() { return accessToken; }

    /** Token type. Always "Bearer". */
    public String tokenType() { return tokenType; }

    /** Token lifetime in seconds from issuance. */
    public int expiresIn() { return expiresIn; }

    /** Absolute expiration time (UTC), computed from {@link #expiresIn()} at call time. */
    public Instant expiresAt() { return expiresAt; }

    @Override
    public String toString() {
        return "MintUserTokenResult{tokenType=" + tokenType
                + ", expiresIn=" + expiresIn
                + ", expiresAt=" + expiresAt + "}";
    }
}
