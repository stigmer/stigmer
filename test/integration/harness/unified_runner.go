package harness

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

// UnifiedRunnerConfig holds configuration for starting the unified runner.
type UnifiedRunnerConfig struct {
	StigmerServiceAddress string
	TemporalAddress       string
	LogDir                string

	// CursorAPIKey is optional. When absent, ExecuteCursor activities fail
	// with an expected API error — useful for offline dispatch verification.
	CursorAPIKey string

	// ProxyEndpoint routes Cursor SDK calls through the Java service proxy.
	ProxyEndpoint string

	// CloudAPIURL, when set, is passed as STIGMER_CLOUD_API_URL — the explicit
	// override for where the runner fetches the model registry (registry id ->
	// provider apiModelId resolution) and pricing. When unset, the runner falls
	// back to STIGMER_PROXY_ENDPOINT, then STIGMER_BACKEND_ENDPOINT (see
	// runner/src/shared/registry-endpoint.ts). Offline tests point it at the
	// MockLLMProxyServer, which serves /v1/proxy/model-registry, keeping the
	// registry source explicit rather than relying on the fallback chain.
	CloudAPIURL string

	// OTLPEndpoint enables OpenTelemetry tracing.
	OTLPEndpoint string

	// StigmerToken is an auth token passed to the runner as STIGMER_TOKEN.
	StigmerToken string

	// LocalArtifactDir, when non-empty, sets ARTIFACT_STORAGE_TYPE=local
	// with LOCAL_ARTIFACT_PATH pointing to this directory. Use this in
	// offline mode where ProxyEndpoint is a MockLLMProxy that does not
	// handle artifact presign endpoints.
	LocalArtifactDir string

	// LocalArtifactServeURL is set internally by StartUnifiedRunnerManager to
	// the address of the file server it starts over LocalArtifactDir; it is
	// threaded to the runner as LOCAL_ARTIFACT_SERVE_URL. Callers leave it
	// empty — see startArtifactFileServer for why the runner needs it.
	LocalArtifactServeURL string

	// LogLabel, when set, is woven into the manager's log filename so that
	// runners sharing a LogDir do not overwrite each other's logs. Without it,
	// every per-test manager writes the same unified-runner-manager.log and only
	// the last survives — useless when a mid-suite test fails. Typically t.Name().
	LogLabel string

	// ExtraEnv holds additional KEY=VALUE runner-process environment entries,
	// appended LAST (so they win over the defaults built here). Use it for the
	// occasional test that must tune runner behavior a dedicated config field does
	// not cover — e.g. STIGMER_PROGRESS_CAPTURE_MIN_INTERVAL_MS=0 to make mid-run
	// file_change_progress capture on every persist. Scoping the override to this
	// runner keeps it out of the shared process env (no os.Setenv leakage to other
	// tests) and legible at the call site.
	ExtraEnv []string
}

// UnifiedRunnerWorkspaceDir returns the WORKSPACE_ROOT_DIR the integration
// runner uses. The Cursor SDK persists its local SQLite state under
// {WorkspaceDir}/.stigmer/cursor-sdk-state/{sessionId}; tests that inspect or
// manipulate that state must derive the path from here.
func UnifiedRunnerWorkspaceDir() string {
	return filepath.Join(os.TempDir(), "stigmer-test-runner-workspace")
}

// --- IPC Protocol Types ---
// Hand-maintained Go mirror of the runner's IPC contract, kept honest by ipc_fixtures_test.go,
// which asserts these types against the golden fixtures generated from the canonical
// backend/services/runner/src/ipc-protocol.ts. Canonical spec and the rule for keeping mirrors
// in sync: backend/services/runner/docs/ipc-protocol.md.

type ipcCommand struct {
	Type        string  `json:"type"`
	SessionID   string  `json:"sessionId,omitempty"`
	ExecutionID string  `json:"executionId,omitempty"`
	Token       *string `json:"token,omitempty"`
}

type ipcResponse struct {
	Type            string `json:"type"`
	SessionID       string `json:"sessionId,omitempty"`
	ExecutionID     string `json:"executionId,omitempty"`
	TaskQueue       string `json:"taskQueue,omitempty"`
	Message         string `json:"message,omitempty"`
	Fatal           bool   `json:"fatal,omitempty"`
	ProtocolVersion int    `json:"protocolVersion,omitempty"`
}

