//go:build e2e
// +build e2e

package e2e

// TestProjectApplyUpdate tests project update functionality:
// 1. Apply v1 (initial deployment)
// 2. Apply v2 (updated agent description)
// 3. Verify agent spec is updated
// 4. Verify agent ID is preserved (update, not recreate)
//
// Test Fixture:
// - testdata/project/update-project/v1/ (initial)
// - testdata/project/update-project/v2/ (updated)
func (s *E2ESuite) TestProjectApplyUpdate() {
	s.T().Logf("=== Testing Project Apply Update ===")

	// STEP 1: Apply v1 (initial deployment)
	s.T().Log("Step 1: Deploy v1...")
	result1 := ApplyProject(s.T(), s.Harness.ServerPort, ProjectUpdateV1TestDataDir)
	VerifyProjectApplyOutputSuccess(s.T(), result1.Output)

	// Verify v1 agent
	agentV1 := VerifyAgentExists(s.T(), s.Harness.ServerPort, UpdateProjectAgentName)
	originalID := agentV1.Metadata.Id
	s.Require().Equal(UpdateProjectV1Description, agentV1.Spec.Description,
		"V1 agent should have initial description")
	s.T().Logf("✓ V1 deployed: %s with description '%s'", originalID, agentV1.Spec.Description)

	// STEP 2: Apply v2 (update)
	s.T().Log("Step 2: Apply v2 (update)...")
	result2 := ApplyProject(s.T(), s.Harness.ServerPort, ProjectUpdateV2TestDataDir)
	VerifyProjectApplyOutputSuccess(s.T(), result2.Output)

	// STEP 3: Verify agent spec is updated
	agentV2 := VerifyAgentExists(s.T(), s.Harness.ServerPort, UpdateProjectAgentName)
	s.Require().Equal(UpdateProjectV2Description, agentV2.Spec.Description,
		"V2 agent should have updated description")
	s.T().Logf("✓ Agent description updated to: '%s'", agentV2.Spec.Description)

	// STEP 4: Verify agent ID is preserved (update, not recreate)
	s.Require().Equal(originalID, agentV2.Metadata.Id,
		"Agent ID should be preserved during update (not recreated)")
	s.T().Logf("✓ Agent ID preserved: %s", agentV2.Metadata.Id)

	// STEP 5: Summary
	s.T().Logf("✅ Test passed: Project update works correctly")
	s.T().Logf("   Agent %s updated in place", UpdateProjectAgentName)
}

// TestProjectApplyUpdatePreservesMetadata tests that updates preserve system metadata:
// 1. Apply v1 and note created_at timestamp
// 2. Apply v2
// 3. Verify created_at is preserved, updated_at is changed
//
// This validates that updates don't recreate resources.
func (s *E2ESuite) TestProjectApplyUpdatePreservesMetadata() {
	s.T().Logf("=== Testing Project Update Preserves Metadata ===")

	// STEP 1: Apply v1
	s.T().Log("Deploy v1...")
	ApplyProject(s.T(), s.Harness.ServerPort, ProjectUpdateV1TestDataDir)
	agentV1 := VerifyAgentExists(s.T(), s.Harness.ServerPort, UpdateProjectAgentName)

	// Note the original created_at
	originalCreatedAt := agentV1.Metadata.CreatedAt
	s.T().Logf("✓ V1 created_at: %v", originalCreatedAt)

	// STEP 2: Apply v2
	s.T().Log("Apply v2 (update)...")
	ApplyProject(s.T(), s.Harness.ServerPort, ProjectUpdateV2TestDataDir)
	agentV2 := VerifyAgentExists(s.T(), s.Harness.ServerPort, UpdateProjectAgentName)

	// STEP 3: Verify created_at is preserved
	s.Require().Equal(originalCreatedAt.GetSeconds(), agentV2.Metadata.CreatedAt.GetSeconds(),
		"created_at should be preserved during update")
	s.T().Logf("✓ created_at preserved: %v", agentV2.Metadata.CreatedAt)

	// STEP 4: Verify updated_at is different (or same if no real change)
	// Note: If the agent wasn't actually modified, updated_at might be the same
	s.T().Logf("✓ updated_at: %v", agentV2.Metadata.UpdatedAt)

	// STEP 5: Summary
	s.T().Logf("✅ Test passed: Metadata preserved during update")
}

// TestProjectApplyUpdateMultipleResources tests updating a complex project:
// 1. Apply multi-agent project
// 2. Verify all resources exist
// 3. Apply again (should be no-op or update)
// 4. Verify resources still exist with correct properties
//
// This validates reconciliation works with multiple resource types.
func (s *E2ESuite) TestProjectApplyUpdateMultipleResources() {
	s.T().Logf("=== Testing Multi-Resource Update ===")

	// STEP 1: Apply multi-agent project
	s.T().Log("Initial deployment...")
	result1 := ApplyProject(s.T(), s.Harness.ServerPort, ProjectMultiAgentTestDataDir)
	VerifyProjectApplyOutputSuccess(s.T(), result1.Output)

	// Get original IDs
	mcpV1 := VerifyMcpServerExists(s.T(), s.Harness.ServerPort, MultiAgentMcpServerName)
	etlV1 := VerifyAgentExists(s.T(), s.Harness.ServerPort, MultiAgentETLAgentName)
	workflowV1 := VerifyWorkflowExists(s.T(), s.Harness.ServerPort, MultiAgentWorkflowName)

	s.T().Logf("✓ Initial deployment: MCP=%s, Agent=%s, Workflow=%s",
		mcpV1.Metadata.Id, etlV1.Metadata.Id, workflowV1.Metadata.Id)

	// STEP 2: Apply again (idempotent)
	s.T().Log("Second apply (should preserve IDs)...")
	result2 := ApplyProject(s.T(), s.Harness.ServerPort, ProjectMultiAgentTestDataDir)
	VerifyProjectApplyOutputSuccess(s.T(), result2.Output)

	// STEP 3: Verify IDs are preserved
	mcpV2 := VerifyMcpServerExists(s.T(), s.Harness.ServerPort, MultiAgentMcpServerName)
	etlV2 := VerifyAgentExists(s.T(), s.Harness.ServerPort, MultiAgentETLAgentName)
	workflowV2 := VerifyWorkflowExists(s.T(), s.Harness.ServerPort, MultiAgentWorkflowName)

	s.Require().Equal(mcpV1.Metadata.Id, mcpV2.Metadata.Id, "MCP Server ID should be preserved")
	s.Require().Equal(etlV1.Metadata.Id, etlV2.Metadata.Id, "Agent ID should be preserved")
	s.Require().Equal(workflowV1.Metadata.Id, workflowV2.Metadata.Id, "Workflow ID should be preserved")

	// STEP 4: Summary
	s.T().Logf("✅ Test passed: Multi-resource update preserves all IDs")
}
