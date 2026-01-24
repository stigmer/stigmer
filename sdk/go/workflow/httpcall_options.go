package workflow

import (
	"github.com/stigmer/stigmer/sdk/go/types"
)

// HttpCallArgs is an alias for HttpCallTaskConfig (Pulumi-style args pattern).
type HttpCallArgs = HttpCallTaskConfig

// HttpCall creates an HTTP_CALL task using struct-based args.
// This follows the Pulumi Args pattern for resource configuration.
//
// Example:
//
//	task := workflow.HttpCall("fetch", &workflow.HttpCallArgs{
//	    Method: "GET",
//	    Endpoint: &types.HttpEndpoint{Uri: "https://api.example.com/data"},
//	    Headers: map[string]string{
//	        "Authorization": "Bearer ${.token}",
//	    },
//	    TimeoutSeconds: 30,
//	})
func HttpCall(name string, args *HttpCallArgs) *Task {
	if args == nil {
		args = &HttpCallArgs{}
	}

	// Initialize maps if nil
	if args.Headers == nil {
		args.Headers = make(map[string]string)
	}
	if args.Body == nil {
		args.Body = make(map[string]interface{})
	}

	return &Task{
		Name:   name,
		Kind:   TaskKindHttpCall,
		Config: args,
	}
}

// ============================================================================
// Convenience Constructors for Common HTTP Methods
// ============================================================================

// HttpGet creates an HTTP GET task.
//
// Example:
//
//	task := workflow.HttpGet("fetch", "https://api.example.com/data", map[string]string{
//	    "Authorization": "Bearer ${.token}",
//	})
//
//	// Or with TaskFieldRef:
//	task := workflow.HttpGet("fetch", apiBase.Concat("/data"), nil)
func HttpGet(name string, uri interface{}, headers map[string]string) *Task {
	return HttpCall(name, &HttpCallArgs{
		Method:   "GET",
		Endpoint: &types.HttpEndpoint{Uri: uri},
		Headers:  headers,
	})
}

// HttpPost creates an HTTP POST task.
//
// Example:
//
//	task := workflow.HttpPost("create", "https://api.example.com/users",
//	    map[string]string{"Content-Type": "application/json"},
//	    map[string]interface{}{"name": "John", "email": "john@example.com"},
//	)
//
//	// Or with TaskFieldRef:
//	task := workflow.HttpPost("create", apiBase.Concat("/users"), nil, body)
func HttpPost(name string, uri interface{}, headers map[string]string, body map[string]interface{}) *Task {
	return HttpCall(name, &HttpCallArgs{
		Method:   "POST",
		Endpoint: &types.HttpEndpoint{Uri: uri},
		Headers:  headers,
		Body:     body,
	})
}

// HttpPut creates an HTTP PUT task.
func HttpPut(name string, uri interface{}, headers map[string]string, body map[string]interface{}) *Task {
	return HttpCall(name, &HttpCallArgs{
		Method:   "PUT",
		Endpoint: &types.HttpEndpoint{Uri: uri},
		Headers:  headers,
		Body:     body,
	})
}

// HttpPatch creates an HTTP PATCH task.
func HttpPatch(name string, uri interface{}, headers map[string]string, body map[string]interface{}) *Task {
	return HttpCall(name, &HttpCallArgs{
		Method:   "PATCH",
		Endpoint: &types.HttpEndpoint{Uri: uri},
		Headers:  headers,
		Body:     body,
	})
}

// HttpDelete creates an HTTP DELETE task.
func HttpDelete(name string, uri interface{}, headers map[string]string) *Task {
	return HttpCall(name, &HttpCallArgs{
		Method:   "DELETE",
		Endpoint: &types.HttpEndpoint{Uri: uri},
		Headers:  headers,
	})
}
