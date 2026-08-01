// Command conformance-cloudenv boots the hermetic cloud environment for the
// conformance suite's cloud target: Testcontainers infrastructure (Postgres,
// Redis, MinIO, OpenFGA), a Temporal dev server, and the stigmer-service fat
// JAR in test security mode with real OpenFGA authorization.
//
// It is spawned by the conformance suite's cloud global setup
// (test/conformance/src/harness/global-setup-cloud.ts), which waits for a
// single JSON ready-line on stdout and later terminates the process with
// SIGTERM. Human-readable progress goes to stderr so stdout stays a clean
// machine channel.
//
// Reuses the integration-test harness wholesale — one battle-tested boot
// implementation, two consumers (Go integration tests and the TS conformance
// suite) — with one deliberate divergence: OpenFGA is mandatory here. The
// integration harness degrades to permit-all authorization when FGA is
// unavailable, but a permit-all cloud target would silently invalidate every
// multi-tenant conformance assertion, so this launcher fails loudly instead.
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

// readySignal is the single JSON line printed to stdout once the environment
// accepts gRPC traffic. The TS global setup parses it to locate the service.
type readySignal struct {
	GrpcAddress string `json:"grpcAddress"`
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

	if h.OpenFGA == nil {
		return errors.New("openfga container did not start despite model dir and CLI being present")
	}

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
		OpenFGAAPIURL:   h.OpenFGA.HTTPEndpoint,
		OpenFGAStoreID:  h.OpenFGA.StoreID,
		OpenFGAModelID:  h.OpenFGA.ModelID,
		MinIOEndpoint:   h.MinIO.Endpoint,
		MinIOAccessKey:  h.MinIO.AccessKey,
		MinIOSecretKey:  h.MinIO.SecretKey,
		VaultAddr:       h.OpenBao.Addr,
		VaultToken:      h.OpenBao.RootToken,
		LogDir:          h.LogDir(),
		Security:        harness.SecurityModeTest,
	}, logger)
	if err != nil {
		return fmt.Errorf("start stigmer-service: %w", err)
	}
	// Registering the service on the harness lets the deferred Stop own its
	// lifecycle alongside the containers.
	h.Service = svc

	if err := harness.SeedBaseFGATuples(bootCtx, h.OpenFGA); err != nil {
		return fmt.Errorf("seed base FGA tuples: %w", err)
	}

	ready, err := json.Marshal(readySignal{GrpcAddress: svc.GRPCAddress()})
	if err != nil {
		return fmt.Errorf("marshal ready signal: %w", err)
	}
	fmt.Println(string(ready))
	logger.Info("conformance cloud environment ready",
		"grpc_address", svc.GRPCAddress(),
		"service_log", svc.LogPath(),
	)

	shutdown := make(chan os.Signal, 1)
	signal.Notify(shutdown, syscall.SIGINT, syscall.SIGTERM)
	sig := <-shutdown
	logger.Info("shutting down", "signal", sig.String())
	return nil
}
