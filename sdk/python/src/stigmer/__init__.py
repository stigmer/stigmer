"""Stigmer Python SDK — typed API client for all Stigmer platform resources.

Usage::

    from stigmer import StigmerClient, AgentInput

    with StigmerClient("sk_live_abc123") as client:
        agent = client.agents.create(AgentInput(name="my-agent", org="my-org"))
        print(agent.metadata.name)
"""

from ._client import StigmerClient
from ._github import (
    ExchangeOAuthCodeParams,
    GetOAuthAuthorizeUrlParams,
    GitHubClient,
    OAuthAuthorizeUrlResponse,
    OAuthTokenResponse,
)
from ._search import ApiResourceKind, SearchClient, SearchParams, SearchResponse

# --- Resource clients and input types (generated) --------------------------

from ._gen._agent import (
    AgentClient,
    AgentInput,
    McpAccessInput,
    McpServerUsageInput,
    SubAgentInput,
    ToolApprovalOverrideInput,
)
from ._gen._agentexecution import (
    AgentExecutionClient,
    AgentExecutionInput,
    AttachmentInput,
    ContextManagementConfigInput,
    ExecutionConfigInput,
)
from ._gen._agentinstance import AgentInstanceClient, AgentInstanceInput
from ._gen._apikey import ApiKeyClient, ApiKeyInput
from ._gen._environment import EnvironmentClient, EnvironmentInput
from ._gen._executioncontext import ExecutionContextClient, ExecutionContextInput
from ._gen._iampolicy import ApiResourceRefInput, IamPolicyClient, IamPolicyInput
from ._gen._identityaccount import IdentityAccountClient, IdentityAccountInput
from ._gen._identityprovider import IdentityProviderClient, IdentityProviderInput
from ._gen._mcpserver import (
    HttpServerConfigInput,
    McpServerClient,
    McpServerInput,
    StdioServerConfigInput,
    ToolApprovalPolicyInput,
)
from ._gen._oauthapp import OAuthAppClient, OAuthAppInput
from ._gen._organization import OrganizationClient, OrganizationInput
from ._gen._project import ProjectClient, ProjectInput
from ._gen._session import (
    GitRepoSourceInput,
    LocalPathSourceInput,
    SessionClient,
    SessionInput,
    WorkspaceEntryInput,
    WorkspaceSourceInput,
)
from ._gen._skill import SkillClient, SkillInput
from ._gen._workflow import (
    ExportInput,
    FlowControlInput,
    WorkflowClient,
    WorkflowDocumentInput,
    WorkflowInput,
    WorkflowTaskInput,
)
from ._gen._workflowexecution import WorkflowExecutionClient, WorkflowExecutionInput
from ._gen._workflowinstance import WorkflowInstanceClient, WorkflowInstanceInput

# --- Shared types (generated) ----------------------------------------------

from ._gen._types import (
    DeleteResourceInput,
    EnvSpecInput,
    EnvVarInput,
    ListParams,
    ListResult,
    Page,
    ResourceRef,
)

# --- Error types (generated) -----------------------------------------------

from ._gen._errors import (
    ErrorCode,
    StigmerError,
    is_not_found,
    is_permission_denied,
    is_retryable,
    is_unauthenticated,
)

__all__ = [
    # Client
    "StigmerClient",
    # GitHub
    "ExchangeOAuthCodeParams",
    "GetOAuthAuthorizeUrlParams",
    "GitHubClient",
    "OAuthAuthorizeUrlResponse",
    "OAuthTokenResponse",
    # Search
    "ApiResourceKind",
    "SearchClient",
    "SearchParams",
    "SearchResponse",
    # Resource clients
    "AgentClient",
    "AgentExecutionClient",
    "AgentInstanceClient",
    "ApiKeyClient",
    "EnvironmentClient",
    "ExecutionContextClient",
    "IamPolicyClient",
    "IdentityAccountClient",
    "IdentityProviderClient",
    "McpServerClient",
    "OAuthAppClient",
    "OrganizationClient",
    "ProjectClient",
    "SessionClient",
    "SkillClient",
    "WorkflowClient",
    "WorkflowExecutionClient",
    "WorkflowInstanceClient",
    # Input types
    "AgentInput",
    "AgentExecutionInput",
    "AgentInstanceInput",
    "ApiKeyInput",
    "ApiResourceRefInput",
    "AttachmentInput",
    "ContextManagementConfigInput",
    "DeleteResourceInput",
    "EnvironmentInput",
    "EnvSpecInput",
    "EnvVarInput",
    "ExecutionConfigInput",
    "ExecutionContextInput",
    "ExportInput",
    "FlowControlInput",
    "GitRepoSourceInput",
    "HttpServerConfigInput",
    "IamPolicyInput",
    "IdentityAccountInput",
    "IdentityProviderInput",
    "LocalPathSourceInput",
    "McpAccessInput",
    "McpServerInput",
    "McpServerUsageInput",
    "OAuthAppInput",
    "OrganizationInput",
    "ProjectInput",
    "SessionInput",
    "SkillInput",
    "StdioServerConfigInput",
    "SubAgentInput",
    "ToolApprovalOverrideInput",
    "ToolApprovalPolicyInput",
    "WorkflowDocumentInput",
    "WorkflowExecutionInput",
    "WorkflowInput",
    "WorkflowInstanceInput",
    "WorkflowTaskInput",
    "WorkspaceEntryInput",
    "WorkspaceSourceInput",
    # Shared types
    "ListParams",
    "ListResult",
    "Page",
    "ResourceRef",
    # Errors
    "ErrorCode",
    "StigmerError",
    "is_not_found",
    "is_permission_denied",
    "is_retryable",
    "is_unauthenticated",
]
