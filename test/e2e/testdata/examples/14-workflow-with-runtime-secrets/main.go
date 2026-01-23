//go:build ignore

package main

import (
	"fmt"
	"os"

	"github.com/stigmer/stigmer/sdk/go/stigmer"
	"github.com/stigmer/stigmer/sdk/go/workflow"
)

// This example demonstrates the secure pattern for handling sensitive data
// using runtime secrets and environment variables.
//
// **CRITICAL SECURITY CONCEPT:**
//
// Runtime secrets are resolved JUST-IN-TIME during activity execution,
// ensuring they NEVER appear in:
//   - Workflow manifests
//   - Temporal history
//   - Logs or traces
//
// Execute this workflow with:
//
//	stigmer run secure-api-workflow \
//	  --runtime-env secret:OPENAI_API_KEY=sk-proj-abc123 \
//	  --runtime-env secret:STRIPE_API_KEY=sk_live_xyz789 \
//	  --runtime-env secret:STRIPE_IDEMPOTENCY_KEY=idempotent-key-abc \
//	  --runtime-env secret:DATABASE_PASSWORD=superSecret123 \
//	  --runtime-env secret:EXTERNAL_API_KEY=ext-api-key-xyz \
//	  --runtime-env secret:WEBHOOK_SIGNING_SECRET=whsec_abc123 \
//	  --runtime-env ENVIRONMENT=production \
//	  --runtime-env AWS_REGION=us-east-1 \
//	  --runtime-env LOG_LEVEL=info
//
// See the generated manifest - it will contain ONLY safe placeholders:
//   - Authorization: "${.secrets.OPENAI_API_KEY}"  ← Safe!
//   - X-API-Key: "${.secrets.STRIPE_API_KEY}"       ← Safe!
//   - password: "${.secrets.DATABASE_PASSWORD}"     ← Safe!
//
// NOT the actual values:
//   - Authorization: "sk-proj-abc123"  ← DANGEROUS! ❌
//   - X-API-Key: "sk_live_xyz789"      ← DANGEROUS! ❌
//   - password: "superSecret123"       ← DANGEROUS! ❌

func main() {
	err := stigmer.Run(runWorkflow)
	if err != nil {
		fmt.Printf("Error: %v\n", err)
		os.Exit(1)
	}
	fmt.Println("✅ Workflow manifest created successfully!")
	fmt.Println("📄 Inspect the manifest - you'll see ONLY placeholders, NO secrets!")
}

