package environment

import (
	"context"
	"strings"
	"testing"

	environmentv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/environment/v1"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource/apiresourcekind"
	"github.com/stigmer/stigmer/backend/libs/go/store"
	"github.com/stigmer/stigmer/backend/libs/go/store/sqlite"
	envsteps "github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/domain/environment/controller/steps"
	"github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/encryption"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// TestEnvironmentEncryptionAtRest pins the oss#405 contract with a REAL
// encryption key: every is_secret value rests as enc:v1: ciphertext, every
// response redacts it, getSecretValue is the only reveal path, and the
// marker round-trip never double-encrypts. The keyless twin of this harness
// (setupTestController) pins the disabled-encryption pass-through in
// TestEnvironmentEncryptionDisabledStoresPlaintext below.

const testEncryptionKey = "0123456789abcdef0123456789abcdef" // 32 bytes

// setupKeyedTestController builds a controller whose SecretService holds a
// real AES-256 key — the production configuration (the OSS key
// auto-generates via NewSecretServiceFromEnv).
func setupKeyedTestController(t *testing.T) (*EnvironmentController, store.Store, *encryption.SecretService) {
	t.Helper()
	s, err := sqlite.NewStore(t.TempDir() + "/test.sqlite")
	require.NoError(t, err, "store should initialize")

	secretService, err := encryption.NewSecretService([]byte(testEncryptionKey))
	require.NoError(t, err, "keyed secret service should initialize")

	return NewEnvironmentController(s, secretService), s, secretService
}

// loadStored reads the persisted environment straight from the store,
// bypassing every RPC boundary — the at-rest truth.
func loadStored(t *testing.T, s store.Store, id string) *environmentv1.Environment {
	t.Helper()
	stored := &environmentv1.Environment{}
	require.NoError(t, s.GetResource(context.Background(),
		apiresourcekind.ApiResourceKind_environment, id, stored))
	return stored
}

func newSecretEnv(name string) *environmentv1.Environment {
	return &environmentv1.Environment{
		ApiVersion: "agentic.stigmer.ai/v1",
		Kind:       "Environment",
		Metadata: &apiresource.ApiResourceMetadata{
			Name: name,
			Org:  "test-org",
		},
		Spec: &environmentv1.EnvironmentSpec{
			Data: map[string]*environmentv1.EnvironmentValue{
				"API_TOKEN":  {Value: "s3cr3t-token", IsSecret: true, Description: "a token"},
				"PLAIN_HOST": {Value: "example.com", IsSecret: false},
			},
		},
	}
}

func TestEnvironmentEncryptionAtRest_Create(t *testing.T) {
	controller, s, secretService := setupKeyedTestController(t)
	defer s.Close()
	ctx := contextWithEnvironmentKind()

	created, err := controller.Create(ctx, newSecretEnv("Keyed Create"))
	require.NoError(t, err)

	stored := loadStored(t, s, created.GetMetadata().GetId())
	storedSecret := stored.GetSpec().GetData()["API_TOKEN"].GetValue()
	assert.True(t, strings.HasPrefix(storedSecret, encryption.EncryptedPrefix),
		"secret must rest as enc:v1: ciphertext, got %q", storedSecret)
	decrypted, err := secretService.Decrypt(storedSecret)
	require.NoError(t, err)
	assert.Equal(t, "s3cr3t-token", decrypted, "ciphertext must decrypt to the original")

	assert.Equal(t, "example.com", stored.GetSpec().GetData()["PLAIN_HOST"].GetValue(),
		"non-secret values must rest plaintext")

	// The description survives encryption in place.
	assert.Equal(t, "a token", stored.GetSpec().GetData()["API_TOKEN"].GetDescription())
}

func TestEnvironmentEncryptionAtRest_UpdateVariables(t *testing.T) {
	controller, s, secretService := setupKeyedTestController(t)
	defer s.Close()
	ctx := contextWithEnvironmentKind()

	created, err := controller.Create(ctx, newSecretEnv("Keyed Merge"))
	require.NoError(t, err)

	// The vendor OAuth token path (ManagedEnvironmentService.UpdateSecrets)
	// rides this exact RPC — the oss#405 headline exposure.
	updated, err := controller.UpdateVariables(ctx, &environmentv1.UpdateEnvironmentVariablesRequest{
		EnvironmentId: created.GetMetadata().GetId(),
		Variables: map[string]*environmentv1.EnvironmentValue{
			"OAUTH_ACCESS_TOKEN": {Value: "vendor-access-token", IsSecret: true, Description: "vendor token"},
		},
	})
	require.NoError(t, err)
	assert.Equal(t, envsteps.RedactedMarker, updated.GetSpec().GetData()["OAUTH_ACCESS_TOKEN"].GetValue(),
		"updateVariables response must redact the merged secret")

	stored := loadStored(t, s, created.GetMetadata().GetId())
	storedToken := stored.GetSpec().GetData()["OAUTH_ACCESS_TOKEN"].GetValue()
	assert.True(t, strings.HasPrefix(storedToken, encryption.EncryptedPrefix),
		"merged secret must rest encrypted, got %q", storedToken)
	decrypted, err := secretService.Decrypt(storedToken)
	require.NoError(t, err)
	assert.Equal(t, "vendor-access-token", decrypted)
	assert.Equal(t, "vendor token", stored.GetSpec().GetData()["OAUTH_ACCESS_TOKEN"].GetDescription(),
		"encryption must preserve the description")

	revealed, err := controller.GetSecretValue(ctx, &environmentv1.EnvironmentSecretValueInput{
		EnvironmentId: created.GetMetadata().GetId(),
		Key:           "OAUTH_ACCESS_TOKEN",
	})
	require.NoError(t, err)
	assert.Equal(t, "vendor-access-token", revealed.GetValue(),
		"getSecretValue must round-trip the encrypted value")
}

// TestEnvironmentEncryption_MarkerRoundTripNeverDoubleEncrypts pins the
// sentinels→encrypt ordering: an update carrying the redaction marker
// restores the STORED ciphertext, and the encrypt step's idempotent
// pass-through must leave it untouched — after the round-trip the value
// still decrypts to the original in one pass.
func TestEnvironmentEncryption_MarkerRoundTripNeverDoubleEncrypts(t *testing.T) {
	controller, s, secretService := setupKeyedTestController(t)
	defer s.Close()
	ctx := contextWithEnvironmentKind()

	created, err := controller.Create(ctx, newSecretEnv("Keyed Marker Roundtrip"))
	require.NoError(t, err)
	ciphertextBefore := loadStored(t, s, created.GetMetadata().GetId()).GetSpec().GetData()["API_TOKEN"].GetValue()

	// The client round-trip: Get (redacted) → edit something else → Update.
	fetched, err := controller.Get(ctx, &apiresource.ApiResourceId{Value: created.GetMetadata().GetId()})
	require.NoError(t, err)
	require.Equal(t, envsteps.RedactedMarker, fetched.GetSpec().GetData()["API_TOKEN"].GetValue())
	fetched.Spec.Description = "edited elsewhere"

	_, err = controller.Update(ctx, fetched)
	require.NoError(t, err)

	ciphertextAfter := loadStored(t, s, created.GetMetadata().GetId()).GetSpec().GetData()["API_TOKEN"].GetValue()
	assert.Equal(t, ciphertextBefore, ciphertextAfter,
		"the marker round-trip must preserve the stored ciphertext byte-for-byte")

	decrypted, err := secretService.Decrypt(ciphertextAfter)
	require.NoError(t, err)
	assert.Equal(t, "s3cr3t-token", decrypted, "one decrypt pass must recover the original — no double encryption")
}

// TestEnvironmentRedaction_AllResponseBoundaries table-drives the oss#405
// response contract across every Environment-returning RPC (apply inherits
// via create/update delegation): the secret comes back as the marker with
// is_secret preserved, the non-secret value comes back verbatim. The
// channelapp every-arm tripwire, applied to RPC boundaries.
func TestEnvironmentRedaction_AllResponseBoundaries(t *testing.T) {
	ctx := contextWithEnvironmentKind()

	cases := []struct {
		rpc  string
		call func(t *testing.T, c *EnvironmentController, created *environmentv1.Environment) *environmentv1.Environment
	}{
		{"create", func(t *testing.T, c *EnvironmentController, created *environmentv1.Environment) *environmentv1.Environment {
			return created
		}},
		{"get", func(t *testing.T, c *EnvironmentController, created *environmentv1.Environment) *environmentv1.Environment {
			env, err := c.Get(ctx, &apiresource.ApiResourceId{Value: created.GetMetadata().GetId()})
			require.NoError(t, err)
			return env
		}},
		{"getByReference", func(t *testing.T, c *EnvironmentController, created *environmentv1.Environment) *environmentv1.Environment {
			env, err := c.GetByReference(ctx, &apiresource.ApiResourceReference{
				Kind: apiresourcekind.ApiResourceKind_environment,
				Org:  "test-org",
				Slug: created.GetMetadata().GetSlug(),
			})
			require.NoError(t, err)
			return env
		}},
		{"list", func(t *testing.T, c *EnvironmentController, created *environmentv1.Environment) *environmentv1.Environment {
			list, err := c.List(ctx, &environmentv1.ListEnvironmentsRequest{Org: "test-org"})
			require.NoError(t, err)
			for _, item := range list.GetItems() {
				if item.GetMetadata().GetId() == created.GetMetadata().GetId() {
					return item
				}
			}
			t.Fatal("created environment missing from list")
			return nil
		}},
		{"update", func(t *testing.T, c *EnvironmentController, created *environmentv1.Environment) *environmentv1.Environment {
			fetched, err := c.Get(ctx, &apiresource.ApiResourceId{Value: created.GetMetadata().GetId()})
			require.NoError(t, err)
			fetched.Spec.Description = "updated"
			env, err := c.Update(ctx, fetched)
			require.NoError(t, err)
			return env
		}},
		{"updateVariables", func(t *testing.T, c *EnvironmentController, created *environmentv1.Environment) *environmentv1.Environment {
			env, err := c.UpdateVariables(ctx, &environmentv1.UpdateEnvironmentVariablesRequest{
				EnvironmentId: created.GetMetadata().GetId(),
				Variables: map[string]*environmentv1.EnvironmentValue{
					"EXTRA": {Value: "extra-value", IsSecret: false},
				},
			})
			require.NoError(t, err)
			return env
		}},
		{"removeVariables", func(t *testing.T, c *EnvironmentController, created *environmentv1.Environment) *environmentv1.Environment {
			env, err := c.RemoveVariables(ctx, &environmentv1.RemoveEnvironmentVariablesRequest{
				EnvironmentId: created.GetMetadata().GetId(),
				Keys:          []string{"PLAIN_HOST"},
			})
			require.NoError(t, err)
			// PLAIN_HOST is gone in this response; only assert the secret.
			assert.Equal(t, envsteps.RedactedMarker, env.GetSpec().GetData()["API_TOKEN"].GetValue(),
				"removeVariables response must redact secrets")
			return nil // non-secret arm not applicable
		}},
		{"updateVisibility", func(t *testing.T, c *EnvironmentController, created *environmentv1.Environment) *environmentv1.Environment {
			env, err := c.UpdateVisibility(ctx, &apiresource.UpdateVisibilityInput{
				ResourceId: created.GetMetadata().GetId(),
				Visibility: apiresource.ApiResourceVisibility_visibility_org,
			})
			require.NoError(t, err)
			return env
		}},
		{"delete", func(t *testing.T, c *EnvironmentController, created *environmentv1.Environment) *environmentv1.Environment {
			env, err := c.Delete(ctx, &apiresource.ApiResourceDeleteInput{ResourceId: created.GetMetadata().GetId()})
			require.NoError(t, err)
			return env
		}},
	}

	for _, tc := range cases {
		t.Run(tc.rpc, func(t *testing.T) {
			controller, s, _ := setupKeyedTestController(t)
			defer s.Close()

			created, err := controller.Create(ctx, newSecretEnv("Boundary "+tc.rpc))
			require.NoError(t, err)

			env := tc.call(t, controller, created)
			if env == nil {
				return
			}
			secret := env.GetSpec().GetData()["API_TOKEN"]
			require.NotNil(t, secret, "%s response must carry the secret entry", tc.rpc)
			assert.Equal(t, envsteps.RedactedMarker, secret.GetValue(),
				"%s response must redact the secret value", tc.rpc)
			assert.True(t, secret.GetIsSecret(), "%s must preserve is_secret", tc.rpc)
			assert.Equal(t, "example.com", env.GetSpec().GetData()["PLAIN_HOST"].GetValue(),
				"%s must return non-secret values verbatim", tc.rpc)
		})
	}
}

// TestEnvironmentRedaction_IsResponseOnly pins that redaction mutates only
// the response copy: repeated reads keep redacting, and the reveal path
// keeps decrypting — the marker never leaks into the store.
func TestEnvironmentRedaction_IsResponseOnly(t *testing.T) {
	controller, s, _ := setupKeyedTestController(t)
	defer s.Close()
	ctx := contextWithEnvironmentKind()

	created, err := controller.Create(ctx, newSecretEnv("Response Only"))
	require.NoError(t, err)
	id := created.GetMetadata().GetId()

	for i := 0; i < 2; i++ {
		fetched, err := controller.Get(ctx, &apiresource.ApiResourceId{Value: id})
		require.NoError(t, err)
		assert.Equal(t, envsteps.RedactedMarker, fetched.GetSpec().GetData()["API_TOKEN"].GetValue())
	}

	revealed, err := controller.GetSecretValue(ctx, &environmentv1.EnvironmentSecretValueInput{
		EnvironmentId: id, Key: "API_TOKEN",
	})
	require.NoError(t, err)
	assert.Equal(t, "s3cr3t-token", revealed.GetValue(),
		"reveal must still decrypt after redacted reads — redaction never reaches the store")

	stored := loadStored(t, s, id)
	assert.True(t, strings.HasPrefix(stored.GetSpec().GetData()["API_TOKEN"].GetValue(), encryption.EncryptedPrefix),
		"the store must hold ciphertext, never the marker")
}

// TestEnvironmentEncryptionDisabledStoresPlaintext pins the WARN-and-pass-
// through convention (oss#394): with no key configured, secrets rest
// plaintext — but responses still redact (redaction is not gated on
// encryption).
func TestEnvironmentEncryptionDisabledStoresPlaintext(t *testing.T) {
	controller, s := setupTestController(t) // keyless harness
	defer s.Close()
	ctx := contextWithEnvironmentKind()

	created, err := controller.Create(ctx, newSecretEnv("Keyless Create"))
	require.NoError(t, err)

	stored := loadStored(t, s, created.GetMetadata().GetId())
	assert.Equal(t, "s3cr3t-token", stored.GetSpec().GetData()["API_TOKEN"].GetValue(),
		"keyless deployments pass secrets through to the store as plaintext")

	assert.Equal(t, envsteps.RedactedMarker, created.GetSpec().GetData()["API_TOKEN"].GetValue(),
		"responses redact even when encryption is disabled")
}
