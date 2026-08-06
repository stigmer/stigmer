package schedule

import (
	"context"

	agentv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agent/v1"
	schedulev1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/schedule/v1"
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

// resolveScheduleDefaultsStep prepares a schedule for creation — the
// ScheduleDefaultsResolver mirror (cloud edition), whose error contracts
// this step replicates byte-identically:
//
//  1. Requires metadata.org — the schedule-owning org is the billing org
//     for every fire (DD-008 D4), so it can never be inferred.
//  2. Validates the cron grammar and the time zone (cron.go — the
//     DD-009 C-4 lexical rules; no cron parsing in either edition).
//  3. Requires spec.agent.agent_ref.slug and normalizes its org (empty
//     means same-org, the platform-wide relative-reference convention).
//  4. Enforces the same-org invariant: agent_ref.org must equal
//     metadata.org — the schedule's org pays for every fire, and both
//     must be the agent's (the AgentChannel decision-004 rule). Checked
//     BEFORE the agent load so a cross-org request cannot probe another
//     org's slugs through this path.
//  5. Loads the referenced agent — scheduling a nonexistent agent is
//     refused with the same NOT_FOUND a direct agent lookup would
//     produce.
//
// Deliberately NO slug default from the agent (the AgentChannel P7
// rule): schedules are N-per-agent with different prompts, so no single
// schedule is "the" canonical one. A schedule without a slug or name
// falls through to the generic ResolveSlug derive-from-name behavior.
//
// Resolution is idempotent: an already-resolved schedule passes through
// unchanged, so the apply pipeline running it before delegating to the
// create pipeline (which runs it again) is harmless.
type resolveScheduleDefaultsStep struct {
	store store.Store
}

func (s *resolveScheduleDefaultsStep) Name() string {
	return "ResolveScheduleDefaults"
}

func (s *resolveScheduleDefaultsStep) Execute(ctx *pipeline.RequestContext[*schedulev1.Schedule]) error {
	schedule := ctx.NewState()
	metadata := schedule.GetMetadata()

	if metadata.GetOrg() == "" {
		return grpclib.InvalidArgumentError("metadata.org is required for a schedule")
	}

	spec := schedule.GetSpec()
	if err := validateScheduleCron(spec.GetCron()); err != nil {
		return err
	}
	if err := validateScheduleTimeZone(spec.GetTimeZone()); err != nil {
		return err
	}

	agentRef := spec.GetAgent().GetAgentRef()
	if agentRef.GetSlug() == "" {
		return grpclib.InvalidArgumentError("spec.agent.agent_ref.slug is required")
	}

	if err := validateScheduleWorkspace(spec); err != nil {
		return err
	}

	// Empty ref org means same-org; make it absolute before the invariant
	// compares orgs.
	refOrg := agentRef.GetOrg()
	if refOrg == "" {
		refOrg = metadata.GetOrg()
	}

	// The same-org invariant (spec.proto): the schedule's org is the
	// billing org for every fire, and it must be the agent's. Checked
	// BEFORE the agent load so a cross-org request cannot probe another
	// org's slugs through this path.
	if refOrg != metadata.GetOrg() {
		return grpclib.FailedPreconditionError(
			"spec.agent.agent_ref.org must match metadata.org — a schedule must live in the referenced agent's organization (%s)",
			refOrg,
		)
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

// validateScheduleWorkspace enforces the schedule-specific workspace
// constraint on the shared AgentInvocation (DD-018 D-3, the surface
// constraint the shared message deliberately does not carry): every
// workspace entry must be a git_repo source. A local_path needs a
// connected client to serve the directory, and a schedule fire has
// none — refusing at write time beats a deterministic provisioning
// failure at 3 AM. Copy is cross-edition contract (cloud mirrors it).
func validateScheduleWorkspace(spec *schedulev1.ScheduleSpec) error {
	for i, entry := range spec.GetAgent().GetWorkspaceEntries() {
		if entry.GetSource().GetGitRepo() == nil {
			return grpclib.InvalidArgumentError(
				"spec.agent.workspace_entries[%d] must use a git_repo source — a scheduled run has no connected client to serve a local_path",
				i,
			)
		}
	}
	return nil
}

// targetFieldName returns the manifest vocabulary for the schedule's
// target arm — the proto field name of the populated target oneof member
// (e.g. "agent"), which is exactly what users declared in YAML. Resolved
// through proto reflection so the future workflow arm (DD-008 D8) needs
// zero changes here — the cloud edition derives the same label from its
// oneof case for identical error copy.
func targetFieldName(spec *schedulev1.ScheduleSpec) string {
	if spec == nil {
		return ""
	}
	reflected := spec.ProtoReflect()
	oneof := reflected.Descriptor().Oneofs().ByName("target")
	if oneof == nil {
		return ""
	}
	populated := reflected.WhichOneof(oneof)
	if populated == nil {
		return ""
	}
	return string(populated.Name())
}

// validateScheduleUpdateStep enforces the schedule's immutable identity
// on update:
//
//   - spec.agent.agent_ref must keep referencing the same agent. Create's
//     consent bar is can_edit on the REFERENCED agent (DD-009 C-6, cloud
//     edition); if an update could repoint the target, a schedule owner
//     could drive an agent they may not edit — bypassing that consent.
//     The AgentChannel rule, for the AgentChannel reason: create a new
//     schedule instead (nothing is lost — a schedule carries no install
//     state).
//   - The target arm (target oneof case) must not change. An agent
//     schedule must not morph into a workflow schedule — the two targets
//     enter different execution pipelines (the provider-arm precedent).
//     Trivially satisfied while one arm exists; enforced structurally so
//     the workflow arm lands with the rule already in force.
//   - The cron grammar and time zone are re-validated: update replaces
//     the spec wholesale and does not run the defaults resolver, so the
//     write path must hold the same bar as create.
//
// Runs after LoadExisting so the existing state is available.
// metadata.slug/org immutability needs no step here: the generic
// BuildUpdateState preserves both from the existing resource. Status
// (firing observations, auto-pause) is likewise preserved wholesale —
// the invariant that keeps DD-008 D7's auto-pause immune to declarative
// clobber; the regression tests pin it.
type validateScheduleUpdateStep struct{}

func (s *validateScheduleUpdateStep) Name() string {
	return "ValidateScheduleUpdate"
}

func (s *validateScheduleUpdateStep) Execute(ctx *pipeline.RequestContext[*schedulev1.Schedule]) error {
	existingVal := ctx.Get(steps.ExistingResourceKey)
	if existingVal == nil {
		return grpclib.InternalError(nil, "existing schedule not found in context")
	}
	existing := existingVal.(*schedulev1.Schedule)

	newState := ctx.NewState()

	inputTarget := targetFieldName(newState.GetSpec())
	existingTarget := targetFieldName(existing.GetSpec())

	if inputTarget != existingTarget {
		return grpclib.FailedPreconditionError(
			"spec target is immutable (schedule target is %s) — create a new schedule for a different target kind",
			existingTarget,
		)
	}

	spec := newState.GetSpec()
	if err := validateScheduleCron(spec.GetCron()); err != nil {
		return err
	}
	if err := validateScheduleTimeZone(spec.GetTimeZone()); err != nil {
		return err
	}
	// Update replaces the spec wholesale (no defaults resolver), so the
	// workspace constraint must hold here too.
	if err := validateScheduleWorkspace(spec); err != nil {
		return err
	}

	inputRef := spec.GetAgent().GetAgentRef()
	existingRef := existing.GetSpec().GetAgent().GetAgentRef()

	// Normalize the input ref's org the same way create does (empty means
	// the schedule's own org) before comparing.
	inputOrg := inputRef.GetOrg()
	if inputOrg == "" {
		inputOrg = existing.GetMetadata().GetOrg()
	}

	if inputRef.GetSlug() != existingRef.GetSlug() || inputOrg != existingRef.GetOrg() {
		return grpclib.FailedPreconditionError(
			"spec.agent.agent_ref is immutable (schedule runs %s/%s) — create a new schedule to run a different agent",
			existingRef.GetOrg(), existingRef.GetSlug(),
		)
	}

	return nil
}

// unmarshalSchedule decodes a stored schedule, skipping invalid entries
// (should not happen in normal operation).
func unmarshalSchedule(data []byte) (*schedulev1.Schedule, bool) {
	schedule := &schedulev1.Schedule{}
	if err := proto.Unmarshal(data, schedule); err != nil {
		return nil, false
	}
	return schedule, true
}