func runWorkflow(ctx *stigmer.Context) error {
	// ============================================================================
	// SCENARIO 1: External API Authentication with Runtime Secrets
	// ============================================================================
	// Use RuntimeSecret() for API keys that should NEVER be in manifests

	wf, err := workflow.New(ctx,
		workflow.WithNamespace("security"),
		workflow.WithName("secure-api-workflow"),
		workflow.WithVersion("1.0.0"),
	)
	if err != nil {
		return err
	}

	// Call OpenAI API with runtime secret for authentication
	// Manifest will contain: "Authorization": "Bearer ${.secrets.OPENAI_API_KEY}"
	// Activity resolves JIT to: "Authorization": "Bearer sk-proj-abc123"
	callOpenAI := wf.HttpPost("callOpenAI",
		"https://api.openai.com/v1/chat/completions",
		workflow.Header("Authorization", workflow.Interpolate("Bearer ", workflow.RuntimeSecret("OPENAI_API_KEY"))),
		workflow.Header("Content-Type", "application/json"),
		workflow.WithBody(map[string]any{
			"model": "gpt-4",
			// ✅ REAL OpenAI API structure with nested array!
			"messages": []map[string]any{
				{
					"role":    "user",
					"content": "Explain quantum computing in simple terms",
				},
			},
			"max_tokens": 100,
		}),
	)

	// ============================================================================
	// SCENARIO 2: Using API Response in Next Call (Field References in Body!)
	// ============================================================================
	// REAL USE CASE: Get error from one API, pass it to ChatGPT for analysis

	// Simulate getting an error from GitHub API
	githubStatus := wf.HttpGet("checkPipeline",
		"https://api.github.com/repos/myorg/myrepo/actions/runs/latest",
		workflow.Header("Authorization", workflow.Interpolate("token ", workflow.RuntimeSecret("GITHUB_TOKEN"))),
	)

	// ✅ Pass the error message to ChatGPT for analysis
	// This demonstrates field references in BODY (not just headers!)
	analyzeError := wf.HttpPost("analyzeError",
		"https://api.openai.com/v1/chat/completions",
		workflow.Header("Authorization", workflow.Interpolate("Bearer ", workflow.RuntimeSecret("OPENAI_API_KEY"))),
		workflow.Header("Content-Type", "application/json"),
		workflow.WithBody(map[string]any{
			"model": "gpt-4",
			// ✅ TaskFieldRef in nested array - REAL use case!
			"messages": []map[string]any{
				{
					"role":    "system",
					"content": "You are a helpful DevOps assistant",
				},
				{
					"role": "user",
					// ✅ Field reference in body - pass error from previous API call
					"content": githubStatus.Field("conclusion"),
				},
			},
		}),
	)

	// ============================================================================
	// SCENARIO 3: Environment-Specific Configuration
	// ============================================================================
	// Use RuntimeEnv() for non-secret config that varies by environment

	// Build environment-specific endpoint
	// Manifest: "https://api-${.env_vars.ENVIRONMENT}.example.com/process"
	// Dev execution: "https://api-dev.example.com/process"
	// Prod execution: "https://api-production.example.com/process"
	processData := wf.HttpPost("processData",
		workflow.Interpolate(
			"https://api-",
			workflow.RuntimeEnv("ENVIRONMENT"),
			".example.com/process",
		),
		workflow.Header("X-Region", workflow.RuntimeEnv("AWS_REGION")),
		workflow.Header("X-Log-Level", workflow.RuntimeEnv("LOG_LEVEL")),
		workflow.WithBody(map[string]any{
			"environment": workflow.RuntimeEnv("ENVIRONMENT"),
			"log_level":   workflow.RuntimeEnv("LOG_LEVEL"),
			// ✅ Field reference in body - the analysis result
			"ai_analysis": analyzeError.Field("choices[0].message.content"),
		}),
	)

	// ============================================================================
	// SCENARIO 4: Multiple Secrets in One Request
	// ============================================================================
	// Demonstrate mixing multiple runtime secrets

	chargePayment := wf.HttpPost("chargePayment",
		"https://api.stripe.com/v1/charges",
		// Multiple authentication mechanisms
		workflow.Header("Authorization", workflow.Interpolate("Bearer ", workflow.RuntimeSecret("STRIPE_API_KEY"))),
		workflow.Header("Idempotency-Key", workflow.RuntimeSecret("STRIPE_IDEMPOTENCY_KEY")),
		workflow.Header("Content-Type", "application/x-www-form-urlencoded"),
		workflow.WithBody(map[string]any{
			"amount":   2000,
			"currency": "usd",
			"source":   "tok_visa",
			// ✅ Nested metadata with runtime env vars and field references
			"metadata": map[string]any{
				"environment":   workflow.RuntimeEnv("ENVIRONMENT"),
				"region":        workflow.RuntimeEnv("AWS_REGION"),
				"request_id":    processData.Field("id"),
				"ai_conclusion": analyzeError.Field("choices[0].message.content"),
			},
		}),
	)

	// ============================================================================
	// SCENARIO 5: Database API Call with Secret Credentials
	// ============================================================================
	// Use runtime secrets for database passwords in API calls

	storeResults := wf.HttpPost("storeResults",
		"https://database-api.example.com/v1/records",
		workflow.Header("X-DB-Host", "postgres.internal"),
		workflow.Header("X-DB-Port", "5432"),
		workflow.Header("X-DB-User", "app_user"),
		// Password as runtime secret - NEVER in manifest!
		workflow.Header("X-DB-Password", workflow.RuntimeSecret("DATABASE_PASSWORD")),
		workflow.Header("Content-Type", "application/json"),
		workflow.WithBody(map[string]any{
			"table":       "api_responses",
			"environment": workflow.RuntimeEnv("ENVIRONMENT"),
			// ✅ Field references in body - store all the data
			"data": map[string]any{
				"openai_response":   callOpenAI.Field("choices[0].message.content"),
				"error_analysis":    analyzeError.Field("choices[0].message.content"),
				"processed_data":    processData.Field("result"),
				"payment_status":    chargePayment.Field("status"),
				"github_conclusion": githubStatus.Field("conclusion"),
			},
		}),
	)

	// ============================================================================
	// SCENARIO 5: Third-Party API with Runtime Webhook Secret
	// ============================================================================
	// Pass webhook signing secrets for verification

	wf.HttpPost("registerWebhook",
		"https://api.external-service.com/v1/webhooks",
		workflow.Header("Authorization", workflow.Interpolate("Bearer ", workflow.RuntimeSecret("EXTERNAL_API_KEY"))),
		workflow.Header("Content-Type", "application/json"),
		workflow.WithBody(map[string]any{
			"url": workflow.Interpolate(
				"https://webhook-",
				workflow.RuntimeEnv("ENVIRONMENT"),
				".myapp.com/callbacks/external",
			),
			// Webhook signing secret - runtime only!
			"secret":      workflow.RuntimeSecret("WEBHOOK_SIGNING_SECRET"),
			"event_types": "payment.success,payment.failed",
		}),
	)

	// ============================================================================
	// SCENARIO 6: Real Slack Webhook with Nested Structure
	// ============================================================================
	// Combine static values, runtime placeholders, AND field references

	wf.HttpPost("notifySlack",
		"https://hooks.slack.com/services/T00000000/B00000000/XXXXXXXXXXXX",
		workflow.Header("Content-Type", "application/json"),
		workflow.WithBody(map[string]any{
			"text": "Deployment Pipeline Completed!",
			// ✅ REAL Slack blocks structure - nested arrays!
			"blocks": []map[string]any{
				{
					"type": "header",
					"text": map[string]any{
						"type": "plain_text",
						"text": "Deployment Status",
					},
				},
				{
					"type": "section",
					"fields": []map[string]any{
						{
							"type": "mrkdwn",
							"text": workflow.Interpolate("*Environment:*\n", workflow.RuntimeEnv("ENVIRONMENT")),
						},
						{
							"type": "mrkdwn",
							"text": workflow.Interpolate("*Region:*\n", workflow.RuntimeEnv("AWS_REGION")),
						},
					},
				},
				{
					"type": "section",
					"text": map[string]any{
						"type": "mrkdwn",
						// ✅ Field reference in deeply nested structure
						"text": analyzeError.Field("choices[0].message.content"),
					},
				},
				{
					"type": "section",
					"fields": []map[string]any{
						{
							"type": "mrkdwn",
							// ✅ Another field reference
							"text": workflow.Interpolate("*Payment:*\n", chargePayment.Field("status")),
						},
						{
							"type": "mrkdwn",
							// ✅ Yet another field reference
							"text": workflow.Interpolate("*DB Record:*\n", storeResults.Field("id")),
						},
					},
				},
			},
			"username":   "Deploy Bot",
			"icon_emoji": ":rocket:",
		}),
	)

	return nil
}

