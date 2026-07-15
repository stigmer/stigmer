package agentchannel

import (
	"context"

	agentv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agent/v1"
	agentchannelv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agentchannel/v1"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource/apiresourcekind"
	grpclib "github.com/stigmer/stigmer/backend/libs/go/grpc"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline/steps"
	"github.com/stigmer/stigmer/backend/libs/go/store"
	"google.golang.org/protobuf/proto"
)

// findAgentByOrgAndSlug scans agents for an org+slug match. Full-scan
// lookup matches the store's local/OSS posture (see LoadByReferenceStep);
// the cloud edition uses an indexed repository query instead.
func findAgentByOrgAndSlug(
	ctx context.Context,
	s store.Store,
	org string,
	slug string,
) (*agentv1.Agent, bool, error) {
	agent, found, err := steps.FindResourceBySlug[*agentv1.Agent](
		ctx, s, apiresourcekind.ApiResourceKind_agent, slug, org)
	if err != nil {
		return nil, false, grpclib.InternalError(err, "failed to list agent resources")
	}
	return agent, found, nil
}

// resolveChannelDefaultsStep prepares a channel for creation — the
// AgentChannelDefaultsResolver mirror (cloud edition), whose error
// contracts this step replicates byte-identically:
//
//  1. Requires metadata.org — the connection-owning org is the billing org
//     and provider credentials resolve in that org (decision 004), so it
//     can never be inferred.
//  2. Requires spec.agent_ref.slug and normalizes spec.agent_ref.org
//     (empty means same-org, the platform-wide relative-reference
//     convention).
//  3. Enforces the same-org invariant: agent_ref.org must equal
//     metadata.org. Unlike shares (decision 013), channels have NO
//     cross-org arm — a channel binds provider credentials and billing to
//     one org, and both must be the agent's. Checked BEFORE the agent
//     load so a cross-org request cannot probe another org's slugs
//     through this path.
//  4. Loads the referenced agent — connecting a channel for a nonexistent
//     agent is refused with the same NOT_FOUND a direct agent lookup
//     would produce.
//
// Deliberately NO slug default from the agent (unlike the share's
// canonical-slug rule, decision 011 D2): channels are N-per-agent across
// providers, so no single channel is "the" canonical one. A channel
// without a slug or name falls through to the generic ResolveSlug
// derive-from-name behavior, exactly like any other resource.
//
// Resolution is idempotent: an already-resolved channel passes through
// unchanged, so the apply pipeline running it before delegating to the
// create pipeline (which runs it again) is harmless.
type resolveChannelDefaultsStep struct {
	store store.Store
}

func (s *resolveChannelDefaultsStep) Name() string {
	return "ResolveChannelDefaults"
}

func (s *resolveChannelDefaultsStep) Execute(ctx *pipeline.RequestContext[*agentchannelv1.AgentChannel]) error {
	channel := ctx.NewState()
	metadata := channel.GetMetadata()

	if metadata.GetOrg() == "" {
		return grpclib.InvalidArgumentError("metadata.org is required for an agent channel")
	}

	agentRef := channel.GetSpec().GetAgentRef()
	if agentRef.GetSlug() == "" {
		return grpclib.InvalidArgumentError("spec.agent_ref.slug is required")
	}

	// Empty ref org means same-org; make it absolute before the invariant
	// compares orgs.
	refOrg := agentRef.GetOrg()
	if refOrg == "" {
		refOrg = metadata.GetOrg()
	}

	// The same-org invariant (spec.proto): the channel's org is the
	// billing org and the credentials org, and both must be the agent's.
	// Checked BEFORE the agent load so a cross-org request cannot probe
	// another org's slugs through this path.
	if refOrg != metadata.GetOrg() {
		return grpclib.FailedPreconditionError(
			"spec.agent_ref.org must match metadata.org — an agent channel must live in the referenced agent's organization (%s)",
			refOrg,
		)
	}

	// The BYO app must be the channel's own org's (secrets never cross
	// orgs — the T06 invariant, applied to app credentials; T04 item 2).
	// Normalized and checked before the agent load for the same
	// no-probing reason. Deliberately NO existence or provider-match
	// check: like environment_refs, enforcement lives at resolution time
	// (the cloud install flow fails closed; OSS has no install flow).
	appRef := channel.GetSpec().GetAppRef()
	if appRef.GetSlug() != "" {
		appRefOrg := appRef.GetOrg()
		if appRefOrg == "" {
			appRefOrg = metadata.GetOrg()
		}
		if appRefOrg != metadata.GetOrg() {
			return grpclib.FailedPreconditionError(
				"spec.app_ref.org must match metadata.org — a channel can only install through its own organization's channel app",
			)
		}
		appRef.Org = appRefOrg
	}

	_, found, err := findAgentByOrgAndSlug(ctx.Context(), s.store, refOrg, agentRef.GetSlug())
	if err != nil {
		return err
	}
	if !found {
		// Byte-identical with the direct agent lookup's refusal (the T09
		// indistinguishability contract).
		return grpclib.NotFoundError("Agent", agentRef.GetSlug())
	}

	agentRef.Org = refOrg

	return nil
}

// initInstallStateStep writes status.install_state = pending_install — the
// channel exists but serves no traffic until the provider install
// completes (status.proto contract; the install flow is the only other
// status writer, and in this edition it never runs — see the package
// comment's §0-b posture).
//
// Runs AFTER BuildNewState, which clears client-provided status — the
// install state is system-managed and must survive that wipe, exactly
// like the audit fields (the stampAgentPinStep positioning in the
// agentshare create pipeline).
type initInstallStateStep struct{}

func (s *initInstallStateStep) Name() string {
	return "InitInstallState"
}

