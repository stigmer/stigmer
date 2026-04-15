package apply

import (
	"context"

	"github.com/pkg/errors"
	skillv1 "github.com/stigmer/stigmer/sdk/go/proto/ai/stigmer/agentic/skill/v1"
	"github.com/stigmer/stigmer/sdk/go/proto/ai/stigmer/commons/apiresource"
	"github.com/stigmer/stigmer/sdk/go/proto/ai/stigmer/commons/apiresource/apiresourcekind"
	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

// VerifyExternalSkills checks if external skills exist in the backend.
//
// It queries the SkillQueryController.GetByReference() RPC for each skill
// and categorizes them as found or missing.
func VerifyExternalSkills(conn grpc.ClientConnInterface, defaultOrgID string, refs []ExternalSkillRef) (*SkillVerificationResult, error) {
	if conn == nil {
		return nil, errors.New("connection is required for skill verification")
	}

	if len(refs) == 0 {
		return &SkillVerificationResult{}, nil
	}

	client := skillv1.NewSkillQueryControllerClient(conn)
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
func checkSkillExists(client skillv1.SkillQueryControllerClient, org, slug string) (bool, error) {
	_, err := client.GetByReference(context.Background(), &apiresource.ApiResourceReference{
		Org:  org,
		Kind: apiresourcekind.ApiResourceKind_skill,
		Slug: slug,
	})

	if err == nil {
		return true, nil
	}

	// Check if it's a "not found" error (expected for missing skills)
	if st, ok := status.FromError(err); ok {
		if st.Code() == codes.NotFound {
			return false, nil
		}
	}

	// Other errors are unexpected
	return false, err
}
