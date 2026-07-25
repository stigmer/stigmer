package harness

import (
	"context"
	"fmt"

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
// application's system of record (the `app-postgres` Spring profile — the
// mongo→postgres migration's Tier-1 ApiResource store). The Java service
// connects via the APP_PG_* env vars and runs its Flyway baseline against it
// at startup.
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
// the records one and as the cloud repo's adapter contract suites).
func StartAppPostgres(ctx context.Context) (*AppPostgresContainer, error) {
	container, host, port, err := runPostgres16(ctx, appPostgresDatabase, appPostgresUser, appPostgresPassword)
	if err != nil {
		return nil, err
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
	container, err := postgres.Run(ctx, "postgres:16-alpine",
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
