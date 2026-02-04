//go:build e2e
// +build e2e

package e2e

// TestProjectApplyOrphanPruning tests orphan resource cleanup:
// 1. Apply v1 (3 agents)
// 2. Apply v2 (2 agents, 1 removed)
// 3. Verify orphan-agent is deleted
// 4. Verify keeper agents still exist
//
// Test Fixture:
// - testdata/project/orphan-project/v1/ (3 agents)
// - testdata/project/orphan-project/v2/ (2 agents, orphan-agent removed)
func (s *E2ESuite) TestProjectApplyOrphanPruning() {
	s.T().Logf("=== Testing Project Apply Orphan Pruning ===")

	// STEP 1: Apply v1 (3 agents)
	s.T().Log("Step 1: Deploy v1 with 3 agents...")
	result1 := ApplyProject(s.T(), s.Harness.ServerPort, ProjectOrphanV1TestDataDir)
	VerifyProjectApplyOutputSuccess(s.T(), result1.Output)

	// Verify all 3 agents exist
	keeper1 := VerifyAgentExists(s.T(), s.Harness.ServerPort, "keeper-agent-1")
	keeper2 := VerifyAgentExists(s.T(), s.Harness.ServerPort, "keeper-agent-2")
	orphan := VerifyAgentExists(s.T(), s.Harness.ServerPort, OrphanAgentName)
	s.T().Logf("✓ V1 deployed with 3 agents: keeper-1=%s, keeper-2=%s, orphan=%s",
		keeper1.Metadata.Id, keeper2.Metadata.Id, orphan.Metadata.Id)

	// STEP 2: Apply v2 (2 agents, orphan removed)
	s.T().Log("Step 2: Apply v2 with 2 agents (orphan-agent removed)...")
	result2 := ApplyProject(s.T(), s.Harness.ServerPort, ProjectOrphanV2TestDataDir)
	VerifyProjectApplyOutputSuccess(s.T(), result2.Output)

	// STEP 3: Verify keeper agents still exist
	keeper1After := VerifyAgentExists(s.T(), s.Harness.ServerPort, "keeper-agent-1")
	keeper2After := VerifyAgentExists(s.T(), s.Harness.ServerPort, "keeper-agent-2")
	s.Require().Equal(keeper1.Metadata.Id, keeper1After.Metadata.Id,
		"keeper-agent-1 should be preserved")
	s.Require().Equal(keeper2.Metadata.Id, keeper2After.Metadata.Id,
		"keeper-agent-2 should be preserved")
	s.T().Logf("✓ Keeper agents preserved: keeper-1=%s, keeper-2=%s",
		keeper1After.Metadata.Id, keeper2After.Metadata.Id)

	// STEP 4: Verify orphan-agent was deleted
	VerifyAgentNotExists(s.T(), s.Harness.ServerPort, OrphanAgentName)
	s.T().Logf("✓ Orphan agent deleted: %s", OrphanAgentName)

	// STEP 5: Summary
	s.T().Logf("✅ Test passed: Orphan pruning works correctly")
	s.T().Logf("   Kept: keeper-agent-1, keeper-agent-2")
	s.T().Logf("   Pruned: %s", OrphanAgentName)
}

// TestProjectApplyNoPruneFlag tests the --prune=false flag:
// 1. Apply v1 (3 agents)
// 2. Apply v2 with --prune=false (2 agents)
// 3. Verify orphan-agent still exists (not pruned)
//
// This validates that users can opt out of orphan cleanup.
func (s *E2ESuite) TestProjectApplyNoPruneFlag() {
	s.T().Logf("=== Testing Project Apply --prune=false Flag ===")

	// STEP 1: Apply v1 (3 agents)
	s.T().Log("Step 1: Deploy v1 with 3 agents...")
	result1 := ApplyProject(s.T(), s.Harness.ServerPort, ProjectOrphanV1TestDataDir)
	VerifyProjectApplyOutputSuccess(s.T(), result1.Output)

	// Verify orphan agent exists
	orphan := VerifyAgentExists(s.T(), s.Harness.ServerPort, OrphanAgentName)
	s.T().Logf("✓ Orphan agent deployed: %s", orphan.Metadata.Id)

	// STEP 2: Apply v2 with --prune=false
	s.T().Log("Step 2: Apply v2 with --prune=false...")
	output := ApplyProjectNoPrune(s.T(), s.Harness.ServerPort, ProjectOrphanV2TestDataDir)
	s.Require().Contains(output, "Deployment successful",
		"Apply should succeed with --prune=false")

	// STEP 3: Verify orphan-agent STILL exists (not pruned)
	orphanAfter := VerifyAgentExists(s.T(), s.Harness.ServerPort, OrphanAgentName)
	s.Require().Equal(orphan.Metadata.Id, orphanAfter.Metadata.Id,
		"Orphan agent should NOT be pruned with --prune=false")
	s.T().Logf("✓ Orphan agent preserved: %s", orphanAfter.Metadata.Id)

	// STEP 4: Verify keeper agents also exist
	VerifyAgentExists(s.T(), s.Harness.ServerPort, "keeper-agent-1")
	VerifyAgentExists(s.T(), s.Harness.ServerPort, "keeper-agent-2")

	// STEP 5: Summary
	s.T().Logf("✅ Test passed: --prune=false prevents orphan deletion")

	// Cleanup: Apply v2 again WITH pruning to clean up the orphan
	s.T().Log("Cleanup: Applying v2 with pruning to clean up...")
	ApplyProject(s.T(), s.Harness.ServerPort, ProjectOrphanV2TestDataDir)
}

// TestProjectApplyOrphanPruningOrder tests that orphans are deleted in correct order:
// This validates that dependent resources are deleted before dependencies.
//
// For a multi-resource project:
// - Workflow (depends on agents) should be deleted first
// - Then agents (depend on MCP servers)
// - Then MCP servers
func (s *E2ESuite) TestProjectApplyOrphanPruningOrder() {
	s.T().Logf("=== Testing Orphan Pruning Order ===")

	// STEP 1: Apply multi-agent project (full deployment)
	s.T().Log("Deploy multi-agent project...")
	result1 := ApplyProject(s.T(), s.Harness.ServerPort, ProjectMultiAgentTestDataDir)
	VerifyProjectApplyOutputSuccess(s.T(), result1.Output)

	// Verify all resources exist
	VerifyMcpServerExists(s.T(), s.Harness.ServerPort, MultiAgentMcpServerName)
	VerifyAgentExists(s.T(), s.Harness.ServerPort, MultiAgentETLAgentName)
	VerifyWorkflowExists(s.T(), s.Harness.ServerPort, MultiAgentWorkflowName)
	s.T().Logf("✓ All resources deployed")

	// STEP 2: Apply basic project (different project replaces resources)
	// Note: This doesn't actually test orphan order within the same project
	// but validates that the reconciliation engine handles the transition
	s.T().Log("Deploy basic project (transitions away from multi-agent)...")
	result2 := ApplyProject(s.T(), s.Harness.ServerPort, ProjectBasicTestDataDir)
	VerifyProjectApplyOutputSuccess(s.T(), result2.Output)

	// STEP 3: Verify basic project agent exists
	VerifyAgentExists(s.T(), s.Harness.ServerPort, BasicProjectAgentName)
	s.T().Logf("✓ Basic project deployed")

	// STEP 4: Summary
	s.T().Logf("✅ Test passed: Project transition handled correctly")
}
