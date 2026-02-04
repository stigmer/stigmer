package apply

import (
	"context"
	"fmt"
	"strings"

	"github.com/pkg/errors"
	skillv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/skill/v1"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource/apiresourcekind"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/cliprint"
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

// DisplayMissingSkillsGuidance shows user guidance when skills are missing.
func DisplayMissingSkillsGuidance(missing []ExternalSkillRef) {
	fmt.Println()
	cliprint.PrintWarning("External skills not found")
	fmt.Println("═══════════════════════════════════════════════════════════════════")
	fmt.Println()
	fmt.Println("The following skills are referenced by agents but haven't been pushed:")
	fmt.Println()

	for i, ref := range missing {
		fmt.Printf("  %d. %s\n", i+1, ref.String())
		if len(ref.ReferencedBy) > 0 {
			fmt.Printf("     Referenced by: %s\n", strings.Join(ref.ReferencedBy, ", "))
		}
		fmt.Println()
	}

	fmt.Println("To fix this, push each skill before deploying:")
	fmt.Println()
	for _, ref := range missing {
		org := ref.Org
		if org == "" {
			org = "<your-org>"
		}
		fmt.Printf("  stigmer skill push ./skills/%s --org %s\n", ref.Slug, org)
	}
	fmt.Println()
	fmt.Println("Then run 'stigmer apply' again.")
	fmt.Println()
	fmt.Println("═══════════════════════════════════════════════════════════════════")
	fmt.Println("Why is this required?")
	fmt.Println()
	fmt.Println("Skills are pushed separately to enable:")
	fmt.Println("  • Independent versioning (use tags like v1.0, latest)")
	fmt.Println("  • Code review before deployment")
	fmt.Println("  • Artifact deduplication across projects")
	fmt.Println()
}
