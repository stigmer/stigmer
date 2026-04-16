package root

import (
	"strings"

	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/session"
	"github.com/stigmer/stigmer/client-apps/cli/pkg/picker"
	stigmer "github.com/stigmer/stigmer/sdk/go"
)

// buildSessionSearchFn returns a picker.SearchFn that lists sessions from
// the backend and filters them client-side by query text. Client-side
// filtering is appropriate here because sessions are user-scoped and the
// total count is typically manageable.
func buildSessionSearchFn(client *stigmer.Client) func(query string) ([]picker.Item, error) {
	return func(query string) ([]picker.Item, error) {
		list, err := session.List(&session.ListOptions{
			Client:   client,
			PageSize: session.MaxPageSize,
		})
		if err != nil {
			return nil, err
		}

		query = strings.ToLower(strings.TrimSpace(query))
		var items []picker.Item
		for _, ses := range list.GetEntries() {
			subject := session.ResolvedSubject(ses.GetSpec().GetSubject())
			if subject == "" {
				subject = "(no subject)"
			}
			sessionID := ses.GetMetadata().GetId()
			agent := ses.GetSpec().GetAgentInstanceId()

			if query != "" {
				combined := strings.ToLower(subject + " " + sessionID + " " + agent)
				if !strings.Contains(combined, query) {
					continue
				}
			}

			meta := ""
			if audit := ses.GetStatus().GetAudit().GetSpecAudit(); audit != nil && audit.GetCreatedAt() != nil {
				meta = relativeTime(audit.GetCreatedAt().AsTime())
			}

			items = append(items, picker.Item{
				ID:       sessionID,
				Title:    subject,
				Subtitle: agent,
				Meta:     meta,
			})
		}

		return items, nil
	}
}
