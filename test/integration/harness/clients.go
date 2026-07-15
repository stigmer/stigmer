package harness

import (
	activityv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/activity/v1"
	agentv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agent/v1"
	agentchannelv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agentchannel/v1"
	agentexecv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agentexecution/v1"
	agentinstancev1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agentinstance/v1"
	agentsharev1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agentshare/v1"
	environmentv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/environment/v1"
	executionctxv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/executioncontext/v1"
	mcpserverv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/mcpserver/v1"
	sessionv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/session/v1"
	skillv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/skill/v1"
	workflowv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/workflow/v1"
	workflowexecutionv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/workflowexecution/v1"
	workflowinstancev1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/workflowinstance/v1"
	billingv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/billing/v1"
	apikeyv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/iam/apikey/v1"
	iampolicyv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/iam/iampolicy/v1"
	identityaccountv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/iam/identityaccount/v1"
	identityproviderv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/iam/identityprovider/v1"
	invitationv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/iam/invitation/v1"
	oauthappv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/iam/oauthapp/v1"
	platformclientv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/iam/platformclient/v1"
	searchv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/search/v1"
	organizationv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/tenancy/organization/v1"
	"google.golang.org/grpc"
)

// Clients holds typed gRPC clients for all services under test.
// It is intentionally a thin wrapper — no logic, no lifecycle management.
type Clients struct {
	// Activity (cross-cutting recents query)
	ActivityQuery activityv1.ActivityQueryControllerClient

	// Workflow services
	WorkflowCommand  workflowv1.WorkflowCommandControllerClient
	WorkflowQuery    workflowv1.WorkflowQueryControllerClient
	InstanceCommand  workflowinstancev1.WorkflowInstanceCommandControllerClient
	InstanceQuery    workflowinstancev1.WorkflowInstanceQueryControllerClient
	ExecutionCommand workflowexecutionv1.WorkflowExecutionCommandControllerClient
	ExecutionQuery   workflowexecutionv1.WorkflowExecutionQueryControllerClient

	// Agent services
	AgentCommand          agentv1.AgentCommandControllerClient
	AgentQuery            agentv1.AgentQueryControllerClient
	AgentInstanceCommand  agentinstancev1.AgentInstanceCommandControllerClient
	AgentInstanceQuery    agentinstancev1.AgentInstanceQueryControllerClient
	AgentExecutionCommand agentexecv1.AgentExecutionCommandControllerClient
	AgentExecutionQuery   agentexecv1.AgentExecutionQueryControllerClient
	AgentShareCommand     agentsharev1.AgentShareCommandControllerClient
	AgentShareQuery       agentsharev1.AgentShareQueryControllerClient
	AgentChannelCommand   agentchannelv1.AgentChannelCommandControllerClient
	AgentChannelQuery     agentchannelv1.AgentChannelQueryControllerClient

	// Environment services
	EnvironmentCommand environmentv1.EnvironmentCommandControllerClient
	EnvironmentQuery   environmentv1.EnvironmentQueryControllerClient

	// ExecutionContext services
	ExecutionContextQuery executionctxv1.ExecutionContextQueryControllerClient

	// Session services
	SessionCommand sessionv1.SessionCommandControllerClient
	SessionQuery   sessionv1.SessionQueryControllerClient

	// MCP Server services
	McpServerCommand mcpserverv1.McpServerCommandControllerClient
	McpServerQuery   mcpserverv1.McpServerQueryControllerClient

	// Skill services
	SkillCommand skillv1.SkillCommandControllerClient
	SkillQuery   skillv1.SkillQueryControllerClient

	// Billing
	BillingCommand billingv1.BillingCommandControllerClient
	BillingQuery   billingv1.BillingQueryControllerClient

	// IAM — PlatformClient
	PlatformClientCommand platformclientv1.PlatformClientCommandControllerClient
	PlatformClientQuery   platformclientv1.PlatformClientQueryControllerClient
	PlatformClientToken   platformclientv1.PlatformClientTokenControllerClient

	// IAM — IdentityProvider
	IdentityProviderCommand identityproviderv1.IdentityProviderCommandControllerClient
	IdentityProviderQuery   identityproviderv1.IdentityProviderQueryControllerClient

	// IAM — IdentityAccount
	IdentityAccountCommand identityaccountv1.IdentityAccountCommandControllerClient
	IdentityAccountQuery   identityaccountv1.IdentityAccountQueryControllerClient

	// IAM — ApiKey
	ApiKeyCommand apikeyv1.ApiKeyCommandControllerClient
	ApiKeyQuery   apikeyv1.ApiKeyQueryControllerClient

	// IAM — IamPolicy
	IamPolicyCommand iampolicyv1.IamPolicyCommandControllerClient
	IamPolicyQuery   iampolicyv1.IamPolicyQueryControllerClient

	// IAM — Invitation
	InvitationCommand invitationv1.InvitationCommandControllerClient
	InvitationQuery   invitationv1.InvitationQueryControllerClient

	// IAM — OAuthApp
	OAuthAppCommand oauthappv1.OAuthAppCommandControllerClient
	OAuthAppQuery   oauthappv1.OAuthAppQueryControllerClient

	// Tenancy — Organization
	OrganizationCommand organizationv1.OrganizationCommandControllerClient
	OrganizationQuery   organizationv1.OrganizationQueryControllerClient

	// Cross-cutting search (list/discover) — the FGA-filtered listing surface
	Search searchv1.SearchServiceClient
}

