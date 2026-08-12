package executioncontext

// Secret-handling contract for the ExecutionContext controller (oss#535):
// encrypt at write, redact every user-shaped read, decrypt only for a
// scope-bound runner token on getByExecutionId. The OSS port of the cloud
// stigmer-cloud#152/#155 contract.

import (
	"context"
	"strings"
	"testing"

	executioncontextv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/executioncontext/v1"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource/apiresourcekind"
	"github.com/stigmer/stigmer/backend/libs/go/store/sqlite"
	envsteps "github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/domain/environment/controller/steps"
	"github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/encryption"
	"github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/runnerauth"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/metadata"
	"google.golang.org/grpc/status"
)

func testSecretService(t *testing.T) *encryption.SecretService {
	t.Helper()
	key := make([]byte, 32)
	copy(key, "0123456789abcdef0123456789abcdef")
	svc, err := encryption.NewSecretService(key)
	require.NoError(t, err)
	return svc
}

func testRunnerAuth(t *testing.T) *runnerauth.Service {
	t.Helper()
	key := make([]byte, 32)
	copy(key, "fedcba9876543210fedcba9876543210")
	return runnerauth.NewService(key)
}

// contextWithRunnerToken simulates the runner presenting its scoped token as
// a Bearer authorization header, the way the gRPC transport delivers it.
func contextWithRunnerToken(t *testing.T, auth *runnerauth.Service, executionID string) context.Context {
	t.Helper()
	token, _, err := auth.Mint(executionID, 0)
	require.NoError(t, err)
	return metadata.NewIncomingContext(
		contextWithExecutionContextKind(),
		metadata.Pairs("authorization", "Bearer "+token),
	)
}

func newSecretsTestEC(name, executionID string) *executioncontextv1.ExecutionContext {
	return &executioncontextv1.ExecutionContext{
		ApiVersion: "agentic.stigmer.ai/v1",
		Kind:       "ExecutionContext",
		Metadata: &apiresource.ApiResourceMetadata{
			Name: name,
			Org:  "test-org",
		},
		Spec: &executioncontextv1.ExecutionContextSpec{
			ExecutionId: executionID,
			Data: map[string]*executioncontextv1.ExecutionValue{
				"API_TOKEN": {Value: "super-secret-token", IsSecret: true},
				"REGION":    {Value: "us-east-1", IsSecret: false},
				"EMPTY_SEC": {Value: "", IsSecret: true},
			},
		},
	}
}

func TestSecrets_EncryptedAtRest(t *testing.T) {
	controller, st := setupTestController(t)
	defer st.Close()

	created, err := controller.Create(contextWithExecutionContextKind(), newSecretsTestEC("At Rest", "wex_atrest"))
	require.NoError(t, err)

	// A fresh unmarshal straight from the store shows the at-rest state:
	// the secret is ciphertext, the non-secret is plaintext, the empty
	// secret declaration stays empty.
	stored := &executioncontextv1.ExecutionContext{}
	require.NoError(t, st.GetResource(context.Background(),
		apiresourcekind.ApiResourceKind_execution_context, created.GetMetadata().GetId(), stored))

	secret := stored.GetSpec().GetData()["API_TOKEN"]
	assert.True(t, strings.HasPrefix(secret.GetValue(), encryption.EncryptedPrefix),
		"is_secret value must rest encrypted, got %q", secret.GetValue())
	assert.NotContains(t, secret.GetValue(), "super-secret-token")
	assert.True(t, secret.GetIsSecret())

	assert.Equal(t, "us-east-1", stored.GetSpec().GetData()["REGION"].GetValue(),
		"non-secret values rest plaintext")
	assert.Equal(t, "", stored.GetSpec().GetData()["EMPTY_SEC"].GetValue(),
		"empty secret declarations stay empty")
}

