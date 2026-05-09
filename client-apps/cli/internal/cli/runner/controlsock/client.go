package controlsock

import (
	"context"
	"encoding/json"
	"fmt"
	"net"
	"net/http"
	"time"

	"github.com/pkg/errors"
)

const clientTimeout = 2 * time.Second

// newHTTPClient returns an http.Client configured to connect via Unix socket.
func newHTTPClient(socketPath string) *http.Client {
	return &http.Client{
		Timeout: clientTimeout,
		Transport: &http.Transport{
			DialContext: func(_ context.Context, _, _ string) (net.Conn, error) {
				return net.DialTimeout("unix", socketPath, clientTimeout)
			},
		},
	}
}

// Ping queries the runner's control socket for its current status.
// Returns the parsed StatusResponse on success, or an error if the
// socket is unreachable, stale, or returns unexpected data.
func Ping(socketPath string) (*StatusResponse, error) {
	client := newHTTPClient(socketPath)
	defer client.CloseIdleConnections()

	resp, err := client.Get("http://localhost/status")
	if err != nil {
		return nil, errors.Wrap(err, "control socket unreachable")
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("control socket returned HTTP %d", resp.StatusCode)
	}

	var status StatusResponse
	if err := json.NewDecoder(resp.Body).Decode(&status); err != nil {
		return nil, errors.Wrap(err, "failed to decode status response")
	}

	return &status, nil
}

// Stop sends a graceful shutdown request to the runner via its control
// socket. The runner will acknowledge the request and then initiate
// shutdown asynchronously. Returns nil on success (HTTP 200 with ok:true),
// or an error if the socket is unreachable or the request fails.
func Stop(socketPath string) error {
	client := newHTTPClient(socketPath)
	defer client.CloseIdleConnections()

	resp, err := client.Post("http://localhost/stop", "application/json", nil)
	if err != nil {
		return errors.Wrap(err, "control socket unreachable")
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("control socket returned HTTP %d for stop", resp.StatusCode)
	}

	var stopResp StopResponse
	if err := json.NewDecoder(resp.Body).Decode(&stopResp); err != nil {
		return errors.Wrap(err, "failed to decode stop response")
	}

	if !stopResp.OK {
		return fmt.Errorf("stop request was not accepted: %s", stopResp.Message)
	}

	return nil
}

// IsHealthy returns true if the runner's control socket is reachable
// and reports a healthy status. This is the primary replacement for
// PID-based liveness probing: a successful response proves the process
// is a Stigmer runner (not PID reuse), is responsive, and can report
// its identity.
func IsHealthy(socketPath string) bool {
	status, err := Ping(socketPath)
	if err != nil {
		return false
	}
	return status.OK
}
