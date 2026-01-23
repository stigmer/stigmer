package workflow

// HttpCallOption is a functional option for configuring an HTTP_CALL task.
type HttpCallOption func(*HttpCallTaskConfig)

// HttpCall creates an HTTP_CALL task with functional options.
// This is the high-level API that wraps the generated HttpCallTask constructor.
//
// Example:
//
//	task := workflow.HttpCall("fetch",
//	    workflow.HTTPMethod("GET"),
//	    workflow.URI("https://api.example.com/data"),
//	    workflow.Header("Authorization", "Bearer ${.token}"),
//	    workflow.Timeout(30),
//	)
func HttpCall(name string, opts ...HttpCallOption) *Task {
	config := &HttpCallTaskConfig{
		Headers: make(map[string]string),
		Body:    make(map[string]interface{}),
	}

	// Apply all options
	for _, opt := range opts {
		opt(config)
	}

	return &Task{
		Name:   name,
		Kind:   TaskKindHttpCall,
		Config: config,
	}
}

// HTTPMethod sets the HTTP method for the request.
//
// Example:
//
//	workflow.HTTPMethod("GET")
//	workflow.HTTPMethod("POST")
func HTTPMethod(method string) HttpCallOption {
	return func(c *HttpCallTaskConfig) {
		c.Method = method
	}
}

// URI sets the HTTP endpoint URI.
//
// Accepts:
//   - String literal: "https://api.example.com"
//   - Expression: "${.baseUrl}/path"
//   - TaskFieldRef: task.Field("url")
//
// Example:
//
//	workflow.URI("https://api.example.com/users")
//	workflow.URI("${.apiBase}/users")
//	workflow.URI(configTask.Field("apiUrl"))
func URI(uri interface{}) HttpCallOption {
	return func(c *HttpCallTaskConfig) {
		c.URI = coerceToString(uri)
	}
}

// Header adds an HTTP header to the request.
//
// Example:
//
//	workflow.Header("Content-Type", "application/json")
//	workflow.Header("Authorization", "Bearer ${.token}")
//	workflow.Header("X-Custom", authTask.Field("token"))
func Header(key, value interface{}) HttpCallOption {
	return func(c *HttpCallTaskConfig) {
		c.Headers[coerceToString(key)] = coerceToString(value)
	}
}

// Headers adds multiple HTTP headers from a map.
//
// Example:
//
//	workflow.Headers(map[string]interface{}{
//	    "Content-Type": "application/json",
//	    "Authorization": "Bearer ${.token}",
//	})
func Headers(headers map[string]interface{}) HttpCallOption {
	return func(c *HttpCallTaskConfig) {
		for key, value := range headers {
			c.Headers[coerceToString(key)] = coerceToString(value)
		}
	}
}

// Body sets the request body.
//
// Example:
//
//	workflow.Body(map[string]any{
//	    "name": "John Doe",
//	    "email": "john@example.com",
//	    "age": 30,
//	})
func Body(body map[string]interface{}) HttpCallOption {
	return func(c *HttpCallTaskConfig) {
		c.Body = body
	}
}

// WithBody is an alias for Body for more concise API.
//
// Example:
//
//	workflow.WithBody(map[string]any{
//	    "name": "John Doe",
//	    "email": "john@example.com",
//	})
func WithBody(body map[string]interface{}) HttpCallOption {
	return Body(body)
}

// Timeout sets the request timeout in seconds.
//
// Example:
//
//	workflow.Timeout(30)  // 30 seconds
func Timeout(seconds int32) HttpCallOption {
	return func(c *HttpCallTaskConfig) {
		c.TimeoutSeconds = seconds
	}
}

// ============================================================================
// Convenience Helpers for Common HTTP Methods
// ============================================================================

// HTTPGet is a convenience helper for setting method to GET.
func HTTPGet() HttpCallOption {
	return HTTPMethod("GET")
}

// HTTPPost is a convenience helper for setting method to POST.
func HTTPPost() HttpCallOption {
	return HTTPMethod("POST")
}

// HTTPPut is a convenience helper for setting method to PUT.
func HTTPPut() HttpCallOption {
	return HTTPMethod("PUT")
}

// HTTPPatch is a convenience helper for setting method to PATCH.
func HTTPPatch() HttpCallOption {
	return HTTPMethod("PATCH")
}

// HTTPDelete is a convenience helper for setting method to DELETE.
func HTTPDelete() HttpCallOption {
	return HTTPMethod("DELETE")
}

// ============================================================================
// Standalone Task Constructors (Non-Workflow Builder Pattern)
// ============================================================================

// HttpGet creates a standalone HTTP GET task (not added to workflow).
//
// Use this when you want to create tasks independently and add them later.
// For workflow builder pattern, use wf.HttpGet() instead.
//
// Example:
//
//	task := workflow.HttpGet("fetch", "https://api.example.com/data",
//	    workflow.Header("Content-Type", "application/json"),
//	)
//	wf.AddTask(task)
func HttpGet(name string, uri interface{}, opts ...HttpCallOption) *Task {
	allOpts := []HttpCallOption{
		HTTPGet(),
		URI(uri),
	}
	allOpts = append(allOpts, opts...)
	return HttpCall(name, allOpts...)
}

// HttpPost creates a standalone HTTP POST task (not added to workflow).
func HttpPost(name string, uri interface{}, opts ...HttpCallOption) *Task {
	allOpts := []HttpCallOption{
		HTTPPost(),
		URI(uri),
	}
	allOpts = append(allOpts, opts...)
	return HttpCall(name, allOpts...)
}

// HttpPut creates a standalone HTTP PUT task (not added to workflow).
func HttpPut(name string, uri interface{}, opts ...HttpCallOption) *Task {
	allOpts := []HttpCallOption{
		HTTPPut(),
		URI(uri),
	}
	allOpts = append(allOpts, opts...)
	return HttpCall(name, allOpts...)
}

// HttpPatch creates a standalone HTTP PATCH task (not added to workflow).
func HttpPatch(name string, uri interface{}, opts ...HttpCallOption) *Task {
	allOpts := []HttpCallOption{
		HTTPPatch(),
		URI(uri),
	}
	allOpts = append(allOpts, opts...)
	return HttpCall(name, allOpts...)
}

// HttpDelete creates a standalone HTTP DELETE task (not added to workflow).
func HttpDelete(name string, uri interface{}, opts ...HttpCallOption) *Task {
	allOpts := []HttpCallOption{
		HTTPDelete(),
		URI(uri),
	}
	allOpts = append(allOpts, opts...)
	return HttpCall(name, allOpts...)
}