// --- UnifiedRunnerManager (IPC manager mode) ---

// UnifiedRunnerManager manages the unified runner process in IPC manager mode,
// communicating via newline-delimited JSON on stdin/stdout.
type UnifiedRunnerManager struct {
	cmd             *exec.Cmd
	stdin           io.WriteCloser
	scanner         *bufio.Scanner
	logFile         *os.File
	logPath         string
	logger          *slog.Logger
	mu              sync.Mutex
	protocolVersion int
	// artifactServer serves LocalArtifactDir over HTTP for the CAS reconcile's
	// read path (nil when no local artifact dir is configured). Torn down by Stop.
	artifactServer *artifactFileServer
	// localArtifactDir is the on-disk root the runner writes CAS/offloaded blobs
	// into (empty when no local artifact dir is configured). Exposed so tests can
	// assert on what did — or must never — reach durable storage.
	localArtifactDir string
}

// LogPath returns the path to the runner's stderr log file.
func (m *UnifiedRunnerManager) LogPath() string {
	return m.logPath
}

// LocalArtifactDir returns the on-disk root the runner writes CAS/offloaded
// blobs into, or "" when no local artifact dir was configured.
func (m *UnifiedRunnerManager) LocalArtifactDir() string {
	return m.localArtifactDir
}

// ProtocolVersion returns the IPC protocol version the runner advertised in its `ready`
// handshake. A pre-versioned runner that omits the field reports 0.
func (m *UnifiedRunnerManager) ProtocolVersion() int {
	return m.protocolVersion
}

// StartUnifiedRunnerManager starts the unified runner in IPC manager mode
// and waits for the {"type":"ready"} response.
func StartUnifiedRunnerManager(ctx context.Context, cfg UnifiedRunnerConfig, logger *slog.Logger) (*UnifiedRunnerManager, error) {
	if logger == nil {
		logger = slog.New(slog.NewTextHandler(os.Stderr, &slog.HandlerOptions{Level: slog.LevelInfo}))
	}

	runnerDir := findUnifiedRunnerDir()
	if runnerDir == "" {
		return nil, fmt.Errorf("unified runner source directory not found")
	}

	// Use the same resolution logic as static mode: prefer pre-built
	// dist/main.js (avoids Temporal webpack bundler failures with raw .ts
	// proto stubs), fall back to tsx for development convenience.
	runBin, entrypoint, resolveErr := resolveRunnerCommand(runnerDir)
	if resolveErr != nil {
		return nil, resolveErr
	}

	logDir := cfg.LogDir
	if logDir == "" {
		var mkErr error
		logDir, mkErr = os.MkdirTemp("", "stigmer-unified-runner-*")
		if mkErr != nil {
			return nil, fmt.Errorf("create log dir: %w", mkErr)
		}
	}
	logName := "unified-runner-manager.log"
	if cfg.LogLabel != "" {
		logName = fmt.Sprintf("unified-runner-manager-%s.log", sanitizeLabel(cfg.LogLabel))
	}
	logPath := filepath.Join(logDir, logName)
	logFile, err := os.Create(logPath)
	if err != nil {
		return nil, fmt.Errorf("create log file: %w", err)
	}
	logger.Info("unified-runner-manager log", "path", logPath)

	// Serve the runner's local artifact dir so the CAS reconcile's
	// getDownloadUrl+fetch read path resolves offline (mirrors the control
	// plane's file server). Closed on any early-return failure via `started`.
	var artifactServer *artifactFileServer
	started := false
	if cfg.LocalArtifactDir != "" {
		artifactServer, err = startArtifactFileServer(cfg.LocalArtifactDir)
		if err != nil {
			logFile.Close()
			return nil, err
		}
		defer func() {
			if !started {
				artifactServer.Close()
			}
		}()
		cfg.LocalArtifactServeURL = artifactServer.url
		logger.Info("artifact file server", "url", artifactServer.url, "dir", cfg.LocalArtifactDir)
	}

	cmd := exec.Command(runBin, entrypoint)
	cmd.Dir = runnerDir
	cmd.Env = buildUnifiedRunnerEnv(cfg, "manager", "")
	cmd.Stderr = logFile

	stdin, err := cmd.StdinPipe()
	if err != nil {
		logFile.Close()
		return nil, fmt.Errorf("create stdin pipe: %w", err)
	}

	stdout, err := cmd.StdoutPipe()
	if err != nil {
		logFile.Close()
		return nil, fmt.Errorf("create stdout pipe: %w", err)
	}

	logger.Info("starting unified-runner-manager",
		"bin", runBin,
		"entrypoint", entrypoint,
		"dir", runnerDir,
		"temporal", cfg.TemporalAddress,
		"stigmer_endpoint", cfg.StigmerServiceAddress,
	)

	if err := cmd.Start(); err != nil {
		logFile.Close()
		return nil, fmt.Errorf("start unified-runner-manager: %w", err)
	}

	scanner := bufio.NewScanner(stdout)

	mgr := &UnifiedRunnerManager{
		cmd:              cmd,
		stdin:            stdin,
		scanner:          scanner,
		logFile:          logFile,
		logPath:          logPath,
		logger:           logger,
		artifactServer:   artifactServer,
		localArtifactDir: cfg.LocalArtifactDir,
	}

	resp, err := mgr.readResponse(ctx, 30*time.Second)
	if err != nil {
		_ = cmd.Process.Kill()
		logFile.Close()
		return nil, fmt.Errorf("unified-runner-manager did not become ready: %w", err)
	}
	if resp.Type == "error" {
		_ = cmd.Process.Kill()
		logFile.Close()
		return nil, fmt.Errorf("unified-runner-manager startup error: %s", resp.Message)
	}
	if resp.Type != "ready" {
		_ = cmd.Process.Kill()
		logFile.Close()
		return nil, fmt.Errorf("unexpected first IPC response: %s", resp.Type)
	}
	mgr.protocolVersion = resp.ProtocolVersion

	logger.Info("unified-runner-manager ready", "pid", cmd.Process.Pid, "protocol_version", resp.ProtocolVersion)
	started = true
	return mgr, nil
}

