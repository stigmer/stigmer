package types

import (
	"bufio"
	"bytes"
	"os"
	"strings"

	"github.com/pkg/errors"
	"gopkg.in/yaml.v3"
)

// DetectResult contains the result of detecting a YAML kind.
type DetectResult struct {
	// Kind is the YAML kind value (e.g., "McpServer", "Agent").
	Kind string

	// ApiVersion is the YAML apiVersion value (e.g., "agentic.stigmer.ai/v1").
	ApiVersion string

	// FilePath is the path to the file that was detected.
	FilePath string

	// RawContent is the raw YAML content of the document.
	RawContent []byte
}

// yamlHeader is a minimal struct for extracting kind and apiVersion.
type yamlHeader struct {
	Kind       string `yaml:"kind"`
	ApiVersion string `yaml:"apiVersion"`
}

// Detect reads a YAML file and extracts kind/apiVersion without full parsing.
// This is a lightweight detection that doesn't validate the full schema.
func Detect(filePath string) (*DetectResult, error) {
	content, err := os.ReadFile(filePath)
	if err != nil {
		return nil, errors.Wrapf(err, "failed to read file %s", filePath)
	}

	results, err := detectFromContent(content, filePath)
	if err != nil {
		return nil, err
	}

	if len(results) == 0 {
		return nil, errors.Errorf("no YAML documents found in %s", filePath)
	}

	return results[0], nil
}

// DetectMulti handles multi-document YAML files (separated by ---).
// Returns a result for each document that has kind/apiVersion.
func DetectMulti(filePath string) ([]*DetectResult, error) {
	content, err := os.ReadFile(filePath)
	if err != nil {
		return nil, errors.Wrapf(err, "failed to read file %s", filePath)
	}

	return detectFromContent(content, filePath)
}

// detectFromContent extracts kind/apiVersion from YAML content.
// Handles multi-document YAML files.
func detectFromContent(content []byte, filePath string) ([]*DetectResult, error) {
	docs := splitYAMLDocuments(content)
	if len(docs) == 0 {
		return nil, errors.Errorf("no YAML documents found in %s", filePath)
	}

	var results []*DetectResult
	for _, doc := range docs {
		// Skip empty documents
		if len(bytes.TrimSpace(doc)) == 0 {
			continue
		}

		header, err := extractHeader(doc)
		if err != nil {
			// Skip documents that don't have valid YAML
			continue
		}

		// Skip documents without kind
		if header.Kind == "" {
			continue
		}

		results = append(results, &DetectResult{
			Kind:       header.Kind,
			ApiVersion: header.ApiVersion,
			FilePath:   filePath,
			RawContent: doc,
		})
	}

	return results, nil
}

// splitYAMLDocuments splits a YAML file into individual documents.
// Documents are separated by "---" on its own line.
func splitYAMLDocuments(content []byte) [][]byte {
	var docs [][]byte
	var current bytes.Buffer

	scanner := bufio.NewScanner(bytes.NewReader(content))
	for scanner.Scan() {
		line := scanner.Text()
		if strings.TrimSpace(line) == "---" {
			if current.Len() > 0 {
				// Copy bytes to avoid buffer reuse issues
				doc := make([]byte, current.Len())
				copy(doc, current.Bytes())
				docs = append(docs, doc)
				current.Reset()
			}
		} else {
			current.WriteString(line)
			current.WriteString("\n")
		}
	}

	// Don't forget the last document
	if current.Len() > 0 {
		doc := make([]byte, current.Len())
		copy(doc, current.Bytes())
		docs = append(docs, doc)
	}

	// If no separators found, the whole content is one document
	if len(docs) == 0 && len(content) > 0 {
		docs = append(docs, content)
	}

	return docs
}

// extractHeader extracts kind and apiVersion from a YAML document.
func extractHeader(doc []byte) (*yamlHeader, error) {
	var header yamlHeader
	if err := yaml.Unmarshal(doc, &header); err != nil {
		return nil, errors.Wrap(err, "failed to parse YAML header")
	}
	return &header, nil
}

// DetectFromReader reads YAML from a byte slice and extracts kind/apiVersion.
// Useful for content that's already in memory.
func DetectFromReader(content []byte, sourceName string) (*DetectResult, error) {
	results, err := detectFromContent(content, sourceName)
	if err != nil {
		return nil, err
	}

	if len(results) == 0 {
		return nil, errors.Errorf("no YAML documents found in %s", sourceName)
	}

	return results[0], nil
}
