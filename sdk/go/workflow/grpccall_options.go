package workflow

// GrpcCallOption is a functional option for configuring a GRPC_CALL task.
type GrpcCallOption func(*GrpcCallTaskConfig)

// GrpcCall creates a GRPC_CALL task with functional options.
//
// Example:
//
//	task := workflow.GrpcCall("callService",
//	    workflow.Service("userservice"),
//	    workflow.GrpcMethod("GetUser"),
//	    workflow.GrpcBody(map[string]interface{}{"id": "123"}),
//	)
func GrpcCall(name string, opts ...GrpcCallOption) *Task {
	config := &GrpcCallTaskConfig{
		Body: make(map[string]interface{}),
	}

	for _, opt := range opts {
		opt(config)
	}

	return &Task{
		Name:   name,
		Kind:   TaskKindGrpcCall,
		Config: config,
	}
}

// Service sets the gRPC service name.
func Service(service string) GrpcCallOption {
	return func(c *GrpcCallTaskConfig) {
		c.Service = service
	}
}

// GrpcMethod sets the gRPC method name.
func GrpcMethod(method string) GrpcCallOption {
	return func(c *GrpcCallTaskConfig) {
		c.Method = method
	}
}

// GrpcBody sets the request body (proto message as JSON).
func GrpcBody(body map[string]interface{}) GrpcCallOption {
	return func(c *GrpcCallTaskConfig) {
		c.Body = body
	}
}
