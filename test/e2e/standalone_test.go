//go:build e2e
// +build e2e

package e2e

import (
	"fmt"
	"net"
	"testing"
	"time"
)

// TestStandalone is a simple standalone test to verify test infrastructure works
// This doesn't use the testify suite or harness - just basic Go testing
func TestStandalone(t *testing.T) {
	t.Log("Running standalone test...")
	
	// Test 1: GetFreePort
	port, err := GetFreePort()
	if err != nil {
		t.Fatalf("GetFreePort failed: %v", err)
	}
	t.Logf("✓ GetFreePort returned: %d", port)
	
	// Test 2: Create a simple listener to test WaitForPort
	addr, err := net.ResolveTCPAddr("tcp", fmt.Sprintf("localhost:%d", port))
	if err != nil {
		t.Fatalf("ResolveTCPAddr failed: %v", err)
	}
	
	listener, err := net.ListenTCP("tcp", addr)
	if err != nil {
		t.Fatalf("ListenTCP failed: %v", err)
	}
	defer listener.Close()
	
	t.Logf("✓ Started test listener on port %d", port)
	
	// Test 3: WaitForPort should succeed
	ready := WaitForPort(port, 2*time.Second)
	if !ready {
		t.Fatal("WaitForPort failed - port not ready")
	}
	t.Logf("✓ WaitForPort succeeded")
	
	t.Log("✅ Standalone test passed - basic infrastructure works!")
}
