package harness

import (
	"context"
	"fmt"
	"io"

	"github.com/testcontainers/testcontainers-go/modules/postgres"
)

// PostgresContainer holds a running PostgreSQL instance backing the
// Datastore record substrate (the `records-postgres` Spring profile).
// The Java service connects via the RECORDS_PG_* env vars emitted by
// buildServiceEnv; applying a Datastore then runs the gating
// schema-sync against this instance, exactly as in production.
type PostgresContainer struct {
	Container *postgres.PostgresContainer
	Host      string
	Port      string
	Database  string
	User      string
	Password  string
}

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
//
// Deliberately a SEPARATE container from the records one, not a second
// database on it: production runs the two as separate clusters with separate
// failure domains (stigmer-cloud DD-011), and two independent, non-primary
// DataSource beans coexisting in one Spring context is precisely one of the
// wirings the app-postgres lane exists to prove.
type AppPostgresContainer struct {
	Container *postgres.PostgresContainer
	Host      string
	Port      string
	Database  string
	User      string
	Password  string
}

// Credentials mirror the application-records-postgres.yaml defaults so
// the test substrate reads like the real one in service logs.
const (
	postgresDatabase = "stigmer_records"
	postgresUser     = "stigmer_records"
	postgresPassword = "integration-test-records"
)

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

// StartPostgres starts the records Postgres container.
// postgres:16-alpine matches the image the cloud repo's Testcontainers
// suites pin (RecordsPostgresContainerSmokeTest and friends).
func StartPostgres(ctx context.Context) (*PostgresContainer, error) {
	container, host, port, err := runPostgres16(ctx, postgresDatabase, postgresUser, postgresPassword)
	if err != nil {
		return nil, err
	}
	return &PostgresContainer{
		Container: container,
		Host:      host,
		Port:      port,
		Database:  postgresDatabase,
		User:      postgresUser,
		Password:  postgresPassword,
	}, nil
}

// StartAppPostgres starts the app-postgres container (same pinned image as
// the records one and as the cloud repo's adapter contract suites), then
// creates the checkpointer database beside the primary one — the out-of-band
// provisioning production gets from the Zalando chart.
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
