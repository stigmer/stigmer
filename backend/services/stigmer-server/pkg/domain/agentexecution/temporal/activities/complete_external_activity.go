package activities

import (
	"context"
	"encoding/base64"

	"go.temporal.io/sdk/activity"
	"go.temporal.io/sdk/client"
	"go.temporal.io/sdk/temporal"
)

// CompleteExternalActivityInput is the input for completing an external activity.
type CompleteExternalActivityInput struct {
	// CallbackToken is the Temporal task token from the external activity
	CallbackToken []byte

	// Result is the result to return to the external activity (can be nil)
	Result interface{}

	// Error is the error to return to the external activity (can be nil)
	// If both Result and Error are provided, Error takes precedence
	Error error
}

// CompleteExternalActivity completes an external Temporal activity using its task token.
//
// This is a system activity that enables the async activity completion pattern.
// See: docs/adr/20260122-async-agent-execution-temporal-token-handshake.md
//
// Flow:
// 1. External workflow (e.g., Zigflow) starts an activity and returns ErrResultPending
// 2. External activity passes its task token to this workflow
// 3. This workflow completes and calls this activity
// 4. This activity uses the Temporal client to complete the external activity
// 5. External workflow resumes execution
//
// This activity MUST be registered with a Temporal client that has access
// to the same namespace as the external workflow.
func CompleteExternalActivity(ctx context.Context, input *CompleteExternalActivityInput) error {
	logger := activity.GetLogger(ctx)

	// Validate input
	if len(input.CallbackToken) == 0 {
		logger.Warn("⚠️ CompleteExternalActivity called with empty token - skipping (backward compatibility)")
		return nil
	}

	// Log token for debugging (Base64 encoded, truncated for security)
	tokenBase64 := base64.StdEncoding.EncodeToString(input.CallbackToken)
	tokenPreview := tokenBase64
	if len(tokenPreview) > 20 {
		tokenPreview = tokenPreview[:20] + "..."
	}

	logger.Info("📞 Completing external activity",
		"token_preview", tokenPreview,
		"token_length", len(input.CallbackToken),
		"has_result", input.Result != nil,
		"has_error", input.Error != nil)

	// Get the Temporal client from activity context
	// This client must be injected when registering the activity
	temporalClient, err := getTemporalClientFromContext(ctx)
	if err != nil {
		logger.Error("❌ Failed to get Temporal client from context", "error", err.Error())
		return err
	}

	// Complete the external activity
	// If Error is provided, report failure; otherwise report success with Result
	if input.Error != nil {
		// Report failure to external activity
		logger.Info("❌ Reporting failure to external activity", "error", input.Error.Error())
		err = temporalClient.CompleteActivity(ctx, input.CallbackToken, nil, input.Error)
	} else {
		// Report success to external activity
		logger.Info("✅ Reporting success to external activity")
		err = temporalClient.CompleteActivity(ctx, input.CallbackToken, input.Result, nil)
	}

	if err != nil {
		logger.Error("❌ Failed to complete external activity", "error", err.Error())
		return err
	}

	logger.Info("✅ Successfully completed external activity")
	return nil
}

// getTemporalClientFromContext retrieves the Temporal client from the activity context.
//
// The client must be stored in the context when registering the activity.
// This is typically done in the worker setup code.
//
// Example worker setup:
//
//	temporalClient := client.NewClient(...)
//	worker := worker.New(temporalClient, taskQueue, ...)
//	worker.RegisterActivityWithOptions(
//	    activities.CompleteExternalActivity,
//	    activity.RegisterOptions{
//	        Name: activities.CompleteExternalActivityName,
//	    },
//	)
//
// The worker automatically makes the client available to activities.
func getTemporalClientFromContext(ctx context.Context) (client.Client, error) {
	// The Temporal SDK provides the client through the activity context
	// We need to use the heartbeat mechanism to access it
	// However, this is actually not directly exposed in the activity context.
	//
	// The correct approach is to:
	// 1. Store the client in a package-level variable during worker setup
	// 2. Or pass the client through a custom context value
	//
	// For now, we'll use a package-level variable that must be initialized
	// by the worker setup code.
	if temporalClientInstance == nil {
		return nil, ErrTemporalClientNotInitialized
	}
	return temporalClientInstance, nil
}

// Package-level variables for Temporal client
// These MUST be initialized by calling InitializeCompleteExternalActivity before use
var (
	temporalClientInstance          client.Client
	ErrTemporalClientNotInitialized = temporal.NewApplicationError("temporal client not initialized - call InitializeCompleteExternalActivity in worker setup", "")
)

// InitializeCompleteExternalActivity initializes the CompleteExternalActivity with a Temporal client.
//
// This MUST be called during worker setup before registering the activity.
//
// Example:
//
//	temporalClient := client.NewClient(...)
//	activities.InitializeCompleteExternalActivity(temporalClient)
//	worker.RegisterActivity(activities.CompleteExternalActivity)
func InitializeCompleteExternalActivity(temporalClient client.Client) {
	temporalClientInstance = temporalClient
}

// CompleteExternalActivityName is the activity name for registration.
const CompleteExternalActivityName = "stigmer/system/complete-external-activity"
