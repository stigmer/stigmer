package root

import (
	"context"
	"crypto/sha256"
	"fmt"
	"time"

	"github.com/pkg/errors"
	"github.com/spf13/cobra"

	apikeyv1 "github.com/stigmer/stigmer/sdk/go/proto/ai/stigmer/iam/apikey/v1"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/apikey"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/backend"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/clierr"
)

// NewApiKeyCommand creates the standalone apikey command group.
func NewApiKeyCommand() *cobra.Command {
	cmd := &cobra.Command{
		Use:   "apikey",
		Short: "Manage API keys for Stigmer Cloud authentication",
		Long: `Create and manage API keys for programmatic access to Stigmer Cloud.

API keys are an alternative to browser-based OAuth authentication.
They are ideal for CI/CD pipelines, automation scripts, and service accounts.

Use the unified verbs for common operations:
  stigmer get apikey <id>       Get API key details
  stigmer list apikey           List all API keys
  stigmer delete apikey <id>    Delete an API key`,
		Example: `  # Create a new API key
  stigmer apikey create --name "ci-pipeline"

  # Create a key that never expires
  stigmer apikey create --name "automation" --never-expires

  # Create a key with custom expiration
  stigmer apikey create --name "temp" --expires-in 7d

  # Look up which key matches a raw token
  stigmer apikey fingerprint <raw-key>`,
	}

	cmd.AddCommand(newApiKeyCreateCommand())
	cmd.AddCommand(newApiKeyFingerprintCommand())

	return cmd
}

func newApiKeyCreateCommand() *cobra.Command {
	var name string
	var neverExpires bool
	var expiresIn string

	cmd := &cobra.Command{
		Use:   "create",
		Short: "Create a new API key",
		Long: `Create a new API key for programmatic access to Stigmer Cloud.

By default, keys expire in 90 days. Use --never-expires for permanent keys
or --expires-in to set a custom duration.

IMPORTANT: The raw API key is displayed only once at creation time.
Save it immediately — it cannot be retrieved later.`,
		Example: `  # Create with a descriptive name
  stigmer apikey create --name "github-actions"

  # Never-expiring key for automation
  stigmer apikey create --name "service-account" --never-expires

  # Key that expires in 30 days
  stigmer apikey create --name "temp-key" --expires-in 30d

  # Duration units: m (minutes), h (hours), d (days), y (years)
  stigmer apikey create --name "short-lived" --expires-in 6h`,
		RunE: func(cmd *cobra.Command, args []string) error {
			err := runApiKeyCreate(name, neverExpires, expiresIn)
			if err != nil {
				clierr.Handle(err)
			}
			return nil
		},
	}

	cmd.Flags().StringVar(&name, "name", "", "display name for the API key")
	cmd.Flags().BoolVar(&neverExpires, "never-expires", false, "create a key that never expires")
	cmd.Flags().StringVar(&expiresIn, "expires-in", "", "custom expiration duration (e.g. 30d, 6h, 1y)")

	return cmd
}

func newApiKeyFingerprintCommand() *cobra.Command {
	return &cobra.Command{
		Use:   "fingerprint <raw-key>",
		Short: "Look up which API key matches a raw token",
		Long: `Compute the SHA-256 hash of a raw API key token and look up the
corresponding API key record in the backend.

This is useful for identifying which API key a given token belongs to,
without exposing the token to the backend in plaintext.`,
		Example: `  stigmer apikey fingerprint stk_abc123...`,
		Args:    cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			err := runApiKeyFingerprint(args[0])
			if err != nil {
				clierr.Handle(err)
			}
			return nil
		},
	}
}

func runApiKeyCreate(name string, neverExpires bool, expiresIn string) error {
	client, err := backend.NewStigmerClient()
	if err != nil {
		return errors.Wrap(err, "failed to connect to backend")
	}
	defer client.Close()
	created, err := apikey.Create(&apikey.CreateOptions{
		Name:         name,
		NeverExpires: neverExpires,
		ExpiresIn:    expiresIn,
		Client:       client,
	})
	if err != nil {
		return err
	}

	apikey.DisplayCreateResult(created)
	return nil
}

func runApiKeyFingerprint(rawKey string) error {
	hash := sha256.Sum256([]byte(rawKey))
	hashHex := fmt.Sprintf("%x", hash)

	client, err := backend.NewStigmerClient()
	if err != nil {
		return errors.Wrap(err, "failed to connect to backend")
	}
	defer client.Close()

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	key, err := client.ApiKey.GetByKeyHash(ctx, &apikeyv1.ApiKeyHash{Value: hashHex})
	if err != nil {
		return errors.Wrap(err, "failed to look up API key by hash")
	}

	apikey.DisplayGetResult(key, "table")
	return nil
}
