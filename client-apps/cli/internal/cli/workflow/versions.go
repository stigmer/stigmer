package workflow

import (
	"context"
	"fmt"
	"strings"

	"github.com/pkg/errors"
	"github.com/stigmer/stigmer/client-apps/cli/pkg/climsg"
	stigmer "github.com/stigmer/stigmer/sdk/go"
	workflowv1 "github.com/stigmer/stigmer/sdk/go/proto/ai/stigmer/agentic/workflow/v1"
)

// RunVersionsList lists version history for a workflow, using an existing client.
func RunVersionsList(client *stigmer.Client, org, slug string, pageSize int32) error {
	ctx := context.Background()

	resp, err := client.Workflow.ListVersions(ctx, &workflowv1.ListWorkflowVersionsInput{
		Org:      org,
		Slug:     slug,
		PageSize: pageSize,
	})
	if err != nil {
		return errors.Wrap(err, "failed to list versions")
	}

	if len(resp.GetVersions()) == 0 {
		fmt.Println()
		climsg.Info("No version history found for %s/%s", org, slug)
		climsg.Info("Tip: Apply a workflow to create the first version:")
		climsg.Info("  stigmer apply -f workflow.yaml")
		fmt.Println()
		return nil
	}

	displayVersionsTable(resp.GetVersions(), resp.GetTotalCount())
	return nil
}

// RunVersionsGet retrieves the validated YAML for a specific workflow version, using an existing client.
func RunVersionsGet(client *stigmer.Client, org, slug, hashOrTag string) error {
	ctx := context.Background()

	workflowID, err := resolveWorkflowID(ctx, client, org, slug)
	if err != nil {
		return err
	}

	entry, err := client.Workflow.GetVersion(ctx, &workflowv1.GetWorkflowVersionInput{
		WorkflowId:  workflowID,
		VersionHash: hashOrTag,
	})
	if err != nil {
		return errors.Wrapf(err, "failed to get version '%s'", hashOrTag)
	}

	yaml := entry.GetValidatedYaml()
	if yaml == "" {
		return fmt.Errorf("version %s has no validated YAML", truncateHash(hashOrTag))
	}

	fmt.Print(yaml)
	return nil
}

// RunVersionsTag assigns a tag to a specific workflow version, using an existing client.
func RunVersionsTag(client *stigmer.Client, org, slug, hash, tag string) error {
	ctx := context.Background()

	workflowID, err := resolveWorkflowID(ctx, client, org, slug)
	if err != nil {
		return err
	}

	_, err = client.Workflow.TagVersion(ctx, &workflowv1.TagWorkflowVersionInput{
		WorkflowId:  workflowID,
		VersionHash: hash,
		Tag:         tag,
	})
	if err != nil {
		return errors.Wrapf(err, "failed to tag version '%s'", truncateHash(hash))
	}

	fmt.Println()
	climsg.Success("Tagged version %s as '%s'", truncateHash(hash), tag)
	fmt.Println()
	return nil
}

// --- Internal helpers ---

func resolveWorkflowID(ctx context.Context, client *stigmer.Client, org, slug string) (string, error) {
	wf, err := client.Workflow.GetByReference(ctx, stigmer.ResourceRef{
		Org:  org,
		Slug: slug,
	})
	if err != nil {
		return "", errors.Wrapf(err, "failed to resolve workflow '%s/%s'", org, slug)
	}
	return wf.GetMetadata().GetId(), nil
}

// --- Display helpers ---

func displayVersionsTable(entries []*workflowv1.WorkflowVersionEntry, totalCount int32) {
	fmt.Println()
	fmt.Printf("Version History (%d total)\n", totalCount)
	fmt.Println()
	fmt.Printf("  %-14s %-10s %-20s %-8s %s\n", "HASH", "TAG", "APPLIED AT", "CURRENT", "MESSAGE")
	fmt.Printf("  %-14s %-10s %-20s %-8s %s\n",
		"──────────────", "──────────", "────────────────────", "────────", "───────")

	for _, entry := range entries {
		hash := truncateHash(entry.GetVersionHash())
		tag := entry.GetTag()
		if tag == "" {
			tag = "-"
		}

		appliedAt := "-"
		if entry.GetAppliedAt() != nil {
			appliedAt = entry.GetAppliedAt().AsTime().Format("2006-01-02 15:04")
		}

		current := ""
		if entry.GetIsCurrent() {
			current = "*"
		}

		message := entry.GetMessage()
		if len(message) > 40 {
			message = message[:37] + "..."
		}
		if message == "" {
			message = "-"
		}

		fmt.Printf("  %-14s %-10s %-20s %-8s %s\n", hash, tag, appliedAt, current, message)
	}

	fmt.Println()
}

