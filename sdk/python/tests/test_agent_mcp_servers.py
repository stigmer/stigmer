"""An agent input carries the MCP servers written in the agent itself.

``AgentInput.mcp_servers`` holds each server's name, address and headers.
The generated conversion must put every one of them on the Agent proto's
``spec.mcp_servers``, and they must survive the wire: the proto is
serialized and parsed back, and the server read from it is the one the
caller wrote.
"""

from __future__ import annotations

from ai.stigmer.agentic.agent.v1 import api_pb2

from stigmer._gen._agent import AgentInput, AgentMcpServerInput

_NAME = "zendesk"
_URL = "https://acme-co.zendesk.com/mcp"
_HEADER = "X-Api-Key"
_HEADER_VALUE = "${ZENDESK_KEY}"


def _agent() -> AgentInput:
    return AgentInput(
        name="Support bot",
        org="acme",
        mcp_servers=[
            AgentMcpServerInput(name=_NAME, url=_URL, headers={_HEADER: _HEADER_VALUE}),
        ],
    )


class TestAgentMcpServers:
    def test_the_proto_holds_each_server_the_caller_wrote(self) -> None:
        servers = _agent()._to_proto().spec.mcp_servers
        assert len(servers) == 1
        assert servers[0].name == _NAME
        assert servers[0].url == _URL
        assert dict(servers[0].headers) == {_HEADER: _HEADER_VALUE}

    def test_the_servers_survive_the_wire(self) -> None:
        wire = _agent()._to_proto().SerializeToString()
        servers = api_pb2.Agent.FromString(wire).spec.mcp_servers
        assert [(s.name, s.url, dict(s.headers)) for s in servers] == [
            (_NAME, _URL, {_HEADER: _HEADER_VALUE}),
        ]

    def test_an_agent_without_servers_sends_none(self) -> None:
        assert len(AgentInput(name="Support bot", org="acme")._to_proto().spec.mcp_servers) == 0
