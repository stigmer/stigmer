package webconsole

import (
	"io/fs"
	"net/http"
	"net/http/httptest"
	"testing"
	"testing/fstest"
)

// newTestHandler builds an spaHandler backed by an in-memory filesystem
// that mirrors a Next.js static export with dynamic routes.
func newTestHandler() *spaHandler {
	memFS := fstest.MapFS{
		"index.html": &fstest.MapFile{Data: []byte("<html>root</html>")},

		// Static page: /agents (list)
		"agents.html": &fstest.MapFile{Data: []byte("<html>agents list</html>")},

		// Dynamic route: /agents/[id]
		"agents/__placeholder__.html":                             &fstest.MapFile{Data: []byte("<html>agent detail</html>")},
		"agents/__placeholder__.txt":                              &fstest.MapFile{Data: []byte("RSC:agent-detail")},
		"agents/__placeholder__/__next._full.txt":                 &fstest.MapFile{Data: []byte("RSC:full")},
		"agents/__placeholder__/__next.agents.$d$id.__PAGE__.txt": &fstest.MapFile{Data: []byte("RSC:page")},
		"agents/__next._full.txt":                                 &fstest.MapFile{Data: []byte("RSC:agents-layout")},
		"agents/__next.agents.__PAGE__.txt":                       &fstest.MapFile{Data: []byte("RSC:agents-list-page")},

		// Dynamic route: /mcp-servers/[id] (hyphenated prefix)
		"mcp-servers/__placeholder__.html": &fstest.MapFile{Data: []byte("<html>mcp detail</html>")},
		"mcp-servers/__placeholder__.txt":  &fstest.MapFile{Data: []byte("RSC:mcp-detail")},

		// Hashed asset
		"_next/static/chunks/abc123.js": &fstest.MapFile{Data: []byte("js-content")},
	}
	return &spaHandler{fs: memFS}
}

func TestDirectFileLookup(t *testing.T) {
	h := newTestHandler()

	rr := serve(h, "/agents.html")
	assertStatus(t, rr, 200)
	assertBody(t, rr, "<html>agents list</html>")
}

func TestHashedAssetCaching(t *testing.T) {
	h := newTestHandler()

	rr := serve(h, "/_next/static/chunks/abc123.js")
	assertStatus(t, rr, 200)
	assertBody(t, rr, "js-content")
	if got := rr.Header().Get("Cache-Control"); got != "public, max-age=31536000, immutable" {
		t.Errorf("cache-control = %q, want immutable", got)
	}
}

func TestDynamicRoute_RSCPayload(t *testing.T) {
	h := newTestHandler()

	rr := serve(h, "/agents/real-agent-id.txt")
	assertStatus(t, rr, 200)
	assertBody(t, rr, "RSC:agent-detail")
	assertNoCache(t, rr)
}

func TestDynamicRoute_NestedRSCPayload(t *testing.T) {
	h := newTestHandler()

	rr := serve(h, "/agents/real-agent-id/__next._full.txt")
	assertStatus(t, rr, 200)
	assertBody(t, rr, "RSC:full")
	assertNoCache(t, rr)
}

func TestDynamicRoute_NestedPagePayload(t *testing.T) {
	h := newTestHandler()

	rr := serve(h, "/agents/real-agent-id/__next.agents.$d$id.__PAGE__.txt")
	assertStatus(t, rr, 200)
	assertBody(t, rr, "RSC:page")
	assertNoCache(t, rr)
}

func TestDynamicRoute_FullPageLoad(t *testing.T) {
	h := newTestHandler()

	rr := serve(h, "/agents/real-agent-id")
	assertStatus(t, rr, 200)
	assertBody(t, rr, "<html>agent detail</html>")
	assertNoCache(t, rr)
}

func TestDynamicRoute_HyphenatedPrefix(t *testing.T) {
	h := newTestHandler()

	rr := serve(h, "/mcp-servers/some-server-id.txt")
	assertStatus(t, rr, 200)
	assertBody(t, rr, "RSC:mcp-detail")
}

func TestLayoutRSC_NotRewritten(t *testing.T) {
	h := newTestHandler()

	rr := serve(h, "/agents/__next._full.txt")
	assertStatus(t, rr, 200)
	assertBody(t, rr, "RSC:agents-layout")
}

func TestUnknownPath_FallsBackToIndex(t *testing.T) {
	h := newTestHandler()

	rr := serve(h, "/completely/unknown/path")
	assertStatus(t, rr, 200)
	assertBody(t, rr, "<html>root</html>")
}

func TestRootPath_ServesIndex(t *testing.T) {
	h := newTestHandler()

	rr := serve(h, "/")
	assertStatus(t, rr, 200)
	assertBody(t, rr, "<html>root</html>")
}

// --- helpers ---

func serve(h http.Handler, path string) *httptest.ResponseRecorder {
	rr := httptest.NewRecorder()
	req := httptest.NewRequest("GET", path, nil)
	h.ServeHTTP(rr, req)
	return rr
}

func assertStatus(t *testing.T, rr *httptest.ResponseRecorder, want int) {
	t.Helper()
	if rr.Code != want {
		t.Errorf("status = %d, want %d", rr.Code, want)
	}
}

func assertBody(t *testing.T, rr *httptest.ResponseRecorder, want string) {
	t.Helper()
	if got := rr.Body.String(); got != want {
		t.Errorf("body = %q, want %q", got, want)
	}
}

func assertNoCache(t *testing.T, rr *httptest.ResponseRecorder) {
	t.Helper()
	if got := rr.Header().Get("Cache-Control"); got != "no-cache" {
		t.Errorf("cache-control = %q, want %q", got, "no-cache")
	}
}

// Verify that isFile correctly distinguishes files from directories.
func TestIsFile(t *testing.T) {
	memFS := fstest.MapFS{
		"dir/file.txt": &fstest.MapFile{Data: []byte("content")},
	}
	h := &spaHandler{fs: memFS}

	if !h.isFile("dir/file.txt") {
		t.Error("isFile(dir/file.txt) = false, want true")
	}

	// fstest.MapFS implicitly creates parent directories.
	if h.isFile("dir") {
		t.Error("isFile(dir) = true, want false")
	}

	if h.isFile("nonexistent") {
		t.Error("isFile(nonexistent) = true, want false")
	}
}

// Verify resolveDynamicRoute returns false for paths with < 2 segments.
func TestResolveDynamicRoute_ShortPath(t *testing.T) {
	h := newTestHandler()
	_, ok := h.resolveDynamicRoute("onlyone")
	if ok {
		t.Error("expected false for single-segment path")
	}
}

var _ fs.FS = fstest.MapFS{}