// AddSession sends an addSession IPC command and waits for confirmation.
func (m *UnifiedRunnerManager) AddSession(ctx context.Context, sessionID string) (string, error) {
	m.mu.Lock()
	defer m.mu.Unlock()

	if err := m.sendCommand(ipcCommand{Type: "addSession", SessionID: sessionID}); err != nil {
		return "", fmt.Errorf("send addSession: %w", err)
	}

	resp, err := m.readResponse(ctx, 30*time.Second)
	if err != nil {
		return "", fmt.Errorf("addSession response: %w", err)
	}
	if resp.Type == "error" {
		return "", fmt.Errorf("addSession error: %s", resp.Message)
	}
	if resp.Type != "sessionAdded" {
		return "", fmt.Errorf("unexpected addSession response: %s", resp.Type)
	}

	m.logger.Info("session added", "session_id", sessionID, "task_queue", resp.TaskQueue)
	return resp.TaskQueue, nil
}

// RemoveSession sends a removeSession IPC command and waits for confirmation.
func (m *UnifiedRunnerManager) RemoveSession(ctx context.Context, sessionID string) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	if err := m.sendCommand(ipcCommand{Type: "removeSession", SessionID: sessionID}); err != nil {
		return fmt.Errorf("send removeSession: %w", err)
	}

	resp, err := m.readResponse(ctx, 10*time.Second)
	if err != nil {
		return fmt.Errorf("removeSession response: %w", err)
	}
	if resp.Type == "error" {
		return fmt.Errorf("removeSession error: %s", resp.Message)
	}
	if resp.Type != "sessionRemoved" {
		return fmt.Errorf("unexpected removeSession response: %s", resp.Type)
	}

	m.logger.Info("session removed", "session_id", sessionID)
	return nil
}

