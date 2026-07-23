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

// Credentials mirror the application-records-postgres.yaml defaults so
// the test substrate reads like the real one in service logs.
const (
	postgresDatabase = "stigmer_records"
	postgresUser     = "stigmer_records"
	postgresPassword = "integration-test-records"
)

// StartPostgres starts the records Postgres container.
// postgres:16-alpine matches the image the cloud repo's Testcontainers
// suites pin (RecordsPostgresContainerSmokeTest and friends).
func StartPostgres(ctx context.Context) (*PostgresContainer, error) {
	container, err := postgres.Run(ctx, "postgres:16-alpine",
		postgres.WithDatabase(postgresDatabase),
		postgres.WithUsername(postgresUser),
		postgres.WithPassword(postgresPassword),
		postgres.BasicWaitStrategies(),
	)
	if err != nil {
		return nil, fmt.Errorf("start postgres container: %w", err)
	}

	host, err := container.Host(ctx)
	if err != nil {
		return nil, fmt.Errorf("get postgres host: %w", err)
	}

	port, err := container.MappedPort(ctx, "5432/tcp")
	if err != nil {
		return nil, fmt.Errorf("get postgres port: %w", err)
	}

	return &PostgresContainer{
		Container: container,
		Host:      host,
		Port:      port.Port(),
		Database:  postgresDatabase,
		User:      postgresUser,
		Password:  postgresPassword,
	}, nil
}
