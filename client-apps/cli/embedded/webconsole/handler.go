package webconsole

import (
	"io/fs"
	"net/http"
	"path"
	"strings"
)

// NewSPAHandler returns an http.Handler that serves the embedded web console
// as a single-page application.
//
// Routing:
//   - If the request path matches a file in the embedded FS, serve it.
//   - Otherwise, serve index.html (client-side routing for Next.js).
//
// Cache control:
//   - Hashed assets (.js, .css with content hashes): immutable, 1-year max-age.
//   - index.html: no-cache, so the browser always fetches the latest version.
//   - Other files: standard browser caching (no explicit header).
func NewSPAHandler() http.Handler {
	assets := FS()
	if assets == nil {
		return http.NotFoundHandler()
	}

	return &spaHandler{fs: assets}
}

type spaHandler struct {
	fs fs.FS
}

func (h *spaHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	// Clean the path and strip leading slash for fs.FS lookup.
	reqPath := path.Clean(r.URL.Path)
	if reqPath == "/" {
		h.serveIndex(w, r)
		return
	}
	fsPath := strings.TrimPrefix(reqPath, "/")

	// Try to open the file. If it exists, serve it with appropriate caching.
	f, err := h.fs.Open(fsPath)
	if err != nil {
		h.serveIndex(w, r)
		return
	}
	f.Close()

	// Hashed assets (e.g. _next/static/chunks/abc123.js) are immutable.
	if isHashedAsset(fsPath) {
		w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
	}

	http.ServeFileFS(w, r, h.fs, fsPath)
}

func (h *spaHandler) serveIndex(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-cache")
	http.ServeFileFS(w, r, h.fs, "index.html")
}

// isHashedAsset returns true for Next.js build assets that include a content
// hash in the filename and are safe to cache indefinitely.
func isHashedAsset(p string) bool {
	return strings.HasPrefix(p, "_next/static/")
}
