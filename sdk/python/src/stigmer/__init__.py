"""Stigmer Python SDK — typed API client for all Stigmer platform resources.

Usage::

    from stigmer import StigmerClient, AgentInput

    with StigmerClient("sk_live_abc123") as client:
        agent = client.agents.create(AgentInput(name="my-agent", org="my-org"))
        print(agent.metadata.name)
"""

from ._billing import (
    BillingClient,
    CreateBillingPortalSessionParams,
    CreatePaymentMethodSetupSessionParams,
    RetireModelPricingBaselineParams,
    UpsertModelPricingBaselineParams,
)
from ._client import StigmerClient
from ._runner_adapter import RunnerAdapter
from ._github import GitHubClient, GitHubRepoParams
from ._search import ApiResourceKind, SearchClient, SearchParams, SearchResponse
from ._tokens import MintUserTokenResult, TokenClient

# --- Resource clients and input types (generated) --------------------------

from ._gen._agent import (
    AgentClient,
    AgentInput,
    RunConfigInput,
)
from ._gen._apikey import ApiKeyClient, ApiKeyInput
from ._gen._iampolicy import ApiResourceRefInput, IamPolicyClient, IamPolicyInput
from ._gen._identityaccount import IdentityAccountClient, IdentityAccountInput
from ._gen._identityprovider import IdentityProviderClient, IdentityProviderInput
from ._gen._oauthapp import OAuthAppClient, OAuthAppInput
from ._gen._organization import OrganizationClient, OrganizationInput
from ._gen._plugin import PluginClient
from ._gen._run import (
    AttachmentInput,
    RunClient,
    RunInput,
)
from ._gen._session import (
    GitRepoSourceInput,
    LocalPathSourceInput,
    SessionClient,
    SessionInput,
    WorkspaceEntryInput,
    WorkspaceSourceInput,
)
from ._gen._skill import SkillClient, SkillInput
from ._gen._vault import (
    VaultClient,
    VaultConnectionInput,
    VaultConnectionSignInInput,
    VaultInput,
    VaultSecretInput,
)
from ._skill import MAX_INLINE_ARTIFACT_BYTES, RoutedSkillClient

# --- Shared types (generated) ----------------------------------------------

from ._gen._types import (
    DeleteResourceInput,
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
    # Runner adapter
    "RunnerAdapter",
    # Billing
    "BillingClient",
    "CreateBillingPortalSessionParams",
    "CreatePaymentMethodSetupSessionParams",
    "RetireModelPricingBaselineParams",
    "UpsertModelPricingBaselineParams",
    # GitHub
    "GitHubClient",
    "GitHubRepoParams",
    # Search
    "ApiResourceKind",
    "SearchClient",
    "SearchParams",
    "SearchResponse",
    # User tokens
    "MintUserTokenResult",
    "TokenClient",
    # Resource clients
    "AgentClient",
    "ApiKeyClient",
    "IamPolicyClient",
    "IdentityAccountClient",
    "IdentityProviderClient",
    "OAuthAppClient",
    "OrganizationClient",
    "PluginClient",
    "RunClient",
    "SessionClient",
    "SkillClient",
    "VaultClient",
    "RoutedSkillClient",
    "MAX_INLINE_ARTIFACT_BYTES",
    # Input types
    "AgentInput",
    "ApiKeyInput",
    "ApiResourceRefInput",
    "AttachmentInput",
    "DeleteResourceInput",
    "GitRepoSourceInput",
    "IamPolicyInput",
    "IdentityAccountInput",
    "IdentityProviderInput",
    "LocalPathSourceInput",
    "OAuthAppInput",
    "OrganizationInput",
    "RunInput",
    "RunConfigInput",
    "SessionInput",
    "SkillInput",
    "VaultConnectionInput",
    "VaultConnectionSignInInput",
    "VaultInput",
    "VaultSecretInput",
    "WorkspaceEntryInput",
    "WorkspaceSourceInput",
    # Shared types
    "ResourceRef",
    # Errors
    "ErrorCode",
    "StigmerError",
    "is_not_found",
    "is_permission_denied",
    "is_retryable",
    "is_unauthenticated",
]
