package harness

import (
	"context"
	"fmt"
	"io"
	"strings"

	tcexec "github.com/testcontainers/testcontainers-go/exec"
	"github.com/testcontainers/testcontainers-go/modules/postgres"
)

// AppPostgresContainer holds a running PostgreSQL instance backing the
// application's system of record (the `app-postgres` Spring profile). The
// Java service connects via the APP_PG_* env vars and runs its Flyway
// baseline against it at startup.
//
// The instance carries TWO databases, mirroring production's layout (T08):
// stigmer_app (the system of record) and stigmer_checkpoints (the LangGraph
// checkpointer store, its own Flyway chain). Both are created here because
// Flyway creates schemas, never databases — the service's fail-fast boot
// requires both to exist. The service reaches stigmer_checkpoints through the
// same APP_PG_* connection values (its config defaults the database name;
// no extra env vars).
type AppPostgresContainer struct {
	Container *postgres.PostgresContainer
	Host      string
	Port      string
	Database  string
	User      string
	Password  string
}

// QueryScalar runs one SQL statement via psql inside the container and
// returns the single value it produces, trimmed (-q -t -A: quiet, tuples
// only, no alignment). The read twin of the seeders' write-only exec — it
// keeps the harness free of a Go Postgres driver (the stated design
// constraint) while letting tests assert durable state the service wrote:
// webhook event settles, outbound ledger rows, binding counts.
func (a *AppPostgresContainer) QueryScalar(ctx context.Context, sql string) (string, error) {
	exitCode, output, err := a.Container.Exec(ctx, []string{
		"psql", "-U", a.User, "-d", a.Database, "-v", "ON_ERROR_STOP=1",
		"-q", "-t", "-A", "-c", sql,
	}, tcexec.Multiplexed())
	if err != nil {
		return "", fmt.Errorf("exec psql in app-postgres container: %w", err)
	}
	raw, readErr := io.ReadAll(output)
	if readErr != nil {
		return "", fmt.Errorf("read psql output: %w", readErr)
	}
	if exitCode != 0 {
		return "", fmt.Errorf("psql exited %d: %s", exitCode, string(raw))
	}
	return strings.TrimSpace(string(raw)), nil
}

// Credentials mirror the application-app-postgres.yaml defaults so the test
// store reads like the real one in service logs.
const (
	appPostgresDatabase = "stigmer_app"
	appPostgresUser     = "stigmer_app"
	appPostgresPassword = "integration-test-app"

	// The checkpointer database (T08): matches application-app-postgres.yaml's
	// CHECKPOINTER_PG_DATABASE default, so the service finds it with zero env
	// var wiring.
	appPostgresCheckpointsDatabase = "stigmer_checkpoints"
)

// StartAppPostgres starts the app-postgres container (same pinned image as
// the cloud repo's adapter contract suites), then creates the checkpointer
// database beside the primary one — the out-of-band provisioning production
// gets from the Zalando chart.
func StartAppPostgres(ctx context.Context) (*AppPostgresContainer, error) {
	container, host, port, err := runPostgres16(ctx, appPostgresDatabase, appPostgresUser, appPostgresPassword)
	if err != nil {
		return nil, err
	}

	// psql inside the container keeps the harness free of a Go Postgres driver
	// dependency; CREATE DATABASE cannot run through the module's snapshot/init
	// hooks anyway (it must execute outside a transaction).
	exitCode, output, err := container.Exec(ctx, []string{
		"psql", "-U", appPostgresUser, "-d", appPostgresDatabase,
		"-c", "CREATE DATABASE " + appPostgresCheckpointsDatabase,
	})
	if err != nil {
		return nil, fmt.Errorf("create %s database: %w", appPostgresCheckpointsDatabase, err)
	}
	if exitCode != 0 {
		out, _ := io.ReadAll(output)
		return nil, fmt.Errorf("create %s database: psql exited %d: %s",
			appPostgresCheckpointsDatabase, exitCode, string(out))
	}

	return &AppPostgresContainer{
		Container: container,
		Host:      host,
		Port:      port,
		Database:  appPostgresDatabase,
		User:      appPostgresUser,
		Password:  appPostgresPassword,
	}, nil
}

func runPostgres16(ctx context.Context, database, user, password string) (*postgres.PostgresContainer, string, string, error) {
	container, err := postgres.Run(ctx, postgresImage,
		postgres.WithDatabase(database),
		postgres.WithUsername(user),
		postgres.WithPassword(password),
		postgres.BasicWaitStrategies(),
	)
	if err != nil {
		return nil, "", "", fmt.Errorf("start postgres container (%s): %w", database, err)
	}

	host, err := container.Host(ctx)
	if err != nil {
		return nil, "", "", fmt.Errorf("get postgres host (%s): %w", database, err)
	}

	port, err := container.MappedPort(ctx, "5432/tcp")
	if err != nil {
		return nil, "", "", fmt.Errorf("get postgres port (%s): %w", database, err)
	}

	return container, host, port.Port(), nil
}