// AddWorkflowExecution sends an addWorkflowExecution IPC command and waits for confirmation.
func (m *UnifiedRunnerManager) AddWorkflowExecution(ctx context.Context, executionID string) (string, error) {
	m.mu.Lock()
	defer m.mu.Unlock()

	if err := m.sendCommand(ipcCommand{Type: "addWorkflowExecution", ExecutionID: executionID}); err != nil {
		return "", fmt.Errorf("send addWorkflowExecution: %w", err)
	}

	resp, err := m.readResponse(ctx, 30*time.Second)
	if err != nil {
		return "", fmt.Errorf("addWorkflowExecution response: %w", err)
	}
	if resp.Type == "error" {
		return "", fmt.Errorf("addWorkflowExecution error: %s", resp.Message)
	}
	if resp.Type != "workflowExecutionAdded" {
		return "", fmt.Errorf("unexpected addWorkflowExecution response: %s", resp.Type)
	}

	m.logger.Info("workflow execution added", "execution_id", executionID, "task_queue", resp.TaskQueue)
	return resp.TaskQueue, nil
}

// RemoveWorkflowExecution sends a removeWorkflowExecution IPC command and waits for confirmation.
func (m *UnifiedRunnerManager) RemoveWorkflowExecution(ctx context.Context, executionID string) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	if err := m.sendCommand(ipcCommand{Type: "removeWorkflowExecution", ExecutionID: executionID}); err != nil {
		return fmt.Errorf("send removeWorkflowExecution: %w", err)
	}

	resp, err := m.readResponse(ctx, 60*time.Second)
	if err != nil {
		return fmt.Errorf("removeWorkflowExecution response: %w", err)
	}
	if resp.Type == "error" {
		return fmt.Errorf("removeWorkflowExecution error: %s", resp.Message)
	}
	if resp.Type != "workflowExecutionRemoved" {
		return fmt.Errorf("unexpected removeWorkflowExecution response: %s", resp.Type)
	}

	m.logger.Info("workflow execution removed", "execution_id", executionID)
	return nil
}

// UpdateToken sends an updateToken IPC command and waits for confirmation.
func (m *UnifiedRunnerManager) UpdateToken(ctx context.Context, token *string) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	if err := m.sendCommand(ipcCommand{Type: "updateToken", Token: token}); err != nil {
		return fmt.Errorf("send updateToken: %w", err)
	}

	resp, err := m.readResponse(ctx, 10*time.Second)
	if err != nil {
		return fmt.Errorf("updateToken response: %w", err)
	}
	if resp.Type == "error" {
		return fmt.Errorf("updateToken error: %s", resp.Message)
	}
	if resp.Type != "tokenUpdated" {
		return fmt.Errorf("unexpected updateToken response: %s", resp.Type)
	}

	m.logger.Info("token updated")
	return nil
}

// Stop sends a shutdown command, waits for the runner to drain its workers
// gracefully (the shutdownComplete reply), then terminates the process.
//
// The Node runtime frequently keeps its event loop alive after Temporal
// workers drain (lingering SDK/gRPC handles), so waiting for the process to
// exit on its own burns the full timeout — ~10s per call, which dominated the
// offline suite runtime. The worker drain is the only part that matters for
// clean Temporal deregistration and finishes in well under a second, so we
// wait briefly for shutdownComplete and then kill the lingering process.
func (m *UnifiedRunnerManager) Stop() error {
	if m.cmd == nil || m.cmd.Process == nil {
		return nil
	}
	m.logger.Info("stopping unified-runner-manager")

	m.mu.Lock()
	if err := m.sendCommand(ipcCommand{Type: "shutdown"}); err == nil {
		_, _ = m.readResponse(context.Background(), 3*time.Second)
	}
	m.mu.Unlock()

	_ = m.cmd.Process.Kill()

	done := make(chan error, 1)
	go func() { done <- m.cmd.Wait() }()
	select {
	case <-time.After(5 * time.Second):
	case <-done:
	}

	m.artifactServer.Close()

	if m.logFile != nil {
		m.logFile.Close()
	}
	return nil
}

func (m *UnifiedRunnerManager) sendCommand(cmd ipcCommand) error {
	data, err := json.Marshal(cmd)
	if err != nil {
		return err
	}
	_, err = fmt.Fprintf(m.stdin, "%s\n", data)
	return err
}