// NewClients creates all typed gRPC clients from a single connection.
func NewClients(conn grpc.ClientConnInterface) *Clients {
	return &Clients{
		ActivityQuery: activityv1.NewActivityQueryControllerClient(conn),

		WorkflowCommand:  workflowv1.NewWorkflowCommandControllerClient(conn),
		WorkflowQuery:    workflowv1.NewWorkflowQueryControllerClient(conn),
		InstanceCommand:  workflowinstancev1.NewWorkflowInstanceCommandControllerClient(conn),
		InstanceQuery:    workflowinstancev1.NewWorkflowInstanceQueryControllerClient(conn),
		ExecutionCommand: workflowexecutionv1.NewWorkflowExecutionCommandControllerClient(conn),
		ExecutionQuery:   workflowexecutionv1.NewWorkflowExecutionQueryControllerClient(conn),

		AgentCommand:          agentv1.NewAgentCommandControllerClient(conn),
		AgentQuery:            agentv1.NewAgentQueryControllerClient(conn),
		AgentInstanceCommand:  agentinstancev1.NewAgentInstanceCommandControllerClient(conn),
		AgentInstanceQuery:    agentinstancev1.NewAgentInstanceQueryControllerClient(conn),
		AgentExecutionCommand: agentexecv1.NewAgentExecutionCommandControllerClient(conn),
		AgentExecutionQuery:   agentexecv1.NewAgentExecutionQueryControllerClient(conn),
		AgentShareCommand:     agentsharev1.NewAgentShareCommandControllerClient(conn),
		AgentShareQuery:       agentsharev1.NewAgentShareQueryControllerClient(conn),
		AgentChannelCommand:   agentchannelv1.NewAgentChannelCommandControllerClient(conn),
		AgentChannelQuery:     agentchannelv1.NewAgentChannelQueryControllerClient(conn),

		EnvironmentCommand: environmentv1.NewEnvironmentCommandControllerClient(conn),
		EnvironmentQuery:   environmentv1.NewEnvironmentQueryControllerClient(conn),

		ExecutionContextQuery: executionctxv1.NewExecutionContextQueryControllerClient(conn),

		SessionCommand: sessionv1.NewSessionCommandControllerClient(conn),
		SessionQuery:   sessionv1.NewSessionQueryControllerClient(conn),

		McpServerCommand: mcpserverv1.NewMcpServerCommandControllerClient(conn),
		McpServerQuery:   mcpserverv1.NewMcpServerQueryControllerClient(conn),

		SkillCommand: skillv1.NewSkillCommandControllerClient(conn),
		SkillQuery:   skillv1.NewSkillQueryControllerClient(conn),

		BillingCommand: billingv1.NewBillingCommandControllerClient(conn),
		BillingQuery:   billingv1.NewBillingQueryControllerClient(conn),

		PlatformClientCommand: platformclientv1.NewPlatformClientCommandControllerClient(conn),
		PlatformClientQuery:   platformclientv1.NewPlatformClientQueryControllerClient(conn),
		PlatformClientToken:   platformclientv1.NewPlatformClientTokenControllerClient(conn),

		IdentityProviderCommand: identityproviderv1.NewIdentityProviderCommandControllerClient(conn),
		IdentityProviderQuery:   identityproviderv1.NewIdentityProviderQueryControllerClient(conn),

		IdentityAccountCommand: identityaccountv1.NewIdentityAccountCommandControllerClient(conn),
		IdentityAccountQuery:   identityaccountv1.NewIdentityAccountQueryControllerClient(conn),

		ApiKeyCommand: apikeyv1.NewApiKeyCommandControllerClient(conn),
		ApiKeyQuery:   apikeyv1.NewApiKeyQueryControllerClient(conn),

		IamPolicyCommand: iampolicyv1.NewIamPolicyCommandControllerClient(conn),
		IamPolicyQuery:   iampolicyv1.NewIamPolicyQueryControllerClient(conn),

		InvitationCommand: invitationv1.NewInvitationCommandControllerClient(conn),
		InvitationQuery:   invitationv1.NewInvitationQueryControllerClient(conn),

		OAuthAppCommand: oauthappv1.NewOAuthAppCommandControllerClient(conn),
		OAuthAppQuery:   oauthappv1.NewOAuthAppQueryControllerClient(conn),

		OrganizationCommand: organizationv1.NewOrganizationCommandControllerClient(conn),
		OrganizationQuery:   organizationv1.NewOrganizationQueryControllerClient(conn),

		Search: searchv1.NewSearchServiceClient(conn),
	}
}
