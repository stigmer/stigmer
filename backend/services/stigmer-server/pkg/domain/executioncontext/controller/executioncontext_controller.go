package executioncontext

import (
	executioncontextv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/executioncontext/v1"
	"github.com/stigmer/stigmer/backend/libs/go/store"
	"github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/encryption"
	"github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/runnerauth"
)

// ExecutionContextController implements ExecutionContextCommandController and ExecutionContextQueryController
type ExecutionContextController struct {
	executioncontextv1.UnimplementedExecutionContextCommandControllerServer
	executioncontextv1.UnimplementedExecutionContextQueryControllerServer
	store store.Store

	// Encrypts is_secret values at write and decrypts them for the runner
	// lane (oss#535). Shared with the Environment/OAuthApp controllers so
	// the encrypt-on-write / decrypt-on-read key pair always matches.
	secretService *encryption.SecretService

	// Verifies the execution-scoped tokens that gate getByExecutionId's
	// decrypt lane. Nil or keyless fails closed: every read redacts.
	runnerAuth *runnerauth.Service
}

// NewExecutionContextController creates a new ExecutionContextController.
//
// secretService and runnerAuth may be nil in tests that never touch secret
// values; a nil service disables encryption (WARN-and-plaintext at write,
// the oss#394 convention) and disables the decrypt lane (fail closed to
// redaction) respectively.
func NewExecutionContextController(
	store store.Store,
	secretService *encryption.SecretService,
	runnerAuth *runnerauth.Service,
) *ExecutionContextController {
	if secretService == nil {
		secretService, _ = encryption.NewSecretService(nil)
	}
	return &ExecutionContextController{
		store:         store,
		secretService: secretService,
		runnerAuth:    runnerAuth,
	}
}
