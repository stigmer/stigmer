//go:build e2e
// +build e2e

package e2e

import (
	"path/filepath"
	
	agentv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agent/v1"
	"google.golang.org/protobuf/proto"
)

// TestDebugAgentPersistence is a diagnostic test to investigate why only one agent appears in the database
//
// This test helps diagnose:
// 1. How many agents are synthesized
// 2. How many agents are deployed via CLI
// 3. How many agents exist in BadgerDB
// 4. What IDs and slugs are actually stored
func (s *E2ESuite) TestDebugAgentPersistence() {
	testdataDir := filepath.Join("testdata", "examples", "01-basic-agent")
	absTestdataDir, err := filepath.Abs(testdataDir)
	s.Require().NoError(err, "Failed to get absolute path to basic-agent directory")

	// ========================================
	// STEP 1: Apply agents
	// ========================================
	s.T().Log("========================================")
	s.T().Log("STEP 1: Applying agents...")
	s.T().Log("========================================")
	
	output, err := RunCLIWithServerAddr(s.Harness.ServerPort, "apply", "--config", absTestdataDir)
	s.Require().NoError(err, "Apply command should succeed")
	
	s.T().Logf("Apply command output:\n%s", output)
	
	// ========================================
	// STEP 2: Query via API (what the test currently does)
	// ========================================
	s.T().Log("\n========================================")
	s.T().Log("STEP 2: Querying agents via gRPC API...")
	s.T().Log("========================================")
	
	org := "local"
	
	// Try to get both agents via API
	basicAgent, basicErr := GetAgentBySlug(s.Harness.ServerPort, "code-reviewer", org)
	if basicErr != nil {
		s.T().Logf("❌ Failed to get 'code-reviewer' via API: %v", basicErr)
	} else {
		s.T().Logf("✅ Found 'code-reviewer' via API:")
		s.T().Logf("   ID: %s", basicAgent.Metadata.Id)
		s.T().Logf("   Name: %s", basicAgent.Metadata.Name)
		s.T().Logf("   Slug: %s", basicAgent.Metadata.Slug)
		s.T().Logf("   Org: %s", basicAgent.Metadata.Org)
	}
	
	fullAgent, fullErr := GetAgentBySlug(s.Harness.ServerPort, "code-reviewer-pro", org)
	if fullErr != nil {
		s.T().Logf("❌ Failed to get 'code-reviewer-pro' via API: %v", fullErr)
	} else {
		s.T().Logf("✅ Found 'code-reviewer-pro' via API:")
		s.T().Logf("   ID: %s", fullAgent.Metadata.Id)
		s.T().Logf("   Name: %s", fullAgent.Metadata.Name)
		s.T().Logf("   Slug: %s", fullAgent.Metadata.Slug)
		s.T().Logf("   Org: %s", fullAgent.Metadata.Org)
	}
	
	// ========================================
	// STEP 3: Inspect BadgerDB directly
	// ========================================
	s.T().Log("\n========================================")
	s.T().Log("STEP 3: Inspecting BadgerDB directly...")
	s.T().Log("========================================")
	
	dbPath := filepath.Join(s.TempDir, "stigmer.db")
	s.T().Logf("Database path: %s", dbPath)
	
	// List ALL keys in the database
	allKeys, err := ListKeysFromDB(dbPath, "")
	s.Require().NoError(err, "Should be able to list keys from DB")
	
	s.T().Logf("\nTotal keys in database: %d", len(allKeys))
	s.T().Log("All keys:")
	for i, key := range allKeys {
		s.T().Logf("  %d. %s", i+1, key)
	}
	
	// List only agent keys
	agentKeys, err := ListKeysFromDB(dbPath, "agent/")
	s.Require().NoError(err, "Should be able to list agent keys from DB")
	
	s.T().Logf("\nAgent keys in database: %d", len(agentKeys))
	s.T().Log("Agent keys:")
	for i, key := range agentKeys {
		s.T().Logf("  %d. %s", i+1, key)
	}
	
	// ========================================
	// STEP 4: Read each agent from DB and inspect
	// ========================================
	s.T().Log("\n========================================")
	s.T().Log("STEP 4: Reading agents from BadgerDB...")
	s.T().Log("========================================")
	
	for i, key := range agentKeys {
		s.T().Logf("\nAgent %d (key: %s):", i+1, key)
		
		// Read the raw bytes
		data, err := GetFromDB(dbPath, key)
		if err != nil {
			s.T().Logf("  ❌ Failed to read from DB: %v", err)
			continue
		}
		
		// Unmarshal the agent
		var agent agentv1.Agent
		if err := proto.Unmarshal(data, &agent); err != nil {
			s.T().Logf("  ❌ Failed to unmarshal agent: %v", err)
			continue
		}
		
		// Print agent details
		s.T().Logf("  ID: %s", agent.Metadata.GetId())
		s.T().Logf("  Name: %s", agent.Metadata.GetName())
		s.T().Logf("  Slug: %s", agent.Metadata.GetSlug())
		s.T().Logf("  Org: %s", agent.Metadata.GetOrg())
		s.T().Logf("  OwnerScope: %s", agent.Metadata.GetOwnerScope())
		s.T().Logf("  Description: %s", agent.Spec.GetDescription())
		s.T().Logf("  Instructions: %s", agent.Spec.GetInstructions()[:50])
		s.T().Logf("  Default Instance ID: %s", agent.Status.GetDefaultInstanceId())
	}
	
	// ========================================
	// STEP 5: Compare counts
	// ========================================
	s.T().Log("\n========================================")
	s.T().Log("STEP 5: Summary")
	s.T().Log("========================================")
	
	s.T().Logf("Agents found via API (GetBySlug):")
	if basicErr == nil {
		s.T().Logf("  ✅ code-reviewer")
	} else {
		s.T().Logf("  ❌ code-reviewer: %v", basicErr)
	}
	if fullErr == nil {
		s.T().Logf("  ✅ code-reviewer-pro")
	} else {
		s.T().Logf("  ❌ code-reviewer-pro: %v", fullErr)
	}
	
	s.T().Logf("\nAgents in BadgerDB: %d", len(agentKeys))
	
	// ========================================
	// ASSERTIONS
	// ========================================
	s.T().Log("\n========================================")
	s.T().Log("ASSERTIONS")
	s.T().Log("========================================")
	
	// Assert that we have exactly 2 agent keys in the database
	s.Equal(2, len(agentKeys), "Should have exactly 2 agents in BadgerDB")
	
	// Assert that both agents can be retrieved via API
	s.NoError(basicErr, "Should be able to retrieve 'code-reviewer' via API")
	s.NoError(fullErr, "Should be able to retrieve 'code-reviewer-pro' via API")
	
	if basicErr == nil && fullErr == nil {
		// Verify they have different IDs
		s.NotEqual(basicAgent.Metadata.Id, fullAgent.Metadata.Id, "Agents should have different IDs")
		
		// Verify they have different slugs
		s.NotEqual(basicAgent.Metadata.Slug, fullAgent.Metadata.Slug, "Agents should have different slugs")
	}
	
	s.T().Log("\n✅ All diagnostic checks passed!")
}

