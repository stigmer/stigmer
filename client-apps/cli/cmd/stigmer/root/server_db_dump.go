package root

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/dgraph-io/badger/v4"
	"github.com/spf13/cobra"
	"google.golang.org/protobuf/encoding/protojson"
	"google.golang.org/protobuf/proto"

	agentv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agent/v1"
	agentexecutionv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agentexecution/v1"
	agentinstancev1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agentinstance/v1"
	sessionv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/session/v1"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/clierr"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/config"
)

func newServerDbDumpCommand() *cobra.Command {
	var filterType string

	cmd := &cobra.Command{
		Use:   "db-dump",
		Short: "Dump BadgerDB contents (server must be stopped)",
		Long: `Dump all data from the local BadgerDB database.

This command reads the embedded BadgerDB and displays all stored resources 
as human-readable JSON. Useful for debugging and inspecting local state.

⚠️  IMPORTANT: The server MUST be stopped before running this command.
BadgerDB uses file locking - only one process can access it at a time.

If you see "Resource temporarily unavailable" errors:
  1. Stop the server: stigmer server stop
  2. Run this command: stigmer server db-dump
  3. Restart if needed: stigmer server start

Available filters:
  --filter agent              Show only agents
  --filter agent-instance     Show only agent instances  
  --filter agent-execution    Show only agent executions
  --filter session            Show only sessions
  --filter all                Show all keys (raw format)

Examples:
  stigmer server db-dump                      # Show all data
  stigmer server db-dump --filter agent       # Show only agents
  stigmer server db-dump --filter all         # Show all keys`,
		Run: func(cmd *cobra.Command, args []string) {
			handleDbDump(filterType)
		},
	}

	cmd.Flags().StringVarP(&filterType, "filter", "f", "", "Filter by resource type (agent, agent-instance, agent-execution, session, all)")

	return cmd
}

func handleDbDump(filterType string) {
	// Get data directory
	dataDir, err := config.GetDataDir()
	if err != nil {
		fmt.Fprintf(os.Stderr, "❌ Failed to determine data directory: %v\n", err)
		clierr.Handle(err)
		return
	}

	dbPath := filepath.Join(dataDir, "badger")

	// Open BadgerDB in READ-ONLY mode (important!)
	opts := badger.DefaultOptions(dbPath)
	opts.ReadOnly = true
	opts.Logger = nil // Silence internal logs

	fmt.Printf("📂 Opening BadgerDB at: %s\n", dbPath)
	fmt.Printf("   Mode: READ-ONLY\n\n")

	db, err := badger.Open(opts)
	if err != nil {
		fmt.Fprintf(os.Stderr, "\n❌ Failed to open BadgerDB: %v\n\n", err)
		fmt.Fprintf(os.Stderr, "Common causes:\n")
		fmt.Fprintf(os.Stderr, "  • Server is still running (BadgerDB file is locked)\n")
		fmt.Fprintf(os.Stderr, "  • Another process is using the database\n\n")
		fmt.Fprintf(os.Stderr, "Solution:\n")
		fmt.Fprintf(os.Stderr, "  1. Stop the server:  stigmer server stop\n")
		fmt.Fprintf(os.Stderr, "  2. Try again:        stigmer server db-dump\n\n")
		return
	}
	defer db.Close()

	// Iterate through all keys
	err = db.View(func(txn *badger.Txn) error {
		opts := badger.DefaultIteratorOptions
		opts.PrefetchValues = true
		it := txn.NewIterator(opts)
		defer it.Close()

		count := 0
		skipped := 0

		for it.Rewind(); it.Valid(); it.Next() {
			item := it.Item()
			key := string(item.Key())

			// Apply filter if specified
			if filterType != "" && filterType != "all" {
				shouldProcess := matchesFilter(key, filterType)
				if !shouldProcess {
					skipped++
					continue
				}
			}

			err := item.Value(func(val []byte) error {
				count++
				printRecord(key, val, filterType == "all")
				return nil
			})

			if err != nil {
				return err
			}
		}

		// Summary
		fmt.Printf("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n")
		if count == 0 {
			if filterType != "" {
				fmt.Printf("⚠️  No records found for filter: %s\n", filterType)
			} else {
				fmt.Printf("⚠️  Database is empty\n")
			}
		} else {
			fmt.Printf("✓ Total records shown: %d\n", count)
			if skipped > 0 {
				fmt.Printf("  (Skipped %d records due to filter)\n", skipped)
			}
		}

		return nil
	})

	if err != nil {
		fmt.Fprintf(os.Stderr, "❌ Error reading database: %v\n", err)
	}
}

func matchesFilter(key, filterType string) bool {
	switch filterType {
	case "agent":
		return strings.HasPrefix(key, "agent/") && !strings.HasPrefix(key, "agent_")
	case "agent-instance":
		return strings.HasPrefix(key, "agent_instance/")
	case "agent-execution":
		return strings.HasPrefix(key, "agent_execution/")
	case "session":
		return strings.HasPrefix(key, "session/")
	default:
		return true
	}
}

func printRecord(key string, val []byte, rawMode bool) {
	fmt.Printf("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n")
	fmt.Printf("Key: %s\n", key)
	fmt.Printf("Size: %d bytes\n", len(val))
	fmt.Printf("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n")

	if rawMode {
		// For "all" filter, just show key and size
		fmt.Println()
		return
	}

	// Try to deserialize as the appropriate protobuf type
	var unmarshaled bool

	// Detect type from key prefix and unmarshal accordingly
	if strings.HasPrefix(key, "agent/") && !strings.HasPrefix(key, "agent_") {
		agent := &agentv1.Agent{}
		if err := proto.Unmarshal(val, agent); err == nil {
			printProtoAsJSON(agent)
			unmarshaled = true
		}
	} else if strings.HasPrefix(key, "agent_instance/") {
		instance := &agentinstancev1.AgentInstance{}
		if err := proto.Unmarshal(val, instance); err == nil {
			printProtoAsJSON(instance)
			unmarshaled = true
		}
	} else if strings.HasPrefix(key, "agent_execution/") {
		execution := &agentexecutionv1.AgentExecution{}
		if err := proto.Unmarshal(val, execution); err == nil {
			printProtoAsJSON(execution)
			unmarshaled = true
		}
	} else if strings.HasPrefix(key, "session/") {
		session := &sessionv1.Session{}
		if err := proto.Unmarshal(val, session); err == nil {
			printProtoAsJSON(session)
			unmarshaled = true
		}
	}

	if !unmarshaled {
		// Fallback: show raw bytes
		fmt.Printf("⚠️  Unable to unmarshal as known protobuf type\n")
		fmt.Printf("Raw bytes (hex): %x\n", val)
	}

	fmt.Println()
}

func printProtoAsJSON(msg proto.Message) {
	jsonBytes, err := protojson.MarshalOptions{
		Multiline: true,
		Indent:    "  ",
	}.Marshal(msg)

	if err != nil {
		fmt.Printf("⚠️  Failed to convert to JSON: %v\n", err)
		return
	}

	fmt.Println(string(jsonBytes))
}
