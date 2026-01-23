package debug

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strings"

	badgerv4 "github.com/dgraph-io/badger/v4"
	"github.com/rs/zerolog/log"
	"google.golang.org/protobuf/encoding/protojson"
	"google.golang.org/protobuf/proto"

	agentv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agent/v1"
	agentexecutionv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agentexecution/v1"
	agentinstancev1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agentinstance/v1"
	sessionv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/session/v1"
	workflowv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/workflow/v1"
	workflowexecutionv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/workflowexecution/v1"
	workflowinstancev1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/workflowinstance/v1"
	"github.com/stigmer/stigmer/backend/libs/go/badger"
)

// StartHTTPServer starts an HTTP server for debugging BadgerDB
// This allows viewing database contents at http://localhost:9999/debug/db
func StartHTTPServer(port int, store *badger.Store) {
	http.HandleFunc("/", handleRoot)
	http.HandleFunc("/debug/db", func(w http.ResponseWriter, r *http.Request) {
		handleDebugDB(w, r, store)
	})
	http.HandleFunc("/debug/db/api", func(w http.ResponseWriter, r *http.Request) {
		handleDebugDBAPI(w, r, store)
	})

	addr := fmt.Sprintf(":%d", port)
	log.Info().Int("port", port).Msg("Starting debug HTTP server")

	go func() {
		if err := http.ListenAndServe(addr, nil); err != nil {
			log.Error().Err(err).Msg("Debug HTTP server failed")
		}
	}()
}

func handleRoot(w http.ResponseWriter, r *http.Request) {
	html := `<!DOCTYPE html>
<html>
<head>
    <title>Stigmer Debug</title>
    <style>
        body { font-family: system-ui; max-width: 800px; margin: 50px auto; padding: 20px; }
        h1 { color: #333; }
        .endpoint { background: #f5f5f5; padding: 15px; margin: 10px 0; border-radius: 5px; }
        .endpoint a { color: #0066cc; text-decoration: none; font-weight: bold; }
        .endpoint a:hover { text-decoration: underline; }
        code { background: #e0e0e0; padding: 2px 6px; border-radius: 3px; }
    </style>
</head>
<body>
    <h1>🔍 Stigmer Debug Server</h1>
    <p>Welcome to the Stigmer debug interface. Available endpoints:</p>
    
    <div class="endpoint">
        <a href="/debug/db">/debug/db</a>
        <p>Interactive web UI for browsing BadgerDB contents</p>
    </div>
    
    <div class="endpoint">
        <a href="/debug/db/api">/debug/db/api</a>
        <p>JSON API for programmatic access</p>
        <p>Query params: <code>?filter=agent|agent-instance|agent-execution|workflow|workflow-instance|workflow-execution|session</code></p>
    </div>
</body>
</html>`
	w.Header().Set("Content-Type", "text/html")
	w.Write([]byte(html))
}