func (m *UnifiedRunnerManager) readResponse(ctx context.Context, timeout time.Duration) (ipcResponse, error) {
	type result struct {
		resp ipcResponse
		err  error
	}
	ch := make(chan result, 1)
	go func() {
		if m.scanner.Scan() {
			var resp ipcResponse
			if err := json.Unmarshal(m.scanner.Bytes(), &resp); err != nil {
				ch <- result{err: fmt.Errorf("unmarshal IPC response: %w", err)}
				return
			}
			ch <- result{resp: resp}
		} else {
			err := m.scanner.Err()
			if err == nil {
				err = fmt.Errorf("runner stdout closed (process may have exited)")
			}
			ch <- result{err: err}
		}
	}()

	select {
	case <-ctx.Done():
		return ipcResponse{}, ctx.Err()
	case <-time.After(timeout):
		return ipcResponse{}, fmt.Errorf("IPC response timeout after %v", timeout)
	case r := <-ch:
		return r.resp, r.err
	}
}

// --- UnifiedRunnerStatic (single-queue static mode) ---

// UnifiedRunnerStatic manages the unified runner in static mode, polling
// a single task queue. Used to simulate a sandbox runner for cloud tests.
type UnifiedRunnerStatic struct {
	cmd       *exec.Cmd
	logFile   *os.File
	logPath   string
	logger    *slog.Logger
	cfg       UnifiedRunnerConfig
	taskQueue string
}

// LogPath returns the path to the runner's log file.
func (r *UnifiedRunnerStatic) LogPath() string {
	return r.logPath
}

// Cfg returns the configuration this runner was started with. Useful for
// tests that stop the shared runner and start an equivalent (or modified)
// one on the same queue, then restore the original on cleanup.
func (r *UnifiedRunnerStatic) Cfg() UnifiedRunnerConfig {
	return r.cfg
}

// TaskQueue returns the queue this runner polls.
func (r *UnifiedRunnerStatic) TaskQueue() string {
	return r.taskQueue
}

// StartUnifiedRunnerStatic starts the unified runner in static mode, polling
// the specified task queue. The runner connects to Temporal and begins
// polling immediately.
func StartUnifiedRunnerStatic(ctx context.Context, cfg UnifiedRunnerConfig, taskQueue string, logger *slog.Logger) (*UnifiedRunnerStatic, error) {
	if logger == nil {
		logger = slog.New(slog.NewTextHandler(os.Stderr, &slog.HandlerOptions{Level: slog.LevelInfo}))
	}

	runnerDir := findUnifiedRunnerDir()
	if runnerDir == "" {
		return nil, fmt.Errorf("unified runner source directory not found")
	}

	runBin, entrypoint, resolveErr := resolveRunnerCommand(runnerDir)
	if resolveErr != nil {
		return nil, resolveErr
	}

	logDir := cfg.LogDir
	if logDir == "" {
		var mkErr error
		logDir, mkErr = os.MkdirTemp("", "stigmer-unified-runner-*")
		if mkErr != nil {
			return nil, fmt.Errorf("create log dir: %w", mkErr)
		}
	}
	logPath := filepath.Join(logDir, fmt.Sprintf("unified-runner-static-%s.log", taskQueue))
	logFile, err := os.Create(logPath)
	if err != nil {
		return nil, fmt.Errorf("create log file: %w", err)
	}
	logger.Info("unified-runner-static log", "path", logPath, "task_queue", taskQueue)

	cmd := exec.Command(runBin, entrypoint)
	cmd.Dir = runnerDir
	cmd.Env = buildUnifiedRunnerEnv(cfg, "static", taskQueue)
	cmd.Stdout = logFile
	cmd.Stderr = logFile

	logger.Info("starting unified-runner-static",
		"bin", runBin,
		"entrypoint", entrypoint,
		"dir", runnerDir,
		"task_queue", taskQueue,
		"temporal", cfg.TemporalAddress,
	)

	if err := cmd.Start(); err != nil {
		logFile.Close()
		return nil, fmt.Errorf("start unified-runner-static: %w", err)
	}

	// Give Temporal worker time to connect and register.
	time.Sleep(5 * time.Second)

	if cmd.ProcessState != nil && cmd.ProcessState.Exited() {
		logFile.Sync()
		if logBytes, readErr := os.ReadFile(logPath); readErr == nil {
			lines := string(logBytes)
			if len(lines) > 2000 {
				lines = lines[len(lines)-2000:]
			}
			logger.Error("unified-runner-static exited prematurely", "last_log", lines)
		}
		logFile.Close()
		return nil, fmt.Errorf("unified-runner-static exited during startup")
	}

	logger.Info("unified-runner-static started", "pid", cmd.Process.Pid, "task_queue", taskQueue)
	return &UnifiedRunnerStatic{
		cmd:       cmd,
		logFile:   logFile,
		logPath:   logPath,
		logger:    logger,
		cfg:       cfg,
		taskQueue: taskQueue,
	}, nil
}