// TestDebugAgentPersistenceWithDirectDBQuery tests if we can query the DB directly
// to see all agents, bypassing the API layer
func (s *E2ESuite) TestDebugAgentPersistenceWithDirectDBQuery() {
	testdataDir := filepath.Join("testdata", "examples", "01-basic-agent")
	absTestdataDir, err := filepath.Abs(testdataDir)
	s.Require().NoError(err, "Failed to get absolute path")

	// Apply agents
	output, err := RunCLIWithServerAddr(s.Harness.ServerPort, "apply", "--config", absTestdataDir)
	s.Require().NoError(err, "Apply should succeed")
	s.T().Logf("Apply output:\n%s", output)

	// Open the database and list all agents
	dbPath := filepath.Join(s.TempDir, "stigmer.db")
	
	agentKeys, err := ListKeysFromDB(dbPath, "agent/")
	s.Require().NoError(err, "Should list agent keys")
	
	s.T().Logf("\n========================================")
	s.T().Logf("AGENTS IN DATABASE (Direct DB Query)")
	s.T().Logf("========================================")
	s.T().Logf("Count: %d", len(agentKeys))
	
	agentsBySlug := make(map[string]*agentv1.Agent)
	
	for _, key := range agentKeys {
		data, err := GetFromDB(dbPath, key)
		s.Require().NoError(err, "Should read agent data")
		
		var agent agentv1.Agent
		err = proto.Unmarshal(data, &agent)
		s.Require().NoError(err, "Should unmarshal agent")
		
		slug := agent.Metadata.GetSlug()
		agentsBySlug[slug] = &agent
		
		s.T().Logf("\nAgent:")
		s.T().Logf("  DB Key: %s", key)
		s.T().Logf("  ID: %s", agent.Metadata.GetId())
		s.T().Logf("  Name: %s", agent.Metadata.GetName())
		s.T().Logf("  Slug: %s", slug)
	}
	
	s.T().Logf("\n========================================")
	s.T().Logf("VERIFICATION")
	s.T().Logf("========================================")
	
	// Check if we have both agents
	if agent, ok := agentsBySlug["code-reviewer"]; ok {
		s.T().Logf("✅ Found 'code-reviewer' (ID: %s)", agent.Metadata.Id)
	} else {
		s.T().Log("❌ Missing 'code-reviewer'")
		s.T().Logf("   Available slugs: %v", getKeys(agentsBySlug))
	}
	
	if agent, ok := agentsBySlug["code-reviewer-pro"]; ok {
		s.T().Logf("✅ Found 'code-reviewer-pro' (ID: %s)", agent.Metadata.Id)
	} else {
		s.T().Log("❌ Missing 'code-reviewer-pro'")
		s.T().Logf("   Available slugs: %v", getKeys(agentsBySlug))
	}
	
	// Assert we have exactly 2 agents
	s.Equal(2, len(agentsBySlug), "Should have exactly 2 agents")
	s.Contains(agentsBySlug, "code-reviewer", "Should have code-reviewer")
	s.Contains(agentsBySlug, "code-reviewer-pro", "Should have code-reviewer-pro")
}

// Helper function to get map keys
func getKeys(m map[string]*agentv1.Agent) []string {
	keys := make([]string, 0, len(m))
	for k := range m {
		keys = append(keys, k)
	}
	return keys
}