func handleDebugDB(w http.ResponseWriter, r *http.Request, store *badger.Store) {
	filter := r.URL.Query().Get("filter")

	// Get database path from store
	dbPath := "unknown"
	isTestDB := false
	if store != nil && store.DB() != nil {
		dbPath = store.DB().Opts().Dir
		// Check if this is a test database
		isTestDB = strings.Contains(dbPath, "stigmer-e2e-") || strings.Contains(dbPath, "/tmp/")
	}
	
	dbTypeLabel := "Production Database"
	dbTypeColor := "#4ec9b0"
	dbTypeIcon := "🗄️"
	if isTestDB {
		dbTypeLabel = "⚠️ Test Database (Temporary)"
		dbTypeColor = "#dcdcaa"
		dbTypeIcon = "🧪"
	}
	
	html := `<!DOCTYPE html>
<html>
<head>
    <title>BadgerDB Debug</title>
    <style>
        body { 
            font-family: 'Monaco', 'Menlo', 'Consolas', monospace; 
            margin: 0; 
            padding: 20px; 
            background: #1e1e1e; 
            color: #d4d4d4; 
        }
        .header { 
            background: #2d2d30; 
            padding: 20px; 
            margin: -20px -20px 20px -20px; 
            border-bottom: 2px solid #007acc;
        }
        h1 { margin: 0 0 10px 0; color: #007acc; }
        .db-path { 
            background: #252526; 
            padding: 10px; 
            margin: 10px 0; 
            border-radius: 3px; 
            font-size: 12px; 
            color: #858585;
            border-left: 3px solid ` + dbTypeColor + `;
        }
        .db-path strong { color: ` + dbTypeColor + `; }
        .db-type { 
            font-weight: bold; 
            color: ` + dbTypeColor + `; 
            font-size: 14px; 
            margin-bottom: 5px;
        }
        .filters { margin: 15px 0; }
        .filter-btn { 
            background: #3c3c3c; 
            border: 1px solid #555; 
            color: #d4d4d4; 
            padding: 8px 16px; 
            margin-right: 10px; 
            cursor: pointer; 
            border-radius: 3px;
            text-decoration: none;
            display: inline-block;
        }
        .filter-btn:hover { background: #505050; }
        .filter-btn.active { background: #007acc; border-color: #007acc; }
        .record { 
            background: #2d2d30; 
            margin: 20px 0; 
            padding: 15px; 
            border-radius: 5px; 
            border-left: 4px solid #007acc;
        }
        .key { 
            color: #4ec9b0; 
            font-weight: bold; 
            margin-bottom: 10px; 
            font-size: 14px;
        }
        .size { 
            color: #858585; 
            font-size: 12px; 
            margin-bottom: 10px;
        }
        .json { 
            background: #1e1e1e; 
            padding: 12px; 
            border-radius: 3px; 
            overflow-x: auto; 
            font-size: 13px;
            line-height: 1.6;
        }
        .summary { 
            background: #2d2d30; 
            padding: 15px; 
            margin: 20px 0; 
            border-radius: 5px;
            text-align: center;
            color: #4ec9b0;
            font-weight: bold;
        }
        .error { color: #f48771; }
        .loading { text-align: center; padding: 40px; color: #858585; }
    </style>
</head>
<body>
    <div class="header">
        <h1>📂 BadgerDB Inspector</h1>
        <p>Live view of embedded database contents</p>
        <div class="db-path">
            <div class="db-type">` + dbTypeIcon + ` ` + dbTypeLabel + `</div>
            <strong>Location:</strong> ` + dbPath + `
        </div>
        <div class="filters">
            <a href="/debug/db" class="filter-btn ` + activeClass(filter, "") + `">All</a>
            <a href="/debug/db?filter=agent" class="filter-btn ` + activeClass(filter, "agent") + `">Agents</a>
            <a href="/debug/db?filter=agent-instance" class="filter-btn ` + activeClass(filter, "agent-instance") + `">Agent Instances</a>
            <a href="/debug/db?filter=agent-execution" class="filter-btn ` + activeClass(filter, "agent-execution") + `">Agent Executions</a>
            <a href="/debug/db?filter=workflow" class="filter-btn ` + activeClass(filter, "workflow") + `">Workflows</a>
            <a href="/debug/db?filter=workflow-instance" class="filter-btn ` + activeClass(filter, "workflow-instance") + `">Workflow Instances</a>
            <a href="/debug/db?filter=workflow-execution" class="filter-btn ` + activeClass(filter, "workflow-execution") + `">Workflow Executions</a>
            <a href="/debug/db?filter=session" class="filter-btn ` + activeClass(filter, "session") + `">Sessions</a>
        </div>
    </div>
    <div id="content" class="loading">Loading database contents...</div>
    <script>
        fetch('/debug/db/api?filter=` + filter + `')
            .then(r => r.json())
            .then(data => {
                let html = '';
                if (data.records.length === 0) {
                    html = '<div class="summary">⚠️ No records found</div>';
                } else {
                    data.records.forEach(record => {
                        html += '<div class="record">';
                        html += '<div class="key">' + escapeHtml(record.key) + '</div>';
                        html += '<div class="size">' + record.size + ' bytes</div>';
                        if (record.error) {
                            html += '<div class="json error">⚠️ ' + escapeHtml(record.error) + '</div>';
                        } else {
                            html += '<div class="json">' + syntaxHighlight(record.value) + '</div>';
                        }
                        html += '</div>';
                    });
                    html += '<div class="summary">✓ Total: ' + data.count + ' records</div>';
                }
                document.getElementById('content').innerHTML = html;
            })
            .catch(err => {
                document.getElementById('content').innerHTML = '<div class="error">Failed to load: ' + err + '</div>';
            });

        function escapeHtml(text) {
            const div = document.createElement('div');
            div.textContent = text;
            return div.innerHTML;
        }

        function syntaxHighlight(json) {
            json = JSON.stringify(json, null, 2);
            json = json.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
            return json.replace(/("(\\u[a-zA-Z0-9]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d*)?(?:[eE][+\-]?\d+)?)/g, function (match) {
                let cls = 'number';
                if (/^"/.test(match)) {
                    if (/:$/.test(match)) {
                        cls = 'key';
                        return '<span style="color: #9cdcfe;">' + match + '</span>';
                    } else {
                        cls = 'string';
                        return '<span style="color: #ce9178;">' + match + '</span>';
                    }
                } else if (/true|false/.test(match)) {
                    cls = 'boolean';
                    return '<span style="color: #569cd6;">' + match + '</span>';
                } else if (/null/.test(match)) {
                    cls = 'null';
                    return '<span style="color: #569cd6;">' + match + '</span>';
                }
                return '<span style="color: #b5cea8;">' + match + '</span>';
            });
        }
    </script>
</body>
</html>`
	w.Header().Set("Content-Type", "text/html")
	w.Write([]byte(html))
}

