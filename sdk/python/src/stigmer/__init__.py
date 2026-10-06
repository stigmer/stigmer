"""Stigmer Python SDK — typed API client for all Stigmer platform resources.

Usage::

    from stigmer import StigmerClient, AgentInput

    with StigmerClient("sk_live_abc123") as client:
        agent = client.agents.create(AgentInput(name="my-agent", org="my-org"))
        print(agent.metadata.name)
"""

from ._billing import (
    AdjustCreditsParams,
    BillingClient,
    CreateBillingPortalSessionParams,
    CreateCheckoutSessionParams,
    CreatePaymentMethodSetupSessionParams,
    DecideModelPricingOverrideParams,
    GetBillingUsageReportParams,
    GetCreditLedgerParams,
    GrantCreditsParams,
    RetireModelPricingBaselineParams,
    SetAutoRechargeConfigParams,
    UpsertModelPricingBaselineParams,
)
from ._client import StigmerClient
from ._runner_adapter import RunnerAdapter
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
    McpServerUsageInput,
    RunConfigInput,
    SubAgentInput,
)
from ._gen._agentrun import (
    AgentRunClient,
    AgentRunInput,
    AttachmentInput,
)
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
)
from ._gen._oauthapp import OAuthAppClient, OAuthAppInput
from ._gen._organization import OrganizationClient, OrganizationInput
from ._gen._session import (
    GitRepoSourceInput,
    LocalPathSourceInput,
    SessionClient,
    SessionInput,
    WorkspaceEntryInput,
    WorkspaceSourceInput,
)
from ._gen._skill import SkillClient, SkillInput
from ._skill import MAX_INLINE_ARTIFACT_BYTES, RoutedSkillClient
from ._gen._workflow import (
    ExportInput,
    FlowControlInput,
    WorkflowClient,
    WorkflowDocumentInput,
    WorkflowInput,
    WorkflowTaskInput,
)
from ._gen._workflowrun import WorkflowRunClient, WorkflowRunInput

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

# --- PlatformClient token minting ------------------------------------------

from .platform_client_auth import (
    MintUserTokenInput,
    MintUserTokenResult,
    PlatformClientAuth,
    platform_client_auth,
)

__all__ = [
    # Client
    "StigmerClient",
    # Runner adapter
    "RunnerAdapter",
    # Billing
    "AdjustCreditsParams",
    "BillingClient",
    "CreateBillingPortalSessionParams",
    "CreateCheckoutSessionParams",
    "CreatePaymentMethodSetupSessionParams",
    "DecideModelPricingOverrideParams",
    "GetBillingUsageReportParams",
    "GetCreditLedgerParams",
    "GrantCreditsParams",
    "RetireModelPricingBaselineParams",
    "SetAutoRechargeConfigParams",
    "UpsertModelPricingBaselineParams",
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
    "AgentRunClient",
    "ApiKeyClient",
    "EnvironmentClient",
    "ExecutionContextClient",
    "IamPolicyClient",
    "IdentityAccountClient",
    "IdentityProviderClient",
    "McpServerClient",
    "OAuthAppClient",
    "OrganizationClient",
    "SessionClient",
    "SkillClient",
    "RoutedSkillClient",
    "MAX_INLINE_ARTIFACT_BYTES",
    "WorkflowClient",
    "WorkflowRunClient",
    # Input types
    "AgentInput",
    "AgentRunInput",
    "ApiKeyInput",
    "ApiResourceRefInput",
    "AttachmentInput",
    "DeleteResourceInput",
    "EnvironmentInput",
    "EnvSpecInput",
    "EnvVarInput",
    "ExecutionContextInput",
    "ExportInput",
    "FlowControlInput",
    "GitRepoSourceInput",
    "HttpServerConfigInput",
    "IamPolicyInput",
    "IdentityAccountInput",
    "IdentityProviderInput",
    "LocalPathSourceInput",
    "McpServerInput",
    "McpServerUsageInput",
    "OAuthAppInput",
    "OrganizationInput",
    "RunConfigInput",
    "SessionInput",
    "SkillInput",
    "StdioServerConfigInput",
    "SubAgentInput",
    "WorkflowDocumentInput",
    "WorkflowInput",
    "WorkflowRunInput",
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
    # PlatformClient token minting
    "MintUserTokenInput",
    "MintUserTokenResult",
    "PlatformClientAuth",
    "platform_client_auth",
]
