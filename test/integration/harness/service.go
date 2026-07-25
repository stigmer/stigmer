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

// FindServiceJar locates the stigmer-service fat JAR. It checks the
// STIGMER_SERVICE_JAR env var first, then falls back to the default
// sibling-repo Bazel output path relative to the caller's working directory.
func FindServiceJar() string {
	if jar := os.Getenv("STIGMER_SERVICE_JAR"); jar != "" {
		return jar
	}
	candidates := []string{
		"../../../stigmer-cloud/bazel-bin/backend/services/stigmer-service/stigmer_service_fatjar.jar",
	}
	for _, c := range candidates {
		abs, err := filepath.Abs(c)
		if err != nil {
			continue
		}
		if _, err := os.Stat(abs); err == nil {
			return abs
		}
	}
	return ""
}

// JavaService manages the stigmer-service fat JAR as a child process.
type JavaService struct {
	cmd           *exec.Cmd
	GRPCPort      string
	HTTPPort      string
	BiDiProxyPort string
	logFile       *os.File
	logPath       string
	logger        *slog.Logger
}

// LogPath returns the path to the service log file.
func (s *JavaService) LogPath() string {
	return s.logPath
}

// SecurityMode controls how the Java service handles authentication.
type SecurityMode string

const (
	// SecurityModeTest bypasses JWT validation with a synthetic caller.
	// This is the default for backward compatibility with existing tests.
	SecurityModeTest SecurityMode = "test"

	// SecurityModeProduction loads the full production security chain:
	// GrpcSecurityConfigBase, FederatedJwtAuthenticationProvider, Auth0
	// JwtDecoder, PlatformClientTokenAuthenticationProvider, and
	// OpaqueTokenAuthenticationProvider for API keys.
	SecurityModeProduction SecurityMode = "production"
)

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
	OpenFGAAPIURL  string
	OpenFGAStoreID string
	OpenFGAModelID string

	// MinIO S3-compatible endpoint for artifact storage.
	// When set, replaces the dummy localhost:19999 placeholder.
	MinIOEndpoint  string
	MinIOAccessKey string
	MinIOSecretKey string

	// Records Postgres — the Datastore record substrate behind the
	// always-active records-postgres profile. When RecordsPGHost is set,
	// RECORDS_PG_* env vars point the (lazy) records pool at a live
	// database and the record RPCs are fully functional; when empty, the
	// service still boots (initializationFailTimeout = -1) and record
	// RPCs fail loudly on first use.
	RecordsPGHost     string
	RecordsPGPort     string
	RecordsPGDatabase string
	RecordsPGUser     string
	RecordsPGPassword string

	// App Postgres — the application's system of record behind the
	// app-postgres Spring profile (mongo→postgres migration). When AppPGHost
	// is set, the profile is ACTIVATED (hybrid storage mode: ApiResource
	// kinds on Postgres, Tier-2 operational stores still on Mongo), APP_PG_*
	// env vars point at this database, and the service runs its Flyway
	// baseline against it during startup — a failed migration fails the
	// boot. When empty, the profile stays off and the service runs the
	// production-shaped Mongo-only stack; nothing else changes.
	AppPGHost     string
	AppPGPort     string
	AppPGDatabase string
	AppPGUser     string
	AppPGPassword string

	// LogDir is the directory for the service log file.
	// If empty, a temporary directory is used.
	LogDir string

	// OTLPEndpoint sets OTEL_EXPORTER_OTLP_ENDPOINT for distributed tracing.
	// When set, observability is enabled and the Java service exports spans
	// to this OTLP/gRPC receiver.
	OTLPEndpoint string

	// Security controls how the Java service handles authentication.
	// Defaults to SecurityModeTest when empty (backward compatible).
	Security SecurityMode

	// Auth0IssuerURL overrides the OIDC issuer URL (security.authentication.idp-url)
	// that the Java service uses for Auth0 JWT validation. Required when
	// Security is SecurityModeProduction to point at a mock OIDC server.
	Auth0IssuerURL string

	// Auth0Audience overrides the expected JWT audience (security.authentication.api-audience).
	// Required when Security is SecurityModeProduction.
	Auth0Audience string

	// Auth0McpAudience optionally sets an additional accepted audience
	// (security.authentication.mcp-audience / AUTH0_MCP_AUDIENCE). Used to
	// exercise the hosted MCP server's audience (mcp.stigmer.ai), for which
	// Auth0 mints tokens scoped to the MCP resource rather than the primary
	// API audience. Empty leaves the default (no additional audience).
	Auth0McpAudience string

	// Auth0TokenURL overrides the OAuth2 token endpoint that MachineAccountJwtProvider
	// uses for client_credentials grants. When set, the Java service calls this URL
	// instead of constructing https://<auth0Domain>/oauth/token.
	Auth0TokenURL string

	// ActivityRouting controls how the Java service dispatches runner activities.
	// "global" (default): all activities route to stigmer_runner.
	// "session": activities route to session:{session_id} per-session queues.
	ActivityRouting string

	// WorkflowActivityRouting controls how the Java service dispatches workflow
	// child workflows. "global" (default): all child workflows route to
	// stigmer_runner. "execution": child workflows route to wfexec:{execution_id}.
	WorkflowActivityRouting string

	// DefaultExecutionTarget resolves EXECUTION_TARGET_UNSPECIFIED on sessions.
	// "local" (default) or "cloud".
	DefaultExecutionTarget string

	// SandboxType controls sandbox provisioning. When non-empty, the "sandbox"
	// Spring profile is activated. Values: "noop" (default) or "daytona".
	SandboxType string

	// PreviousJWTSigningKey, when set, is passed to the Java service as
	// STIGMER_JWT_SIGNING_KEY_PREVIOUS — a verify-only key for the
	// key-rotation overlap. Tokens signed with it must still verify while the
	// primary key (STIGMER_JWT_SIGNING_KEY) keeps minting.
	PreviousJWTSigningKey string

	// PreviousJWTSigningKeyID overrides STIGMER_JWT_SIGNING_KEY_PREVIOUS_ID.
	// Only meaningful when PreviousJWTSigningKey is set; defaults to
	// "stigmer-signing-key-0" on the service side when empty.
	PreviousJWTSigningKeyID string

	// JWTAudience, when set, is passed to the Java service as
	// STIGMER_JWT_AUDIENCE — the environment audience stamped on minted tokens
	// and checked at verification. A token whose aud names another environment
	// is rejected on its claims rather than only on a signature mismatch.
	JWTAudience string

	// RequireAudience, when true, passes STIGMER_JWT_REQUIRE_AUDIENCE=true so a
	// token with a missing or non-matching aud is rejected (strict). When false
	// (default), verification is lenient: tokens with no aud are still accepted.
	RequireAudience bool
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

	bidiPort, err := freePort()
	if err != nil {
		return nil, fmt.Errorf("allocate bidi proxy port: %w", err)
	}
	bidiPortStr := fmt.Sprintf("%d", bidiPort)

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
	cmd.Env = append(buildServiceEnv(cfg),
		fmt.Sprintf("STIGMER_PROXY_CURSOR_BIDI_PORT=%s", bidiPortStr),
	)
	cmd.Stdout = logFile
	cmd.Stderr = logFile

	logger.Info("starting stigmer-service",
		"jar", cfg.JarPath,
		"grpc_port", cfg.GRPCPort,
		"http_port", cfg.HTTPPort,
		"bidi_proxy_port", bidiPortStr,
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

	bidiAddr := fmt.Sprintf("127.0.0.1:%s", bidiPortStr)
	if err := waitForPortOrExit(ctx, bidiAddr, 60*time.Second, exitCh); err != nil {
		_ = cmd.Process.Kill()
		logFile.Close()
		return nil, fmt.Errorf("java service BiDi proxy port not ready: %w", err)
	}

	logger.Info("stigmer-service ready",
		"grpc", grpcAddr,
		"bidi_proxy", bidiAddr,
		"log", logFile.Name(),
	)

	return &JavaService{
		cmd:           cmd,
		GRPCPort:      cfg.GRPCPort,
		HTTPPort:      cfg.HTTPPort,
		BiDiProxyPort: bidiPortStr,
		logFile:       logFile,
		logPath:       logPath,
		logger:        logger,
	}, nil
}

