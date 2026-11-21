// Asks a running Stigmer server whether a new session can start now: the
// server's named health status stigmer.sandboxes, over the Connect protocol's
// JSON form of grpc.health.v1.Health/Check, at the server's in-cluster
// Service.
//
// The server reports that status NOT_SERVING while its sandbox driver still
// builds what every new sandbox starts from (Agent Substrate's golden
// snapshot) and SERVING once it is published; a driver with no such image
// reports SERVING from boot. The overall health status, which the pod's
// probes read, is left alone, so the console answers while the image builds.
//
// It is the operator's second outbound client after internal/keycloak, and
// like that one it only ever talks to a component the operator runs. Plain
// HTTP/1.1 and JSON keep a gRPC stack out of the operator for one unary call.

package serverhealth

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
)

// SandboxesService is the named health status the server keeps for
// whether new sessions can start.
const SandboxesService = "stigmer.sandboxes"

// Client asks servers for their health.
type Client struct {
	HTTP *http.Client
}

// New is a client with a short timeout: a server that does not answer is
// asked again on the next pass.
func New() Client { return Client{HTTP: &http.Client{Timeout: 5 * time.Second}} }

// SandboxesServing reports whether the server at baseURL (http://host:port)
// says new sessions can start now.
func (c Client) SandboxesServing(ctx context.Context, baseURL string) (bool, error) {
	body, err := json.Marshal(map[string]string{"service": SandboxesService})
	if err != nil {
		return false, err
	}
	url := strings.TrimSuffix(baseURL, "/") + "/grpc.health.v1.Health/Check"
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(body))
	if err != nil {
		return false, err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Connect-Protocol-Version", "1")
	resp, err := c.HTTP.Do(req)
	if err != nil {
		return false, fmt.Errorf("asking the server's health at %s: %w", url, err)
	}
	defer resp.Body.Close()
	raw, err := io.ReadAll(io.LimitReader(resp.Body, 64<<10))
	if err != nil {
		return false, fmt.Errorf("reading the server's health: %w", err)
	}
	if resp.StatusCode != http.StatusOK {
		return false, fmt.Errorf("the server's health check answered %s: %s", resp.Status, strings.TrimSpace(string(raw)))
	}
	var answer struct {
		Status string `json:"status"`
	}
	if err := json.Unmarshal(raw, &answer); err != nil {
		return false, fmt.Errorf("reading the server's health: %w", err)
	}
	return answer.Status == "SERVING", nil
}
