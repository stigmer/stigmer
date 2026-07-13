//go:build integration

package integration

import (
	"context"
	"testing"
	"time"

	"github.com/google/uuid"
	agentv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agent/v1"
	agentinstancev1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agentinstance/v1"
	agentsharev1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agentshare/v1"
	environmentv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/environment/v1"
	mcpserverv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/mcpserver/v1"
	sessionv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/session/v1"
	apiresource "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource"
	apiresourcekind "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource/apiresourcekind"
	"github.com/stigmer/stigmer/test/integration/harness"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

// T06 — Org-Shared Environments. These tests pin the contract that unblocks
// tool-using shared agents: an environment shared with the organization
// (metadata.visibility == visibility_org) is runtime-resolvable for any
// execution in the org — including guest sessions — while secret reveal
// stays creator-only and revocation fails closed on the very next message.

const (
	visOrgLevel     = apiresource.ApiResourceVisibility_visibility_org
	visPrivateLevel = apiresource.ApiResourceVisibility_visibility_private
)

// t06EnvVar is unique to this suite so the personal-environment fallback
// (which fills missing MCP vars from the caller's personal env) can never
// mask a resolution failure.
const t06EnvVar = "T06_TOOL_API_KEY"

// createSecretEnvironment creates an environment holding one secret value.
func createSecretEnvironment(t *testing.T, ctx context.Context, clients *harness.Clients, name string) *environmentv1.Environment {
	t.Helper()
	env, err := clients.EnvironmentCommand.Create(ctx, &environmentv1.Environment{
		ApiVersion: "agentic.stigmer.ai/v1",
		Kind:       "Environment",
		Metadata: &apiresource.ApiResourceMetadata{
			Name: name,
			Org:  harness.TestOrg,
		},
		Spec: &environmentv1.EnvironmentSpec{
			Description: "T06 org-shared environment test credentials",
			Data: map[string]*environmentv1.EnvironmentValue{
				t06EnvVar: {Value: "t06-secret-value", IsSecret: true},
			},
		},
	})
	require.NoError(t, err, "environment create should succeed")
	t.Cleanup(func() {
		cleanCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		_, _ = clients.EnvironmentCommand.Delete(cleanCtx, &apiresource.ApiResourceDeleteInput{
			ResourceId: env.GetMetadata().GetId(),
		})
	})
	return env
}

// createToolAgent builds a tool-using shared agent: an MCP server requiring
// t06EnvVar and a publicly shared agent using it. No credential binding —
// callers bind either through a dedicated instance
// (createToolAgentWithEnvRef, the T06 path) or through the share's
// environment_refs (the DD-011 channel binding).
func createToolAgent(
	t *testing.T, ctx context.Context, clients *harness.Clients, nameSuffix string,
) *agentv1.Agent {
	t.Helper()

	mcpName := "test-t06-mcp-" + nameSuffix + "-" + uuid.New().String()[:8]
	mcpServer, err := clients.McpServerCommand.Apply(ctx, &mcpserverv1.McpServer{
		ApiVersion: "agentic.stigmer.ai/v1",
		Kind:       "McpServer",
		Metadata: &apiresource.ApiResourceMetadata{
			Name: mcpName,
			Org:  harness.TestOrg,
		},
		Spec: &mcpserverv1.McpServerSpec{
			Description: "T06 tool server requiring a credential",
			ServerType: &mcpserverv1.McpServerSpec_Stdio{
				Stdio: &mcpserverv1.StdioServerConfig{
					Command: "echo",
					Args:    []string{"${" + t06EnvVar + "}"},
				},
			},
			Env: map[string]*environmentv1.EnvVarDeclaration{
				t06EnvVar: {
					Description: "T06 credential the tool cannot start without",
					IsSecret:    true,
					// optional defaults to false — the validator enforces it.
				},
			},
		},
	})
	require.NoError(t, err, "MCP server apply should succeed")
	t.Cleanup(func() {
		cleanCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		_, _ = clients.McpServerCommand.Delete(cleanCtx, &apiresource.ApiResourceDeleteInput{
			ResourceId: mcpServer.GetMetadata().GetId(),
		})
	})

	agent := harness.CreateAgent(t, ctx, clients, "test-t06-agent-"+nameSuffix,
		"You are a tool-using test agent for org-shared environment verification.",
		harness.WithMcpServerUsage(mcpServer.GetMetadata().GetSlug()),
	)
	applyShare(t, ctx, clients, shareFor(agent, true))
	return agent
}

// createToolAgentWithEnvRef builds the full T06 fixture: a tool-using shared
// agent plus a dedicated instance binding the given environment.
func createToolAgentWithEnvRef(
	t *testing.T, ctx context.Context, clients *harness.Clients,
	env *environmentv1.Environment, nameSuffix string,
) (*agentv1.Agent, *agentinstancev1.AgentInstance) {
	t.Helper()

	agent := createToolAgent(t, ctx, clients, nameSuffix)

	// A dedicated instance binds the environment — the owner's second consent
	// (the first being the environment's visibility). The guest gate accepts
	// any instance belonging to the shared agent.
	instance, err := clients.AgentInstanceCommand.Create(ctx, &agentinstancev1.AgentInstance{
		ApiVersion: "agentic.stigmer.ai/v1",
		Kind:       "AgentInstance",
		Metadata: &apiresource.ApiResourceMetadata{
			Name: "test-t06-instance-" + nameSuffix,
			Org:  harness.TestOrg,
		},
		Spec: &agentinstancev1.AgentInstanceSpec{
			AgentId: agent.GetMetadata().GetId(),
			EnvironmentRefs: []*apiresource.ApiResourceReference{{
				Kind: apiresourcekind.ApiResourceKind_environment,
				Org:  env.GetMetadata().GetOrg(),
				Slug: env.GetMetadata().GetSlug(),
			}},
		},
	})
	require.NoError(t, err, "instance create with environment_refs should succeed")

	return agent, instance
}

// setEnvironmentVisibility flips the environment's visibility as the owner.
func setEnvironmentVisibility(
	t *testing.T, ctx context.Context, clients *harness.Clients,
	envID string, visibility apiresource.ApiResourceVisibility,
) {
	t.Helper()
	updated, err := clients.EnvironmentCommand.UpdateVisibility(ctx, &apiresource.UpdateVisibilityInput{
		ResourceId: envID,
		Visibility: visibility,
	})
	require.NoError(t, err, "environment updateVisibility to %s should succeed", visibility)
	require.Equal(t, visibility, updated.GetMetadata().GetVisibility())
	// Responses never carry stored secret ciphertext or plaintext.
	for key, value := range updated.GetSpec().GetData() {
		if value.GetIsSecret() {
			assert.Equal(t, "***REDACTED***", value.GetValue(),
				"updateVisibility response must redact secret %q", key)
		}
	}
}

// guestSessionFor mints a guest token and opens a session bound to the
// given instance of the shared agent. Returns the guest's clients and the
// session id.
func guestSessionFor(
	t *testing.T, ctx context.Context, clients *harness.Clients,
	agent *agentv1.Agent, instanceID, subject string,
) (*harness.Clients, string) {
	t.Helper()
	minted := mintGuestToken(t, ctx, clients,
		agent.GetMetadata().GetOrg(), agent.GetMetadata().GetSlug(), "")
	guest := guestClients(t, minted.GetAccessToken())

	session, err := guest.SessionCommand.Create(ctx, &sessionv1.Session{
		ApiVersion: "agentic.stigmer.ai/v1",
		Kind:       "Session",
		Metadata:   &apiresource.ApiResourceMetadata{Name: "t06-session-" + subject},
		Spec: &sessionv1.SessionSpec{
			AgentInstanceId: instanceID,
			Subject:         subject,
			Harness:         sessionv1.Harness_HARNESS_NATIVE,
		},
	})
	require.NoError(t, err, "guest session create against the bound instance should succeed")
	return guest, session.GetMetadata().GetId()
}

// TestOrgSharedEnvironment_GuestToolCredentials is the T06 headline proof:
// a guest running a tool-using shared agent fails closed while the bound
// environment is private, succeeds once the owner shares the environment
// with the org, and fails closed again the moment sharing is revoked — all
// on the same guest token, proving the gate reads live state.
//
// The refusal a GUEST sees is deliberately the generic UNAVAILABLE copy:
// the owner-facing diagnostic (missing variable, environment to share) names
// internal proto fields and resource slugs, which must never reach an
// anonymous visitor. The full diagnostic goes to the server log instead —
// this is the session-12 leak fix, and the NotContains asserts below are
// the standing guard against reintroducing it.
func TestOrgSharedEnvironment_GuestToolCredentials(t *testing.T) {
	requireGuestPrereqs(t)

	ctx, cancel := context.WithTimeout(context.Background(), 120*time.Second)
	defer cancel()

	clients := harness.NewClients(grpcConn)
	env := createSecretEnvironment(t, ctx, clients, "test-t06-guest-creds")
	agent, instance := createToolAgentWithEnvRef(t, ctx, clients, env, "guest")

	guest, sessionID := guestSessionFor(t, ctx, clients, agent, instance.GetMetadata().GetId(), "guest-tools")

	// 1. Private environment: the guest's message is refused synchronously
	//    at create with the generic copy — never the internal diagnostic.
	_, err := guestCreateExecution(ctx, guest, sessionID, "private-env-attempt")
	require.Error(t, err, "a private environment must block the guest's tool-using execution")
	st, ok := status.FromError(err)
	require.True(t, ok)
	assert.Equal(t, codes.FailedPrecondition, st.Code())
	assert.Equal(t, defaultUnavailableCopy, st.Message(),
		"a guest must see the generic unavailable copy, not the owner diagnostic")
	assert.NotContains(t, st.Message(), t06EnvVar,
		"the guest-visible refusal must never leak the missing variable name")
	assert.NotContains(t, st.Message(), env.GetMetadata().GetSlug(),
		"the guest-visible refusal must never leak the environment slug")

	// 2. Owner shares the environment with the org: the SAME guest token's
	//    next message goes through — the secrets merged, validation passed.
	setEnvironmentVisibility(t, ctx, clients, env.GetMetadata().GetId(), visOrgLevel)

	exec, err := guestCreateExecution(ctx, guest, sessionID, "shared-env-attempt")
	require.NoError(t, err,
		"an org-shared environment must unblock the guest's tool-using execution")
	assert.Equal(t, harness.TestOrg, exec.GetMetadata().GetOrg())

	// 3. Revocation fails closed: back to private, the next message is
	//    refused again — no caching, no grandfathering.
	setEnvironmentVisibility(t, ctx, clients, env.GetMetadata().GetId(), visPrivateLevel)

	_, err = guestCreateExecution(ctx, guest, sessionID, "revoked-env-attempt")
	require.Error(t, err, "reverting to private must block the very next guest message")
	st, ok = status.FromError(err)
	require.True(t, ok)
	assert.Equal(t, codes.FailedPrecondition, st.Code())
}

// TestOrgSharedEnvironment_GuestToolCredentials_ViaShareRefs proves the
// DD-011 credential channel end to end: the share's environment_refs — not
// an instance binding — carry the tool credentials, so a guest chatting on
// the agent's PRISTINE default instance gets a working tool-using agent.
// This is the binding the Share dialog writes and the path that unblocks
// tool-using agents behind a plain share link (the default instance is
// system-managed and stays untouched). Removing the binding fails closed on
// the guest's next message, proving the share — not the instance — is the
// load-bearing consent.
func TestOrgSharedEnvironment_GuestToolCredentials_ViaShareRefs(t *testing.T) {
	requireGuestPrereqs(t)

	ctx, cancel := context.WithTimeout(context.Background(), 120*time.Second)
	defer cancel()

	clients := harness.NewClients(grpcConn)
	env := createSecretEnvironment(t, ctx, clients, "test-t06-share-refs")
	setEnvironmentVisibility(t, ctx, clients, env.GetMetadata().GetId(), visOrgLevel)

	agent := createToolAgent(t, ctx, clients, "share-refs")
	envRef := &apiresource.ApiResourceReference{
		Kind: apiresourcekind.ApiResourceKind_environment,
		Org:  env.GetMetadata().GetOrg(),
		Slug: env.GetMetadata().GetSlug(),
	}

	// 1. Phase A guardrail on the wire: environment_refs bind to
	//    public-audience shares only (org members carry no share linkage, so
	//    bound credentials would silently never apply). The message-level
	//    CEL rule must reject the combination through the real backend, not
	//    just in the OSS proto unit tests.
	invalid := shareFor(agent, true)
	invalid.Spec.Audience = agentsharev1.AgentShareAudience_agent_share_audience_org
	invalid.Spec.EnvironmentRefs = []*apiresource.ApiResourceReference{envRef}
	_, err := clients.AgentShareCommand.Apply(ctx, invalid)
	require.Error(t, err, "env refs on an org-audience share must be rejected")
	st, ok := status.FromError(err)
	require.True(t, ok)
	assert.Equal(t, codes.InvalidArgument, st.Code(),
		"the audience/env-refs rule is proto-boundary validation (INVALID_ARGUMENT)")

	// 2. Bind the credentials to the (public) share. The guest pins the
	//    agent's system-managed DEFAULT instance — no instance binding
	//    exists anywhere.
	bound := shareFor(agent, true)
	bound.Spec.EnvironmentRefs = []*apiresource.ApiResourceReference{envRef}
	applyShare(t, ctx, clients, bound)

	guest, sessionID := guestSessionFor(t, ctx, clients, agent,
		agent.GetStatus().GetDefaultInstanceId(), "share-refs")

	exec, err := guestCreateExecution(ctx, guest, sessionID, "share-bound-attempt")
	require.NoError(t, err,
		"share-bound credentials must satisfy MCP validation on the pristine default instance")
	assert.Equal(t, harness.TestOrg, exec.GetMetadata().GetOrg())

	// 3. Unbind: re-apply the share without the ref. The SAME guest token's
	//    next message fails closed with the generic guest copy — the gate
	//    reads the live share, and no credential lingers on the instance.
	applyShare(t, ctx, clients, shareFor(agent, true))

	_, err = guestCreateExecution(ctx, guest, sessionID, "unbound-attempt")
	require.Error(t, err, "removing the share's env binding must block the very next guest message")
	st, ok = status.FromError(err)
	require.True(t, ok)
	assert.Equal(t, codes.FailedPrecondition, st.Code())
	assert.Equal(t, defaultUnavailableCopy, st.Message(),
		"the guest refusal must be the generic copy, never the owner diagnostic")
}

// TestOrgSharedEnvironment_GuestCannotReadEnvironment pins the containment
// half of the model: org sharing makes an environment usable BY THE RUNTIME
// for guest executions — it never grants the guest identity any read on the
// environment resource itself, let alone secret reveal.
func TestOrgSharedEnvironment_GuestCannotReadEnvironment(t *testing.T) {
	requireGuestPrereqs(t)

	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()

	clients := harness.NewClients(grpcConn)
	env := createSecretEnvironment(t, ctx, clients, "test-t06-containment")
	setEnvironmentVisibility(t, ctx, clients, env.GetMetadata().GetId(), visOrgLevel)

	agent := createSharedAgent(t, ctx, clients, "test-t06-containment-agent")
	minted := mintGuestToken(t, ctx, clients,
		agent.GetMetadata().GetOrg(), agent.GetMetadata().GetSlug(), "")
	guest := guestClients(t, minted.GetAccessToken())

	_, err := guest.EnvironmentQuery.Get(ctx, &apiresource.ApiResourceId{
		Value: env.GetMetadata().GetId(),
	})
	require.Error(t, err, "a guest must not read an org-shared environment resource")

	_, err = guest.EnvironmentQuery.GetSecretValue(ctx, &environmentv1.EnvironmentSecretValueInput{
		EnvironmentId: env.GetMetadata().GetId(),
		Key:           t06EnvVar,
	})
	require.Error(t, err, "a guest must never reveal a secret value")
}

// TestOrgSharedEnvironment_VisibilityGuardrails pins the write-path
// invariants across BOTH visibility-changing RPCs: levels beyond org are
// structurally rejected, and personal/OAuth-managed environments refuse the
// org level however it is reached (targeted RPC or generic update).
func TestOrgSharedEnvironment_VisibilityGuardrails(t *testing.T) {
	requireGuestPrereqs(t)

	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()

	clients := harness.NewClients(grpcConn)

	t.Run("levels_beyond_org_rejected", func(t *testing.T) {
		env := createSecretEnvironment(t, ctx, clients, "test-t06-level-cap")
		for _, level := range []apiresource.ApiResourceVisibility{
			apiresource.ApiResourceVisibility_visibility_public,
			apiresource.ApiResourceVisibility_visibility_platform,
		} {
			_, err := clients.EnvironmentCommand.UpdateVisibility(ctx, &apiresource.UpdateVisibilityInput{
				ResourceId: env.GetMetadata().GetId(),
				Visibility: level,
			})
			require.Error(t, err, "environment visibility %s must be rejected", level)
			st, ok := status.FromError(err)
			require.True(t, ok)
			assert.Equal(t, codes.InvalidArgument, st.Code(),
				"level %s must be INVALID_ARGUMENT, got %s: %s", level, st.Code(), st.Message())
		}
	})

	t.Run("managed_environment_rejects_org_via_update_visibility", func(t *testing.T) {
		env, err := clients.EnvironmentCommand.Create(ctx, &environmentv1.Environment{
			ApiVersion: "agentic.stigmer.ai/v1",
			Kind:       "Environment",
			Metadata: &apiresource.ApiResourceMetadata{
				Name:   "test-t06-managed-" + uuid.New().String()[:8],
				Org:    harness.TestOrg,
				Labels: map[string]string{"stigmer.ai/managed": "true"},
			},
			Spec: &environmentv1.EnvironmentSpec{
				Data: map[string]*environmentv1.EnvironmentValue{
					"OAUTH_ACCESS_TOKEN": {Value: "tok", IsSecret: true},
				},
			},
		})
		require.NoError(t, err)

		_, err = clients.EnvironmentCommand.UpdateVisibility(ctx, &apiresource.UpdateVisibilityInput{
			ResourceId: env.GetMetadata().GetId(),
			Visibility: visOrgLevel,
		})
		require.Error(t, err, "an OAuth-managed environment must never be org-shareable")
		st, ok := status.FromError(err)
		require.True(t, ok)
		assert.Equal(t, codes.FailedPrecondition, st.Code())
		assert.Contains(t, st.Message(), "OAuth-managed environments cannot be shared")
	})

	t.Run("generic_update_cannot_bypass_the_guardrail", func(t *testing.T) {
		// The forbidden combination can also be assembled via generic
		// update — a restricted label added to an org-visible environment.
		// The guardrail checks the merged new state, so this must fail too.
		env := createSecretEnvironment(t, ctx, clients, "test-t06-update-bypass")
		setEnvironmentVisibility(t, ctx, clients, env.GetMetadata().GetId(), visOrgLevel)

		updated := env.GetMetadata()
		_, err := clients.EnvironmentCommand.Update(ctx, &environmentv1.Environment{
			ApiVersion: "agentic.stigmer.ai/v1",
			Kind:       "Environment",
			Metadata: &apiresource.ApiResourceMetadata{
				Id:         updated.GetId(),
				Name:       updated.GetName(),
				Org:        updated.GetOrg(),
				Visibility: visOrgLevel,
				Labels:     map[string]string{"stigmer.ai/personal": "true"},
			},
			Spec: env.GetSpec(),
		})
		require.Error(t, err,
			"adding a share-restricted label to an org-visible environment must be rejected")
		st, ok := status.FromError(err)
		require.True(t, ok)
		assert.Equal(t, codes.FailedPrecondition, st.Code())
	})

	t.Run("generic_update_visibility_change_is_honored", func(t *testing.T) {
		// Visibility set through generic update must behave identically to
		// the targeted RPC (validated + tuple-reconciled) — the runtime gate
		// reads the same field either way.
		env := createSecretEnvironment(t, ctx, clients, "test-t06-update-vis")

		meta := env.GetMetadata()
		updated, err := clients.EnvironmentCommand.Update(ctx, &environmentv1.Environment{
			ApiVersion: "agentic.stigmer.ai/v1",
			Kind:       "Environment",
			Metadata: &apiresource.ApiResourceMetadata{
				Id:         meta.GetId(),
				Name:       meta.GetName(),
				Org:        meta.GetOrg(),
				Visibility: visOrgLevel,
			},
			Spec: env.GetSpec(),
		})
		require.NoError(t, err, "generic update setting org visibility should succeed")
		assert.Equal(t, visOrgLevel, updated.GetMetadata().GetVisibility())

		fetched, err := clients.EnvironmentQuery.Get(ctx, &apiresource.ApiResourceId{
			Value: meta.GetId(),
		})
		require.NoError(t, err)
		assert.Equal(t, visOrgLevel, fetched.GetMetadata().GetVisibility(),
			"org visibility set via generic update must persist")
	})

	t.Run("create_with_org_visibility_works", func(t *testing.T) {
		env, err := clients.EnvironmentCommand.Create(ctx, &environmentv1.Environment{
			ApiVersion: "agentic.stigmer.ai/v1",
			Kind:       "Environment",
			Metadata: &apiresource.ApiResourceMetadata{
				Name:       "test-t06-born-shared-" + uuid.New().String()[:8],
				Org:        harness.TestOrg,
				Visibility: visOrgLevel,
			},
			Spec: &environmentv1.EnvironmentSpec{
				Data: map[string]*environmentv1.EnvironmentValue{
					t06EnvVar: {Value: "v", IsSecret: true},
				},
			},
		})
		require.NoError(t, err, "creating an environment born org-shared should succeed")
		assert.Equal(t, visOrgLevel, env.GetMetadata().GetVisibility())
	})
}
