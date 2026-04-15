package session

import (
	"fmt"
	"os"

	"github.com/fatih/color"

	sessionv1 "github.com/stigmer/stigmer/sdk/go/proto/ai/stigmer/agentic/session/v1"
	"github.com/stigmer/stigmer/client-apps/cli/pkg/display"
)

// DisplayGetResult displays a session in the specified format.
func DisplayGetResult(session *sessionv1.Session, format string) {
	display.DisplayProto(session, format, func() { displaySessionTable(session) })
}

func displaySessionTable(session *sessionv1.Session) {
	fmt.Println()
	fmt.Printf("Session: %s\n", session.GetMetadata().GetId())
	fmt.Println()

	fmt.Printf("Metadata:\n")
	fmt.Printf("  ID:      %s\n", session.GetMetadata().GetId())
	fmt.Printf("  Name:    %s\n", session.GetMetadata().GetName())
	fmt.Printf("  Org:     %s\n", session.GetMetadata().GetOrg())
	fmt.Println()

	fmt.Printf("Spec:\n")
	fmt.Printf("  Agent Instance: %s\n", session.GetSpec().GetAgentInstanceId())
	if subject := ResolvedSubject(session.GetSpec().GetSubject()); subject != "" {
		fmt.Printf("  Subject:        %s\n", subject)
	}
	fmt.Println()

	if audit := session.GetStatus().GetAudit().GetSpecAudit(); audit != nil {
		fmt.Printf("Audit:\n")
		if audit.GetCreatedAt() != nil {
			fmt.Printf("  Created:  %s\n", audit.GetCreatedAt().AsTime().Local().Format("2006-01-02 15:04:05"))
		}
		if audit.GetUpdatedAt() != nil {
			fmt.Printf("  Updated:  %s\n", audit.GetUpdatedAt().AsTime().Local().Format("2006-01-02 15:04:05"))
		}
	}
	fmt.Println()
}

// DisplayListResult displays a list of sessions.
func DisplayListResult(list *sessionv1.SessionList, format string) {
	entries := list.GetEntries()
	if len(entries) == 0 {
		display.DisplayEmptyResults("sessions", "")
		return
	}

	display.DisplayProto(list, format, func() { displayListTable(list) })
}

func displayListTable(list *sessionv1.SessionList) {
	entries := list.GetEntries()
	headerColor := color.New(color.FgCyan, color.Bold).SprintFunc()

	tbl := display.NewTable(
		[]string{"SESSION ID", "AGENT", "SUBJECT", "CREATED"},
		display.WithHeaderColor(headerColor),
		display.WithAdaptive(),
	)

	for _, ses := range entries {
		subject := ResolvedSubject(ses.GetSpec().GetSubject())
		if subject == "" {
			subject = "-"
		}
		created := "-"
		if audit := ses.GetStatus().GetAudit().GetSpecAudit(); audit != nil && audit.GetCreatedAt() != nil {
			created = audit.GetCreatedAt().AsTime().Local().Format("2006-01-02 15:04:05")
		}

		tbl.AddRow(
			ses.GetMetadata().GetId(),
			ses.GetSpec().GetAgentInstanceId(),
			subject,
			created,
		)
	}

	fmt.Println()
	tbl.Render(os.Stdout)

	totalPages := list.GetTotalPages()
	if totalPages > 1 {
		fmt.Printf("Page 1 of %d\n", totalPages)
	}
}
