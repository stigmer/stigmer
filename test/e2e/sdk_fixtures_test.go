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
	
	// Target directory in testdata (e.g., "agents/basic-agent")
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
			TestDataDir:    "agents/basic-agent",
			TargetFileName: "main.go",
		},
		// Add more examples as needed:
		// {
		//     SDKFileName:    "02_agent_with_skills.go",
		//     TestDataDir:    "agents/agent-with-skills",
		//     TargetFileName: "main.go",
		// },
		// Workflow examples (for future):
		// {
		//     SDKFileName:    "07_basic_workflow.go",
		//     TestDataDir:    "workflows/basic-workflow",
		//     TargetFileName: "main.go",
		// },
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
