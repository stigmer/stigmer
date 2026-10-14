package ai.stigmer.sdk.gen;

import ai.stigmer.agentic.agent.v1.Agent;
import ai.stigmer.agentic.agent.v1.AgentMcpServer;
import com.google.protobuf.InvalidProtocolBufferException;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;

/**
 * An agent input carries the MCP servers written in the agent itself.
 *
 * <p>{@code AgentInput.mcpServers} holds each server's name, address and
 * headers. The generated conversion must put every one of them on the Agent
 * proto's {@code spec.mcp_servers}, and they must survive the wire: the
 * proto is serialized and parsed back, and the server read from it is the
 * one the caller wrote.
 */
class AgentMcpServersTest {

    private static final String NAME = "zendesk";
    private static final String URL = "https://acme-co.zendesk.com/mcp";
    private static final String HEADER = "X-Api-Key";
    private static final String HEADER_VALUE = "${ZENDESK_KEY}";

    private static Agent agentOnTheWire() {
        return AgentInput.builder()
            .name("Support bot")
            .org("acme")
            .mcpServers(java.util.List.of(
                AgentInput.AgentMcpServerInput.builder()
                    .name(NAME)
                    .url(URL)
                    .headers(java.util.Map.of(HEADER, HEADER_VALUE))
                    .build()))
            .build()
            .toProto();
    }

    @Test
    void proto_holdsEachServerTheCallerWrote() {
        java.util.List<AgentMcpServer> servers = agentOnTheWire().getSpec().getMcpServersList();

        assertEquals(1, servers.size());
        assertEquals(NAME, servers.get(0).getName());
        assertEquals(URL, servers.get(0).getUrl());
        assertEquals(java.util.Map.of(HEADER, HEADER_VALUE), servers.get(0).getHeadersMap());
    }

    @Test
    void servers_surviveTheWire() throws InvalidProtocolBufferException {
        Agent parsed = Agent.parseFrom(agentOnTheWire().toByteArray());
        java.util.List<AgentMcpServer> servers = parsed.getSpec().getMcpServersList();

        assertEquals(1, servers.size());
        assertEquals(NAME, servers.get(0).getName());
        assertEquals(URL, servers.get(0).getUrl());
        assertEquals(java.util.Map.of(HEADER, HEADER_VALUE), servers.get(0).getHeadersMap());
    }

    @Test
    void agent_withoutServers_sendsNone() {
        Agent agent = AgentInput.builder().name("Support bot").org("acme").build().toProto();

        assertEquals(0, agent.getSpec().getMcpServersCount());
    }
}