func truncateHash(hash string) string {
	if len(hash) > 12 {
		return hash[:12]
	}
	return hash
}

// computeUnifiedDiff produces a simple unified diff between two YAML strings.
func computeUnifiedDiff(a, b, labelA, labelB string) string {
	linesA := strings.Split(a, "\n")
	linesB := strings.Split(b, "\n")

	var buf strings.Builder
	buf.WriteString(fmt.Sprintf("--- %s\n", truncateHash(labelA)))
	buf.WriteString(fmt.Sprintf("+++ %s\n", truncateHash(labelB)))

	// Simple line-by-line diff (longest common subsequence is complex;
	// for CLI display we use a basic approach that shows removed then added lines
	// per contiguous changed hunk).
	hunks := buildHunks(linesA, linesB)
	for _, h := range hunks {
		buf.WriteString(fmt.Sprintf("@@ -%d,%d +%d,%d @@\n", h.startA+1, h.lenA, h.startB+1, h.lenB))
		for _, l := range h.lines {
			buf.WriteString(l)
			buf.WriteString("\n")
		}
	}

	return buf.String()
}

type diffHunk struct {
	startA, lenA int
	startB, lenB int
	lines        []string
}

func buildHunks(linesA, linesB []string) []diffHunk {
	// Use a simple LCS-based diff to produce hunks
	lcs := longestCommonSubsequence(linesA, linesB)

	var hunks []diffHunk
	var currentLines []string
	idxA, idxB, idxLCS := 0, 0, 0
	hunkStartA, hunkStartB := 0, 0
	inHunk := false

	flushHunk := func() {
		if inHunk && len(currentLines) > 0 {
			hunks = append(hunks, diffHunk{
				startA: hunkStartA,
				lenA:   countPrefix(currentLines, "-") + countPrefix(currentLines, " "),
				startB: hunkStartB,
				lenB:   countPrefix(currentLines, "+") + countPrefix(currentLines, " "),
				lines:  currentLines,
			})
			currentLines = nil
			inHunk = false
		}
	}

	for idxA < len(linesA) || idxB < len(linesB) {
		if idxLCS < len(lcs) && idxA < len(linesA) && idxB < len(linesB) && linesA[idxA] == lcs[idxLCS] && linesB[idxB] == lcs[idxLCS] {
			// Context line (matching)
			if inHunk {
				currentLines = append(currentLines, " "+linesA[idxA])
			}
			idxA++
			idxB++
			idxLCS++
			if inHunk && countTrailingContext(currentLines) >= 3 {
				flushHunk()
			}
		} else {
			if !inHunk {
				inHunk = true
				hunkStartA = idxA
				hunkStartB = idxB
				currentLines = nil
			}
			if idxA < len(linesA) && (idxLCS >= len(lcs) || linesA[idxA] != lcs[idxLCS]) {
				currentLines = append(currentLines, "-"+linesA[idxA])
				idxA++
			} else if idxB < len(linesB) && (idxLCS >= len(lcs) || linesB[idxB] != lcs[idxLCS]) {
				currentLines = append(currentLines, "+"+linesB[idxB])
				idxB++
			}
		}
	}

	flushHunk()
	return hunks
}

func longestCommonSubsequence(a, b []string) []string {
	m, n := len(a), len(b)
	dp := make([][]int, m+1)
	for i := range dp {
		dp[i] = make([]int, n+1)
	}
	for i := 1; i <= m; i++ {
		for j := 1; j <= n; j++ {
			if a[i-1] == b[j-1] {
				dp[i][j] = dp[i-1][j-1] + 1
			} else if dp[i-1][j] >= dp[i][j-1] {
				dp[i][j] = dp[i-1][j]
			} else {
				dp[i][j] = dp[i][j-1]
			}
		}
	}

	result := make([]string, 0, dp[m][n])
	i, j := m, n
	for i > 0 && j > 0 {
		if a[i-1] == b[j-1] {
			result = append(result, a[i-1])
			i--
			j--
		} else if dp[i-1][j] >= dp[i][j-1] {
			i--
		} else {
			j--
		}
	}
	// Reverse
	for left, right := 0, len(result)-1; left < right; left, right = left+1, right-1 {
		result[left], result[right] = result[right], result[left]
	}
	return result
}

func countPrefix(lines []string, prefix string) int {
	count := 0
	for _, l := range lines {
		if strings.HasPrefix(l, prefix) {
			count++
		}
	}
	return count
}

func countTrailingContext(lines []string) int {
	count := 0
	for i := len(lines) - 1; i >= 0; i-- {
		if strings.HasPrefix(lines[i], " ") {
			count++
		} else {
			break
		}
	}
	return count
}
