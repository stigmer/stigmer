// Command conformance-cloudenv boots the hermetic cloud environment for the
// conformance suite's cloud target: Testcontainers infrastructure (Postgres,
// Redis, MinIO, OpenFGA), a Temporal dev server, a mock platform identity
// tenant, and the stigmer-service fat JAR in PRODUCTION security mode with
// real OpenFGA authorization.
//
// It is spawned by the conformance suite's cloud global setup
// (test/conformance/src/harness/global-setup-cloud.ts), which waits for a
// single JSON ready-line on stdout and later terminates the process with
// SIGTERM. Human-readable progress goes to stderr so stdout stays a clean
// machine channel — and, since the ready line carries the tenant's signing
// key, stdout is the ONLY place that key may appear. Nothing here logs it.
//
// Reuses the integration-test harness wholesale — one battle-tested boot
// implementation, two consumers (Go integration tests and the TS conformance
// suite) — with two deliberate divergences from the Go suites' defaults:
//
//   - OpenFGA is mandatory. The integration harness degrades to permit-all
//     authorization when FGA is unavailable, but a permit-all cloud target
//     would silently invalidate every multi-tenant conformance assertion, so
//     this launcher fails loudly instead.
//   - The JAR runs the production security chain (GrpcSecurityConfigBase,
//     HttpSecurityConfig, the Auth0 MachineAccountJwtProvider), trusting a
//     mock identity tenant this process serves, exactly the way
//     test/integration-security boots it. The Go suites keep test security
//     mode; the conformance suite's job is to observe the edge (entry
//     20260907.02 — D-S1 option (ii) of 20260904.02), so a synthetic
//     tokenless caller would be the one thing it must not have.
//
// Production mode has a chicken-and-egg the harness resolves the way the
// security suite does: before any credential can be accepted, one human
// platform operator must already exist. SeedBootstrapOperator writes that
// account and its FGA grants after the JAR boots; the ready line names its
// subject and hands over the tenant material, and the TS side mints the
// operator's first token itself and bootstraps everything else through
// production RPCs.
package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/stigmer/stigmer/test/integration/harness"
)

// bootTimeout bounds the full environment boot: container pulls on a cold
// cache plus the JVM start. Generous because CI caches may be empty.
const bootTimeout = 10 * time.Minute

// The mock platform identity tenant's audiences — what the JAR is configured
// to accept on inbound tenant tokens (AUTH0_API_AUDIENCE / AUTH0_MCP_AUDIENCE)
// and what the TS side stamps on the tokens it mints. Reserved test names so
// a token from this run can never be mistaken for a production one.
const (
	tenantAPIAudience = "https://api.conformance.stigmer.test"
	tenantMCPAudience = "https://mcp.conformance.stigmer.test"
)

// The pre-auth bootstrap operator. Its IdpID is the `sub` the TS side mints
// for it; the account id is what every FGA grant names. Both are constants:
// the run's isolation comes from the fresh Postgres and FGA store, not from
// unique names.
const (
	bootstrapOperatorAccountID = "conformance-bootstrap-operator"
	bootstrapOperatorSubject   = "conformance-bootstrap-operator|tenant"
	bootstrapOperatorEmail     = "bootstrap-operator@conformance.stigmer.test"
)

// readySignal is the single JSON line printed to stdout once the environment
// accepts gRPC traffic. The TS global setup parses it to locate the service.
// The HTTP address carries the Spring routes the gRPC port does not — the
// artifact presign endpoints (/v1/proxy/artifacts/...) the conformance
// runner's proxy artifact store targets (stigmer#803), and since E1 the whole
// side-channel proxy, the Stripe webhook and the public lane. The bidi
// address is the Cursor BiDi proxy's own Netty listener (h2c), which Tomcat
// cannot serve; the TS side publishes both to the suites through CLOUD_ENV.
// The identity tenant group is what lets the TS side mint tokens the JAR
// trusts: the bootstrap operator's first token, and the direct-login suite's
// first-party tokens (CLOUD_ENV.directLogin*).
type readySignal struct {
	GrpcAddress       string              `json:"grpcAddress"`
	HTTPAddress       string              `json:"httpAddress"`
	CursorBidiAddress string              `json:"cursorBidiAddress"`
	IdentityTenant    identityTenantReady `json:"identityTenant"`
}

