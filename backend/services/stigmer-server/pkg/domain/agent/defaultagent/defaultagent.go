// Package defaultagent resolves the platform default agent — the single
// resolution implementation behind Agent.GetDefault, AgentExecution create,
// and Session create.
//
// The default agent is a platform-level singleton: the agent labeled
// stigmer.ai/default-agent: "true" with visibility_public, seeded in the
// system org and served to callers of every org. Resolution is deliberately
// GLOBAL — GetDefaultAgentRequest.org exists for authorization scoping only
// (see apis/ai/stigmer/agentic/agent/v1/io.proto). It powers the
// session-first UX where a user starts a conversation without picking an
// agent.
//
// This package is the OSS twin of the cloud edition's
// AgentRepo.findDefault() (stigmer-cloud
// backend/services/stigmer-service/.../domain/agentic/agent/repo/), which
// likewise owns the label AND visibility predicate in one named query
// called by the same three handlers. Keep the two in sync.
//
// # Determinism contract (stigmer/stigmer#356)
//
// Multiple labeled agents is a reachable state, not an error: safe label
// rotation applies the new default before retiring the old one (retiring
// first would leave a window with no resolvable default). Among public
// candidates the winner is the one with the LOWEST metadata.id — the
// incumbent. Rationale, in order of what was rejected:
//
//   - First-match (the pre-#356 behavior): the store scan had no ordering,
//     so the served default depended on row insertion order, and the
//     visibility gate could fail on an arbitrary non-public winner while a
//     valid public candidate existed.
//   - Newest-wins: nothing guards the reserved stigmer.ai/* label namespace
//     at write boundaries, so newest-wins would let any newly labeled public
//     agent deterministically capture the platform-wide default.
//     Incumbent-wins keeps the seeded default serving until an operator
//     explicitly removes its label — that removal is the rotation cutover.
//   - Creation time: spec_audit.created_at is not trustworthy as an
//     ordering key. When this resolver was designed,
//     steps.SetAuditFieldsForUpdate reset it on every visibility update,
//     skill push, and schedule trigger (stigmer/stigmer#453, since fixed);
//     rows written before that fix may still carry rewritten timestamps,
//     and audit metadata remains operationally mutable in a way identity
//     is not. metadata.id never changes for the life of the row and is
//     time-ordered for server-generated ULIDs.
package defaultagent

import (
	"context"
	"errors"
	"fmt"

	"github.com/rs/zerolog/log"
	agentv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agent/v1"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource/apiresourcekind"
	"github.com/stigmer/stigmer/backend/libs/go/store"
	"google.golang.org/protobuf/proto"
)

// Label marks the platform default agent; the value must be LabelValue.
const Label = "stigmer.ai/default-agent"

// LabelValue is the only value of Label that marks an agent as the default.
const LabelValue = "true"

// ErrNotConfigured reports that no agent carries the default-agent label.
// Call sites map this to codes.NotFound with their own caller-facing copy.
var ErrNotConfigured = errors.New("no agent labeled " + Label + "=" + LabelValue)

// ErrNotPublic reports that labeled agents exist but none is
// visibility_public. Call sites map this to codes.FailedPrecondition —
// a deliberate divergence from the cloud edition, whose SQL predicate
// collapses this state into "not found": the distinct code tells a
// self-hosting operator the label is present but the visibility is wrong.
var ErrNotPublic = errors.New("agents labeled " + Label + "=" + LabelValue + " exist but none is visibility_public")

// Find resolves the platform default agent per the package contract:
// candidates are all agents labeled Label=LabelValue, only visibility_public
// candidates are eligible, and among those the lowest metadata.id wins.
//
// Returns ErrNotConfigured when nothing carries the label, ErrNotPublic when
// labeled agents exist but none is public, and a wrapped store error on
// query or decode failure (a store failure is an internal fault, not a
// "no default agent" condition — callers must not map it to NotFound).
func Find(ctx context.Context, s store.Store) (*agentv1.Agent, error) {
	raws, err := s.FindAllByLabel(ctx, apiresourcekind.ApiResourceKind_agent, Label, LabelValue, &agentv1.Agent{})
	if err != nil {
		return nil, fmt.Errorf("list agents labeled %s=%s: %w", Label, LabelValue, err)
	}
	if len(raws) == 0 {
		return nil, ErrNotConfigured
	}

	publicCount := 0
	var winner *agentv1.Agent
	for _, raw := range raws {
		candidate := &agentv1.Agent{}
		if err := proto.Unmarshal(raw, candidate); err != nil {
			// FindAllByLabel already unmarshaled every returned row to match
			// the label, so a failure here is store corruption. Fail loudly:
			// skipping a row could silently change which agent wins.
			return nil, fmt.Errorf("unmarshal agent labeled %s=%s: %w", Label, LabelValue, err)
		}
		if candidate.GetMetadata().GetVisibility() != apiresource.ApiResourceVisibility_visibility_public {
			continue
		}
		publicCount++
		if winner == nil || candidate.GetMetadata().GetId() < winner.GetMetadata().GetId() {
			winner = candidate
		}
	}
	if winner == nil {
		return nil, ErrNotPublic
	}

	if publicCount > 1 {
		// Expected briefly mid-rotation; persistent duplicates mean someone
		// forgot to retire the old label after applying the new default.
		log.Warn().
			Int("public_labeled_agents", publicCount).
			Str("winner_id", winner.GetMetadata().GetId()).
			Str("winner_name", winner.GetMetadata().GetName()).
			Msg("Multiple public agents carry the default-agent label; serving the incumbent (lowest id). Retire the stale label to complete rotation.")
	}

	return winner, nil
}
