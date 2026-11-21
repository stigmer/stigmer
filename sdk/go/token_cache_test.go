package stigmer

import (
	"context"
	"errors"
	"fmt"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

// The cache's rules are the TypeScript SDK's createTokenCache: the held token
// is served until a minute before it expires; callers that ask during a fetch
// share it; a failed fetch is not kept; Invalidate drops the token, and a
// fetch already running when it is called is not kept either. Expiry is real
// wall-clock time, so a token minted to expire in 30 seconds is already inside
// the minute and is fetched again.

func countingFetch(lifetime time.Duration) (func(context.Context) (*MintUserTokenResult, error), *atomic.Int32) {
	var calls atomic.Int32
	return func(context.Context) (*MintUserTokenResult, error) {
		n := calls.Add(1)
		return &MintUserTokenResult{AccessToken: fmt.Sprintf("token-%d", n), TokenType: "Bearer", ExpiresAt: time.Now().Add(lifetime)}, nil
	}, &calls
}

func mustToken(t *testing.T, c *TokenCache) string {
	t.Helper()
	token, err := c.Token(t.Context())
	if err != nil {
		t.Fatalf("Token: %v", err)
	}
	return token
}

func TestTokenCache_AFreshTokenIsFetchedOnceAndReused(t *testing.T) {
	fetch, calls := countingFetch(15 * time.Minute)
	c := NewTokenCache(fetch)
	for range 3 {
		if got := mustToken(t, c); got != "token-1" {
			t.Fatalf("Token = %q, want token-1", got)
		}
	}
	if calls.Load() != 1 {
		t.Errorf("fetches = %d, want 1", calls.Load())
	}
}

func TestTokenCache_ATokenInsideTheLastMinuteIsFetchedAgain(t *testing.T) {
	fetch, calls := countingFetch(30 * time.Second)
	c := NewTokenCache(fetch)
	if first, second := mustToken(t, c), mustToken(t, c); first != "token-1" || second != "token-2" {
		t.Fatalf("tokens = %q, %q; want token-1 then token-2", first, second)
	}
	if calls.Load() != 2 {
		t.Errorf("fetches = %d, want 2", calls.Load())
	}
}

func TestTokenCache_ConcurrentCallersShareOneFetch(t *testing.T) {
	release := make(chan struct{})
	var calls atomic.Int32
	c := NewTokenCache(func(context.Context) (*MintUserTokenResult, error) {
		calls.Add(1)
		<-release
		return &MintUserTokenResult{AccessToken: "shared", ExpiresAt: time.Now().Add(15 * time.Minute)}, nil
	})

	var wg sync.WaitGroup
	results := make([]string, 4)
	for i := range results {
		wg.Add(1)
		go func() {
			defer wg.Done()
			results[i], _ = c.Token(t.Context())
		}()
	}
	// Every caller is either running the one fetch or waiting on it.
	for calls.Load() == 0 {
		time.Sleep(time.Millisecond)
	}
	time.Sleep(20 * time.Millisecond)
	close(release)
	wg.Wait()

	for i, got := range results {
		if got != "shared" {
			t.Errorf("caller %d got %q, want shared", i, got)
		}
	}
	if calls.Load() != 1 {
		t.Errorf("fetches = %d, want 1", calls.Load())
	}
}

func TestTokenCache_AFailedFetchIsNotKept(t *testing.T) {
	refused := errors.New("mint refused")
	var calls atomic.Int32
	c := NewTokenCache(func(context.Context) (*MintUserTokenResult, error) {
		if calls.Add(1) == 1 {
			return nil, refused
		}
		return &MintUserTokenResult{AccessToken: "after", ExpiresAt: time.Now().Add(15 * time.Minute)}, nil
	})
	if _, err := c.Token(t.Context()); !errors.Is(err, refused) {
		t.Fatalf("first Token err = %v, want the fetch's error", err)
	}
	if got := mustToken(t, c); got != "after" {
		t.Errorf("Token after a failure = %q, want after", got)
	}
}

func TestTokenCache_InvalidateDropsTheHeldToken(t *testing.T) {
	fetch, _ := countingFetch(15 * time.Minute)
	c := NewTokenCache(fetch)
	mustToken(t, c)
	c.Invalidate()
	if got := mustToken(t, c); got != "token-2" {
		t.Errorf("Token after Invalidate = %q, want token-2", got)
	}
}

func TestTokenCache_AFetchRunningWhenInvalidatedAnswersButIsNotKept(t *testing.T) {
	var c *TokenCache
	var calls atomic.Int32
	c = NewTokenCache(func(context.Context) (*MintUserTokenResult, error) {
		n := calls.Add(1)
		if n == 1 {
			c.Invalidate() // the person signs out while the mint runs
		}
		return &MintUserTokenResult{AccessToken: fmt.Sprintf("token-%d", n), ExpiresAt: time.Now().Add(15 * time.Minute)}, nil
	})
	if first, second := mustToken(t, c), mustToken(t, c); first != "token-1" || second != "token-2" {
		t.Errorf("tokens = %q, %q; want token-1 then token-2", first, second)
	}
}

func TestTokenCache_AResultWithoutATokenOrAnExpiryIsRefused(t *testing.T) {
	cases := map[string]struct {
		result *MintUserTokenResult
		want   error
	}{
		"nil result":  {nil, errNoFetchedToken},
		"empty token": {&MintUserTokenResult{ExpiresAt: time.Now().Add(time.Hour)}, errNoFetchedToken},
		"no expiry":   {&MintUserTokenResult{AccessToken: "tok"}, errNoFetchedExpiry},
	}
	for name, tc := range cases {
		c := NewTokenCache(func(context.Context) (*MintUserTokenResult, error) { return tc.result, nil })
		if _, err := c.Token(t.Context()); !errors.Is(err, tc.want) {
			t.Errorf("%s: err = %v, want %v", name, err, tc.want)
		}
	}
}

func TestTokenCache_AWaiterWhoseContextEndsStopsWaiting(t *testing.T) {
	release := make(chan struct{})
	defer close(release)
	started := make(chan struct{})
	c := NewTokenCache(func(context.Context) (*MintUserTokenResult, error) {
		close(started)
		<-release
		return &MintUserTokenResult{AccessToken: "late", ExpiresAt: time.Now().Add(time.Hour)}, nil
	})
	go func() { _, _ = c.Token(context.Background()) }()
	<-started

	ctx, cancel := context.WithCancel(t.Context())
	cancel()
	if _, err := c.Token(ctx); !errors.Is(err, context.Canceled) {
		t.Errorf("err = %v, want context.Canceled", err)
	}
}