// identityTenantReady is the ready line's tenant group — the private half of
// the tenant the JAR discovered at boot, plus the operator subject the seeding
// above made resolvable. PrivateKeyPEM is a PKCS#8 PEM, the format the TS
// direct-login mint consumes.
type identityTenantReady struct {
	Issuer           string `json:"issuer"`
	KeyID            string `json:"kid"`
	PrivateKeyPEM    string `json:"privateKeyPem"`
	APIAudience      string `json:"apiAudience"`
	MCPAudience      string `json:"mcpAudience"`
	BootstrapSubject string `json:"bootstrapSubject"`
}

func main() {
	logger := slog.New(slog.NewTextHandler(os.Stderr, &slog.HandlerOptions{Level: slog.LevelInfo}))
	if err := run(logger); err != nil {
		logger.Error("conformance cloud environment failed", "error", err)
		os.Exit(1)
	}
}

func run(logger *slog.Logger) error {
	jarPath := harness.FindServiceJar()
	if jarPath == "" {
		return errors.New(
			"stigmer-service fat JAR not found: set STIGMER_SERVICE_JAR or build it in the " +
				"sibling stigmer-cloud checkout with " +
				"`./bazelw build //backend/services/stigmer-service:stigmer_service_fatjar`")
	}
	externalFGA, err := externalOpenFGAFromEnv()
	if err != nil {
		return err
	}
	if externalFGA == nil {
		// Standalone mode provisions its own OpenFGA store, so the model
		// source and the transform CLI must exist up front. Join mode skips
		// both: the external store already carries a written model.
		if harness.FindFGAModelDir() == "" {
			return errors.New(
				"FGA model directory not found: set STIGMER_FGA_MODEL_DIR or ensure stigmer-cloud " +
					"is a sibling checkout (cloud conformance requires real OpenFGA authorization)")
		}
		if !harness.IsFGACLIAvailable() {
			return errors.New(
				"fga CLI not on PATH (install with `brew install openfga/tap/fga`): cloud " +
					"conformance requires real OpenFGA authorization")
		}
	}

	bootCtx, cancelBoot := context.WithTimeout(context.Background(), bootTimeout)
	defer cancelBoot()

	h, err := harness.Start(bootCtx, harness.DefaultConfig())
	if err != nil {
		return fmt.Errorf("start test infrastructure: %w", err)
	}
	// Teardown uses a fresh context: the boot context may be exhausted or
	// cancelled by the time the launcher receives its shutdown signal.
	defer func() {
		h.Stop(context.Background())
		logger.Info("conformance cloud environment stopped")
	}()

	// Join mode (the C5 shared-FGA readout substrate, ruling Q4 of
	// 20260830.02.sp.billing-facade): the Java service authorizes against an
	// EXTERNALLY provisioned OpenFGA store — the spike composition's — so both
	// sides of the billing facade share one set of tuples, the shape
	// production has after the X1 cutover. The harness's own container may
	// still have booted above (it keys off the model dir, not this choice);
	// it simply goes unused, which is a few idle seconds — never a fork of
	// the battle-tested boot path.
	fga := h.OpenFGA
	if externalFGA != nil {
		fga = externalFGA
		logger.Info("joining external openfga store",
			"endpoint", fga.HTTPEndpoint, "store_id", fga.StoreID, "model_id", fga.ModelID)
	}
	if fga == nil {
		return errors.New("openfga container did not start despite model dir and CLI being present")
	}

	// The mock identity tenant must be serving before the JAR starts:
	// GrpcSecurityConfigBase runs OIDC discovery while its beans initialize,
	// and a failed discovery fails the boot. An empty issuer makes the
	// server's own URL the issuer (trailing slash, Auth0's shape).
	tenant, err := harness.NewMockOIDCServer("", tenantAPIAudience)
	if err != nil {
		return fmt.Errorf("start mock identity tenant: %w", err)
	}
	defer tenant.Close()
	logger.Info("mock identity tenant serving", "issuer", tenant.Issuer)

	svc, err := harness.StartJavaService(bootCtx, harness.ServiceConfig{
		JarPath:         jarPath,
		AppPGHost:       h.AppPostgres.Host,
		AppPGPort:       h.AppPostgres.Port,
		AppPGDatabase:   h.AppPostgres.Database,
		AppPGUser:       h.AppPostgres.User,
		AppPGPassword:   h.AppPostgres.Password,
		RedisHost:       h.Redis.Host,
		RedisPort:       h.Redis.Port,
		TemporalAddress: h.Temporal.Address(),
		OpenFGAAPIURL:   fga.HTTPEndpoint,
		OpenFGAStoreID:  fga.StoreID,
		OpenFGAModelID:  fga.ModelID,
		MinIOEndpoint:   h.MinIO.Endpoint,
		MinIOAccessKey:  h.MinIO.AccessKey,
		MinIOSecretKey:  h.MinIO.SecretKey,
		VaultAddr:       h.OpenBao.Addr,
		VaultToken:      h.OpenBao.RootToken,
		LogDir:          h.LogDir(),
		// Production security, trusting the tenant above. The token URL is
		// where the JAR's MachineAccountJwtProvider fetches the machine
		// account's client_credentials JWT (sub = AUTH0_CLIENT_ID@clients,
		// the row BootstrapIdentitySeeder writes at boot).
		Security:         harness.SecurityModeProduction,
		Auth0IssuerURL:   tenant.Issuer,
		Auth0Audience:    tenantAPIAudience,
		Auth0McpAudience: tenantMCPAudience,
		Auth0TokenURL:    tenant.URL + "/oauth/token",
		// Production's token-shape posture for Stigmer-minted tokens: stamped
		// with an environment audience, verified leniently (a token without
		// an aud still verifies) — the prod overlay's posture; the value is
		// per-environment by design, so it is the harness's own, shared with
		// the security suite.
		JWTAudience:     harness.StigmerJWTAudience,
		RequireAudience: false,
		// Production's proxy edge: a call with no scope header is refused.
		ProxyRequireScopeHeader: true,
		// The conformance global setup (cloud-env.ts) sets this on the
		// launcher's environment from the suite's own redirect-URI constant —
		// the single source of truth the OAuth suites assert against. Passed
		// through explicitly (never via ambient environment inheritance) so
		// the service's OAuth posture is visible right here.
		OAuthRedirectURI: os.Getenv("STIGMER_OAUTH_REDIRECT_URI"),
		// Optional verify-only key (join mode): tokens minted by the other
		// side of a shared substrate — the spike composition's keypair —
		// verify here through the service's existing key-rotation overlap
		// lane. Format is the primary key's own: base64 of PKCS#8 DER (the
		// spike's .env.spike carries base64 of PEM — convert before setting).
		PreviousJWTSigningKey: os.Getenv("STIGMER_CONFORMANCE_EXTRA_JWT_VERIFY_KEY_BASE64"),
		// The cloud-capability fixtures (E1, entry 20260906.04): the TS
		// global setup boots the fake LLM upstream, the fake Stripe API and
		// the fake Discord receiver BEFORE spawning this launcher and hands
		// their addresses (and a run-local webhook signing secret) over on
		// the environment; each is threaded through an explicit
		// ServiceConfig field so the service's outbound posture is visible
		// here, never inherited ambiently. Empty when the launcher runs
		// without the fixtures (the production defaults apply).
		StripeWebhookSecret:    os.Getenv(envStripeWebhookSecret),
		StripeAPIBase:          os.Getenv(envStripeAPIBase),
		LLMUpstreamBaseURL:     os.Getenv(envLLMUpstreamBaseURL),
		LeadsDiscordWebhookURL: os.Getenv(envLeadsDiscordWebhookURL),
	}, logger)
	if err != nil {
		return fmt.Errorf("start stigmer-service: %w", err)
	}
	// Registering the service on the harness lets the deferred Stop own its
	// lifecycle alongside the containers.
	h.Service = svc

	// After boot (Flyway has created s_iam.identity_account), before the
	// first authenticated call (subjects resolve per request): the one
	// pre-auth account production mode cannot create for itself.
	if err := harness.SeedBootstrapOperator(bootCtx, h.AppPostgres, fga, harness.BootstrapOperatorInput{
		IdentityAccountID: bootstrapOperatorAccountID,
		IdpID:             bootstrapOperatorSubject,
		Email:             bootstrapOperatorEmail,
		Name:              "Conformance Bootstrap Operator",
		FirstName:         "Conformance",
		LastName:          "Bootstrap",
		Org:               harness.TestOrg,
	}); err != nil {
		return fmt.Errorf("seed bootstrap operator: %w", err)
	}

	material, err := tenant.Material()
	if err != nil {
		return fmt.Errorf("export identity tenant material: %w", err)
	}
	ready, err := json.Marshal(readySignal{
		GrpcAddress:       svc.GRPCAddress(),
		HTTPAddress:       svc.HTTPAddress(),
		CursorBidiAddress: svc.BiDiProxyAddress(),
		IdentityTenant: identityTenantReady{
			Issuer:           material.Issuer,
			KeyID:            material.KeyID,
			PrivateKeyPEM:    material.PrivateKeyPEM,
			APIAudience:      tenantAPIAudience,
			MCPAudience:      tenantMCPAudience,
			BootstrapSubject: bootstrapOperatorSubject,
		},
	})
	if err != nil {
		return fmt.Errorf("marshal ready signal: %w", err)
	}
	fmt.Println(string(ready))
	logger.Info("conformance cloud environment ready",
		"grpc_address", svc.GRPCAddress(),
		"http_address", svc.HTTPAddress(),
		"cursor_bidi_address", svc.BiDiProxyAddress(),
		"identity_tenant", material.Issuer,
		"security_mode", "production",
		"service_log", svc.LogPath(),
	)

	shutdown := make(chan os.Signal, 1)
	signal.Notify(shutdown, syscall.SIGINT, syscall.SIGTERM)
	sig := <-shutdown
	logger.Info("shutting down", "signal", sig.String())
	return nil
}

