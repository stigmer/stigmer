package session

import (
	"fmt"

	sessionv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/session/v1"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/clierr"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/cliprint"
	"google.golang.org/protobuf/encoding/protojson"
	"gopkg.in/yaml.v3"
)

// DisplayGetResult displays a session in the specified format.
func DisplayGetResult(session *sessionv1.Session, format string) {
	switch format {
	case "yaml":
		displaySessionYAML(session)
	case "json":
		displaySessionJSON(session)
	default:
		displaySessionTable(session)
	}
}

func displaySessionTable(session *sessionv1.Session) {
	fmt.Println()
	cliprint.PrintInfo("Session: %s", session.GetMetadata().GetId())
	fmt.Println()

	cliprint.PrintInfo("Metadata:")
	cliprint.PrintInfo("  ID:      %s", session.GetMetadata().GetId())
	cliprint.PrintInfo("  Name:    %s", session.GetMetadata().GetName())
	cliprint.PrintInfo("  Org:     %s", session.GetMetadata().GetOrg())
	fmt.Println()

	cliprint.PrintInfo("Spec:")
	cliprint.PrintInfo("  Agent Instance: %s", session.GetSpec().GetAgentInstanceId())
	if session.GetSpec().GetSubject() != "" {
		cliprint.PrintInfo("  Subject:        %s", session.GetSpec().GetSubject())
	}
	fmt.Println()

	if audit := session.GetStatus().GetAudit().GetSpecAudit(); audit != nil {
		cliprint.PrintInfo("Audit:")
		if audit.GetCreatedAt() != nil {
			cliprint.PrintInfo("  Created:  %s", audit.GetCreatedAt().AsTime().Local().Format("2006-01-02 15:04:05"))
		}
		if audit.GetUpdatedAt() != nil {
			cliprint.PrintInfo("  Updated:  %s", audit.GetUpdatedAt().AsTime().Local().Format("2006-01-02 15:04:05"))
		}
	}
	fmt.Println()
}

func displaySessionYAML(session *sessionv1.Session) {
	marshaler := protojson.MarshalOptions{
		Indent:          "  ",
		UseProtoNames:   true,
		EmitUnpopulated: false,
	}
	jsonBytes, err := marshaler.Marshal(session)
	if err != nil {
		clierr.Handle(fmt.Errorf("failed to marshal session to JSON: %w", err))
		return
	}

	var jsonMap map[string]interface{}
	if err := yaml.Unmarshal(jsonBytes, &jsonMap); err != nil {
		clierr.Handle(fmt.Errorf("failed to parse JSON: %w", err))
		return
	}

	yamlBytes, err := yaml.Marshal(jsonMap)
	if err != nil {
		clierr.Handle(fmt.Errorf("failed to marshal to YAML: %w", err))
		return
	}
	fmt.Print(string(yamlBytes))
}

func displaySessionJSON(session *sessionv1.Session) {
	marshaler := protojson.MarshalOptions{
		Indent:          "  ",
		UseProtoNames:   true,
		EmitUnpopulated: false,
	}
	jsonBytes, err := marshaler.Marshal(session)
	if err != nil {
		clierr.Handle(fmt.Errorf("failed to marshal session to JSON: %w", err))
		return
	}
	fmt.Println(string(jsonBytes))
}

// DisplayListResult displays a list of sessions.
func DisplayListResult(list *sessionv1.SessionList, format string) {
	entries := list.GetEntries()
	if len(entries) == 0 {
		fmt.Println()
		cliprint.PrintInfo("No sessions found.")
		fmt.Println()
		return
	}

	switch format {
	case "yaml":
		displayListYAML(list)
	case "json":
		displayListJSON(list)
	default:
		displayListTable(list)
	}
}

func displayListTable(list *sessionv1.SessionList) {
	entries := list.GetEntries()

	fmt.Println()
	fmt.Printf("%-26s  %-26s  %-30s  %s\n", "SESSION ID", "AGENT", "SUBJECT", "CREATED")
	fmt.Printf("%-26s  %-26s  %-30s  %s\n", "----------", "-----", "-------", "-------")

	for _, ses := range entries {
		id := ses.GetMetadata().GetId()
		agent := truncateString(ses.GetSpec().GetAgentInstanceId(), 26)
		subject := truncateString(ses.GetSpec().GetSubject(), 30)
		created := "-"
		if audit := ses.GetStatus().GetAudit().GetSpecAudit(); audit != nil && audit.GetCreatedAt() != nil {
			created = audit.GetCreatedAt().AsTime().Local().Format("2006-01-02 15:04:05")
		}

		fmt.Printf("%-26s  %-26s  %-30s  %s\n", id, agent, subject, created)
	}

	fmt.Println()
	totalPages := list.GetTotalPages()
	if totalPages > 1 {
		cliprint.PrintInfo("Page 1 of %d", totalPages)
	}
}

func displayListYAML(list *sessionv1.SessionList) {
	marshaler := protojson.MarshalOptions{
		Indent:          "  ",
		UseProtoNames:   true,
		EmitUnpopulated: false,
	}
	jsonBytes, err := marshaler.Marshal(list)
	if err != nil {
		clierr.Handle(fmt.Errorf("failed to marshal list to JSON: %w", err))
		return
	}

	var jsonMap map[string]interface{}
	if err := yaml.Unmarshal(jsonBytes, &jsonMap); err != nil {
		clierr.Handle(fmt.Errorf("failed to parse JSON: %w", err))
		return
	}

	yamlBytes, err := yaml.Marshal(jsonMap)
	if err != nil {
		clierr.Handle(fmt.Errorf("failed to marshal to YAML: %w", err))
		return
	}
	fmt.Print(string(yamlBytes))
}

func displayListJSON(list *sessionv1.SessionList) {
	marshaler := protojson.MarshalOptions{
		Indent:          "  ",
		UseProtoNames:   true,
		EmitUnpopulated: false,
	}
	jsonBytes, err := marshaler.Marshal(list)
	if err != nil {
		clierr.Handle(fmt.Errorf("failed to marshal list to JSON: %w", err))
		return
	}
	fmt.Println(string(jsonBytes))
}

func truncateString(s string, maxLen int) string {
	if len(s) <= maxLen {
		return s
	}
	if maxLen <= 3 {
		return "..."
	}
	return s[:maxLen-3] + "..."
}
