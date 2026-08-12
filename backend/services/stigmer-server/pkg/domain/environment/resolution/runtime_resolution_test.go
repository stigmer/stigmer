package resolution

import (
	"context"
	"testing"

	environmentv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/environment/v1"
	apiresourcepb "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource/apiresourcekind"
	"github.com/stigmer/stigmer/backend/libs/go/store"
	"github.com/stigmer/stigmer/backend/libs/go/store/sqlite"
	"github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/encryption"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

const testKey = "0123456789abcdef0123456789abcdef" // 32 bytes

func newTestStore(t *testing.T) store.Store {
	t.Helper()
	s, err := sqlite.NewStore(t.TempDir() + "/test.sqlite")
	require.NoError(t, err)
	t.Cleanup(func() { s.Close() })
	return s
}

func keyedService(t *testing.T, s store.Store) (*RuntimeResolutionService, *encryption.SecretService) {
	t.Helper()
	secretService, err := encryption.NewSecretService([]byte(testKey))
	require.NoError(t, err)
	return NewRuntimeResolutionService(s, secretService), secretService
}

// seedEnvironment persists an environment directly (no controller pipeline)
// so tests control the exact at-rest bytes — encrypted, plaintext-legacy,
// or corrupt.
func seedEnvironment(t *testing.T, s store.Store, slug string, data map[string]*environmentv1.EnvironmentValue) {
	t.Helper()
	env := &environmentv1.Environment{
		ApiVersion: "agentic.stigmer.ai/v1",
		Kind:       "Environment",
		Metadata: &apiresourcepb.ApiResourceMetadata{
			Id:   "env_" + slug,
			Name: slug,
			Slug: slug,
			Org:  "test-org",
		},
		Spec: &environmentv1.EnvironmentSpec{Data: data},
	}
	require.NoError(t, s.SaveResource(context.Background(),
		apiresourcekind.ApiResourceKind_environment, env.GetMetadata().GetId(), env))
}

func envRef(slug string) *apiresourcepb.ApiResourceReference {
	return &apiresourcepb.ApiResourceReference{
		Kind: apiresourcekind.ApiResourceKind_environment,
		Org:  "test-org",
		Slug: slug,
	}
}

func TestResolveByReference_DecryptsSecrets(t *testing.T) {
	s := newTestStore(t)
	svc, secretService := keyedService(t, s)

	ciphertext, err := secretService.Encrypt("real-secret")
	require.NoError(t, err)
	seedEnvironment(t, s, "keyed-env", map[string]*environmentv1.EnvironmentValue{
		"API_TOKEN":  {Value: ciphertext, IsSecret: true, Description: "a token"},
		"PLAIN_HOST": {Value: "example.com", IsSecret: false},
	})

	resolved, err := svc.ResolveByReference(context.Background(), envRef("keyed-env"))
	require.NoError(t, err)

	assert.Equal(t, "real-secret", resolved.GetSpec().GetData()["API_TOKEN"].GetValue(),
		"secret must resolve decrypted for the execution-context merge")
	assert.True(t, resolved.GetSpec().GetData()["API_TOKEN"].GetIsSecret(),
		"is_secret must survive resolution (EC merge propagates it)")
	assert.Equal(t, "example.com", resolved.GetSpec().GetData()["PLAIN_HOST"].GetValue(),
		"non-secret values pass through untouched")
}

func TestResolveByReference_LegacyPlaintextPassesThrough(t *testing.T) {
	s := newTestStore(t)
	svc, _ := keyedService(t, s)

	// A pre-oss#405 row: is_secret but stored plaintext. Resolution must
	// hand it through unchanged — zero-migration contract.
	seedEnvironment(t, s, "legacy-env", map[string]*environmentv1.EnvironmentValue{
		"OLD_SECRET": {Value: "stored-before-encryption", IsSecret: true},
	})

	resolved, err := svc.ResolveByReference(context.Background(), envRef("legacy-env"))
	require.NoError(t, err)
	assert.Equal(t, "stored-before-encryption", resolved.GetSpec().GetData()["OLD_SECRET"].GetValue())
}

func TestResolveByReference_DropsUndecryptableValuePerKey(t *testing.T) {
	s := newTestStore(t)
	svc, secretService := keyedService(t, s)

	good, err := secretService.Encrypt("good-secret")
	require.NoError(t, err)
	seedEnvironment(t, s, "corrupt-env", map[string]*environmentv1.EnvironmentValue{
		"GOOD_KEY": {Value: good, IsSecret: true},
		// Ciphertext-shaped but not valid base64 payload — tampered data.
		"BAD_KEY": {Value: "enc:v1:!!!not-base64!!!", IsSecret: true},
	})

	resolved, err := svc.ResolveByReference(context.Background(), envRef("corrupt-env"))
	require.NoError(t, err, "a single corrupt value must not fail the whole resolution")

	assert.Equal(t, "good-secret", resolved.GetSpec().GetData()["GOOD_KEY"].GetValue())
	_, present := resolved.GetSpec().GetData()["BAD_KEY"]
	assert.False(t, present, "the undecryptable key must be dropped, not passed through as ciphertext")
}

func TestResolveByReference_FailsLoudWhenKeyMissingForCiphertext(t *testing.T) {
	s := newTestStore(t)

	// Encrypt with a real key, then resolve with a keyless service — the
	// "key file lost" scenario. Silently skipping would start executions
	// missing credentials; the resolution must fail loud instead.
	keyedSecrets, err := encryption.NewSecretService([]byte(testKey))
	require.NoError(t, err)
	ciphertext, err := keyedSecrets.Encrypt("unreachable-secret")
	require.NoError(t, err)
	seedEnvironment(t, s, "stranded-env", map[string]*environmentv1.EnvironmentValue{
		"API_TOKEN": {Value: ciphertext, IsSecret: true},
	})

	keyless, err := encryption.NewSecretService(nil)
	require.NoError(t, err)
	svc := NewRuntimeResolutionService(s, keyless)

	_, err = svc.ResolveByReference(context.Background(), envRef("stranded-env"))
	require.Error(t, err, "ciphertext without a key must fail resolution")
	assert.Contains(t, err.Error(), "no encryption key is configured")
}

func TestResolveByReference_LookupSemanticsMatchTheRpcPath(t *testing.T) {
	s := newTestStore(t)
	svc, _ := keyedService(t, s)

	seedEnvironment(t, s, "lookup-env", map[string]*environmentv1.EnvironmentValue{
		"K": {Value: "v", IsSecret: false},
	})

	t.Run("unknown slug is NotFound", func(t *testing.T) {
		_, err := svc.ResolveByReference(context.Background(), envRef("no-such-env"))
		assert.Equal(t, codes.NotFound, status.Code(err))
	})

	t.Run("wrong org is NotFound", func(t *testing.T) {
		ref := envRef("lookup-env")
		ref.Org = "other-org"
		_, err := svc.ResolveByReference(context.Background(), ref)
		assert.Equal(t, codes.NotFound, status.Code(err))
	})

	t.Run("missing org is InvalidArgument (org-scoped kind)", func(t *testing.T) {
		ref := envRef("lookup-env")
		ref.Org = ""
		_, err := svc.ResolveByReference(context.Background(), ref)
		assert.Equal(t, codes.InvalidArgument, status.Code(err))
	})

	t.Run("kind mismatch is InvalidArgument", func(t *testing.T) {
		ref := envRef("lookup-env")
		ref.Kind = apiresourcekind.ApiResourceKind_agent
		_, err := svc.ResolveByReference(context.Background(), ref)
		assert.Equal(t, codes.InvalidArgument, status.Code(err))
	})

	t.Run("missing slug is InvalidArgument", func(t *testing.T) {
		ref := envRef("")
		_, err := svc.ResolveByReference(context.Background(), ref)
		assert.Equal(t, codes.InvalidArgument, status.Code(err))
	})
}

// TestResolveByReference_DoesNotMutateTheStore pins that decryption happens
// on the freshly-unmarshalled copy: after a resolve, the at-rest bytes are
// still ciphertext.
func TestResolveByReference_DoesNotMutateTheStore(t *testing.T) {
	s := newTestStore(t)
	svc, secretService := keyedService(t, s)

	ciphertext, err := secretService.Encrypt("stay-encrypted")
	require.NoError(t, err)
	seedEnvironment(t, s, "immutable-env", map[string]*environmentv1.EnvironmentValue{
		"API_TOKEN": {Value: ciphertext, IsSecret: true},
	})

	_, err = svc.ResolveByReference(context.Background(), envRef("immutable-env"))
	require.NoError(t, err)

	stored := &environmentv1.Environment{}
	require.NoError(t, s.GetResource(context.Background(),
		apiresourcekind.ApiResourceKind_environment, "env_immutable-env", stored))
	assert.Equal(t, ciphertext, stored.GetSpec().GetData()["API_TOKEN"].GetValue(),
		"resolution must never write plaintext back to the store")
}
