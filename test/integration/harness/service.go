package harness

import (
	"context"
	"fmt"
	"log/slog"
	"os"
	"os/exec"
	"path/filepath"
	"time"
)

// JavaService manages the stigmer-service fat JAR as a child process.
type JavaService struct {
	cmd      *exec.Cmd
	GRPCPort string
	HTTPPort string
	logFile  *os.File
	logPath  string
	logger   *slog.Logger
}

// LogPath returns the path to the service log file.
func (s *JavaService) LogPath() string {
	return s.logPath
}

// ServiceConfig holds the addresses of infrastructure that the Java
// service needs to connect to.
type ServiceConfig struct {
	JarPath         string
	MongoHost       string
	MongoPort       string
	RedisHost       string
	RedisPort       string
	TemporalAddress string
	GRPCPort        string
	HTTPPort        string

	// AnthropicAPIKey is passed to the Java service as the LLM proxy's
	// upstream Anthropic key. When set, the proxy can forward runner
	// LLM calls to Anthropic and record per-call usage for billing.
	AnthropicAPIKey string

	// CursorAPIKey is passed to the Java service as the Cursor proxy's
	// upstream API key. When set, the CursorProxyController can forward
	// cursor-runner requests to Cursor's API and record per-call usage.
	CursorAPIKey string

	// OpenFGA configuration. When all three are set, the Java service
	// uses a real OpenFGA instance for authorization instead of the
	// permit-all TestIamPolicyGrpcRepo stub.
	OpenFGAAPIURL string
	OpenFGAStoreID string
	OpenFGAModelID string

	// LogDir is the directory for the service log file.
	// If empty, a temporary directory is used.
	LogDir string
}

// StartJavaService launches the stigmer-service fat JAR as a child process
// with environment variables pointing to the test infrastructure.
func StartJavaService(ctx context.Context, cfg ServiceConfig, logger *slog.Logger) (*JavaService, error) {
	if logger == nil {
		logger = slog.New(slog.NewTextHandler(os.Stderr, &slog.HandlerOptions{Level: slog.LevelInfo}))
	}
	if cfg.GRPCPort == "" {
		p, err := freePort()
		if err != nil {
			return nil, fmt.Errorf("allocate grpc port: %w", err)
		}
		cfg.GRPCPort = fmt.Sprintf("%d", p)
	}
	if cfg.HTTPPort == "" {
		p, err := freePort()
		if err != nil {
			return nil, fmt.Errorf("allocate http port: %w", err)
		}
		cfg.HTTPPort = fmt.Sprintf("%d", p)
	}

	logDir := cfg.LogDir
	if logDir == "" {
		var mkErr error
		logDir, mkErr = os.MkdirTemp("", "stigmer-integration-test-*")
		if mkErr != nil {
			return nil, fmt.Errorf("create log dir: %w", mkErr)
		}
	}
	logPath := filepath.Join(logDir, "stigmer-service.log")
	logFile, err := os.Create(logPath)
	if err != nil {
		return nil, fmt.Errorf("create log file: %w", err)
	}
	logger.Info("service log", "path", logPath)

	// Use exec.Command (not CommandContext) so the Java process lifetime
	// is decoupled from the startup context. The caller's context governs
	// the port-readiness wait, but the service runs until Stop() is called.
	// Previously, CommandContext tied the JVM to a 5-minute TestMain deadline,
	// which silently killed the process during long-running tests.
	cmd := exec.Command("java", "-jar", cfg.JarPath)
	cmd.Env = buildServiceEnv(cfg)
	cmd.Stdout = logFile
	cmd.Stderr = logFile

	logger.Info("starting stigmer-service",
		"jar", cfg.JarPath,
		"grpc_port", cfg.GRPCPort,
		"http_port", cfg.HTTPPort,
		"mongo", fmt.Sprintf("%s:%s", cfg.MongoHost, cfg.MongoPort),
		"temporal", cfg.TemporalAddress,
	)

	if err := cmd.Start(); err != nil {
		logFile.Close()
		return nil, fmt.Errorf("start java service: %w", err)
	}

	// Monitor for early process exit in a goroutine
	exitCh := make(chan error, 1)
	go func() {
		exitCh <- cmd.Wait()
	}()

	grpcAddr := fmt.Sprintf("127.0.0.1:%s", cfg.GRPCPort)
	if err := waitForPortOrExit(ctx, grpcAddr, 120*time.Second, exitCh); err != nil {
		_ = cmd.Process.Kill()
		// Read last lines of log for diagnostics
		logFile.Sync()
		if logBytes, readErr := os.ReadFile(logPath); readErr == nil {
			lines := string(logBytes)
			if len(lines) > 2000 {
				lines = lines[len(lines)-2000:]
			}
			logger.Error("java service failed to start", "error", err, "last_log", lines)
		}
		logFile.Close()
		return nil, fmt.Errorf("java service gRPC port not ready: %w", err)
	}

	logger.Info("stigmer-service ready",
		"grpc", grpcAddr,
		"log", logFile.Name(),
	)

	return &JavaService{
		cmd:      cmd,
		GRPCPort: cfg.GRPCPort,
		HTTPPort: cfg.HTTPPort,
		logFile:  logFile,
		logPath:  logPath,
		logger:   logger,
	}, nil
}

