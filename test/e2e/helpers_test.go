//go:build e2e
// +build e2e

package e2e

import (
	"context"
	"fmt"
	"net"
	"time"

	badger "github.com/dgraph-io/badger/v3"
	agentv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agent/v1"
	agentexecutionv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agentexecution/v1"
	apiresource "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource/apiresourcekind"
	"google.golang.org/grpc"
	"google.golang.org/grpc/credentials/insecure"
)

// GetFreePort finds an available port on localhost
func GetFreePort() (int, error) {
	addr, err := net.ResolveTCPAddr("tcp", "localhost:0")
	if err != nil {
		return 0, err
	}

	l, err := net.ListenTCP("tcp", addr)
	if err != nil {
		return 0, err
	}
	defer l.Close()

	return l.Addr().(*net.TCPAddr).Port, nil
}

// WaitForPort checks if a port is accepting connections within the timeout
func WaitForPort(port int, timeout time.Duration) bool {
	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		conn, err := net.DialTimeout("tcp",
			fmt.Sprintf("localhost:%d", port),
			100*time.Millisecond)
		if err == nil {
			conn.Close()
			return true
		}
		time.Sleep(100 * time.Millisecond)
	}
	return false
}

// GetFromDB reads a value from the BadgerDB database
// dbPath should be the path to the BadgerDB database directory (e.g., "{tempDir}/stigmer.db")
func GetFromDB(dbPath string, key string) ([]byte, error) {
	// Open BadgerDB with read-only access
	opts := badger.DefaultOptions(dbPath)
	opts.Logger = nil // Disable logging for cleaner test output

	db, err := badger.Open(opts)
	if err != nil {
		return nil, fmt.Errorf("failed to open BadgerDB: %w", err)
	}
	defer db.Close()

	var value []byte
	err = db.View(func(txn *badger.Txn) error {
		item, err := txn.Get([]byte(key))
		if err != nil {
			return err
		}

		// ValueCopy is required because the value is only valid during transaction
		value, err = item.ValueCopy(nil)
		return err
	})

	if err != nil {
		return nil, fmt.Errorf("failed to get key %s: %w", key, err)
	}

	return value, nil
}

// ListKeysFromDB returns all keys in the BadgerDB database (useful for debugging)
func ListKeysFromDB(dbPath string, prefix string) ([]string, error) {
	opts := badger.DefaultOptions(dbPath)
	opts.Logger = nil

	db, err := badger.Open(opts)
	if err != nil {
		return nil, fmt.Errorf("failed to open BadgerDB: %w", err)
	}
	defer db.Close()

	var keys []string
	err = db.View(func(txn *badger.Txn) error {
		opts := badger.DefaultIteratorOptions
		opts.PrefetchValues = false // We only need keys
		it := txn.NewIterator(opts)
		defer it.Close()

		prefixBytes := []byte(prefix)
		for it.Seek(prefixBytes); it.ValidForPrefix(prefixBytes); it.Next() {
			item := it.Item()
			key := string(item.Key())
			keys = append(keys, key)
		}
		return nil
	})

	if err != nil {
		return nil, fmt.Errorf("failed to list keys: %w", err)
	}

	return keys, nil
}

// GetAgentViaAPI retrieves an agent by ID
func GetAgentViaAPI(serverPort int, agentID string) (*agentv1.Agent, error) {
	// Connect to the server
	addr := fmt.Sprintf("localhost:%d", serverPort)
	conn, err := grpc.Dial(addr, grpc.WithTransportCredentials(insecure.NewCredentials()))
	if err != nil {
		return nil, fmt.Errorf("failed to connect to server: %w", err)
	}
	defer conn.Close()

	// Create agent query client
	client := agentv1.NewAgentQueryControllerClient(conn)

	// Query the agent
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	agent, err := client.Get(ctx, &agentv1.AgentId{Value: agentID})
	if err != nil {
		return nil, fmt.Errorf("failed to get agent: %w", err)
	}

	return agent, nil
}

// GetAgentBySlug queries an agent by slug and organization via gRPC API
// This is the proper way to verify agents by slug in tests
func GetAgentBySlug(serverPort int, slug string, org string) (*agentv1.Agent, error) {
	// Connect to the server
	addr := fmt.Sprintf("localhost:%d", serverPort)
	conn, err := grpc.Dial(addr, grpc.WithTransportCredentials(insecure.NewCredentials()))
	if err != nil {
		return nil, fmt.Errorf("failed to connect to server: %w", err)
	}
	defer conn.Close()

	// Create agent query client
	client := agentv1.NewAgentQueryControllerClient(conn)

	// Query the agent by reference (slug + org)
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	agent, err := client.GetByReference(ctx, &apiresource.ApiResourceReference{
		Scope: apiresource.ApiResourceOwnerScope_organization,
		Org:   org,
		Kind:  apiresourcekind.ApiResourceKind_agent,
		Slug:  slug,
	})
	if err != nil {
		return nil, fmt.Errorf("failed to get agent by slug: %w", err)
	}

	return agent, nil
}

