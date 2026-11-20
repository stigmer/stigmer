package ai.stigmer.sdk;

import org.junit.jupiter.api.Test;

import java.time.Instant;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.function.Supplier;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * TokenCache: the backend's per-user token, fetched once per token, not per
 * call. The rules are the TypeScript SDK's {@code createTokenCache}: the held
 * token is served until a minute before it expires; callers that ask during a
 * fetch share it; a fetch that throws is not kept; {@code invalidate} drops
 * the token, and a fetch already running when it is called is not kept
 * either. Expiry is real wall-clock time, so a token minted to expire in 30
 * seconds is already inside the minute and is fetched again.
 */
class TokenCacheTest {

    private static MintUserTokenResult result(String token, long seconds) {
        return new MintUserTokenResult(token, "Bearer", (int) seconds, Instant.now().plusSeconds(seconds));
    }

    private static Supplier<MintUserTokenResult> counting(AtomicInteger calls, long seconds) {
        return () -> result("token-" + calls.incrementAndGet(), seconds);
    }

    @Test
    void aFreshTokenIsFetchedOnceAndReused() {
        AtomicInteger calls = new AtomicInteger();
        TokenCache cache = TokenCache.of(counting(calls, 900));
        assertEquals("token-1", cache.get());
        assertEquals("token-1", cache.get());
        assertEquals(1, calls.get());
    }

    @Test
    void aTokenInsideTheLastMinuteIsFetchedAgain() {
        AtomicInteger calls = new AtomicInteger();
        TokenCache cache = TokenCache.of(counting(calls, 30));
        assertEquals("token-1", cache.get());
        assertEquals("token-2", cache.get());
    }

    @Test
    void concurrentCallersShareOneFetch() throws Exception {
        AtomicInteger calls = new AtomicInteger();
        CountDownLatch started = new CountDownLatch(1);
        CountDownLatch release = new CountDownLatch(1);
        TokenCache cache = TokenCache.of(() -> {
            calls.incrementAndGet();
            started.countDown();
            try {
                release.await(5, TimeUnit.SECONDS);
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
            }
            return result("shared", 900);
        });
        List<String> results = Collections.synchronizedList(new ArrayList<>());
        List<Thread> threads = new ArrayList<>();
        for (int i = 0; i < 4; i++) {
            Thread thread = new Thread(() -> results.add(cache.get()));
            threads.add(thread);
            thread.start();
        }
        assertTrue(started.await(5, TimeUnit.SECONDS));
        Thread.sleep(20);
        release.countDown();
        for (Thread thread : threads) {
            thread.join(5000);
        }
        assertEquals(List.of("shared", "shared", "shared", "shared"), results);
        assertEquals(1, calls.get());
    }

    @Test
    void aFailedFetchIsNotKept() {
        AtomicInteger calls = new AtomicInteger();
        TokenCache cache = TokenCache.of(() -> {
            if (calls.incrementAndGet() == 1) {
                throw new IllegalArgumentException("mint refused");
            }
            return result("after", 900);
        });
        IllegalArgumentException e = assertThrows(IllegalArgumentException.class, cache::get);
        assertEquals("mint refused", e.getMessage());
        assertEquals("after", cache.get());
    }

    @Test
    void invalidateDropsTheHeldToken() {
        AtomicInteger calls = new AtomicInteger();
        TokenCache cache = TokenCache.of(counting(calls, 900));
        cache.get();
        cache.invalidate();
        assertEquals("token-2", cache.get());
    }

    @Test
    void aFetchRunningWhenInvalidatedAnswersButIsNotKept() {
        AtomicInteger calls = new AtomicInteger();
        TokenCache[] cache = new TokenCache[1];
        cache[0] = TokenCache.of(() -> {
            int n = calls.incrementAndGet();
            if (n == 1) {
                cache[0].invalidate(); // the person signs out while the mint runs
            }
            return result("token-" + n, 900);
        });
        assertEquals("token-1", cache[0].get());
        assertEquals("token-2", cache[0].get());
    }

    @Test
    void aResultWithoutATokenOrAnExpiryIsRefused() {
        assertThrows(IllegalStateException.class, () -> TokenCache.of(() -> null).get());
        assertThrows(IllegalStateException.class, () -> TokenCache.of(() -> result("", 900)).get());
        assertThrows(IllegalStateException.class,
                () -> TokenCache.of(() -> new MintUserTokenResult("tok", "Bearer", 900, null)).get());
    }

    @Test
    void aNullFetchIsRefused() {
        assertThrows(NullPointerException.class, () -> TokenCache.of(null));
    }
}