// Env vars selecting join mode: the launcher points the Java service at an
// externally provisioned OpenFGA store instead of provisioning its own.
const (
	envExternalFGAAPIURL  = "STIGMER_CONFORMANCE_EXTERNAL_OPENFGA_API_URL"
	envExternalFGAStoreID = "STIGMER_CONFORMANCE_EXTERNAL_OPENFGA_STORE_ID"
	envExternalFGAModelID = "STIGMER_CONFORMANCE_EXTERNAL_OPENFGA_MODEL_ID"
)

// The fixture hand-over contract between cloud-env.ts (writer) and this
// launcher (reader) — see the ServiceConfig fields they feed.
const (
	envStripeWebhookSecret    = "STIGMER_CONFORMANCE_STRIPE_WEBHOOK_SECRET"
	envStripeAPIBase          = "STIGMER_CONFORMANCE_STRIPE_API_BASE"
	envLLMUpstreamBaseURL     = "STIGMER_CONFORMANCE_LLM_UPSTREAM_BASE_URL"
	envLeadsDiscordWebhookURL = "STIGMER_CONFORMANCE_LEADS_DISCORD_WEBHOOK_URL"
)

// externalOpenFGAFromEnv reads the join-mode store coordinates. All three
// variables or none: a partial set is a misconfiguration answered loudly, not
// a silent fall-through to standalone mode (which would authorize against a
// different store than the caller intended — the exact drift a shared
// substrate exists to prevent). The returned handle carries no container;
// harness.OpenFGAContainer's write/seed operations use only the coordinates.
func externalOpenFGAFromEnv() (*harness.OpenFGAContainer, error) {
	apiURL := os.Getenv(envExternalFGAAPIURL)
	storeID := os.Getenv(envExternalFGAStoreID)
	modelID := os.Getenv(envExternalFGAModelID)
	if apiURL == "" && storeID == "" && modelID == "" {
		return nil, nil
	}
	if apiURL == "" || storeID == "" || modelID == "" {
		return nil, fmt.Errorf(
			"external OpenFGA configuration is partial: %s, %s, and %s must all be set together (got %q, %q, %q)",
			envExternalFGAAPIURL, envExternalFGAStoreID, envExternalFGAModelID,
			apiURL, storeID, modelID)
	}
	return &harness.OpenFGAContainer{
		HTTPEndpoint: apiURL,
		StoreID:      storeID,
		ModelID:      modelID,
	}, nil
}
