package ai.stigmer.sdk;

import java.time.Duration;
import java.time.Instant;
import java.util.Objects;
import java.util.function.Supplier;

/**
 * A token provider that fetches once and keeps the token until it nearly
 * expires.
 *
 * <p>A backend that acts as one of its product's signed-in users mints that
 * person a user token with its service account's client, then starts the run
 * with a second client on the token
 * ({@link StigmerClient.Builder#tokenProvider(Supplier)}). The client asks for
 * the token on every call, so a provider that minted each time would mint per
 * request. {@code TokenCache} sits between them: it serves the token it holds
 * until a minute before it expires, then fetches again; callers that ask while
 * a fetch runs wait for that one fetch; a fetch that throws is not kept, so the
 * next call tries again. It is the Java form of the TypeScript SDK's
 * {@code createTokenCache}, with the same rules, and is safe to share between
 * threads.
 *
 * <pre>{@code
 * TokenCache tokens = TokenCache.of(() -> admin.tokens().mintUserToken(
 *     MintUserTokenInput.builder().org("acme").userId(user.getId()).build()));
 * try (StigmerClient asUser = StigmerClient.builder().tokenProvider(tokens).build()) {
 *     // what asUser starts is the person's own
 * }
 * }</pre>
 *
 * <p>The cache is the one writer of the token it holds; {@link #invalidate()}
 * is the one way to drop it early (when the person signs out, or the backend
 * learns the token was revoked).
 */
public final class TokenCache implements Supplier<String> {

    /**
     * How long before expiry a held token counts as stale (the TypeScript
     * SDK's {@code EXPIRY_SKEW_MS}): a long stream must not start on a token
     * that expires moments later.
     */
    static final Duration EXPIRY_SKEW = Duration.ofMinutes(1);

    private final Supplier<MintUserTokenResult> fetch;
    /** Held only while a fetch runs, so concurrent callers share it. */
    private final Object fetchLock = new Object();
    /** Guards the held token and the generation; never held across a fetch. */
    private final Object stateLock = new Object();
    private String token;
    private Instant expiresAt;
    /** Bumped by {@link #invalidate()}, so a fetch that started before it is not kept. */
    private long generation;

    private TokenCache(Supplier<MintUserTokenResult> fetch) {
        this.fetch = fetch;
    }

    /**
     * Creates a cache over {@code fetch}, which returns a minted token with its
     * expiry: what {@link TokenClient#mintUserToken} returns.
     *
     * @throws NullPointerException if {@code fetch} is null
     */
    public static TokenCache of(Supplier<MintUserTokenResult> fetch) {
        return new TokenCache(Objects.requireNonNull(fetch, "fetch must not be null"));
    }

    /**
     * The held token while it has more than a minute left, otherwise a new
     * one.
     *
     * @throws IllegalStateException if the fetch returned no result, no token
     *                               or no expiry
     * @throws RuntimeException      whatever the fetch threw (a
     *                               {@code StigmerException} from
     *                               {@code mintUserToken}), unchanged and not kept
     */
    @Override
    public String get() {
        String held = fresh();
        if (held != null) {
            return held;
        }
        synchronized (fetchLock) {
            // A caller that waited on the lock finds the token the fetch it
            // waited for kept.
            held = fresh();
            if (held != null) {
                return held;
            }
            long startedIn;
            synchronized (stateLock) {
                startedIn = generation;
            }
            MintUserTokenResult result = fetch.get();
            if (result == null || result.accessToken() == null || result.accessToken().isEmpty()) {
                throw new IllegalStateException("stigmer: TokenCache: the fetch returned no access token");
            }
            if (result.expiresAt() == null) {
                throw new IllegalStateException("stigmer: TokenCache: the fetched token has no expiresAt");
            }
            synchronized (stateLock) {
                if (startedIn == generation) {
                    token = result.accessToken();
                    expiresAt = result.expiresAt();
                }
            }
            return result.accessToken();
        }
    }

    /**
     * Forgets the held token, so the next call fetches a new one. A fetch
     * already running still answers its callers, but its token is not kept: a
     * token minted for one person must not be served after the host says that
     * person signed out or changed.
     */
    public void invalidate() {
        synchronized (stateLock) {
            generation++;
            token = null;
            expiresAt = null;
        }
    }

    private String fresh() {
        synchronized (stateLock) {
            if (token != null && Duration.between(Instant.now(), expiresAt).compareTo(EXPIRY_SKEW) > 0) {
                return token;
            }
            return null;
        }
    }
}
