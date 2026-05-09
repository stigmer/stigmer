package controlsock

import (
	"context"
	"encoding/json"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"time"

	"github.com/pkg/errors"
	"github.com/rs/zerolog/log"
)

// StateProvider is implemented by the runner to supply live status data
// to the control socket server. The implementation must be safe for
// concurrent calls from multiple HTTP handler goroutines.
type StateProvider interface {
	Status() StatusResponse
}

// Server is an HTTP server bound to a Unix domain socket that exposes
// runner status and accepts stop commands from other processes on the
// same machine. It follows the Docker/containerd pattern of HTTP over
// Unix socket, making it debuggable with curl:
//
//	curl --unix-socket ~/.stigmer/run/runner.sock http://localhost/status
type Server struct {
	socketPath string
	listener   net.Listener
	httpSrv    *http.Server
	state      StateProvider
	stopFn     context.CancelFunc
}

// NewServer creates a control socket server. The stopFn is called when
// a POST /stop request is received — it should cancel the runner's
// root context to initiate graceful shutdown.
func NewServer(socketPath string, state StateProvider, stopFn context.CancelFunc) *Server {
	s := &Server{
		socketPath: socketPath,
		state:      state,
		stopFn:     stopFn,
	}

	mux := http.NewServeMux()
	mux.HandleFunc("GET /status", s.handleStatus)
	mux.HandleFunc("POST /stop", s.handleStop)
	mux.HandleFunc("/", s.handleNotFound)

	s.httpSrv = &http.Server{
		Handler:      mux,
		ReadTimeout:  5 * time.Second,
		WriteTimeout: 5 * time.Second,
	}

	return s
}

// Start binds the Unix domain socket and begins serving requests.
// It creates the parent directory if needed, removes any stale socket
// file from a previous crash, and sets restrictive file permissions.
//
// Start returns once the listener is bound. HTTP serving happens in a
// background goroutine. Call Shutdown to stop the server and clean up.
func (s *Server) Start() error {
	dir := filepath.Dir(s.socketPath)
	if err := os.MkdirAll(dir, 0700); err != nil {
		return errors.Wrapf(err, "failed to create socket directory %s", dir)
	}

	// Remove stale socket from a previous crash. If the file doesn't
	// exist, that's fine. If it's a regular file or another process's
	// socket, removing it is still correct — our state file records
	// the socket path, so we own this location.
	if err := os.Remove(s.socketPath); err != nil && !os.IsNotExist(err) {
		return errors.Wrapf(err, "failed to remove stale socket at %s", s.socketPath)
	}

	ln, err := net.Listen("unix", s.socketPath)
	if err != nil {
		return errors.Wrapf(err, "failed to listen on %s", s.socketPath)
	}
	s.listener = ln

	if err := os.Chmod(s.socketPath, 0600); err != nil {
		ln.Close()
		return errors.Wrapf(err, "failed to set permissions on %s", s.socketPath)
	}

	go func() {
		if err := s.httpSrv.Serve(ln); err != nil && !errors.Is(err, http.ErrServerClosed) {
			log.Error().Err(err).Str("socket", s.socketPath).Msg("Control socket server error")
		}
	}()

	log.Debug().Str("socket", s.socketPath).Msg("Control socket server started")
	return nil
}

// SocketPath returns the path to the Unix domain socket.
func (s *Server) SocketPath() string {
	return s.socketPath
}

// Shutdown gracefully stops the HTTP server and removes the socket file.
func (s *Server) Shutdown(ctx context.Context) error {
	var firstErr error

	if err := s.httpSrv.Shutdown(ctx); err != nil {
		firstErr = errors.Wrap(err, "failed to shutdown control socket server")
	}

	if err := os.Remove(s.socketPath); err != nil && !os.IsNotExist(err) {
		if firstErr == nil {
			firstErr = errors.Wrapf(err, "failed to remove socket file %s", s.socketPath)
		}
	}

	log.Debug().Str("socket", s.socketPath).Msg("Control socket server stopped")
	return firstErr
}

func (s *Server) handleStatus(w http.ResponseWriter, _ *http.Request) {
	status := s.state.Status()
	writeJSON(w, http.StatusOK, &status)
}

func (s *Server) handleStop(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, &StopResponse{
		OK:      true,
		Message: "shutdown initiated",
	})

	// Cancel the runner's context after the response is flushed.
	// A small delay ensures the HTTP response reaches the client
	// before the server shuts down.
	go func() {
		time.Sleep(50 * time.Millisecond)
		s.stopFn()
	}()
}

func (s *Server) handleNotFound(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusNotFound, &ErrorResponse{
		OK:    false,
		Error: "unknown endpoint: " + r.Method + " " + r.URL.Path + " (available: GET /status, POST /stop)",
	})
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	enc := json.NewEncoder(w)
	enc.SetIndent("", "  ")
	if err := enc.Encode(v); err != nil {
		log.Error().Err(err).Msg("Failed to encode control socket response")
	}
}
