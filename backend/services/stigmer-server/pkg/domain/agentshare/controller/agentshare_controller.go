// Package agentshare implements the AgentShare controllers — the
// first-class sharing channel promoted out of Agent.spec.sharing
// (decision 011).
//
// A share carries everything a hosted chat link needs: audience, embed
// origins, visitor-facing refusal copy, guest tool credentials
// (environment_refs), and the rotatable link token. The referenced agent
// is never modified by share operations, so applying an agent manifest
// can never touch a share.
//
// Authorization posture (OSS): this edition is single-user and local, so
// handlers perform no authorization — a documented no-op, not a silent
// divergence. The cloud edition enforces the same contracts via FGA
// (share owner for update/rotate/delete, referenced-agent can_edit for
// create) plus app-level gates for the anonymous resolution paths.
package agentshare

import (
	agentsharev1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agentshare/v1"
	"github.com/stigmer/stigmer/backend/libs/go/store"
)

// AgentShareController implements AgentShareCommandController and
// AgentShareQueryController.
type AgentShareController struct {
	agentsharev1.UnimplementedAgentShareCommandControllerServer
	agentsharev1.UnimplementedAgentShareQueryControllerServer
	store store.Store
}

// NewAgentShareController creates a new AgentShareController.
func NewAgentShareController(store store.Store) *AgentShareController {
	return &AgentShareController{store: store}
}
