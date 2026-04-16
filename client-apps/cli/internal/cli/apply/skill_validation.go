// Package apply provides SDK synthesis execution for the stigmer apply command.
package apply

import (
	"fmt"
	"strings"

	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/synthesis"
	agentv1 "github.com/stigmer/stigmer/sdk/go/proto/ai/stigmer/agentic/agent/v1"
	"github.com/stigmer/stigmer/sdk/go/proto/ai/stigmer/commons/apiresource"
)

// ExternalSkillRef represents a reference to an externally-pushed skill.
// External skills are skills that are referenced by agents but not defined
// inline in the SDK synthesis output.
type ExternalSkillRef struct {
	// Org is the organization that owns the skill.
	Org string
	// Slug is the skill's unique identifier within the organization.
	Slug string
	// ReferencedBy lists the agents that reference this skill.
	ReferencedBy []string
}

// String returns a human-readable representation of the skill reference.
func (r ExternalSkillRef) String() string {
	if r.Org != "" {
		return fmt.Sprintf("%s/%s", r.Org, r.Slug)
	}
	return r.Slug
}

// SkillVerificationResult contains the outcome of skill existence verification.
type SkillVerificationResult struct {
	// Found contains skills that were verified to exist in the backend.
	Found []ExternalSkillRef
	// Missing contains skills that were not found in the backend.
	Missing []ExternalSkillRef
}

// ExtractExternalSkillRefs extracts external skill references from synthesis result.
//
// It identifies skills that are:
// 1. Referenced in the dependencies map with format "skill:external:{slug}"
// 2. Referenced in Agent.Spec.SkillRefs but not defined inline (SkillSynths)
//
// Note: SkillSynth doesn't contain slug information (only source location),
// so we cannot exclude inline skills from this list. All skill refs are
// treated as potentially external until the CLI processes the SkillSynth
// and discovers the actual skill name from SKILL.md.
//
// The returned refs are deduplicated by org/slug.
func ExtractExternalSkillRefs(result *synthesis.Result) []ExternalSkillRef {
	if result == nil {
		return nil
	}

	// Note: With SkillSynth, we cannot determine inline skill slugs until
	// the synth is processed (SKILL.md is read from source). For now, we
	// treat all skill refs as external since we don't know which ones
	// will be defined by the SkillSynths.
	inlineSkillSlugs := make(map[string]bool)

	// Extract from dependencies map and agent protos
	refMap := make(map[string]*ExternalSkillRef)
	extractFromDependencies(result.Dependencies, refMap, inlineSkillSlugs)
	extractFromAgents(result.Agents, refMap, inlineSkillSlugs)

	// Convert map to slice
	refs := make([]ExternalSkillRef, 0, len(refMap))
	for _, ref := range refMap {
		refs = append(refs, *ref)
	}
	return refs
}

// extractFromDependencies extracts external skill refs from the dependencies map.
// External skills have the format "skill:external:{slug}" in the dependencies.
func extractFromDependencies(deps map[string][]string, refMap map[string]*ExternalSkillRef, inlineSlugs map[string]bool) {
	const externalPrefix = "skill:external:"

	for resourceID, dependencies := range deps {
		for _, dep := range dependencies {
			if !strings.HasPrefix(dep, externalPrefix) {
				continue
			}

			// Extract slug from "skill:external:{slug}" or "skill:external:{org}/{slug}"
			remainder := strings.TrimPrefix(dep, externalPrefix)
			org, slug := parseOrgSlug(remainder)

			if slug == "" || inlineSlugs[slug] {
				continue
			}

			key := makeRefKey(org, slug)
			if existing, ok := refMap[key]; ok {
				existing.ReferencedBy = append(existing.ReferencedBy, resourceID)
			} else {
				refMap[key] = &ExternalSkillRef{
					Org:          org,
					Slug:         slug,
					ReferencedBy: []string{resourceID},
				}
			}
		}
	}
}

// extractFromAgents extracts external skill refs from Agent.Spec.SkillRefs.
func extractFromAgents(agents []*agentv1.Agent, refMap map[string]*ExternalSkillRef, inlineSlugs map[string]bool) {
	for _, agent := range agents {
		if agent == nil || agent.Spec == nil {
			continue
		}

		agentName := ""
		if agent.Metadata != nil {
			agentName = "agent:" + agent.Metadata.Name
		}

		// Extract from main agent SkillRefs
		for _, ref := range agent.Spec.SkillRefs {
			addSkillRef(ref, agentName, refMap, inlineSlugs)
		}

		// Extract from sub-agent SkillRefs
		for _, subAgent := range agent.Spec.SubAgents {
			if subAgent == nil {
				continue
			}
			subAgentName := agentName
			if subAgent.Name != "" {
				subAgentName = agentName + "/" + subAgent.Name
			}
			for _, ref := range subAgent.SkillRefs {
				addSkillRef(ref, subAgentName, refMap, inlineSlugs)
			}
		}
	}
}

// addSkillRef adds a skill reference to the map if it's external.
func addSkillRef(ref *apiresource.ApiResourceReference, agentName string, refMap map[string]*ExternalSkillRef, inlineSlugs map[string]bool) {
	if ref == nil || ref.Slug == "" {
		return
	}

	// Skip inline skills
	if inlineSlugs[ref.Slug] {
		return
	}

	key := makeRefKey(ref.Org, ref.Slug)
	if existing, ok := refMap[key]; ok {
		if agentName != "" && !containsString(existing.ReferencedBy, agentName) {
			existing.ReferencedBy = append(existing.ReferencedBy, agentName)
		}
	} else {
		referencedBy := []string{}
		if agentName != "" {
			referencedBy = []string{agentName}
		}
		refMap[key] = &ExternalSkillRef{
			Org:          ref.Org,
			Slug:         ref.Slug,
			ReferencedBy: referencedBy,
		}
	}
}

// parseOrgSlug parses an "org/slug" or just "slug" string.
func parseOrgSlug(s string) (org, slug string) {
	parts := strings.SplitN(s, "/", 2)
	if len(parts) == 2 {
		return parts[0], parts[1]
	}
	return "", parts[0]
}

// makeRefKey creates a unique key for a skill reference.
func makeRefKey(org, slug string) string {
	if org != "" {
		return org + "/" + slug
	}
	return slug
}

// containsString checks if a slice contains a string.
func containsString(slice []string, s string) bool {
	for _, item := range slice {
		if item == s {
			return true
		}
	}
	return false
}