// AgentExistsViaAPI checks if an agent exists by querying the gRPC API
// This is the proper way to verify agents in tests (not direct DB access)
func AgentExistsViaAPI(serverPort int, agentID string) (bool, error) {
	agent, err := GetAgentViaAPI(serverPort, agentID)
	if err != nil {
		return false, err
	}
	return agent != nil, nil
}

// AgentExecutionExistsViaAPI checks if an agent execution exists by querying the gRPC API
// This is the proper way to verify executions in tests (not direct DB access)
func AgentExecutionExistsViaAPI(serverPort int, executionID string) (bool, error) {
	// Connect to the server
	addr := fmt.Sprintf("localhost:%d", serverPort)
	conn, err := grpc.Dial(addr, grpc.WithTransportCredentials(insecure.NewCredentials()))
	if err != nil {
		return false, fmt.Errorf("failed to connect to server: %w", err)
	}
	defer conn.Close()

	// Create agent execution query client
	client := agentexecutionv1.NewAgentExecutionQueryControllerClient(conn)

	// Query the execution
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	_, err = client.Get(ctx, &agentexecutionv1.AgentExecutionId{Value: executionID})
	if err != nil {
		// Check if it's a NotFound error (execution doesn't exist) or another error
		return false, fmt.Errorf("failed to get execution: %w", err)
	}

	return true, nil
}

// GetAgentExecutionViaAPI retrieves an agent execution by ID
func GetAgentExecutionViaAPI(serverPort int, executionID string) (*agentexecutionv1.AgentExecution, error) {
	// Connect to the server
	addr := fmt.Sprintf("localhost:%d", serverPort)
	conn, err := grpc.Dial(addr, grpc.WithTransportCredentials(insecure.NewCredentials()))
	if err != nil {
		return nil, fmt.Errorf("failed to connect to server: %w", err)
	}
	defer conn.Close()

	// Create agent execution query client
	client := agentexecutionv1.NewAgentExecutionQueryControllerClient(conn)

	// Query the execution
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	execution, err := client.Get(ctx, &agentexecutionv1.AgentExecutionId{Value: executionID})
	if err != nil {
		return nil, fmt.Errorf("failed to get execution: %w", err)
	}

	return execution, nil
}

// WaitForExecutionPhase polls the execution until it reaches the target phase or times out
// Returns the execution object when target phase is reached, or error on timeout
func WaitForExecutionPhase(serverPort int, executionID string, targetPhase agentexecutionv1.ExecutionPhase, timeout time.Duration) (*agentexecutionv1.AgentExecution, error) {
	deadline := time.Now().Add(timeout)
	var lastExecution *agentexecutionv1.AgentExecution
	
	for time.Now().Before(deadline) {
		execution, err := GetAgentExecutionViaAPI(serverPort, executionID)
		if err != nil {
			// Execution might not exist yet, keep waiting
			time.Sleep(500 * time.Millisecond)
			continue
		}

		lastExecution = execution

		// Check if we've reached the target phase
		if execution.Status != nil && execution.Status.Phase == targetPhase {
			return execution, nil
		}

		// Check if execution is in a terminal failed state
		if execution.Status != nil && execution.Status.Phase == agentexecutionv1.ExecutionPhase_EXECUTION_FAILED {
			return execution, fmt.Errorf("execution failed (target phase was %s)", targetPhase.String())
		}

		// Not there yet, wait and retry
		time.Sleep(500 * time.Millisecond)
	}

	// Timeout reached - include current phase for debugging
	currentPhase := "UNKNOWN"
	if lastExecution != nil && lastExecution.Status != nil {
		currentPhase = lastExecution.Status.Phase.String()
	}
	return nil, fmt.Errorf("timeout waiting for execution to reach phase %s after %v (stuck at phase: %s)", targetPhase.String(), timeout, currentPhase)
}

// GetExecutionMessages retrieves all messages from an execution
func GetExecutionMessages(serverPort int, executionID string) ([]string, error) {
	execution, err := GetAgentExecutionViaAPI(serverPort, executionID)
	if err != nil {
		return nil, err
	}

	if execution.Status == nil || len(execution.Status.Messages) == 0 {
		return []string{}, nil
	}

	messages := make([]string, len(execution.Status.Messages))
	for i, msg := range execution.Status.Messages {
		messages[i] = msg.Content
	}

	return messages, nil
}
