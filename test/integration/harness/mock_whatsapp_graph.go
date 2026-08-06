package harness

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
)

// MockWhatsAppGraph is a stand-in for Meta's Graph API, precise to the two
// calls the channel runtime makes: the install-time phone-number read
// (GET /{phone_number_id}) and the message send
// (POST /{phone_number_id}/messages). It exists so integration tests can
// run the REAL WhatsApp install flow and the REAL outbound delivery engine
// without a network dependency on graph.facebook.com — the service's
// graph-api-base-url is a config knob
// (STIGMER_CHANNELS_WHATSAPP_GRAPH_API_BASE_URL) pointed here at boot.
//
// The client contract this honors (WhatsAppWebApiClient): responses are
// judged solely by body parseability and the absence of an "error" member —
// HTTP status is never inspected — and a send is acknowledged with
// {"messages":[{"id":"<wamid>"}]}.
type MockWhatsAppGraph struct {
	server *httptest.Server

	mu    sync.Mutex
	sends []MockGraphSend
	seq   int
}

// MockGraphSend is one recorded POST /{phone_number_id}/messages call.
type MockGraphSend struct {
	PhoneNumberID string
	// Body is the raw JSON the service sent (to, type, text, ...).
	Body string
}

// StartMockWhatsAppGraph starts the mock on an ephemeral port. Callers own
// Close.
func StartMockWhatsAppGraph() *MockWhatsAppGraph {
	mock := &MockWhatsAppGraph{}
	mock.server = httptest.NewServer(http.HandlerFunc(mock.handle))
	return mock
}

// BaseURL is the value for STIGMER_CHANNELS_WHATSAPP_GRAPH_API_BASE_URL —
// no trailing slash, no version segment (the client concatenates paths
// verbatim, so the version prefix is simply absent here).
func (m *MockWhatsAppGraph) BaseURL() string {
	return m.server.URL
}

// Close shuts the mock down.
func (m *MockWhatsAppGraph) Close() {
	m.server.Close()
}

// SendsTo returns the recorded message sends for one phone number id —
// the assertion surface for "the platform sent exactly N messages".
func (m *MockWhatsAppGraph) SendsTo(phoneNumberID string) []MockGraphSend {
	m.mu.Lock()
	defer m.mu.Unlock()
	var out []MockGraphSend
	for _, send := range m.sends {
		if send.PhoneNumberID == phoneNumberID {
			out = append(out, send)
		}
	}
	return out
}

func (m *MockWhatsAppGraph) handle(w http.ResponseWriter, r *http.Request) {
	segments := strings.Split(strings.Trim(r.URL.Path, "/"), "/")

	// POST /{phone_number_id}/messages — sends, read receipts, templates.
	if r.Method == http.MethodPost && len(segments) == 2 && segments[1] == "messages" {
		body, _ := io.ReadAll(r.Body)
		m.mu.Lock()
		m.seq++
		wamid := fmt.Sprintf("wamid.MOCK%d", m.seq)
		// Read receipts (status: "read") are provider side effects, not
		// messages — recorded only when the payload carries a "to".
		if strings.Contains(string(body), `"to"`) {
			m.sends = append(m.sends, MockGraphSend{
				PhoneNumberID: segments[0],
				Body:          string(body),
			})
		}
		m.mu.Unlock()
		writeJSON(w, map[string]any{
			"messaging_product": "whatsapp",
			"messages":          []map[string]string{{"id": wamid}},
		})
		return
	}

	// GET /{phone_number_id} — the install flow's phone-number read.
	if r.Method == http.MethodGet && len(segments) == 1 {
		writeJSON(w, map[string]any{
			"id":                   segments[0],
			"display_phone_number": "+1 555 025 3483",
			"verified_name":        "Integration Test Business",
		})
		return
	}

	// Anything else answers Meta's error shape so an unexpected call
	// fails the caller loudly instead of hanging or half-working.
	w.WriteHeader(http.StatusNotFound)
	writeJSON(w, map[string]any{
		"error": map[string]any{
			"message": "unsupported mock route: " + r.Method + " " + r.URL.Path,
			"type":    "GraphMethodException",
			"code":    100,
		},
	})
}

func writeJSON(w http.ResponseWriter, body map[string]any) {
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(body)
}