func (s *JavaService) GRPCAddress() string {
	return fmt.Sprintf("127.0.0.1:%s", s.GRPCPort)
}

func (s *JavaService) HTTPAddress() string {
	return fmt.Sprintf("http://127.0.0.1:%s", s.HTTPPort)
}

func (s *JavaService) BiDiProxyAddress() string {
	return fmt.Sprintf("http://127.0.0.1:%s", s.BiDiProxyPort)
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
	productionSecurity := cfg.Security == SecurityModeProduction

	// This list deliberately reproduces the cloud service's required profile
	// set (application.yaml) minus what tests stub out (mongock, vault); a new
	// always-on cloud profile that gates required beans must be added here
	// too, or the Spring context fails to boot with a missing-bean error.
	//
	// records-postgres: required for the Datastore record-substrate beans to
	// exist (an unconditional pipeline step injects DatastoreRecordStore).
	// The harness starts a Postgres container (StartPostgres) and suites
	// pass it via ServiceConfig.RecordsPG*, making the record RPCs fully
	// live. When a suite leaves RecordsPGHost empty, the lazy pool
	// (initializationFailTimeout = -1) still lets the service boot against
	// the localhost:5432 defaults; record RPCs then fail loudly on first use.
	profiles := "mongo,temporal,iam,logging,auth0,skill-r2,agent-execution-r2,claimcheck-r2,records-postgres"
	if cfg.SandboxType != "" {
		profiles += ",sandbox"
	}
	if fgaEnabled {
		profiles += ",openfga"
	}
	if cfg.OTLPEndpoint != "" {
		profiles += ",observability"
	}
	// Hybrid storage mode (mongo→postgres migration): app-postgres is ADDED
	// to — never substituted for — the list above. The mongo profile must stay
	// active alongside it: Tier-2 operational stores (billing, channels,
	// webhooks, sandboxes, audit sidecars) are still Mongo-backed until
	// T04/T05b port them.
	if cfg.AppPGHost != "" {
		profiles += ",app-postgres"
	}

	env := os.Environ()
	env = append(env,
		fmt.Sprintf("SPRING_PROFILES_ACTIVE=%s", profiles),

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

		// R2/S3 config — backed by MinIO testcontainer when available
		"SKILL_ARTIFACT_R2_BUCKET=test-bucket",
		fmt.Sprintf("SKILL_ARTIFACT_R2_ENDPOINT=%s", r2Endpoint(cfg)),
		fmt.Sprintf("SKILL_ARTIFACT_R2_ACCESS_KEY_ID=%s", r2AccessKey(cfg)),
		fmt.Sprintf("SKILL_ARTIFACT_R2_SECRET_ACCESS_KEY=%s", r2SecretKey(cfg)),
		"AGENT_EXECUTION_ARTIFACT_R2_BUCKET=test-bucket",
		fmt.Sprintf("AGENT_EXECUTION_ARTIFACT_R2_ENDPOINT=%s", r2Endpoint(cfg)),
		fmt.Sprintf("AGENT_EXECUTION_ARTIFACT_R2_ACCESS_KEY_ID=%s", r2AccessKey(cfg)),
		fmt.Sprintf("AGENT_EXECUTION_ARTIFACT_R2_SECRET_ACCESS_KEY=%s", r2SecretKey(cfg)),
		// MinIO can't resolve a bucket subdomain, so the presigner must use
		// path-style addressing or presigned uploads fail with SignatureDoesNotMatch.
		// Production R2 keeps the virtual-host default (flag is false there).
		"AGENT_EXECUTION_ARTIFACT_R2_PATH_STYLE_ACCESS_ENABLED=true",

		// Claim check R2 config
		"CLAIMCHECK_R2_BUCKET=test-claimcheck-bucket",
		fmt.Sprintf("CLAIMCHECK_R2_ENDPOINT=%s", r2Endpoint(cfg)),
		fmt.Sprintf("CLAIMCHECK_R2_ACCESS_KEY_ID=%s", r2AccessKey(cfg)),
		fmt.Sprintf("CLAIMCHECK_R2_SECRET_ACCESS_KEY=%s", r2SecretKey(cfg)),

		// Stripe (dummy key to satisfy ConditionalOnProperty — never called)
		"STIGMER_STRIPE_SECRET_KEY=sk_test_integration_dummy",
		"STIGMER_STRIPE_WEBHOOK_SECRET=whsec_test_dummy",

		// Disable optional features
		"STIGMER_VAULT_ENABLED=false",
		fmt.Sprintf("OBSERVABILITY_ENABLED=%t", cfg.OTLPEndpoint != ""),
		"STIGMER_BILLING_RECONCILIATION_ENABLED=false",
		"STIGMER_BILLING_RESERVATION_EXPIRY_ENABLED=false",

		// Shared-agent launch gate: lower the per-session turn limit so the
		// integration test can trip it without 30 real execution creates.
		// Other limits keep production defaults (tests use fresh cookies, so
		// per-guest buckets never collide across tests).
		"STIGMER_SHARING_MAX_TURNS_PER_SESSION=5",
		"STIGMER_RUNNER_LAUNCHER_TYPE=noop",

		fmt.Sprintf("STIGMER_ACTIVITY_ROUTING=%s", activityRouting(cfg)),
		fmt.Sprintf("STIGMER_WORKFLOW_ACTIVITY_ROUTING=%s", workflowActivityRouting(cfg)),
		fmt.Sprintf("STIGMER_DEFAULT_EXECUTION_TARGET=%s", defaultExecutionTarget(cfg)),
		fmt.Sprintf("STIGMER_SANDBOX_TYPE=%s", sandboxType(cfg)),

		"STIGMER_PROXY_REQUIRE_SCOPE_HEADER=false",

		// Skip JWKS URI reachability check for IdentityProvider create/update.
		// Test JWKS servers run on plain HTTP localhost which fails the HTTPS
		// requirement in ValidateJwksReachability.
		"STIGMER_IDP_JWKS_VALIDATION_DISABLED=true",

		// RSA-2048 PKCS#8 DER signing key for PlatformClient token minting (test-only).
		// Generated via: openssl genrsa 2048 | openssl pkcs8 -topk8 -nocrypt -outform DER | base64
		fmt.Sprintf("STIGMER_JWT_SIGNING_KEY=%s", StigmerJWTSigningKeyBase64),
	)

	// Records Postgres — the Datastore record substrate. When unset, the
	// application-records-postgres.yaml localhost defaults apply and the
	// lazy pool leaves record RPCs failing loudly on first use.
	if cfg.RecordsPGHost != "" {
		env = append(env,
			fmt.Sprintf("RECORDS_PG_HOST=%s", cfg.RecordsPGHost),
			fmt.Sprintf("RECORDS_PG_PORT=%s", cfg.RecordsPGPort),
			fmt.Sprintf("RECORDS_PG_DATABASE=%s", cfg.RecordsPGDatabase),
			fmt.Sprintf("RECORDS_PG_USERNAME=%s", cfg.RecordsPGUser),
			fmt.Sprintf("RECORDS_PG_PASSWORD=%s", cfg.RecordsPGPassword),
		)
	}

	// App Postgres — the ApiResource system of record when the app-postgres
	// profile is active (see the profile block above for the hybrid-mode
	// contract). Deliberately a different database than records: the two
	// datasources are separate clusters in production (DD-011) and must
	// never share configuration.
	if cfg.AppPGHost != "" {
		env = append(env,
			fmt.Sprintf("APP_PG_HOST=%s", cfg.AppPGHost),
			fmt.Sprintf("APP_PG_PORT=%s", cfg.AppPGPort),
			fmt.Sprintf("APP_PG_DATABASE=%s", cfg.AppPGDatabase),
			fmt.Sprintf("APP_PG_USERNAME=%s", cfg.AppPGUser),
			fmt.Sprintf("APP_PG_PASSWORD=%s", cfg.AppPGPassword),
		)
	}

	// Optional previous signing key for key-rotation overlap tests. When set,
	// the service accepts tokens signed by this key in addition to the primary.
	if cfg.PreviousJWTSigningKey != "" {
		env = append(env,
			fmt.Sprintf("STIGMER_JWT_SIGNING_KEY_PREVIOUS=%s", cfg.PreviousJWTSigningKey),
		)
		if cfg.PreviousJWTSigningKeyID != "" {
			env = append(env,
				fmt.Sprintf("STIGMER_JWT_SIGNING_KEY_PREVIOUS_ID=%s", cfg.PreviousJWTSigningKeyID),
			)
		}
	}

	// Optional environment audience for the JWT audience-binding tests. When set,
	// minted tokens are stamped with it and tokens naming another audience are
	// rejected. RequireAudience flips lenient (no-aud accepted) to strict.
	if cfg.JWTAudience != "" {
		env = append(env,
			fmt.Sprintf("STIGMER_JWT_AUDIENCE=%s", cfg.JWTAudience),
			fmt.Sprintf("STIGMER_JWT_REQUIRE_AUDIENCE=%t", cfg.RequireAudience),
		)
	}

	if productionSecurity {
		// Production security mode: load the real GrpcSecurityConfigBase,
		// FederatedJwtAuthenticationProvider, and Auth0 JwtDecoder.
		// Auth0 config points at the mock OIDC server.
		env = append(env, "STIGMER_SECURITY_MODE=production")

		auth0Domain := "test.auth0.com"
		auth0Audience := "test-audience"
		if cfg.Auth0IssuerURL != "" {
			// Override the OIDC issuer URL directly so Spring doesn't construct
			// https://${AUTH0_DOMAIN}/ — our mock runs on plain HTTP.
			env = append(env, fmt.Sprintf("SECURITY_AUTHENTICATION_IDP_URL=%s", cfg.Auth0IssuerURL))
		}
		if cfg.Auth0Audience != "" {
			auth0Audience = cfg.Auth0Audience
		}
		env = append(env,
			fmt.Sprintf("AUTH0_DOMAIN=%s", auth0Domain),
			"AUTH0_CLIENT_ID=test-client-id",
			"AUTH0_CLIENT_SECRET=test-client-secret",
			fmt.Sprintf("AUTH0_API_AUDIENCE=%s", auth0Audience),
		)
		if cfg.Auth0McpAudience != "" {
			env = append(env, fmt.Sprintf("AUTH0_MCP_AUDIENCE=%s", cfg.Auth0McpAudience))
		}
		if cfg.Auth0TokenURL != "" {
			env = append(env, fmt.Sprintf("AUTH0_TOKEN_URL=%s", cfg.Auth0TokenURL))
		}
	} else {
		// Test security mode: bypass Auth0 JWT validation with a synthetic
		// caller. GrpcSecurityConfigBase and MachineAccountJwtProvider are
		// not loaded. The permit-all TestIamPolicyGrpcRepo is used unless
		// real FGA is enabled.
		env = append(env, "STIGMER_SECURITY_MODE=test")
		env = append(env,
			"AUTH0_DOMAIN=test.auth0.com",
			"AUTH0_CLIENT_ID=test-client-id",
			"AUTH0_CLIENT_SECRET=test-client-secret",
			"AUTH0_API_AUDIENCE=test-audience",
		)
	}

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

	if cfg.OTLPEndpoint != "" {
		env = append(env,
			fmt.Sprintf("OTEL_EXPORTER_OTLP_ENDPOINT=%s", cfg.OTLPEndpoint),
			"OTEL_SERVICE_NAME=stigmer-service-test",
		)
	}

	return env
}

func r2Endpoint(cfg ServiceConfig) string {
	if cfg.MinIOEndpoint != "" {
		return cfg.MinIOEndpoint
	}
	return "http://localhost:19999"
}

func r2AccessKey(cfg ServiceConfig) string {
	if cfg.MinIOAccessKey != "" {
		return cfg.MinIOAccessKey
	}
	return "test"
}

func r2SecretKey(cfg ServiceConfig) string {
	if cfg.MinIOSecretKey != "" {
		return cfg.MinIOSecretKey
	}
	return "test"
}

func activityRouting(cfg ServiceConfig) string {
	if cfg.ActivityRouting != "" {
		return cfg.ActivityRouting
	}
	return "global"
}

func workflowActivityRouting(cfg ServiceConfig) string {
	if cfg.WorkflowActivityRouting != "" {
		return cfg.WorkflowActivityRouting
	}
	return "global"
}

func defaultExecutionTarget(cfg ServiceConfig) string {
	if cfg.DefaultExecutionTarget != "" {
		return cfg.DefaultExecutionTarget
	}
	return "local"
}

func sandboxType(cfg ServiceConfig) string {
	if cfg.SandboxType != "" {
		return cfg.SandboxType
	}
	return "noop"
}
