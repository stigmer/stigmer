// A token provider that fetches once and keeps the token until it nearly
// expires.
//
// A backend that acts as one of its product's signed-in users mints that
// person a user token with its service account's client, then starts the run
// with a second client on the token (WithTokenFunc). The client asks for the
// token on every call, so a func that minted each time would mint per
// request. TokenCache sits between them: it serves the token it holds until a
// minute before it expires, then fetches again; callers that ask while a fetch
// runs wait for that one fetch; a failed fetch is not kept, so the next call
// tries again. It is the Go form of the TypeScript SDK's createTokenCache,
// with the same rules.
//
// The cache is the one writer of the token it holds; Invalidate is the one
// way to drop it early (when the person signs out, or the backend learns the
// token was revoked).

package stigmer

import (
	"context"
	"errors"
	"sync"
	"time"
)

// tokenExpirySkew is how long before expiry a held token counts as stale (the
// TypeScript SDK's EXPIRY_SKEW_MS): a long stream must not start on a token
// that expires moments later.
const tokenExpirySkew = time.Minute

// TokenCache fetches a user token once and reuses it until it is about to
// expire. Pass its Token method to WithTokenFunc. It is safe for concurrent
// use.
type TokenCache struct {
	fetch func(ctx context.Context) (*MintUserTokenResult, error)

	mu         sync.Mutex
	token      string
	expiresAt  time.Time
	inflight   *tokenFetch
	generation uint64
}

// tokenFetch is one fetch in flight, shared by every caller that asks while it
// runs.
type tokenFetch struct {
	done  chan struct{}
	token string
	err   error
}

// NewTokenCache returns a cache over fetch, which returns a minted token with
// its expiry: what TokenClient.MintUserToken returns.
//
//	tokens := stigmer.NewTokenCache(func(ctx context.Context) (*stigmer.MintUserTokenResult, error) {
//	    return admin.Tokens.MintUserToken(ctx, &stigmer.MintUserTokenInput{Org: "acme", UserID: user.ID})
//	})
//	asUser, err := stigmer.NewClient(stigmer.WithTokenFunc(tokens.Token))
func NewTokenCache(fetch func(ctx context.Context) (*MintUserTokenResult, error)) *TokenCache {
	return &TokenCache{fetch: fetch}
}

// Token returns the held token while it has more than a minute left, otherwise
// a new one. Callers that ask while a fetch runs share it; a caller whose ctx
// ends first stops waiting with ctx's error. The fetch runs with the ctx of
// the caller that started it. A failed fetch, or a result with no token or no
// expiry, is answered as an error and not kept.
func (c *TokenCache) Token(ctx context.Context) (string, error) {
	c.mu.Lock()
	if c.token != "" && time.Until(c.expiresAt) > tokenExpirySkew {
		token := c.token
		c.mu.Unlock()
		return token, nil
	}
	call := c.inflight
	if call == nil {
		call = &tokenFetch{done: make(chan struct{})}
		c.inflight = call
		started := c.generation
		c.mu.Unlock()
		c.run(ctx, call, started)
	} else {
		c.mu.Unlock()
	}

	select {
	case <-call.done:
		return call.token, call.err
	case <-ctx.Done():
		return "", ctx.Err()
	}
}

// Invalidate forgets the held token, so the next call fetches a new one. A
// fetch already running still answers its callers, but its token is not kept:
// a token minted for one person must not be served after the host says that
// person signed out or changed.
func (c *TokenCache) Invalidate() {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.generation++
	c.token = ""
	c.expiresAt = time.Time{}
	c.inflight = nil
}

var (
	errNoFetchedToken  = errors.New("stigmer: TokenCache: the fetch returned no access token")
	errNoFetchedExpiry = errors.New("stigmer: TokenCache: the fetched token has no ExpiresAt")
)

func (c *TokenCache) run(ctx context.Context, call *tokenFetch, started uint64) {
	result, err := c.fetch(ctx)
	switch {
	case err != nil:
		call.err = err
	case result == nil || result.AccessToken == "":
		call.err = errNoFetchedToken
	case result.ExpiresAt.IsZero():
		call.err = errNoFetchedExpiry
	default:
		call.token = result.AccessToken
	}

	c.mu.Lock()
	if started == c.generation {
		if call.err == nil {
			c.token = result.AccessToken
			c.expiresAt = result.ExpiresAt
		}
		c.inflight = nil
	}
	c.mu.Unlock()
	close(call.done)
}
