package steps

import (
	"context"
	"testing"

	environmentv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/environment/v1"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource/apiresourcekind"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline"
	"github.com/stigmer/stigmer/backend/libs/go/store"
	"github.com/stigmer/stigmer/backend/libs/go/store/sqlite"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

func setupPersonalTestStore(t *testing.T) store.Store {
	t.Helper()
	s, err := sqlite.NewStore(t.TempDir() + "/personal_uniqueness_test.sqlite")
	require.NoError(t, err, "failed to create test store")
	t.Cleanup(func() { s.Close() })
	return s
}

// savePersonalEnv persists an environment carrying the personal label in the given org.
func savePersonalEnv(t *testing.T, s store.Store, id, org string) {
	t.Helper()
	env := &environmentv1.Environment{
		ApiVersion: "agentic.stigmer.ai/v1",
		Kind:       "Environment",
		Metadata: &apiresource.ApiResourceMetadata{
			Id:     id,
			Name:   id,
			Slug:   id,
			Org:    org,
			Labels: map[string]string{personalLabelKey: personalLabelValue},
		},
	}
	require.NoError(t, s.SaveResource(context.Background(), apiresourcekind.ApiResourceKind_environment, id, env))
}

// runStep executes the uniqueness step against the given candidate environment.
func runStep(t *testing.T, s store.Store, candidate *environmentv1.Environment) error {
	t.Helper()
	step := NewEnforcePersonalUniquenessStep(s)
	ctx := pipeline.NewRequestContext(context.Background(), candidate)
	ctx.SetNewState(candidate)
	return step.Execute(ctx)
}

func personalEnv(org string) *environmentv1.Environment {
	return &environmentv1.Environment{
		Metadata: &apiresource.ApiResourceMetadata{
			Name:   "candidate",
			Org:    org,
			Labels: map[string]string{personalLabelKey: personalLabelValue},
		},
	}
}

func TestEnforcePersonalUniquenessStep_NonPersonalIsNoOp(t *testing.T) {
	s := setupPersonalTestStore(t)
	// A personal env already exists; a non-personal candidate must NOT be blocked by it.
	savePersonalEnv(t, s, "env-existing", "acme")

	candidate := &environmentv1.Environment{
		Metadata: &apiresource.ApiResourceMetadata{
			Name: "config",
			Org:  "acme",
			// No personal label.
		},
	}

	require.NoError(t, runStep(t, s, candidate))
}

func TestEnforcePersonalUniquenessStep_NilMetadataIsNoOp(t *testing.T) {
	s := setupPersonalTestStore(t)
	require.NoError(t, runStep(t, s, &environmentv1.Environment{}))
}

func TestEnforcePersonalUniquenessStep_NoExistingSucceeds(t *testing.T) {
	s := setupPersonalTestStore(t)
	require.NoError(t, runStep(t, s, personalEnv("acme")))
}

func TestEnforcePersonalUniquenessStep_SameOrgRejected(t *testing.T) {
	s := setupPersonalTestStore(t)
	savePersonalEnv(t, s, "env-existing", "acme")

	err := runStep(t, s, personalEnv("acme"))

	require.Error(t, err)
	assert.Equal(t, codes.AlreadyExists, status.Code(err),
		"a second personal env in the same org must be rejected with ALREADY_EXISTS; got %v", err)
	assert.Contains(t, err.Error(), "env-existing",
		"error should identify the conflicting environment id")
}

// TestEnforcePersonalUniquenessStep_DifferentOrgAllowed is the regression guard
// for issue #193: a personal env in one org must NOT block a personal env in another.
func TestEnforcePersonalUniquenessStep_DifferentOrgAllowed(t *testing.T) {
	s := setupPersonalTestStore(t)
	savePersonalEnv(t, s, "env-in-acme", "acme")

	require.NoError(t, runStep(t, s, personalEnv("globex")),
		"a personal env in org 'globex' must be allowed even though one exists in org 'acme'")
}

func TestEnforcePersonalUniquenessStep_EmptyOrgExactMatch(t *testing.T) {
	t.Run("existing empty-org personal blocks another empty-org personal", func(t *testing.T) {
		s := setupPersonalTestStore(t)
		savePersonalEnv(t, s, "env-no-org", "")

		err := runStep(t, s, personalEnv(""))

		require.Error(t, err)
		assert.Equal(t, codes.AlreadyExists, status.Code(err))
	})

	t.Run("existing non-empty-org personal does not block an empty-org personal", func(t *testing.T) {
		s := setupPersonalTestStore(t)
		savePersonalEnv(t, s, "env-in-acme", "acme")

		require.NoError(t, runStep(t, s, personalEnv("")),
			"empty org must match only empty org; a wildcard here would re-introduce #193")
	})
}