func (r *UnifiedRunnerStatic) Stop() error {
	if r.cmd == nil || r.cmd.Process == nil {
		return nil
	}
	r.logger.Info("stopping unified-runner-static")
	err := r.cmd.Process.Kill()
	if r.logFile != nil {
		r.logFile.Close()
	}
	return err
}

// --- Shared helpers ---

func findUnifiedRunnerDir() string {
	candidates := []string{
		"../../../../backend/services/runner",
		"../../backend/services/runner",
	}
	for _, c := range candidates {
		abs, err := filepath.Abs(c)
		if err != nil {
			continue
		}
		pkgJSON := filepath.Join(abs, "package.json")
		if _, err := os.Stat(pkgJSON); err == nil {
			return abs
		}
	}

	if envPath := os.Getenv("UNIFIED_RUNNER_DIR"); envPath != "" {
		return envPath
	}

	return ""
}

// resolveRunnerCommand determines the best way to launch the runner:
// - If dist/main.js exists (pre-built), uses "node dist/main.js" for production-like behavior
// - Otherwise, falls back to "tsx src/main.ts" for development convenience
func resolveRunnerCommand(runnerDir string) (bin string, entrypoint string, err error) {
	distEntry := filepath.Join(runnerDir, "dist", "main.js")
	if _, statErr := os.Stat(distEntry); statErr == nil {
		nodeBin, lookErr := exec.LookPath("node")
		if lookErr == nil {
			return nodeBin, distEntry, nil
		}
	}

	tsxBin := filepath.Join(runnerDir, "node_modules", ".bin", "tsx")
	if _, statErr := os.Stat(tsxBin); statErr != nil {
		return "", "", fmt.Errorf("tsx not found at %s — run 'npm install' in runner", tsxBin)
	}
	return tsxBin, filepath.Join(runnerDir, "src", "main.ts"), nil
}

// artifactFileServer serves a runner's local artifact directory over HTTP so
// the CAS reconcile's read path (casBlobReader → getDownloadUrl → fetch)
// resolves in offline tests — the harness twin of the control-plane file
// server (stigmer-server server.go).
//
// Mapping: LocalArtifactStorage writes each blob to join(dir, key) and resolves
// its download URL to {serveURL}/{key}, so serving `dir` at "/" makes a GET of
// /{key} map straight back to join(dir, key). This is the exact shape proven by
// the cas-substrate unit test's real-serve-path case.
type artifactFileServer struct {
	server *http.Server
	url    string
}

func startArtifactFileServer(dir string) (*artifactFileServer, error) {
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		return nil, fmt.Errorf("listen for artifact file server: %w", err)
	}
	srv := &http.Server{Handler: http.FileServer(http.Dir(dir))}
	go func() { _ = srv.Serve(ln) }()
	return &artifactFileServer{
		server: srv,
		url:    fmt.Sprintf("http://%s", ln.Addr().String()),
	}, nil
}

