package workflow

// GrpcCallArgs is an alias for GrpcCallTaskConfig (Pulumi-style args pattern).
type GrpcCallArgs = GrpcCallTaskConfig

// GrpcCall creates a GRPC_CALL task using struct-based args.
// This follows the Pulumi Args pattern for resource configuration.
//
// Example:
//
//	task := workflow.GrpcCall("callService", &workflow.GrpcCallArgs{
//	    Service: "userservice",
//	    Method:  "GetUser",
//	    Body:    map[string]interface{}{"id": "123"},
//	})
func GrpcCall(name string, args *GrpcCallArgs) *Task {
	if args == nil {
		args = &GrpcCallArgs{}
	}

	// Initialize maps if nil
	if args.Body == nil {
		args.Body = make(map[string]interface{})
	}

	return &Task{
		Name:   name,
		Kind:   TaskKindGrpcCall,
		Config: args,
	}
}
