package server

import "net/http"

// registryCORS wraps the public registry JSON proxies with the same
// allow-all-origins policy the gRPC-Web wrapper applies to API calls.
// These endpoints serve embedded, unauthenticated, cacheable JSON (the
// task-kind and model registries), and the OSS web console fetches them
// cross-origin — without these headers the browser blocks the response
// and the console's task palette and model pickers never load (oss#571).
func registryCORS(h http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		if r.Method == http.MethodOptions {
			w.Header().Set("Access-Control-Allow-Methods", "GET, OPTIONS")
			w.Header().Set("Access-Control-Allow-Headers", "Authorization, Content-Type")
			w.WriteHeader(http.StatusNoContent)
			return
		}
		h.ServeHTTP(w, r)
	})
}