// Close shuts the server down; safe on a nil receiver (no local artifact dir).
func (a *artifactFileServer) Close() {
	if a == nil || a.server == nil {
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	_ = a.server.Shutdown(ctx)
}

func buildUnifiedRunnerEnv(cfg UnifiedRunnerConfig, mode, taskQueue string) []string {
	wsDir := UnifiedRunnerWorkspaceDir()
	_ = os.MkdirAll(wsDir, 0o755)

	env := os.Environ()

	env = append(env,
		fmt.Sprintf("STIGMER_BACKEND_ENDPOINT=http://%s", cfg.StigmerServiceAddress),
		"STIGMER_API_KEY=test-integration-key",

		fmt.Sprintf("TEMPORAL_SERVICE_ADDRESS=%s", cfg.TemporalAddress),
		"TEMPORAL_NAMESPACE=default",

		"MODE=local",

		fmt.Sprintf("WORKSPACE_ROOT_DIR=%s", wsDir),

		"LOG_LEVEL=INFO",

		fmt.Sprintf("STIGMER_SERVER_ADDRESS=%s", cfg.StigmerServiceAddress),

		"SKIP_MCP_CONNECT_BACKFILL=true",

		// Sentinels for the stdio env-isolation guard (oss#256): the runner
		// process carries these, and mcp_stdio_env_isolation_test.go asserts
		// that a stdio MCP subprocess does NOT. STIGMER_RUNNER_HITL_SECRET is
		// the real credential name (a stable value is a supported runner
		// config); the second is a neutral canary nothing else reads.
		"STIGMER_RUNNER_HITL_SECRET=integration-hitl-fingerprint-key",
		"STIGMER_TEST_LEAK_SENTINEL=leak-canary",
	)

	if mode == "manager" {
		env = append(env, "STIGMER_RUNNER_MODE=manager")
	} else if taskQueue != "" {
		env = append(env, fmt.Sprintf("STIGMER_TASK_QUEUE=%s", taskQueue))
	}

	if cfg.StigmerToken != "" {
		env = append(env, fmt.Sprintf("STIGMER_TOKEN=%s", cfg.StigmerToken))
	}

	if cfg.CloudAPIURL != "" {
		env = append(env, fmt.Sprintf("STIGMER_CLOUD_API_URL=%s", cfg.CloudAPIURL))
	}

	if cfg.ProxyEndpoint != "" {
		runnerJWT, err := MintRunnerToken()
		if err != nil {
			runnerJWT = "test-integration-key"
		}
		env = append(env,
			fmt.Sprintf("STIGMER_PROXY_ENDPOINT=%s", cfg.ProxyEndpoint),
			fmt.Sprintf("STIGMER_TOKEN=%s", runnerJWT),
		)
		if strings.HasPrefix(cfg.ProxyEndpoint, "https://") {
			env = append(env, "NODE_TLS_REJECT_UNAUTHORIZED=0")
		}
		if cfg.LocalArtifactDir != "" {
			env = append(env,
				"ARTIFACT_STORAGE_TYPE=local",
				fmt.Sprintf("LOCAL_ARTIFACT_PATH=%s", cfg.LocalArtifactDir),
			)
			// Point the runner's blob reader at the harness file server so the
			// CAS reconcile's getDownloadUrl+fetch resolves (default is :7235,
			// which nothing serves in-test).
			if cfg.LocalArtifactServeURL != "" {
				env = append(env, fmt.Sprintf("LOCAL_ARTIFACT_SERVE_URL=%s", cfg.LocalArtifactServeURL))
			}
		} else {
			env = append(env, "ARTIFACT_STORAGE_TYPE=proxy")
		}
	} else if cfg.CursorAPIKey != "" {
		env = append(env, fmt.Sprintf("CURSOR_API_KEY=%s", cfg.CursorAPIKey))
	}

	if cfg.OTLPEndpoint != "" {
		env = append(env, fmt.Sprintf("OTEL_EXPORTER_OTLP_ENDPOINT=%s", cfg.OTLPEndpoint))
	}

	if os.Getenv("ANTHROPIC_API_KEY") == "" && os.Getenv("CURSOR_API_KEY") == "" {
		env = append(env, "STIGMER_LLM_REQUEST_TIMEOUT_MS=5000")
	}

	// Caller-supplied overrides go last so a test can tune runner behavior beyond
	// the dedicated config fields (see UnifiedRunnerConfig.ExtraEnv).
	env = append(env, cfg.ExtraEnv...)

	return env
}