/*
SECURITY COMPARISON:

❌ WRONG PATTERN - Compile-time secrets (INSECURE):

	apiKey := ctx.SetSecret("key", "sk-proj-abc123")
	wf.HttpPost("api",
	    "https://api.openai.com/v1/chat/completions",
	    workflow.Header("Authorization", apiKey.Concat("Bearer ", ...)),
	)

	Result: Manifest contains "Authorization": "Bearer sk-proj-abc123"  ← EXPOSED! ❌
	        Temporal history contains the secret                        ← EXPOSED! ❌
	        Anyone with Temporal access sees the secret                 ← EXPOSED! ❌

✅ CORRECT PATTERN - Runtime secrets (SECURE):

	wf.HttpPost("api",
	    "https://api.openai.com/v1/chat/completions",
	    workflow.Header("Authorization",
	        workflow.Interpolate("Bearer ", workflow.RuntimeSecret("OPENAI_API_KEY")),
	    ),
	)

	Result: Manifest contains "Authorization": "Bearer ${.secrets.OPENAI_API_KEY}"  ← SAFE! ✅
	        Temporal history contains ONLY the placeholder                         ← SAFE! ✅
	        Secret resolved JIT in activity, discarded immediately                 ← SAFE! ✅

EXECUTION EXAMPLES:

1. Development environment:
   stigmer run secure-api-workflow \
     --runtime-env secret:OPENAI_API_KEY=sk-proj-dev123 \
     --runtime-env secret:STRIPE_API_KEY=sk_test_dev \
     --runtime-env secret:STRIPE_IDEMPOTENCY_KEY=dev-idempotent-key \
     --runtime-env secret:DATABASE_PASSWORD=devPassword123 \
     --runtime-env secret:EXTERNAL_API_KEY=ext-dev-key \
     --runtime-env secret:WEBHOOK_SIGNING_SECRET=whsec_dev \
     --runtime-env ENVIRONMENT=dev \
     --runtime-env AWS_REGION=us-west-2 \
     --runtime-env LOG_LEVEL=debug

2. Production environment (same manifest!):
   stigmer run secure-api-workflow \
     --runtime-env secret:OPENAI_API_KEY=sk-proj-prod-xyz \
     --runtime-env secret:STRIPE_API_KEY=sk_live_realkey \
     --runtime-env secret:STRIPE_IDEMPOTENCY_KEY=prod-idempotent-key \
     --runtime-env secret:DATABASE_PASSWORD=prodPassword \
     --runtime-env secret:EXTERNAL_API_KEY=ext-prod-key \
     --runtime-env secret:WEBHOOK_SIGNING_SECRET=whsec_prod \
     --runtime-env ENVIRONMENT=production \
     --runtime-env AWS_REGION=us-east-1 \
     --runtime-env LOG_LEVEL=info

3. CI/CD pipeline (secrets from vault):
   export OPENAI_KEY=$(vault read -field=value secret/openai/api-key)
   export STRIPE_KEY=$(vault read -field=value secret/stripe/api-key)
   export DB_PASS=$(vault read -field=value secret/database/password)

   stigmer run secure-api-workflow \
     --runtime-env secret:OPENAI_API_KEY="$OPENAI_KEY" \
     --runtime-env secret:STRIPE_API_KEY="$STRIPE_KEY" \
     --runtime-env secret:DATABASE_PASSWORD="$DB_PASS" \
     --runtime-env ENVIRONMENT=staging \
     --runtime-env AWS_REGION=eu-west-1 \
     --runtime-env LOG_LEVEL=info

WHEN TO USE EACH PATTERN:

RuntimeSecret():
  ✅ API keys (OpenAI, Stripe, AWS, etc.)
  ✅ Authentication tokens
  ✅ Database passwords
  ✅ OAuth client secrets
  ✅ Webhook signing keys
  ✅ Private keys / certificates
  ✅ Any sensitive data

RuntimeEnv():
  ✅ Environment names (dev, staging, prod)
  ✅ Region configuration
  ✅ Feature flags
  ✅ API endpoints (non-secret)
  ✅ Log levels
  ✅ Timeout values
  ✅ Non-sensitive config

ctx.SetString():
  ✅ Static configuration
  ✅ Public constants
  ✅ Non-secret metadata
  ✅ Workflow version/namespace
  ✅ Documentation strings
*/
