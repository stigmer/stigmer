package main

import (
	"fmt"
	"os"

	"google.golang.org/protobuf/encoding/protojson"
	"google.golang.org/protobuf/proto"
	
	agentv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agent/v1"
)

func main() {
	if len(os.Args) < 2 {
		fmt.Println("Usage: go run tools/decode-manifest.go <manifest-file>")
		os.Exit(1)
	}

	manifestPath := os.Args[1]

	// Read the protobuf file
	data, err := os.ReadFile(manifestPath)
	if err != nil {
		panic(fmt.Sprintf("Failed to read manifest: %v", err))
	}

	// Unmarshal as Agent
	agent := &agentv1.Agent{}
	if err := proto.Unmarshal(data, agent); err != nil {
		panic(fmt.Sprintf("Failed to unmarshal agent: %v", err))
	}

	// Print as JSON
	jsonBytes, err := protojson.MarshalOptions{
		Multiline: true,
		Indent:    "  ",
	}.Marshal(agent)
	if err != nil {
		panic(fmt.Sprintf("Failed to marshal to JSON: %v", err))
	}

	fmt.Println(string(jsonBytes))
}