func TestSecrets_UserShapedReadsRedact(t *testing.T) {
	// One table for every boundary that answers a caller outside the runner
	// lane: the create echo, get, getByReference, the delete echo, and
	// getByExecutionId without a token. All five must present the identical
	// contract: marker for non-empty secrets, is_secret preserved,
	// non-secrets and empty secrets untouched.
	controller, st := setupTestController(t)
	defer st.Close()

	created, err := controller.Create(contextWithExecutionContextKind(), newSecretsTestEC("Redact Table", "wex_redact"))
	require.NoError(t, err)

	reads := map[string]func() (*executioncontextv1.ExecutionContext, error){
		"create echo": func() (*executioncontextv1.ExecutionContext, error) {
			return created, nil
		},
		"get": func() (*executioncontextv1.ExecutionContext, error) {
			return controller.Get(contextWithExecutionContextKind(),
				&executioncontextv1.ExecutionContextId{Value: created.GetMetadata().GetId()})
		},
		"getByReference": func() (*executioncontextv1.ExecutionContext, error) {
			return controller.GetByReference(contextWithExecutionContextKind(),
				&apiresource.ApiResourceReference{
					Kind: apiresourcekind.ApiResourceKind_execution_context,
					Slug: created.GetMetadata().GetSlug(),
				})
		},
		"getByExecutionId without token": func() (*executioncontextv1.ExecutionContext, error) {
			return controller.GetByExecutionId(contextWithExecutionContextKind(),
				&executioncontextv1.ExecutionContextExecutionIdInput{ExecutionId: "wex_redact"})
		},
		// Runs last: it removes the row.
		"delete echo": func() (*executioncontextv1.ExecutionContext, error) {
			return controller.Delete(contextWithExecutionContextKind(),
				&apiresource.ApiResourceDeleteInput{ResourceId: created.GetMetadata().GetId()})
		},
	}

	for _, name := range []string{"create echo", "get", "getByReference", "getByExecutionId without token", "delete echo"} {
		ec, err := reads[name]()
		require.NoError(t, err, name)
		data := ec.GetSpec().GetData()

		assert.Equal(t, envsteps.RedactedMarker, data["API_TOKEN"].GetValue(),
			"%s: non-empty secret must be the redaction marker", name)
		assert.True(t, data["API_TOKEN"].GetIsSecret(), "%s: is_secret preserved", name)
		assert.Equal(t, "us-east-1", data["REGION"].GetValue(),
			"%s: non-secret values are never redacted", name)
		assert.Equal(t, "", data["EMPTY_SEC"].GetValue(),
			"%s: empty secret declarations stay empty (a marker would fake a stored value)", name)
	}
}

func TestSecrets_RedactionNeverReachesTheStore(t *testing.T) {
	controller, st := setupTestController(t)
	defer st.Close()

	created, err := controller.Create(contextWithExecutionContextKind(), newSecretsTestEC("Store Immutability", "wex_immut"))
	require.NoError(t, err)

	// Read through every redacting boundary, then confirm the stored row
	// still holds decryptable ciphertext — redaction happens on response
	// copies only.
	_, err = controller.Get(contextWithExecutionContextKind(),
		&executioncontextv1.ExecutionContextId{Value: created.GetMetadata().GetId()})
	require.NoError(t, err)

	stored := &executioncontextv1.ExecutionContext{}
	require.NoError(t, st.GetResource(context.Background(),
		apiresourcekind.ApiResourceKind_execution_context, created.GetMetadata().GetId(), stored))
	assert.True(t, strings.HasPrefix(stored.GetSpec().GetData()["API_TOKEN"].GetValue(), encryption.EncryptedPrefix),
		"the store must never hold the redaction marker")
}

func TestSecrets_GetByExecutionIdDispatch(t *testing.T) {
	// The decrypt gate: only a valid, unexpired token bound to THIS
	// execution decrypts; every other credential state falls closed to
	// redaction as a successful response.
	controller, st := setupTestController(t)
	defer st.Close()

	auth := testRunnerAuth(t)
	_, err := controller.Create(contextWithExecutionContextKind(), newSecretsTestEC("Dispatch", "wex_dispatch"))
	require.NoError(t, err)

	read := func(ctx context.Context) *executioncontextv1.ExecutionContext {
		t.Helper()
		ec, err := controller.GetByExecutionId(ctx,
			&executioncontextv1.ExecutionContextExecutionIdInput{ExecutionId: "wex_dispatch"})
		require.NoError(t, err)
		return ec
	}

	t.Run("scope-bound token decrypts", func(t *testing.T) {
		ec := read(contextWithRunnerToken(t, auth, "wex_dispatch"))
		assert.Equal(t, "super-secret-token", ec.GetSpec().GetData()["API_TOKEN"].GetValue())
		assert.True(t, ec.GetSpec().GetData()["API_TOKEN"].GetIsSecret(), "is_secret survives decryption")
		assert.Equal(t, "us-east-1", ec.GetSpec().GetData()["REGION"].GetValue())
	})

	t.Run("token for another execution redacts", func(t *testing.T) {
		ec := read(contextWithRunnerToken(t, auth, "wex_someone_else"))
		assert.Equal(t, envsteps.RedactedMarker, ec.GetSpec().GetData()["API_TOKEN"].GetValue())
	})

	t.Run("malformed token redacts", func(t *testing.T) {
		ctx := metadata.NewIncomingContext(contextWithExecutionContextKind(),
			metadata.Pairs("authorization", "Bearer not-a-real-token"))
		ec := read(ctx)
		assert.Equal(t, envsteps.RedactedMarker, ec.GetSpec().GetData()["API_TOKEN"].GetValue())
	})

	t.Run("non-bearer authorization redacts", func(t *testing.T) {
		token, _, err := auth.Mint("wex_dispatch", 0)
		require.NoError(t, err)
		ctx := metadata.NewIncomingContext(contextWithExecutionContextKind(),
			metadata.Pairs("authorization", "Basic "+token))
		ec := read(ctx)
		assert.Equal(t, envsteps.RedactedMarker, ec.GetSpec().GetData()["API_TOKEN"].GetValue())
	})

	t.Run("no metadata at all redacts", func(t *testing.T) {
		ec := read(contextWithExecutionContextKind())
		assert.Equal(t, envsteps.RedactedMarker, ec.GetSpec().GetData()["API_TOKEN"].GetValue())
	})
}

