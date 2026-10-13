// Example: Streaming an agent run.
//
// This shows how to start a conversation on an agent and read what the
// agent does as it happens. The new conversation names the agent by
// reference; the server creates its session and pins the agent's current
// version on it.
//
// A session's output is one ordered log of Claude Managed Agents events.
// StreamEvents with after_seq 0 first sends every stored event of the
// session, then each new one as it is appended, so nothing the turn
// produced before the stream opened is missed. The turn's own
// stigmer.run.status event says when it ended.
package examples

import (
	"context"
	"fmt"
	"io"
	"log"
	"strings"

	stigmer "github.com/stigmer/stigmer/sdk/go/v3"
	sessionv1 "github.com/stigmer/stigmer/sdk/go/v3/proto/ai/stigmer/agentic/session/v1"
	"google.golang.org/protobuf/proto"
)

// turnEnded reports whether a stigmer.run.status phase ends the turn.
func turnEnded(phase string) bool {
	switch phase {
	case "completed", "failed", "cancelled", "terminated":
		return true
	}
	return false
}

func StreamingRun() {
	ctx := context.Background()

	client, err := stigmer.NewClient(stigmer.WithAPIKey("sk_live_your_api_key"))
	if err != nil {
		log.Fatal(err)
	}
	defer client.Close()

	run, err := client.Run.Create(ctx, &stigmer.RunInput{
		SessionSpec: &stigmer.SessionSpecInput{
			AgentRef: stigmer.ResourceRef{Org: "my-org", Slug: "code-reviewer"},
		},
		Message: "Review the latest changes in the auth module",
		RunConfig: &stigmer.RunConfigInput{
			ModelName:     "claude-sonnet-4-6",
			MaxToolRounds: 25,
			MaxCostUsd:    2.00,
		},
	})
	if err != nil {
		log.Fatal(err)
	}
	runID := run.GetMetadata().GetId()
	fmt.Printf("Created run: %s\n", runID)

	// The server records the session it created on the run.
	stream, err := client.Session.StreamEvents(ctx, &sessionv1.StreamSessionEventsRequest{
		SessionId: run.GetSpec().GetSessionId(),
		AfterSeq:  proto.Int64(0),
	})
	if err != nil {
		log.Fatal(err)
	}

	for {
		frame, err := stream.Recv()
		if err == io.EOF {
			break
		}
		if err != nil {
			log.Fatal(err)
		}
		event := frame.GetEvent()
		if event.GetRunId() != runID {
			continue
		}
		switch {
		case event.GetAgentMessage() != nil && event.GetThreadId() == "":
			var text strings.Builder
			for _, block := range event.GetAgentMessage().GetContent() {
				text.WriteString(block.GetText())
			}
			fmt.Println(text.String())
		case event.GetAgentToolUse() != nil:
			fmt.Printf("Tool: %s\n", event.GetAgentToolUse().GetName())
		case event.GetStigmerRunStatus() != nil:
			status := event.GetStigmerRunStatus()
			fmt.Printf("Phase: %s\n", status.GetPhase())
			if turnEnded(status.GetPhase()) {
				return
			}
		}
	}
}
