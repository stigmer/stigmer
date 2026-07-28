package harness

import (
	"context"
	"fmt"
	"time"

	"github.com/testcontainers/testcontainers-go"
	"github.com/testcontainers/testcontainers-go/modules/redis"
)

type RedisContainer struct {
	Container *redis.RedisContainer
	Host      string
	Port      string
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