func (s *JavaService) GRPCAddress() string {
	return fmt.Sprintf("127.0.0.1:%s", s.GRPCPort)
}

func (s *JavaService) HTTPAddress() string {
	return fmt.Sprintf("http://127.0.0.1:%s", s.HTTPPort)
}

func (s *JavaService) Stop() error {
	if s.cmd == nil || s.cmd.Process == nil {
		return nil
	}
	s.logger.Info("stopping stigmer-service")
	err := s.cmd.Process.Kill()
	if s.logFile != nil {
		s.logFile.Close()
	}
	return err
}

func buildServiceEnv(cfg ServiceConfig) []string {
	fgaEnabled := cfg.OpenFGAAPIURL != "" && cfg.OpenFGAStoreID != "" && cfg.OpenFGAModelID != ""

	profiles := "mongo,temporal,iam,logging,auth0,skill-r2,agent-execution-r2"
	if fgaEnabled {
		profiles += ",openfga"
	}

	env := os.Environ()
	env = append(env,
		// Spring profiles: auth0 profile provides security.authentication.* property bindings;
		// GrpcSecurityConfigBase and MachineAccountJwtProvider are skipped via
		// stigmer.security.mode=test, so no OIDC discovery call is made.
		// The openfga profile is added when real FGA is enabled.
		fmt.Sprintf("SPRING_PROFILES_ACTIVE=%s", profiles),

		// Test security mode: bypass Auth0 JWT validation but keep gRPC/HTTP
		// pipeline intact. When fga.enabled=true, the production FGA path
		// (IamPolicyGrpcRepoImpl → OpenFGA) is used instead of the permit-all stub.
		"STIGMER_SECURITY_MODE=test",

		// Server ports
		fmt.Sprintf("SERVER_PORT=%s", cfg.HTTPPort),
		fmt.Sprintf("GRPC_SERVER_PORT=%s", cfg.GRPCPort),

		// MongoDB (Testcontainers — no auth)
		fmt.Sprintf("SPRING_DATA_MONGODB_URI=mongodb://%s:%s/stigmer_test", cfg.MongoHost, cfg.MongoPort),
		"MONGO_DB_HOST=unused",
		"MONGO_DB_PORT=27017",
		"MONGO_DB_USERNAME=unused",
		"MONGO_DB_PASSWORD=unused",
		"MONGO_DB_NAME=stigmer_test",
		"MONGO_DB_AUTH_DATABASE=admin",
		"MONGO_TRANSACTIONS_ENABLED=false",

		// Redis (Testcontainers — no auth)
		fmt.Sprintf("REDIS_HOST=%s", cfg.RedisHost),
		fmt.Sprintf("REDIS_PORT=%s", cfg.RedisPort),
		"REDIS_PASSWORD=unused",

		// Temporal (dev server)
		fmt.Sprintf("TEMPORAL_SERVICE_ADDRESS=%s", cfg.TemporalAddress),
		"TEMPORAL_NAMESPACE=default",

		// Machine account domain (required by iam profile)
		"MACHINE_ACCOUNT_EMAIL_DOMAIN=test.machineaccount.stigmer.ai",

		// R2/S3 dummy config (beans created but not called during tests)
		"SKILL_ARTIFACT_R2_BUCKET=test-bucket",
		"SKILL_ARTIFACT_R2_ENDPOINT=http://localhost:19999",
		"SKILL_ARTIFACT_R2_ACCESS_KEY_ID=test",
		"SKILL_ARTIFACT_R2_SECRET_ACCESS_KEY=test",
		"AGENT_EXECUTION_ARTIFACT_R2_BUCKET=test-bucket",
		"AGENT_EXECUTION_ARTIFACT_R2_ENDPOINT=http://localhost:19999",
		"AGENT_EXECUTION_ARTIFACT_R2_ACCESS_KEY_ID=test",
		"AGENT_EXECUTION_ARTIFACT_R2_SECRET_ACCESS_KEY=test",

		// Claim check R2 dummy config (beans created but not called during tests)
		"CLAIMCHECK_R2_BUCKET=test-claimcheck-bucket",
		"CLAIMCHECK_R2_ENDPOINT=http://localhost:19999",
		"CLAIMCHECK_R2_ACCESS_KEY_ID=test",
		"CLAIMCHECK_R2_SECRET_ACCESS_KEY=test",

		// Auth0 dummy values (required by property resolution even in test mode)
		"AUTH0_DOMAIN=test.auth0.com",
		"AUTH0_CLIENT_ID=test-client-id",
		"AUTH0_CLIENT_SECRET=test-client-secret",
		"AUTH0_API_AUDIENCE=test-audience",

		// Stripe (dummy key to satisfy ConditionalOnProperty — never called)
		"STIGMER_STRIPE_SECRET_KEY=sk_test_integration_dummy",
		"STIGMER_STRIPE_WEBHOOK_SECRET=whsec_test_dummy",

		// Disable optional features
		"STIGMER_VAULT_ENABLED=false",
		"OBSERVABILITY_ENABLED=false",
		"STIGMER_BILLING_RECONCILIATION_ENABLED=false",
		"STIGMER_BILLING_RESERVATION_EXPIRY_ENABLED=false",
		"STIGMER_RUNNER_LAUNCHER_TYPE=noop",

		// Allow proxy requests without FGA scope headers. Runners may
		// issue metadata requests (e.g. /v1/models) before execution
		// scope is set. This remains false even with real FGA — the
		// proxy scope headers are tested separately.
		"STIGMER_PROXY_REQUIRE_SCOPE_HEADER=false",
	)

	if fgaEnabled {
		env = append(env,
			"STIGMER_FGA_ENABLED=true",
			fmt.Sprintf("OPENFGA_API_URL=%s", cfg.OpenFGAAPIURL),
			fmt.Sprintf("OPENFGA_STORE_ID=%s", cfg.OpenFGAStoreID),
			fmt.Sprintf("OPENFGA_MODEL_ID=%s", cfg.OpenFGAModelID),
		)
	}

	if cfg.AnthropicAPIKey != "" {
		env = append(env,
			fmt.Sprintf("STIGMER_PROXY_ANTHROPIC_API_KEY=%s", cfg.AnthropicAPIKey),
		)
	}

	if cfg.CursorAPIKey != "" {
		env = append(env,
			fmt.Sprintf("STIGMER_PROXY_CURSOR_API_KEY=%s", cfg.CursorAPIKey),
		)
	}

	return env
}
