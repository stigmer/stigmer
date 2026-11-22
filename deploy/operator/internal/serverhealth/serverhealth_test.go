// Pins the wire form of the sandboxes health question (the Connect JSON
// request the server answers) and the three answers the operator tells
// apart: serving, not serving, and a server that cannot say.

package serverhealth

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestSandboxesServing(t *testing.T) {
	status := "NOT_SERVING"
	code := http.StatusOK
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost || r.URL.Path != "/grpc.health.v1.Health/Check" || r.Header.Get("Content-Type") != "application/json" {
			t.Errorf("request %s %s (%s), want a Connect JSON POST to Health/Check", r.Method, r.URL.Path, r.Header.Get("Content-Type"))
		}
		var body map[string]string
		raw, _ := io.ReadAll(r.Body)
		if err := json.Unmarshal(raw, &body); err != nil || body["service"] != SandboxesService {
			t.Errorf("body %s, want service %s", raw, SandboxesService)
		}
		w.WriteHeader(code)
		_, _ = w.Write([]byte(`{"status":"` + status + `"}`))
	}))
	defer srv.Close()
	c := New()

	if ok, err := c.SandboxesServing(context.Background(), srv.URL+"/"); err != nil || ok {
		t.Fatalf("NOT_SERVING = %v, %v; want false, nil", ok, err)
	}
	status = "SERVING"
	if ok, err := c.SandboxesServing(context.Background(), srv.URL); err != nil || !ok {
		t.Fatalf("SERVING = %v, %v; want true, nil", ok, err)
	}
	code = http.StatusNotFound
	if ok, err := c.SandboxesServing(context.Background(), srv.URL); err == nil || ok {
		t.Fatalf("a 404 = %v, %v; want an error", ok, err)
	}
}
