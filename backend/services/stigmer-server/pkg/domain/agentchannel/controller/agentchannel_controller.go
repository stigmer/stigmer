// Package agentchannel implements the AgentChannel controllers — the
// connection binding an agent to an external messaging platform workspace
// (the Slack/WhatsApp distribution channel, decisions 001–008 of the
// channel-integrations project).
//
// A channel declares which agent serves a provider workspace and whether
// serving is enabled. Workspace identity and credentials are produced by
// the provider install flow and live in status — a declarative apply can
// never clobber them. Unlike shares (decision 013), channels have NO
// cross-org arm: the channel's org is the billing org and the credentials
// org, and both must be the referenced agent's (decision 004).
//
// Authorization posture (OSS): this edition is single-user and local, so
// handlers perform no authorization — a documented no-op, not a silent
// divergence. The cloud edition enforces the same contracts via FGA
// (can_edit on the referenced agent for create; channel-level can_edit/
// can_delete for update, install, and delete).
//
// Install posture (OSS, T02 §0-b — a deliberate, developer-approved
// divergence): initiateInstall and completeInstall refuse with
// FAILED_PRECONDITION ("channel installs require Stigmer Cloud"). This
// edition has no webhook receiver and no delivery runtime, so an installed
// channel could never serve traffic — an honest refusal beats a
// half-connected install. This deliberately does NOT follow the OSS
// MCP-OAuth precedent (a full implementation with config guards);
// bring-your-own-provider-app in OSS remains a future path if an OSS
// channel runtime ever lands.
package agentchannel

import (
	agentchannelv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agentchannel/v1"
	"github.com/stigmer/stigmer/backend/libs/go/store"
)

// AgentChannelController implements AgentChannelCommandController and
// AgentChannelQueryController.
type AgentChannelController struct {
	agentchannelv1.UnimplementedAgentChannelCommandControllerServer
	agentchannelv1.UnimplementedAgentChannelQueryControllerServer
	store store.Store
}

// NewAgentChannelController creates a new AgentChannelController.
func NewAgentChannelController(store store.Store) *AgentChannelController {
	return &AgentChannelController{store: store}
}
