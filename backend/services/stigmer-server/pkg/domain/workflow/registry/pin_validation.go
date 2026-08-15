package registry

import (
	"fmt"
	"sort"
	"strings"

	sessionv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/session/v1"
)

// Harness section names as the registry document spells them. Exported so
// every consumer (workflow validation, schedule/channel pin validation)
// shares one vocabulary instead of re-declaring string literals.
const (
	HarnessNameCursor = "cursor"
	HarnessNameNative = "native"
)

const (
	maxModelSuggestions  = 3
	maxModelEditDistance = 5
)

// HarnessName maps the session harness enum to its registry section name.
// Unset resolves to native — this edition's platform default harness (the
// DD-015 edition-honest posture: each edition judges pins against the
// harness ITS runs would actually use; the cloud edition resolves its own
// configured default).
func HarnessName(h sessionv1.Harness) string {
	if h == sessionv1.Harness_HARNESS_CURSOR {
		return HarnessNameCursor
	}
	return HarnessNameNative
}

// UnknownModelPinRefusal is this edition's one statement of the write-time
// model-pin EXISTENCE rule (stigmer/stigmer#774, the DD-001 D2/D3
// remainder): a pinned model_name that is not in the model registry is
// refused at apply/update, with a did-you-mean. Before this rule,
// model_name was the one profile knob that failed OPEN — a typo'd pin
// passed every write boundary and the cursor runner silently fell back to
// "default" (Auto), billing at Auto rates (the exact class the
// chat-surface-cost-reduction project existed to close).
//
// harness names the registry section the pin's runs would use
// (HarnessName of the surface's effective harness). Pass "" for surfaces
// with NO serving harness in this edition (agent channels — this edition
// stores their spec without a serving runtime): the pin then validates
// against EVERY harness section and is refused only when no section knows
// it, which catches the typo class without falsely refusing a model that
// is valid where the spec will actually serve.
//
// Deliberately WRITE-TIME ONLY — unlike the pin-PRESENCE rule
// (ScheduleModelPinningRefusal), this is NOT evaluated at the run
// starter's fire-time backstop: upstream registry drift must never break
// a previously-valid schedule at its 3 AM fire. The runner's divergence
// detection remains the runtime defense-in-depth, expected to never fire
// for platform-validated pins.
//
// Degrades to a no-op ("") when the registry is empty or lacks the
// harness section — a build without a usable registry must not refuse
// every write (the HasAnyModels posture workflow validation established).
//
// Returns the refusal copy, or "" when the pin is valid (or unverifiable).
func UnknownModelPinRefusal(fieldPath, harness, model string) string {
	model = strings.TrimSpace(model)
	if model == "" {
		return ""
	}

	s := Store()
	if !s.HasAnyModels() {
		return ""
	}

	var candidates []string
	if harness == "" {
		if s.IsValidModelOnAnyHarness(model) {
			return ""
		}
		candidates = s.CanonicalModelsAcrossHarnesses()
	} else {
		if !s.HasHarness(harness) {
			return ""
		}
		if s.IsValidModel(harness, model) {
			return ""
		}
		candidates = s.CanonicalModels(harness)
	}

	scope := "any harness"
	if harness != "" {
		scope = harness + " harness"
	}
	msg := fmt.Sprintf("%s: model '%s' is not in the model registry (%s)",
		fieldPath, model, scope)

	if suggestions := SuggestSimilarModels(model, candidates); len(suggestions) > 0 {
		quoted := make([]string, len(suggestions))
		for i, s := range suggestions {
			quoted[i] = fmt.Sprintf("'%s'", s)
		}
		msg += fmt.Sprintf("; did you mean %s?", strings.Join(quoted, ", "))
	}

	return msg
}

// SuggestSimilarModels returns up to three model ids from the candidate
// list sorted by Levenshtein distance to the target, closest first. Only
// candidates within the edit-distance cap are included — a far-off typo
// gets no misleading suggestion. Shared by workflow model validation and
// the pin-existence rule so every did-you-mean behaves identically.
func SuggestSimilarModels(target string, candidates []string) []string {
	type scored struct {
		name string
		dist int
	}

	targetLower := strings.ToLower(target)
	var matches []scored

	for _, name := range candidates {
		d := suggestionEditDistance(targetLower, strings.ToLower(name))
		if d <= maxModelEditDistance {
			matches = append(matches, scored{name, d})
		}
	}

	sort.Slice(matches, func(i, j int) bool {
		if matches[i].dist != matches[j].dist {
			return matches[i].dist < matches[j].dist
		}
		return matches[i].name < matches[j].name
	})

	limit := maxModelSuggestions
	if len(matches) < limit {
		limit = len(matches)
	}

	result := make([]string, limit)
	for i := 0; i < limit; i++ {
		result[i] = matches[i].name
	}
	return result
}

// suggestionEditDistance is the standard two-row Levenshtein distance.
func suggestionEditDistance(a, b string) int {
	if a == b {
		return 0
	}
	if len(a) == 0 {
		return len(b)
	}
	if len(b) == 0 {
		return len(a)
	}

	prev := make([]int, len(b)+1)
	curr := make([]int, len(b)+1)
	for j := 0; j <= len(b); j++ {
		prev[j] = j
	}

	for i := 1; i <= len(a); i++ {
		curr[0] = i
		for j := 1; j <= len(b); j++ {
			cost := 1
			if a[i-1] == b[j-1] {
				cost = 0
			}
			curr[j] = min(prev[j]+1, min(curr[j-1]+1, prev[j-1]+cost))
		}
		prev, curr = curr, prev
	}
	return prev[len(b)]
}
