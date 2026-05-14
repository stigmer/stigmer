package harness

import (
	"context"
	"fmt"
	"time"

	"github.com/testcontainers/testcontainers-go"
	"github.com/testcontainers/testcontainers-go/modules/mongodb"
	"github.com/testcontainers/testcontainers-go/modules/redis"
)

type MongoContainer struct {
	Container *mongodb.MongoDBContainer
	Host      string
	Port      string
	URI       string
}

type RedisContainer struct {
	Container *redis.RedisContainer
	Host      string
	Port      string
}

func StartMongo(ctx context.Context) (*MongoContainer, error) {
	container, err := mongodb.Run(ctx, "mongo:7")
	if err != nil {
		return nil, fmt.Errorf("start mongodb container: %w", err)
	}

	host, err := container.Host(ctx)
	if err != nil {
		return nil, fmt.Errorf("get mongodb host: %w", err)
	}

	port, err := container.MappedPort(ctx, "27017/tcp")
	if err != nil {
		return nil, fmt.Errorf("get mongodb port: %w", err)
	}

	uri, err := container.ConnectionString(ctx)
	if err != nil {
		return nil, fmt.Errorf("get mongodb connection string: %w", err)
	}

	return &MongoContainer{
		Container: container,
		Host:      host,
		Port:      port.Port(),
		URI:       uri,
	}, nil
}

func StartRedis(ctx context.Context) (*RedisContainer, error) {
	container, err := redis.Run(ctx, "redis:7-alpine")
	if err != nil {
		return nil, fmt.Errorf("start redis container: %w", err)
	}

	host, err := container.Host(ctx)
	if err != nil {
		return nil, fmt.Errorf("get redis host: %w", err)
	}

	port, err := container.MappedPort(ctx, "6379/tcp")
	if err != nil {
		return nil, fmt.Errorf("get redis port: %w", err)
	}

	return &RedisContainer{
		Container: container,
		Host:      host,
		Port:      port.Port(),
	}, nil
}

func StopContainer(ctx context.Context, c testcontainers.Container) error {
	if c == nil {
		return nil
	}
	timeout := 10 * time.Second
	return c.Stop(ctx, &timeout)
}
