package steps

import (
	apiresourcepb "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource"
)

const (
	managedLabelKey   = "stigmer.ai/managed"
	managedLabelValue = "true"
)

// ShareRestrictionReason reports why an environment must never leave private
// visibility, or "" when no restriction applies.
//
// Two classes of environment are share-restricted by construction:
//   - Personal environments (stigmer.ai/personal=true): the user's whole
//     credential fallback bag. Org-sharing it would expose every credential
//     the user ever stored, not a deliberately scoped set.
//   - Managed environments (stigmer.ai/managed=true): system-created holders
//     of per-user OAuth tokens. Sharing OAuth grants needs its own identity
//     and refresh design (tracked follow-up), so it is rejected here rather
//     than silently half-working.
//
// Both editions enforce this identically (Cloud mirrors the check in its
// environment visibility validation), keeping the error contract shared.
func ShareRestrictionReason(metadata *apiresourcepb.ApiResourceMetadata) string {
	labels := metadata.GetLabels()
	if labels[personalLabelKey] == personalLabelValue {
		return "personal environments cannot be shared with the organization - " +
			"create a dedicated environment with only the credentials the agent needs"
	}
	if labels[managedLabelKey] == managedLabelValue {
		return "OAuth-managed environments cannot be shared with the organization - " +
			"OAuth tokens are per-user credentials"
	}
	return ""
}
