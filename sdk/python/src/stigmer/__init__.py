"""Python client for Stigmer, the open-source backend for the agents in your product.

Usage::

    import os

    from stigmer import StigmerClient, AgentInput

    with StigmerClient(os.environ["STIGMER_API_KEY"]) as client:
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
from ._token_cache import FetchedToken, TokenCache
from ._turns import TURN_PHASE_WAITING, TurnAsk, TurnOutcome

# --- Routed wrappers over the generated skill and file clients -----------

from ._skill import MAX_INLINE_ARTIFACT_BYTES, RoutedSkillClient
from ._file import FileContent, RoutedFileClient

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
    "TokenCache",
    "FetchedToken",
    # Send a message and wait for the answer
    "TURN_PHASE_WAITING",
    "TurnAsk",
    "TurnOutcome",
    # Routed wrappers over the generated skill and file clients
    "RoutedSkillClient",
    "RoutedFileClient",
    "FileContent",
    "MAX_INLINE_ARTIFACT_BYTES",
    # Shared types
    "DeleteResourceInput",
    "ResourceRef",
    # Errors
    "ErrorCode",
    "StigmerError",
    "is_not_found",
    "is_permission_denied",
    "is_retryable",
    "is_unauthenticated",
]

# --- BEGIN stigmer-codegen: resource clients and inputs (generated; do not edit) ---
# `make -C sdk/python codegen` writes this region from the API's resources:
# each resource's client and input types. Every other line of this file is
# handwritten.

from ._gen._agent import (
    AgentClient,
    AgentInput,
    EnvVarDeclarationInput,
    HookSourceInput,
    HookConfigInput,
    HookGroupInput,
    HookHandlerInput,
    RunConfigInput,
    AgentMcpServerInput,
)
from ._gen._apikey import ApiKeyClient, ApiKeyInput
from ._gen._channel import (
    ChannelClient,
    ChannelInput,
    WebChannelConfigInput,
    WebChannelMessagesInput,
    SlackChannelConfigInput,
    WhatsAppChannelConfigInput,
)
from ._gen._channelapp import (
    ChannelAppClient,
    ChannelAppInput,
    SlackChannelAppConfigInput,
    WhatsAppChannelAppConfigInput,
)
from ._gen._environment import (
    EnvironmentClient,
    EnvironmentInput,
    EnvironmentNetworkingInput,
    EnvironmentPackagesInput,
)
from ._gen._eval import EvalClient, EvalInput
from ._gen._evalrun import (
    EvalRunClient,
    EvalRunInput,
    EvalRunCaseSourceInput,
    EvalRunTargetInput,
)
from ._gen._federationissuer import FederationIssuerClient, FederationIssuerInput
from ._gen._file import FileClient, FileInput
from ._gen._grant import GrantClient, GrantInput, ApiResourceRefInput
from ._gen._identityaccount import (
    IdentityAccountClient,
    IdentityAccountInput,
    IdentityAccountPreferencesInput,
)
from ._gen._invitation import InvitationClient, InvitationInput
from ._gen._license import (
    LicenseClient,
    LicenseInput,
    LicenseCustomerInput,
    EntitlementsInput,
    EntitlementLimitsInput,
)
from ._gen._memory import MemoryClient, MemoryInput, MemoryProvenanceInput
from ._gen._oauthapp import OAuthAppClient, OAuthAppInput
from ._gen._organization import (
    OrganizationClient,
    OrganizationInput,
    OrganizationPreferencesInput,
    OrganizationPoliciesInput,
    OrganizationEmbeddingInput,
)
from ._gen._plan import PlanClient, PlanInput, PlanTermsInput
from ._gen._plugin import PluginClient, PluginInput, PluginAuthorInput
from ._gen._providerkey import ProviderKeyClient
from ._gen._routine import (
    RoutineClient,
    RoutineInput,
    AgentInvocationInput,
    SessionResourceInput,
    FileResourceInput,
    GitRepositoryResourceInput,
    LocalPathResourceInput,
)
from ._gen._run import (
    RunClient,
    RunInput,
    SessionSpecInput,
    ConversationCatchupInput,
    EvalCaseContextInput,
    EvalMockServerInput,
    EvalMockToolInput,
    EvalMockPluginHomeInput,
    EvalMockAgentHomeInput,
)
from ._gen._score import ScoreClient, ScoreInput, ScoreCriterionInput
from ._gen._scoringrule import ScoringRuleClient, ScoringRuleInput
from ._gen._session import SessionClient, SessionInput
from ._gen._skill import SkillClient, SkillInput
from ._gen._subscription import SubscriptionClient, SubscriptionInput
from ._gen._team import TeamClient, TeamInput
from ._gen._vault import (
    VaultClient,
    VaultInput,
    VaultSecretInput,
    VaultConnectionInput,
    VaultConnectionSignInInput,
)

__all__ += [
    "AgentClient",
    "AgentInput",
    "EnvVarDeclarationInput",
    "HookSourceInput",
    "HookConfigInput",
    "HookGroupInput",
    "HookHandlerInput",
    "RunConfigInput",
    "AgentMcpServerInput",
    "ApiKeyClient",
    "ApiKeyInput",
    "ChannelClient",
    "ChannelInput",
    "WebChannelConfigInput",
    "WebChannelMessagesInput",
    "SlackChannelConfigInput",
    "WhatsAppChannelConfigInput",
    "ChannelAppClient",
    "ChannelAppInput",
    "SlackChannelAppConfigInput",
    "WhatsAppChannelAppConfigInput",
    "EnvironmentClient",
    "EnvironmentInput",
    "EnvironmentNetworkingInput",
    "EnvironmentPackagesInput",
    "EvalClient",
    "EvalInput",
    "EvalRunClient",
    "EvalRunInput",
    "EvalRunCaseSourceInput",
    "EvalRunTargetInput",
    "FederationIssuerClient",
    "FederationIssuerInput",
    "FileClient",
    "FileInput",
    "GrantClient",
    "GrantInput",
    "ApiResourceRefInput",
    "IdentityAccountClient",
    "IdentityAccountInput",
    "IdentityAccountPreferencesInput",
    "InvitationClient",
    "InvitationInput",
    "LicenseClient",
    "LicenseInput",
    "LicenseCustomerInput",
    "EntitlementsInput",
    "EntitlementLimitsInput",
    "MemoryClient",
    "MemoryInput",
    "MemoryProvenanceInput",
    "OAuthAppClient",
    "OAuthAppInput",
    "OrganizationClient",
    "OrganizationInput",
    "OrganizationPreferencesInput",
    "OrganizationPoliciesInput",
    "OrganizationEmbeddingInput",
    "PlanClient",
    "PlanInput",
    "PlanTermsInput",
    "PluginClient",
    "PluginInput",
    "PluginAuthorInput",
    "ProviderKeyClient",
    "RoutineClient",
    "RoutineInput",
    "AgentInvocationInput",
    "SessionResourceInput",
    "FileResourceInput",
    "GitRepositoryResourceInput",
    "LocalPathResourceInput",
    "RunClient",
    "RunInput",
    "SessionSpecInput",
    "ConversationCatchupInput",
    "EvalCaseContextInput",
    "EvalMockServerInput",
    "EvalMockToolInput",
    "EvalMockPluginHomeInput",
    "EvalMockAgentHomeInput",
    "ScoreClient",
    "ScoreInput",
    "ScoreCriterionInput",
    "ScoringRuleClient",
    "ScoringRuleInput",
    "SessionClient",
    "SessionInput",
    "SkillClient",
    "SkillInput",
    "SubscriptionClient",
    "SubscriptionInput",
    "TeamClient",
    "TeamInput",
    "VaultClient",
    "VaultInput",
    "VaultSecretInput",
    "VaultConnectionInput",
    "VaultConnectionSignInInput",
]
# --- END stigmer-codegen ---
