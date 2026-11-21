package stigmer

// Pins that the generated AgentInput carries an agent's computer
// (spec.computer) to the wire and back, both values a Go author can mean:
// COMPUTER_NONE, which turns an existing agent's computer off, and
// COMPUTER_REQUIRED. The setting is an enum rather than an optional bool so
// that a Go input, whose zero reads as unset, can still send "no computer".
// An input that leaves it at zero sends nothing, which the server reads as
// "keep the stored value". Driven through AgentClient.Apply against the
// in-memory capture server beside the MCP servers' round-trip.

import (
	"context"
	"testing"

	sessionv1 "go.stigmer.ai/sdk/proto/ai/stigmer/agentic/session/v1"
)

func TestAgentApply_CarriesComputerToTheWireAndBack(t *testing.T) {
	for _, computer := range []sessionv1.Computer{
		sessionv1.Computer_COMPUTER_NONE,
		sessionv1.Computer_COMPUTER_REQUIRED,
		sessionv1.Computer_COMPUTER_UNSPECIFIED,
	} {
		t.Run(computer.String(), func(t *testing.T) {
			client, capture := newAgentCaptureClient(t)

			_, err := client.Apply(context.Background(), &AgentInput{
				Name:         "Support desk",
				Org:          mcpAgentOrgSlug,
				Instructions: "Answer tickets.",
				Computer:     computer,
			})
			if err != nil {
				t.Fatalf("Agent.Apply: %v", err)
			}

			if got := capture.lastAgent.GetSpec().GetComputer(); got != computer {
				t.Errorf("wire computer = %v, want %v", got, computer)
			}
			if back := AgentInputFromProto(capture.lastAgent); back.Computer != computer {
				t.Errorf("round-trip computer = %v, want %v", back.Computer, computer)
			}
		})
	}
}
