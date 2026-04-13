"""Top-level Stigmer API client."""

from __future__ import annotations

from types import TracebackType

import grpc

from ._gen._agent import AgentClient
from ._gen._agentexecution import AgentExecutionClient
from ._gen._agentinstance import AgentInstanceClient
from ._gen._apikey import ApiKeyClient
from ._gen._environment import EnvironmentClient
from ._gen._executioncontext import ExecutionContextClient
from ._gen._iampolicy import IamPolicyClient
from ._gen._identityaccount import IdentityAccountClient
from ._gen._identityprovider import IdentityProviderClient
from ._gen._mcpserver import McpServerClient
from ._gen._oauthapp import OAuthAppClient
from ._gen._organization import OrganizationClient
from ._gen._project import ProjectClient
from ._gen._session import SessionClient
from ._gen._skill import SkillClient
from ._gen._workflow import WorkflowClient
from ._gen._workflowexecution import WorkflowExecutionClient
from ._gen._workflowinstance import WorkflowInstanceClient
from ._github import GitHubClient
from ._search import SearchClient
from ._transport import DEFAULT_TARGET, create_channel


class StigmerClient:
    """Stigmer API client.

    Creates a gRPC channel to the Stigmer platform and exposes typed
    sub-clients for every resource kind, plus a cross-resource
    :attr:`search` client and a :attr:`github` OAuth client.

    Usage::

        client = StigmerClient("sk_live_abc123")
        agent = client.agents.get("agent-id")
        client.close()

    As a context manager::

        with StigmerClient("sk_live_abc123") as client:
            agent = client.agents.get("agent-id")
    """

    agents: AgentClient
    agent_executions: AgentExecutionClient
    agent_instances: AgentInstanceClient
    api_keys: ApiKeyClient
    environments: EnvironmentClient
    execution_contexts: ExecutionContextClient
    iam_policies: IamPolicyClient
    identity_accounts: IdentityAccountClient
    identity_providers: IdentityProviderClient
    mcp_servers: McpServerClient
    oauthapps: OAuthAppClient
    organizations: OrganizationClient
    projects: ProjectClient
    sessions: SessionClient
    skills: SkillClient
    workflows: WorkflowClient
    workflow_executions: WorkflowExecutionClient
    workflow_instances: WorkflowInstanceClient
    search: SearchClient
    github: GitHubClient

    def __init__(
        self,
        api_key: str,
        *,
        base_url: str = DEFAULT_TARGET,
        insecure: bool = False,
    ) -> None:
        if not api_key:
            raise ValueError("stigmer: API key is required")

        self._channel = create_channel(base_url, api_key, insecure=insecure)
        self._init_clients(self._channel)

    def _init_clients(self, channel: grpc.Channel) -> None:
        """Wire up all resource sub-clients from the gRPC channel."""
        from ._gen._client import GeneratedClient

        gen = GeneratedClient(channel)

        self.agents = gen.agents
        self.agent_executions = gen.agent_executions
        self.agent_instances = gen.agent_instances
        self.api_keys = gen.api_keys
        self.environments = gen.environments
        self.execution_contexts = gen.execution_contexts
        self.iam_policies = gen.iam_policies
        self.identity_accounts = gen.identity_accounts
        self.identity_providers = gen.identity_providers
        self.mcp_servers = gen.mcp_servers
        self.oauthapps = gen.oauthapps
        self.organizations = gen.organizations
        self.projects = gen.projects
        self.sessions = gen.sessions
        self.skills = gen.skills
        self.workflows = gen.workflows
        self.workflow_executions = gen.workflow_executions
        self.workflow_instances = gen.workflow_instances

        self.search = SearchClient(channel)
        self.github = GitHubClient(channel)

    def close(self) -> None:
        """Release the underlying gRPC channel."""
        if self._channel is not None:
            self._channel.close()

    def __enter__(self) -> StigmerClient:
        return self

    def __exit__(
        self,
        exc_type: type[BaseException] | None,
        exc_val: BaseException | None,
        exc_tb: TracebackType | None,
    ) -> None:
        self.close()
