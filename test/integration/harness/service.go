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
	logger   *slog.Logger
}

// ServiceConfig holds the addresses of infrastructure that the Java
// service needs to connect to.
type ServiceConfig struct {
	JarPath          string
	MongoHost        string
	MongoPort        string
	RedisHost        string
	RedisPort        string
	TemporalAddress  string
	GRPCPort         string
	HTTPPort         string
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

	logDir, err := os.MkdirTemp("", "stigmer-integration-test-*")
	if err != nil {
		return nil, fmt.Errorf("create log dir: %w", err)
	}
	logPath := filepath.Join(logDir, "stigmer-service.log")
	logFile, err := os.Create(logPath)
	if err != nil {
		return nil, fmt.Errorf("create log file: %w", err)
	}
	logger.Info("service log", "path", logPath)

	cmd := exec.CommandContext(ctx, "java", "-jar", cfg.JarPath)
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
		logger:   logger,
	}, nil
}

func (s *JavaService) GRPCAddress() string {
	return fmt.Sprintf("127.0.0.1:%s", s.GRPCPort)
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
	env := os.Environ()
	env = append(env,
		// Spring profiles: auth0 profile provides security.authentication.* property bindings;
		// GrpcSecurityConfigBase and MachineAccountJwtProvider are skipped via
		// stigmer.security.mode=test, so no OIDC discovery call is made.
		"SPRING_PROFILES_ACTIVE=mongo,temporal,iam,logging,auth0,skill-r2,agent-execution-r2",

		// Test security mode: bypass Auth0/OpenFGA
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
	)
	return env
}
