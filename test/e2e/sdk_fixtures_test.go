//go:build e2e
// +build e2e

package e2e

import (
	"fmt"
	"io"
	"os"
	"path/filepath"
)

// SDKExample represents an SDK example that should be copied to testdata
type SDKExample struct {
	// SDK example file name (e.g., "01_basic_agent.go")
	SDKFileName string
	
	// Target directory in testdata (e.g., "examples/01-basic-agent")
	TestDataDir string
	
	// Target file name in testdata (usually "main.go")
	TargetFileName string
}

// GetSDKExamplesDirectory returns the absolute path to sdk/go/examples/
func GetSDKExamplesDirectory() (string, error) {
	// We're in test/e2e, SDK examples are at ../../sdk/go/examples
	cwd, err := os.Getwd()
	if err != nil {
		return "", fmt.Errorf("failed to get working directory: %w", err)
	}
	
	sdkExamplesPath := filepath.Join(cwd, "..", "..", "sdk", "go", "examples")
	absPath, err := filepath.Abs(sdkExamplesPath)
	if err != nil {
		return "", fmt.Errorf("failed to get absolute path: %w", err)
	}
	
	return absPath, nil
}

// GetTestDataDirectory returns the absolute path to test/e2e/testdata/
func GetTestDataDirectory() (string, error) {
	cwd, err := os.Getwd()
	if err != nil {
		return "", fmt.Errorf("failed to get working directory: %w", err)
	}
	
	testDataPath := filepath.Join(cwd, "testdata")
	absPath, err := filepath.Abs(testDataPath)
	if err != nil {
		return "", fmt.Errorf("failed to get absolute path: %w", err)
	}
	
	return absPath, nil
}

// CopySDKExample copies an SDK example file to the testdata directory
func CopySDKExample(example SDKExample) error {
	// Get source path (SDK example)
	sdkDir, err := GetSDKExamplesDirectory()
	if err != nil {
		return fmt.Errorf("failed to get SDK examples directory: %w", err)
	}
	sourcePath := filepath.Join(sdkDir, example.SDKFileName)
	
	// Get target path (testdata)
	testDataDir, err := GetTestDataDirectory()
	if err != nil {
		return fmt.Errorf("failed to get testdata directory: %w", err)
	}
	targetDir := filepath.Join(testDataDir, example.TestDataDir)
	targetPath := filepath.Join(targetDir, example.TargetFileName)
	
	// Ensure target directory exists
	if err := os.MkdirAll(targetDir, 0755); err != nil {
		return fmt.Errorf("failed to create target directory %s: %w", targetDir, err)
	}
	
	// Open source file
	sourceFile, err := os.Open(sourcePath)
	if err != nil {
		return fmt.Errorf("failed to open source file %s: %w", sourcePath, err)
	}
	defer sourceFile.Close()
	
	// Create target file
	targetFile, err := os.Create(targetPath)
	if err != nil {
		return fmt.Errorf("failed to create target file %s: %w", targetPath, err)
	}
	defer targetFile.Close()
	
	// Copy contents
	if _, err := io.Copy(targetFile, sourceFile); err != nil {
		return fmt.Errorf("failed to copy file contents: %w", err)
	}
	
	return nil
}

// CopyAllSDKExamples copies all SDK examples to testdata
// This should be called once before running tests (in SetupSuite)
func CopyAllSDKExamples() error {
	examples := []SDKExample{
		// Agent examples
		{
			SDKFileName:    "01_basic_agent.go",
			TestDataDir:    "examples/01-basic-agent",
			TargetFileName: "main.go",
		},
		{
			SDKFileName:    "02_agent_with_skills.go",
			TestDataDir:    "examples/02-agent-with-skills",
			TargetFileName: "main.go",
		},
		{
			SDKFileName:    "03_agent_with_mcp_servers.go",
			TestDataDir:    "examples/03-agent-with-mcp-servers",
			TargetFileName: "main.go",
		},
		{
			SDKFileName:    "04_agent_with_subagents.go",
			TestDataDir:    "examples/04-agent-with-subagents",
			TargetFileName: "main.go",
		},
		{
			SDKFileName:    "05_agent_with_environment_variables.go",
			TestDataDir:    "examples/05-agent-with-environment-variables",
			TargetFileName: "main.go",
		},
		{
			SDKFileName:    "06_agent_with_instructions_from_files.go",
			TestDataDir:    "examples/06-agent-with-instructions-from-files",
			TargetFileName: "main.go",
		},
		// Workflow examples
		{
			SDKFileName:    "07_basic_workflow.go",
			TestDataDir:    "examples/07-basic-workflow",
			TargetFileName: "main.go",
		},
		{
			SDKFileName:    "08_workflow_with_conditionals.go",
			TestDataDir:    "examples/08-workflow-with-conditionals",
			TargetFileName: "main.go",
		},
		{
			SDKFileName:    "09_workflow_with_loops.go",
			TestDataDir:    "examples/09-workflow-with-loops",
			TargetFileName: "main.go",
		},
		{
			SDKFileName:    "10_workflow_with_error_handling.go",
			TestDataDir:    "examples/10-workflow-with-error-handling",
			TargetFileName: "main.go",
		},
		{
			SDKFileName:    "11_workflow_with_parallel_execution.go",
			TestDataDir:    "examples/11-workflow-with-parallel-execution",
			TargetFileName: "main.go",
		},
		{
			SDKFileName:    "12_agent_with_typed_context.go",
			TestDataDir:    "examples/12-agent-with-typed-context",
			TargetFileName: "main.go",
		},
		{
			SDKFileName:    "13_workflow_and_agent_shared_context.go",
			TestDataDir:    "examples/13-workflow-and-agent-shared-context",
			TargetFileName: "main.go",
		},
		{
			SDKFileName:    "14_workflow_with_runtime_secrets.go",
			TestDataDir:    "examples/14-workflow-with-runtime-secrets",
			TargetFileName: "main.go",
		},
		{
			SDKFileName:    "15_workflow_calling_simple_agent.go",
			TestDataDir:    "examples/15-workflow-calling-simple-agent",
			TargetFileName: "main.go",
		},
		{
			SDKFileName:    "16_workflow_calling_agent_by_slug.go",
			TestDataDir:    "examples/16-workflow-calling-agent-by-slug",
			TargetFileName: "main.go",
		},
		{
			SDKFileName:    "17_workflow_agent_with_runtime_secrets.go",
			TestDataDir:    "examples/17-workflow-agent-with-runtime-secrets",
			TargetFileName: "main.go",
		},
		{
			SDKFileName:    "18_workflow_multi_agent_orchestration.go",
			TestDataDir:    "examples/18-workflow-multi-agent-orchestration",
			TargetFileName: "main.go",
		},
		{
			SDKFileName:    "19_workflow_agent_execution_config.go",
			TestDataDir:    "examples/19-workflow-agent-execution-config",
			TargetFileName: "main.go",
		},
	}
	
	for _, example := range examples {
		if err := CopySDKExample(example); err != nil {
			return fmt.Errorf("failed to copy %s: %w", example.SDKFileName, err)
		}
	}
	
	return nil
}

// VerifySDKExampleExists checks if an SDK example file exists
func VerifySDKExampleExists(fileName string) error {
	sdkDir, err := GetSDKExamplesDirectory()
	if err != nil {
		return err
	}
	
	filePath := filepath.Join(sdkDir, fileName)
	if _, err := os.Stat(filePath); os.IsNotExist(err) {
		return fmt.Errorf("SDK example file does not exist: %s", filePath)
	}
	
	return nil
}
