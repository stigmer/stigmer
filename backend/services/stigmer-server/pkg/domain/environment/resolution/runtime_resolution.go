// Package resolution provides server-side resolution of environments for
// executions — the OSS twin of the cloud edition's
// EnvironmentRuntimeResolutionService.
//
// Runtime resolution and human reveal are two distinct operations: the
// environment RPC surface redacts secret values in every response (oss#405,
// getSecretValue being the single-key reveal path), while an execution needs
// the full map decrypted. This service is the sanctioned internal path for
// the latter. It deliberately does not ride the gRPC surface: the RPC
// responses are redacted by design, and this single-user edition has no
// caller identity that could gate an "unredacted" RPC variant.
//
// Called cross-domain by the execution-context builders (agentexecution,
// workflowexecution) — a deliberate, documented boundary crossing in the
// style of the cloud edition's EnvironmentMergeService dependency. The OSS
// edition omits the cloud's OrgSharedEnvironmentPolicy gate: single-user,
// no trust boundary to enforce.
//
// Returned values are PLAINTEXT, for execution-context builds only. Never
// surface them in an API response, log, or error message.
package resolution

import (
	"context"
	"errors"
	"fmt"

	"github.com/rs/zerolog/log"
	environmentv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/environment/v1"
	apiresourcepb "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource/apiresourcekind"
	grpclib "github.com/stigmer/stigmer/backend/libs/go/grpc"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline/steps"
	"github.com/stigmer/stigmer/backend/libs/go/store"
	"github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/encryption"
)

// RuntimeResolutionService resolves environments with secret values
// decrypted, for merging into an ExecutionContext.
type RuntimeResolutionService struct {
	store         store.Store
	secretService *encryption.SecretService
}

func NewRuntimeResolutionService(
	s store.Store,
	secretService *encryption.SecretService,
) *RuntimeResolutionService {
	return &RuntimeResolutionService{store: s, secretService: secretService}
}

// ResolveByReference loads the referenced environment and decrypts its
// is_secret values in place on the freshly-unmarshalled copy (the store is
// never touched). Lookup semantics match the GetByReference RPC exactly —
// same slug+org matching (steps.FindResourceBySlug) and the same org
// requirement for this org-scoped kind — so a ref that resolves through the
// RPC surface resolves identically here, and vice versa.
//
// Error doctrine (the cloud service's, expressed in this edition's error
// taxonomy):
//   - Undecryptable ciphertext (tampered/truncated/wrong-key) is scoped to
//     one value: WARN and drop that key, matching the cloud's per-key skip.
//   - encryption.ErrEncryptionDisabled propagates: the stored ciphertext may
//     be perfectly valid (key file lost), and skipping it would start the
//     execution silently missing a credential — a confusing downstream
//     failure instead of a clear one here.
//
// An unresolvable reference returns NotFound, same as the RPC path — the
// execution-context builders treat that as an authoring error that fails
// the create (never a silent run without credentials).
func (s *RuntimeResolutionService) ResolveByReference(
	ctx context.Context,
	ref *apiresourcepb.ApiResourceReference,
) (*environmentv1.Environment, error) {
	if ref == nil || ref.GetSlug() == "" {
		return nil, grpclib.InvalidArgumentError("environment reference with slug is required")
	}
	if kind := ref.GetKind(); kind != 0 && kind != apiresourcekind.ApiResourceKind_environment {
		return nil, grpclib.InvalidArgumentError(
			"kind mismatch: expected environment, got %s", kind.String())
	}
	if err := steps.RequireOrgForReference(apiresourcekind.ApiResourceKind_environment, ref.GetOrg()); err != nil {
		return nil, err
	}

	env, found, err := steps.FindResourceBySlug[*environmentv1.Environment](
		ctx, s.store, apiresourcekind.ApiResourceKind_environment, ref.GetSlug(), ref.GetOrg(),
	)
	if err != nil {
		return nil, grpclib.InternalError(err, "failed to look up environment for runtime resolution")
	}
	if !found {
		return nil, grpclib.NotFoundError("environment", ref.GetSlug())
	}

	if err := s.decryptSecretValues(env); err != nil {
		return nil, err
	}
	return env, nil
}

// decryptSecretValues walks spec.data and decrypts every encrypted is_secret
// value. Plaintext legacy rows pass through Decrypt unchanged, so pre-oss#405
// stores resolve without migration.
func (s *RuntimeResolutionService) decryptSecretValues(env *environmentv1.Environment) error {
	data := env.GetSpec().GetData()
	if len(data) == 0 {
		return nil
	}

	environmentID := env.GetMetadata().GetId()
	for key, val := range data {
		if !val.GetIsSecret() || !s.secretService.IsEncrypted(val.GetValue()) {
			continue
		}

		decrypted, err := s.secretService.Decrypt(val.GetValue())
		if err != nil {
			if errors.Is(err, encryption.ErrEncryptionDisabled) {
				return grpclib.InternalError(err, fmt.Sprintf(
					"environment %s holds encrypted secret '%s' but no encryption key is configured",
					environmentID, key))
			}
			log.Warn().Err(err).
				Str("key", key).
				Str("environment_id", environmentID).
				Msg("Undecryptable ciphertext in environment — dropping this value from runtime resolution")
			delete(env.Spec.Data, key)
			continue
		}
		val.Value = decrypted
	}
	return nil
}
