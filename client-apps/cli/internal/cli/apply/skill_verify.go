package apply

import (
	"context"

	"github.com/pkg/errors"
	stigmer "github.com/stigmer/stigmer/sdk/go"
)

// VerifyExternalSkills checks if external skills exist in the backend.
//
// It queries the Skill SDK client's GetByReference method for each skill
// and categorizes them as found or missing.
func VerifyExternalSkills(client *stigmer.Client, defaultOrgID string, refs []ExternalSkillRef) (*SkillVerificationResult, error) {
	if len(refs) == 0 {
		return &SkillVerificationResult{}, nil
	}

	if client == nil {
		return nil, errors.New("client is required for skill verification")
	}

	result := &SkillVerificationResult{
		Found:   make([]ExternalSkillRef, 0),
		Missing: make([]ExternalSkillRef, 0),
	}

	for _, ref := range refs {
		org := ref.Org
		if org == "" {
			org = defaultOrgID
		}

		exists, err := checkSkillExists(client, org, ref.Slug)
		if err != nil {
			return nil, errors.Wrapf(err, "failed to verify skill %s", ref.String())
		}

		if exists {
			result.Found = append(result.Found, ref)
		} else {
			result.Missing = append(result.Missing, ref)
		}
	}

	return result, nil
}

// checkSkillExists queries the backend to check if a skill exists.
func checkSkillExists(client *stigmer.Client, org, slug string) (bool, error) {
	_, err := client.Skill.GetByReference(context.Background(), stigmer.ResourceRef{
		Org:  org,
		Slug: slug,
	})

	if err == nil {
		return true, nil
	}

	if stigmer.IsNotFound(err) {
		return false, nil
	}

	return false, err
}
