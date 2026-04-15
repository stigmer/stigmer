package apikey

import (
	"context"
	"fmt"
	"time"

	"github.com/pkg/errors"
	stigmer "github.com/stigmer/stigmer/sdk/go"
	apikeyv1 "github.com/stigmer/stigmer/sdk/go/proto/ai/stigmer/iam/apikey/v1"
)

const defaultExpirationDays = 90

// CreateOptions contains options for creating an API key.
type CreateOptions struct {
	Name         string
	NeverExpires bool
	ExpiresIn    string // e.g. "30d", "6h", "1y"
	Client       *stigmer.Client
}

// Create creates a new API key.
func Create(opts *CreateOptions) (*apikeyv1.ApiKey, error) {
	if opts == nil {
		return nil, errors.New("create options cannot be nil")
	}
	if opts.Client == nil {
		return nil, errors.New("client cannot be nil")
	}

	var expiresAtStr string
	if !opts.NeverExpires {
		if opts.ExpiresIn != "" {
			duration, err := ParseExpirationDuration(opts.ExpiresIn)
			if err != nil {
				return nil, err
			}
			expiresAtStr = time.Now().Add(duration).Format(time.RFC3339)
		} else {
			expiresAtStr = time.Now().Add(defaultExpirationDays * 24 * time.Hour).Format(time.RFC3339)
		}
	}

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	created, err := opts.Client.ApiKey.Create(ctx, &stigmer.ApiKeyInput{
		Name:         opts.Name,
		NeverExpires: opts.NeverExpires,
		ExpiresAt:    expiresAtStr,
	})
	if err != nil {
		return nil, errors.Wrap(err, "failed to create API key")
	}

	return created, nil
}

// ParseExpirationDuration parses duration strings like "30d", "6h", "1y".
func ParseExpirationDuration(s string) (time.Duration, error) {
	if len(s) < 2 {
		return 0, fmt.Errorf("invalid duration format: %q (expected e.g. 30d, 6h, 1y)", s)
	}

	unit := s[len(s)-1]
	valueStr := s[:len(s)-1]

	var value int
	_, err := fmt.Sscanf(valueStr, "%d", &value)
	if err != nil {
		return 0, fmt.Errorf("invalid duration value in %q: %v", s, err)
	}
	if value <= 0 {
		return 0, fmt.Errorf("duration must be positive, got %d", value)
	}

	switch unit {
	case 'm':
		return time.Duration(value) * time.Minute, nil
	case 'h':
		return time.Duration(value) * time.Hour, nil
	case 'd':
		return time.Duration(value) * 24 * time.Hour, nil
	case 'y':
		return time.Duration(value) * 365 * 24 * time.Hour, nil
	default:
		return 0, fmt.Errorf("invalid duration unit '%c' (valid: m, h, d, y)", unit)
	}
}
