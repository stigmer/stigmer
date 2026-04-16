package apikey

import (
	"fmt"
	"os"
	"time"

	"github.com/fatih/color"

	"github.com/stigmer/stigmer/client-apps/cli/pkg/display"
	apikeyv1 "github.com/stigmer/stigmer/sdk/go/proto/ai/stigmer/iam/apikey/v1"
)

// DisplayGetResult displays an API key in the specified format.
func DisplayGetResult(key *apikeyv1.ApiKey, format string) {
	display.DisplayProto(key, format, func() { displayGetTable(key) })
}

func displayGetTable(key *apikeyv1.ApiKey) {
	fmt.Println()
	fmt.Printf("API Key: %s\n", key.GetMetadata().GetId())
	fmt.Println()

	fmt.Printf("Metadata:\n")
	fmt.Printf("  ID:   %s\n", key.GetMetadata().GetId())
	if key.GetMetadata().GetName() != "" {
		fmt.Printf("  Name: %s\n", key.GetMetadata().GetName())
	}
	fmt.Println()

	fmt.Printf("Spec:\n")
	if key.GetSpec().GetFingerprint() != "" {
		fmt.Printf("  Fingerprint: ***%s\n", key.GetSpec().GetFingerprint())
	}
	if key.GetSpec().GetNeverExpires() {
		fmt.Printf("  Expires:     Never\n")
	} else if key.GetSpec().GetExpiresAt() != nil {
		expiresAt := key.GetSpec().GetExpiresAt().AsTime()
		fmt.Printf("  Expires:     %s\n", expiresAt.Format(time.RFC3339))
		remaining := time.Until(expiresAt)
		if remaining > 0 {
			fmt.Printf("  Valid for:   %s\n", FormatDuration(remaining))
		} else {
			fmt.Printf("  Status:      EXPIRED\n")
		}
	}
	fmt.Println()

	if key.GetStatus() != nil && key.GetStatus().GetAudit() != nil {
		audit := key.GetStatus().GetAudit().GetSpecAudit()
		if audit != nil {
			fmt.Printf("Audit:\n")
			if audit.GetCreatedAt() != nil {
				fmt.Printf("  Created: %s\n", audit.GetCreatedAt().AsTime().Format(time.RFC3339))
			}
		}
		if key.GetStatus().GetLastUsedAt() != nil {
			fmt.Printf("  Last Used: %s\n", key.GetStatus().GetLastUsedAt().AsTime().Format(time.RFC3339))
		}
		fmt.Println()
	}
}

// DisplayListResult displays a list of API keys in the specified format.
func DisplayListResult(keys []*apikeyv1.ApiKey, format string) {
	if len(keys) == 0 {
		display.DisplayEmptyResults("API keys", "")
		return
	}

	display.DisplayProtoSlice(keys, format, func() { displayListTable(keys) })
}

func displayListTable(keys []*apikeyv1.ApiKey) {
	headerColor := color.New(color.FgCyan, color.Bold).SprintFunc()
	dimColor := color.New(color.Faint).SprintFunc()

	tbl := display.NewTable(
		[]string{"ID", "NAME", "FINGERPRINT", "EXPIRES"},
		display.WithHeaderColor(headerColor),
		display.WithAdaptive(),
	)

	for _, key := range keys {
		name := key.GetMetadata().GetName()
		if name == "" {
			name = "-"
		}

		fingerprint := ""
		if key.GetSpec().GetFingerprint() != "" {
			fingerprint = "***" + key.GetSpec().GetFingerprint()
		}

		expires := "Never"
		if !key.GetSpec().GetNeverExpires() && key.GetSpec().GetExpiresAt() != nil {
			expiresAt := key.GetSpec().GetExpiresAt().AsTime()
			if time.Now().After(expiresAt) {
				expires = "EXPIRED"
			} else {
				expires = expiresAt.Format("2006-01-02")
			}
		}

		tbl.AddRow(
			dimColor(key.GetMetadata().GetId()),
			name,
			fingerprint,
			expires,
		)
	}

	fmt.Println()
	tbl.Render(os.Stdout)
}

// DisplayCreateResult displays a newly created API key with the raw key value.
func DisplayCreateResult(key *apikeyv1.ApiKey) {
	fmt.Println()
	fmt.Println("API key created successfully!")
	fmt.Println()
	fmt.Println("IMPORTANT: Save this API key now — it will not be shown again!")
	fmt.Println()
	fmt.Println("═══════════════════════════════════════════════════════════════")
	fmt.Printf("  %s\n", key.GetSpec().GetKeyHash())
	fmt.Println("═══════════════════════════════════════════════════════════════")
	fmt.Println()

	fmt.Printf("  ID:          %s\n", key.GetMetadata().GetId())
	if key.GetMetadata().GetName() != "" {
		fmt.Printf("  Name:        %s\n", key.GetMetadata().GetName())
	}
	if key.GetSpec().GetFingerprint() != "" {
		fmt.Printf("  Fingerprint: ***%s\n", key.GetSpec().GetFingerprint())
	}
	if key.GetSpec().GetNeverExpires() {
		fmt.Printf("  Expires:     Never\n")
	} else if key.GetSpec().GetExpiresAt() != nil {
		fmt.Printf("  Expires:     %s\n", key.GetSpec().GetExpiresAt().AsTime().Format(time.RFC3339))
	}
	fmt.Println()

	fmt.Println("Usage:")
	fmt.Printf("  export STIGMER_API_KEY='%s'\n", key.GetSpec().GetKeyHash())
	fmt.Printf("  stigmer --api-key '%s' <command>\n", key.GetSpec().GetKeyHash())
	fmt.Println()
}

// FormatDuration formats a duration in human-readable form.
func FormatDuration(d time.Duration) string {
	if d < time.Hour {
		return fmt.Sprintf("%d minutes", int(d.Minutes()))
	}
	if d < 24*time.Hour {
		return fmt.Sprintf("%d hours", int(d.Hours()))
	}
	days := int(d.Hours() / 24)
	if days < 365 {
		return fmt.Sprintf("%d days", days)
	}
	years := days / 365
	remainingDays := days % 365
	if remainingDays == 0 {
		return fmt.Sprintf("%d years", years)
	}
	return fmt.Sprintf("%d years %d days", years, remainingDays)
}