func TestSecrets_ForgedCiphertextInputRejected(t *testing.T) {
	// The write-boundary guard (the oss#395 / cloud#229 idiom): input shaped
	// like stored ciphertext is refused so the encrypt step's idempotent
	// pass-through can't be used to smuggle a forged or replayed blob.
	controller, st := setupTestController(t)
	defer st.Close()

	ec := newSecretsTestEC("Forged", "wex_forged")
	ec.Spec.Data["API_TOKEN"].Value = encryption.EncryptedPrefix + "Zm9yZ2VkLWJsb2I="

	_, err := controller.Create(contextWithExecutionContextKind(), ec)
	require.Error(t, err)
	assert.Equal(t, codes.InvalidArgument, status.Code(err))
}

func TestSecrets_LegacyPlaintextRowsServeWithoutMigration(t *testing.T) {
	// A pre-oss#535 row holds plaintext secrets. Reads still redact it
	// (redaction is representation-agnostic), and the runner lane returns
	// it as-is (Decrypt passes non-ciphertext through) — zero migration.
	controller, st := setupTestController(t)
	defer st.Close()

	auth := testRunnerAuth(t)

	// Simulate the legacy row by persisting through a keyless controller
	// (encryption disabled -> WARN-and-plaintext, the oss#394 convention).
	keyless := NewExecutionContextController(st, nil, auth)
	created, err := keyless.Create(contextWithExecutionContextKind(), newSecretsTestEC("Legacy", "wex_legacy"))
	require.NoError(t, err)

	stored := &executioncontextv1.ExecutionContext{}
	require.NoError(t, st.GetResource(context.Background(),
		apiresourcekind.ApiResourceKind_execution_context, created.GetMetadata().GetId(), stored))
	require.Equal(t, "super-secret-token", stored.GetSpec().GetData()["API_TOKEN"].GetValue(),
		"precondition: the legacy row rests plaintext")

	// User-shaped read on the keyed controller: still redacted.
	fetched, err := controller.Get(contextWithExecutionContextKind(),
		&executioncontextv1.ExecutionContextId{Value: created.GetMetadata().GetId()})
	require.NoError(t, err)
	assert.Equal(t, envsteps.RedactedMarker, fetched.GetSpec().GetData()["API_TOKEN"].GetValue())

	// Runner lane: plaintext passes through Decrypt unchanged.
	ec, err := controller.GetByExecutionId(contextWithRunnerToken(t, auth, "wex_legacy"),
		&executioncontextv1.ExecutionContextExecutionIdInput{ExecutionId: "wex_legacy"})
	require.NoError(t, err)
	assert.Equal(t, "super-secret-token", ec.GetSpec().GetData()["API_TOKEN"].GetValue())
}

func TestSecrets_NoRunnerAuthFailsClosed(t *testing.T) {
	// A controller without a token verifier can never decrypt — even a
	// genuine token falls to redaction rather than an error.
	st, err := sqlite.NewStore(t.TempDir() + "/test.sqlite")
	require.NoError(t, err)
	defer st.Close()

	auth := testRunnerAuth(t)
	controller := NewExecutionContextController(st, testSecretService(t), nil)

	_, err = controller.Create(contextWithExecutionContextKind(), newSecretsTestEC("No Auth", "wex_noauth"))
	require.NoError(t, err)

	ec, err := controller.GetByExecutionId(contextWithRunnerToken(t, auth, "wex_noauth"),
		&executioncontextv1.ExecutionContextExecutionIdInput{ExecutionId: "wex_noauth"})
	require.NoError(t, err)
	assert.Equal(t, envsteps.RedactedMarker, ec.GetSpec().GetData()["API_TOKEN"].GetValue())
}
