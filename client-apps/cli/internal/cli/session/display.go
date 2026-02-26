package session

import (
	"fmt"

	sessionv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/session/v1"
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
		fmt.Println()
		fmt.Printf("No sessions found.\n")
		fmt.Println()
		return
	}

	display.DisplayProto(list, format, func() { displayListTable(list) })
}

func displayListTable(list *sessionv1.SessionList) {
	entries := list.GetEntries()

	fmt.Println()
	fmt.Printf("%-26s  %-26s  %-30s  %s\n", "SESSION ID", "AGENT", "SUBJECT", "CREATED")
	fmt.Printf("%-26s  %-26s  %-30s  %s\n", "----------", "-----", "-------", "-------")

	for _, ses := range entries {
		id := ses.GetMetadata().GetId()
		agent := truncateString(ses.GetSpec().GetAgentInstanceId(), 26)
		subject := ResolvedSubject(ses.GetSpec().GetSubject())
		if subject == "" {
			subject = "-"
		} else {
			subject = truncateString(subject, 30)
		}
		created := "-"
		if audit := ses.GetStatus().GetAudit().GetSpecAudit(); audit != nil && audit.GetCreatedAt() != nil {
			created = audit.GetCreatedAt().AsTime().Local().Format("2006-01-02 15:04:05")
		}

		fmt.Printf("%-26s  %-26s  %-30s  %s\n", id, agent, subject, created)
	}

	fmt.Println()
	totalPages := list.GetTotalPages()
	if totalPages > 1 {
		fmt.Printf("Page 1 of %d\n", totalPages)
	}
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