func activeClass(current, target string) string {
	if current == target {
		return "active"
	}
	return ""
}

func handleDebugDBAPI(w http.ResponseWriter, r *http.Request, store *badger.Store) {
	filter := r.URL.Query().Get("filter")

	type Record struct {
		Key   string      `json:"key"`
		Size  int         `json:"size"`
		Value interface{} `json:"value,omitempty"`
		Error string      `json:"error,omitempty"`
	}

	type Response struct {
		Count   int      `json:"count"`
		Records []Record `json:"records"`
	}

	response := Response{Records: []Record{}}

	err := store.DB().View(func(txn *badgerv4.Txn) error {
		opts := badgerv4.DefaultIteratorOptions
		opts.PrefetchValues = true
		it := txn.NewIterator(opts)
		defer it.Close()

		for it.Rewind(); it.Valid(); it.Next() {
			item := it.Item()
			key := string(item.Key())

			// Apply filter
			if filter != "" {
				if !matchesFilter(key, filter) {
					continue
				}
			}

			err := item.Value(func(val []byte) error {
				record := Record{
					Key:  key,
					Size: len(val),
				}

				// Try to unmarshal as proto
				value, err := unmarshalProto(key, val)
				if err != nil {
					record.Error = err.Error()
				} else {
					record.Value = value
				}

				response.Records = append(response.Records, record)
				return nil
			})

			if err != nil {
				return err
			}
		}

		response.Count = len(response.Records)
		return nil
	})

	if err != nil {
		// Return JSON error response (frontend expects JSON)
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(Response{
			Count: 0,
			Records: []Record{{
				Key:   "error",
				Size:  0,
				Error: fmt.Sprintf("Database error: %v", err),
			}},
		})
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(response)
}

func matchesFilter(key, filter string) bool {
	switch filter {
	case "agent":
		return strings.HasPrefix(key, "agent/") && !strings.HasPrefix(key, "agent_")
	case "agent-instance":
		return strings.HasPrefix(key, "agent_instance/")
	case "agent-execution":
		return strings.HasPrefix(key, "agent_execution/")
	case "workflow":
		return strings.HasPrefix(key, "workflow/") && !strings.HasPrefix(key, "workflow_")
	case "workflow-instance":
		return strings.HasPrefix(key, "workflow_instance/")
	case "workflow-execution":
		return strings.HasPrefix(key, "workflow_execution/")
	case "session":
		return strings.HasPrefix(key, "session/")
	default:
		return true
	}
}

func unmarshalProto(key string, val []byte) (interface{}, error) {
	var msg proto.Message

	// Detect type from key prefix
	if strings.HasPrefix(key, "agent/") && !strings.HasPrefix(key, "agent_") {
		msg = &agentv1.Agent{}
	} else if strings.HasPrefix(key, "agent_instance/") {
		msg = &agentinstancev1.AgentInstance{}
	} else if strings.HasPrefix(key, "agent_execution/") {
		msg = &agentexecutionv1.AgentExecution{}
	} else if strings.HasPrefix(key, "workflow/") && !strings.HasPrefix(key, "workflow_") {
		msg = &workflowv1.Workflow{}
	} else if strings.HasPrefix(key, "workflow_instance/") {
		msg = &workflowinstancev1.WorkflowInstance{}
	} else if strings.HasPrefix(key, "workflow_execution/") {
		msg = &workflowexecutionv1.WorkflowExecution{}
	} else if strings.HasPrefix(key, "session/") {
		msg = &sessionv1.Session{}
	} else {
		return nil, fmt.Errorf("unknown key prefix: %s", key)
	}

	if err := proto.Unmarshal(val, msg); err != nil {
		return nil, fmt.Errorf("failed to unmarshal: %v", err)
	}

	// Convert to JSON-friendly map
	jsonBytes, err := protojson.Marshal(msg)
	if err != nil {
		return nil, fmt.Errorf("failed to marshal to JSON: %v", err)
	}

	var result interface{}
	if err := json.Unmarshal(jsonBytes, &result); err != nil {
		return nil, fmt.Errorf("failed to unmarshal JSON: %v", err)
	}

	return result, nil
}