func (s *initInstallStateStep) Execute(ctx *pipeline.RequestContext[*agentchannelv1.AgentChannel]) error {
	channel := ctx.NewState()
	if channel.GetStatus() == nil {
		channel.Status = &agentchannelv1.AgentChannelStatus{}
	}
	channel.Status.InstallState = agentchannelv1.AgentChannelInstallState_pending_install
	return nil
}

// providerFieldName returns the manifest vocabulary for the channel's
// provider arm — the proto field name of the populated provider_config
// oneof member (e.g. "slack"), which is exactly what users declared in
// YAML. Resolved through proto reflection so a future provider arm
// (WhatsApp, T05) needs zero changes here — the cloud edition derives the
// same label from its oneof case for identical error copy.
func providerFieldName(spec *agentchannelv1.AgentChannelSpec) string {
	if spec == nil {
		return ""
	}
	reflected := spec.ProtoReflect()
	oneof := reflected.Descriptor().Oneofs().ByName("provider_config")
	if oneof == nil {
		return ""
	}
	populated := reflected.WhichOneof(oneof)
	if populated == nil {
		return ""
	}
	return string(populated.Name())
}

// validateChannelUpdateStep enforces the channel's immutable identity on
// update:
//
//   - spec.agent_ref must keep referencing the same agent. A channel is a
//     connection FOR one agent — re-pointing it would silently move
//     workspace traffic (and its billing) to a different blueprint;
//     create a new channel instead.
//   - The provider arm (provider_config oneof case) must not change. The
//     install state, credentials, and delivery records are all
//     provider-shaped — a slack channel cannot become whatsapp.
//
// Runs after LoadExisting so the existing state is available.
// metadata.slug/org immutability needs no step here: the generic
// BuildUpdateState preserves both from the existing resource. Status
// (install facts, credential reference) is likewise preserved wholesale.
type validateChannelUpdateStep struct{}

func (s *validateChannelUpdateStep) Name() string {
	return "ValidateChannelUpdate"
}

func (s *validateChannelUpdateStep) Execute(ctx *pipeline.RequestContext[*agentchannelv1.AgentChannel]) error {
	existingVal := ctx.Get(steps.ExistingResourceKey)
	if existingVal == nil {
		return grpclib.InternalError(nil, "existing agent channel not found in context")
	}
	existing := existingVal.(*agentchannelv1.AgentChannel)

	inputRef := ctx.Input().GetSpec().GetAgentRef()
	existingRef := existing.GetSpec().GetAgentRef()

	// Normalize the input ref's org the same way create does (empty means
	// the channel's own org) before comparing.
	inputOrg := inputRef.GetOrg()
	if inputOrg == "" {
		inputOrg = existing.GetMetadata().GetOrg()
	}

	if inputRef.GetSlug() != existingRef.GetSlug() || inputOrg != existingRef.GetOrg() {
		return grpclib.FailedPreconditionError(
			"spec.agent_ref is immutable (channel connects %s/%s) — create a new channel to connect a different agent",
			existingRef.GetOrg(), existingRef.GetSlug(),
		)
	}

	inputProvider := providerFieldName(ctx.Input().GetSpec())
	existingProvider := providerFieldName(existing.GetSpec())

	if inputProvider != existingProvider {
		return grpclib.FailedPreconditionError(
			"spec provider is immutable (channel provider is %s) — create a new channel for a different provider",
			existingProvider,
		)
	}

	return validateAppRefUpdate(ctx, existing)
}

// validateAppRefUpdate enforces the app_ref rules on update (T04 item 2),
// byte-identical with the cloud edition's ValidateChannelUpdate:
//
//   - same-org always: a channel must never install through another org's
//     app credentials (repeated here because update does not run the
//     defaults resolver);
//   - frozen while installed: the workspace granted THAT app and the
//     stored bot token belongs to it. Pending and revoked channels may
//     rebind freely — switching apps before (re-)installing is a
//     legitimate flow.
func validateAppRefUpdate(
	ctx *pipeline.RequestContext[*agentchannelv1.AgentChannel],
	existing *agentchannelv1.AgentChannel,
) error {
	inputAppRef := ctx.Input().GetSpec().GetAppRef()
	existingAppRef := existing.GetSpec().GetAppRef()

	inputAppOrg := ""
	if inputAppRef.GetSlug() != "" {
		inputAppOrg = inputAppRef.GetOrg()
		if inputAppOrg == "" {
			inputAppOrg = existing.GetMetadata().GetOrg()
		}
	}

	if inputAppOrg != "" && inputAppOrg != existing.GetMetadata().GetOrg() {
		return grpclib.FailedPreconditionError(
			"spec.app_ref.org must match metadata.org — a channel can only install through its own organization's channel app",
		)
	}

	installed := existing.GetStatus().GetInstallState() ==
		agentchannelv1.AgentChannelInstallState_installed
	changed := inputAppRef.GetSlug() != existingAppRef.GetSlug() ||
		(inputAppRef.GetSlug() != "" && inputAppOrg != existingAppRef.GetOrg())

	if installed && changed {
		return grpclib.FailedPreconditionError(
			"spec.app_ref cannot change while the channel is installed — the workspace authorized the current app; uninstall or disconnect first, then rebind and re-install",
		)
	}

	return nil
}

// unmarshalChannel decodes a stored agent channel, skipping invalid
// entries (should not happen in normal operation).
func unmarshalChannel(data []byte) (*agentchannelv1.AgentChannel, bool) {
	channel := &agentchannelv1.AgentChannel{}
	if err := proto.Unmarshal(data, channel); err != nil {
		return nil, false
	}
	return channel, true
}
