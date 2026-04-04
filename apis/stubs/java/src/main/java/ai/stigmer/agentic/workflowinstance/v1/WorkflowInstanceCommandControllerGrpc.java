package ai.stigmer.agentic.workflowinstance.v1;

import static io.grpc.MethodDescriptor.generateFullMethodName;

/**
 * <pre>
 * WorkflowInstanceCommandController handles write operations (Create, Update, Delete) for WorkflowInstance resources.
 * This service provides the CUD (Create, Update, Delete) operations following the
 * Command-Query Separation pattern. All RPCs that modify state go through this controller.
 * Authorization:
 * - create: Custom authorization logic (validates workflow_id access, environment_refs access)
 * - update: Standard authorization (requires update permission on the instance)
 * - delete: Standard authorization (requires delete permission on the instance)
 * All workflow instances belong to an organization.
 * </pre>
 */
@io.grpc.stub.annotations.GrpcGenerated
public final class WorkflowInstanceCommandControllerGrpc {

  private WorkflowInstanceCommandControllerGrpc() {}

  public static final java.lang.String SERVICE_NAME = "ai.stigmer.agentic.workflowinstance.v1.WorkflowInstanceCommandController";

  // Static method descriptors that strictly reflect the proto.
  private static volatile io.grpc.MethodDescriptor<ai.stigmer.agentic.workflowinstance.v1.WorkflowInstance,
      ai.stigmer.agentic.workflowinstance.v1.WorkflowInstance> getApplyMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "apply",
      requestType = ai.stigmer.agentic.workflowinstance.v1.WorkflowInstance.class,
      responseType = ai.stigmer.agentic.workflowinstance.v1.WorkflowInstance.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.agentic.workflowinstance.v1.WorkflowInstance,
      ai.stigmer.agentic.workflowinstance.v1.WorkflowInstance> getApplyMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.agentic.workflowinstance.v1.WorkflowInstance, ai.stigmer.agentic.workflowinstance.v1.WorkflowInstance> getApplyMethod;
    if ((getApplyMethod = WorkflowInstanceCommandControllerGrpc.getApplyMethod) == null) {
      synchronized (WorkflowInstanceCommandControllerGrpc.class) {
        if ((getApplyMethod = WorkflowInstanceCommandControllerGrpc.getApplyMethod) == null) {
          WorkflowInstanceCommandControllerGrpc.getApplyMethod = getApplyMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.agentic.workflowinstance.v1.WorkflowInstance, ai.stigmer.agentic.workflowinstance.v1.WorkflowInstance>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "apply"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.workflowinstance.v1.WorkflowInstance.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.workflowinstance.v1.WorkflowInstance.getDefaultInstance()))
              .setSchemaDescriptor(new WorkflowInstanceCommandControllerMethodDescriptorSupplier("apply"))
              .build();
        }
      }
    }
    return getApplyMethod;
  }

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.agentic.workflowinstance.v1.WorkflowInstance,
      ai.stigmer.agentic.workflowinstance.v1.WorkflowInstance> getCreateMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "create",
      requestType = ai.stigmer.agentic.workflowinstance.v1.WorkflowInstance.class,
      responseType = ai.stigmer.agentic.workflowinstance.v1.WorkflowInstance.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.agentic.workflowinstance.v1.WorkflowInstance,
      ai.stigmer.agentic.workflowinstance.v1.WorkflowInstance> getCreateMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.agentic.workflowinstance.v1.WorkflowInstance, ai.stigmer.agentic.workflowinstance.v1.WorkflowInstance> getCreateMethod;
    if ((getCreateMethod = WorkflowInstanceCommandControllerGrpc.getCreateMethod) == null) {
      synchronized (WorkflowInstanceCommandControllerGrpc.class) {
        if ((getCreateMethod = WorkflowInstanceCommandControllerGrpc.getCreateMethod) == null) {
          WorkflowInstanceCommandControllerGrpc.getCreateMethod = getCreateMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.agentic.workflowinstance.v1.WorkflowInstance, ai.stigmer.agentic.workflowinstance.v1.WorkflowInstance>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "create"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.workflowinstance.v1.WorkflowInstance.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.workflowinstance.v1.WorkflowInstance.getDefaultInstance()))
              .setSchemaDescriptor(new WorkflowInstanceCommandControllerMethodDescriptorSupplier("create"))
              .build();
        }
      }
    }
    return getCreateMethod;
  }

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.agentic.workflowinstance.v1.WorkflowInstance,
      ai.stigmer.agentic.workflowinstance.v1.WorkflowInstance> getUpdateMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "update",
      requestType = ai.stigmer.agentic.workflowinstance.v1.WorkflowInstance.class,
      responseType = ai.stigmer.agentic.workflowinstance.v1.WorkflowInstance.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.agentic.workflowinstance.v1.WorkflowInstance,
      ai.stigmer.agentic.workflowinstance.v1.WorkflowInstance> getUpdateMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.agentic.workflowinstance.v1.WorkflowInstance, ai.stigmer.agentic.workflowinstance.v1.WorkflowInstance> getUpdateMethod;
    if ((getUpdateMethod = WorkflowInstanceCommandControllerGrpc.getUpdateMethod) == null) {
      synchronized (WorkflowInstanceCommandControllerGrpc.class) {
        if ((getUpdateMethod = WorkflowInstanceCommandControllerGrpc.getUpdateMethod) == null) {
          WorkflowInstanceCommandControllerGrpc.getUpdateMethod = getUpdateMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.agentic.workflowinstance.v1.WorkflowInstance, ai.stigmer.agentic.workflowinstance.v1.WorkflowInstance>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "update"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.workflowinstance.v1.WorkflowInstance.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.workflowinstance.v1.WorkflowInstance.getDefaultInstance()))
              .setSchemaDescriptor(new WorkflowInstanceCommandControllerMethodDescriptorSupplier("update"))
              .build();
        }
      }
    }
    return getUpdateMethod;
  }

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.agentic.workflowinstance.v1.WorkflowInstanceId,
      ai.stigmer.agentic.workflowinstance.v1.WorkflowInstance> getDeleteMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "delete",
      requestType = ai.stigmer.agentic.workflowinstance.v1.WorkflowInstanceId.class,
      responseType = ai.stigmer.agentic.workflowinstance.v1.WorkflowInstance.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.agentic.workflowinstance.v1.WorkflowInstanceId,
      ai.stigmer.agentic.workflowinstance.v1.WorkflowInstance> getDeleteMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.agentic.workflowinstance.v1.WorkflowInstanceId, ai.stigmer.agentic.workflowinstance.v1.WorkflowInstance> getDeleteMethod;
    if ((getDeleteMethod = WorkflowInstanceCommandControllerGrpc.getDeleteMethod) == null) {
      synchronized (WorkflowInstanceCommandControllerGrpc.class) {
        if ((getDeleteMethod = WorkflowInstanceCommandControllerGrpc.getDeleteMethod) == null) {
          WorkflowInstanceCommandControllerGrpc.getDeleteMethod = getDeleteMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.agentic.workflowinstance.v1.WorkflowInstanceId, ai.stigmer.agentic.workflowinstance.v1.WorkflowInstance>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "delete"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.workflowinstance.v1.WorkflowInstanceId.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.workflowinstance.v1.WorkflowInstance.getDefaultInstance()))
              .setSchemaDescriptor(new WorkflowInstanceCommandControllerMethodDescriptorSupplier("delete"))
              .build();
        }
      }
    }
    return getDeleteMethod;
  }

  /**
   * Creates a new async stub that supports all call types for the service
   */
  public static WorkflowInstanceCommandControllerStub newStub(io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<WorkflowInstanceCommandControllerStub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<WorkflowInstanceCommandControllerStub>() {
        @java.lang.Override
        public WorkflowInstanceCommandControllerStub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new WorkflowInstanceCommandControllerStub(channel, callOptions);
        }
      };
    return WorkflowInstanceCommandControllerStub.newStub(factory, channel);
  }

  /**
   * Creates a new blocking-style stub that supports all types of calls on the service
   */
  public static WorkflowInstanceCommandControllerBlockingV2Stub newBlockingV2Stub(
      io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<WorkflowInstanceCommandControllerBlockingV2Stub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<WorkflowInstanceCommandControllerBlockingV2Stub>() {
        @java.lang.Override
        public WorkflowInstanceCommandControllerBlockingV2Stub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new WorkflowInstanceCommandControllerBlockingV2Stub(channel, callOptions);
        }
      };
    return WorkflowInstanceCommandControllerBlockingV2Stub.newStub(factory, channel);
  }

  /**
   * Creates a new blocking-style stub that supports unary and streaming output calls on the service
   */
  public static WorkflowInstanceCommandControllerBlockingStub newBlockingStub(
      io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<WorkflowInstanceCommandControllerBlockingStub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<WorkflowInstanceCommandControllerBlockingStub>() {
        @java.lang.Override
        public WorkflowInstanceCommandControllerBlockingStub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new WorkflowInstanceCommandControllerBlockingStub(channel, callOptions);
        }
      };
    return WorkflowInstanceCommandControllerBlockingStub.newStub(factory, channel);
  }

  /**
   * Creates a new ListenableFuture-style stub that supports unary calls on the service
   */
  public static WorkflowInstanceCommandControllerFutureStub newFutureStub(
      io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<WorkflowInstanceCommandControllerFutureStub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<WorkflowInstanceCommandControllerFutureStub>() {
        @java.lang.Override
        public WorkflowInstanceCommandControllerFutureStub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new WorkflowInstanceCommandControllerFutureStub(channel, callOptions);
        }
      };
    return WorkflowInstanceCommandControllerFutureStub.newStub(factory, channel);
  }

  /**
   * <pre>
   * WorkflowInstanceCommandController handles write operations (Create, Update, Delete) for WorkflowInstance resources.
   * This service provides the CUD (Create, Update, Delete) operations following the
   * Command-Query Separation pattern. All RPCs that modify state go through this controller.
   * Authorization:
   * - create: Custom authorization logic (validates workflow_id access, environment_refs access)
   * - update: Standard authorization (requires update permission on the instance)
   * - delete: Standard authorization (requires delete permission on the instance)
   * All workflow instances belong to an organization.
   * </pre>
   */
  public interface AsyncService {

    /**
     * <pre>
     * Create or update a workflow instance.
     * The authorization and state-operation are determined depending on whether the workflow instance
     * is going to be created or updated which is determined as part of the request execution.
     * </pre>
     */
    default void apply(ai.stigmer.agentic.workflowinstance.v1.WorkflowInstance request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.workflowinstance.v1.WorkflowInstance> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getApplyMethod(), responseObserver);
    }

    /**
     * <pre>
     * Create a new workflow instance.
     * Creates a configured deployment of a Workflow template with environment bindings.
     * Input validation:
     * - metadata.org must be specified
     * - spec.workflow_id must be a valid Workflow resource ID
     * - spec.environment_refs must reference valid Environment resources
     * Authorization:
     * Uses custom authorization logic to verify:
     * 1. User has permission to access the referenced Workflow template
     * 2. User has permission to access all referenced Environment resources
     * 3. Owner scope is valid for the user's organization/identity
     * Returns:
     * The created WorkflowInstance with:
     * - Assigned resource ID (metadata.id)
     * - Created timestamp (status.audit.created_at)
     * - Initial version (status.audit.version = 1)
     * Example:
     * Input: WorkflowInstance with workflow_id="wfl_123", environment_refs=["env_prod"]
     * Output: WorkflowInstance with id="wfi_abc456", created_at="2025-01-11T10:00:00Z"
     * </pre>
     */
    default void create(ai.stigmer.agentic.workflowinstance.v1.WorkflowInstance request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.workflowinstance.v1.WorkflowInstance> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getCreateMethod(), responseObserver);
    }

    /**
     * <pre>
     * Update an existing workflow instance.
     * Modifies the configuration of an existing WorkflowInstance.
     * You can update:
     * - spec.description (change descriptive text)
     * - spec.environment_refs (add/remove/reorder environment bindings)
     * - metadata.labels, metadata.tags, metadata.annotations
     * You cannot update:
     * - spec.workflow_id (must delete and recreate to change template)
     * - metadata.id (immutable resource identifier)
     * - metadata.org (immutable after creation)
     * Authorization:
     * Requires "update" permission on the specific WorkflowInstance resource.
     * Field path "metadata.id" identifies which resource to authorize.
     * Versioning:
     * Each update increments status.audit.version and updates status.audit.updated_at.
     * Returns:
     * The updated WorkflowInstance with:
     * - Incremented version number
     * - Updated timestamp
     * - Modified spec fields
     * Error: PERMISSION_DENIED if user lacks update permission
     * </pre>
     */
    default void update(ai.stigmer.agentic.workflowinstance.v1.WorkflowInstance request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.workflowinstance.v1.WorkflowInstance> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getUpdateMethod(), responseObserver);
    }

    /**
     * <pre>
     * Delete a workflow instance.
     * Permanently removes a WorkflowInstance resource.
     * Important:
     * - Deletion is permanent and cannot be undone
     * - Does NOT delete the referenced Workflow template (templates are reusable)
     * - Does NOT delete the referenced Environment resources (environments are reusable)
     * - DOES cascade delete any dependent WorkflowExecution resources (executions belong to instance)
     * Authorization:
     * Requires "delete" permission on the specific WorkflowInstance resource.
     * Field path "value" extracts the resource ID from WorkflowInstanceId wrapper.
     * Use Cases:
     * - Remove deprecated instances
     * - Clean up test/dev instances
     * - Decommission old deployment configurations
     * Returns:
     * The deleted WorkflowInstance (final state before deletion).
     * Useful for audit logs and confirming what was deleted.
     * Error: PERMISSION_DENIED if user lacks delete permission
     * Error: NOT_FOUND if instance ID doesn't exist
     * </pre>
     */
    default void delete(ai.stigmer.agentic.workflowinstance.v1.WorkflowInstanceId request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.workflowinstance.v1.WorkflowInstance> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getDeleteMethod(), responseObserver);
    }
  }

  /**
   * Base class for the server implementation of the service WorkflowInstanceCommandController.
   * <pre>
   * WorkflowInstanceCommandController handles write operations (Create, Update, Delete) for WorkflowInstance resources.
   * This service provides the CUD (Create, Update, Delete) operations following the
   * Command-Query Separation pattern. All RPCs that modify state go through this controller.
   * Authorization:
   * - create: Custom authorization logic (validates workflow_id access, environment_refs access)
   * - update: Standard authorization (requires update permission on the instance)
   * - delete: Standard authorization (requires delete permission on the instance)
   * All workflow instances belong to an organization.
   * </pre>
   */
  public static abstract class WorkflowInstanceCommandControllerImplBase
      implements io.grpc.BindableService, AsyncService {

    @java.lang.Override public final io.grpc.ServerServiceDefinition bindService() {
      return WorkflowInstanceCommandControllerGrpc.bindService(this);
    }
  }

  /**
   * A stub to allow clients to do asynchronous rpc calls to service WorkflowInstanceCommandController.
   * <pre>
   * WorkflowInstanceCommandController handles write operations (Create, Update, Delete) for WorkflowInstance resources.
   * This service provides the CUD (Create, Update, Delete) operations following the
   * Command-Query Separation pattern. All RPCs that modify state go through this controller.
   * Authorization:
   * - create: Custom authorization logic (validates workflow_id access, environment_refs access)
   * - update: Standard authorization (requires update permission on the instance)
   * - delete: Standard authorization (requires delete permission on the instance)
   * All workflow instances belong to an organization.
   * </pre>
   */
  public static final class WorkflowInstanceCommandControllerStub
      extends io.grpc.stub.AbstractAsyncStub<WorkflowInstanceCommandControllerStub> {
    private WorkflowInstanceCommandControllerStub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected WorkflowInstanceCommandControllerStub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new WorkflowInstanceCommandControllerStub(channel, callOptions);
    }

    /**
     * <pre>
     * Create or update a workflow instance.
     * The authorization and state-operation are determined depending on whether the workflow instance
     * is going to be created or updated which is determined as part of the request execution.
     * </pre>
     */
    public void apply(ai.stigmer.agentic.workflowinstance.v1.WorkflowInstance request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.workflowinstance.v1.WorkflowInstance> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getApplyMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * Create a new workflow instance.
     * Creates a configured deployment of a Workflow template with environment bindings.
     * Input validation:
     * - metadata.org must be specified
     * - spec.workflow_id must be a valid Workflow resource ID
     * - spec.environment_refs must reference valid Environment resources
     * Authorization:
     * Uses custom authorization logic to verify:
     * 1. User has permission to access the referenced Workflow template
     * 2. User has permission to access all referenced Environment resources
     * 3. Owner scope is valid for the user's organization/identity
     * Returns:
     * The created WorkflowInstance with:
     * - Assigned resource ID (metadata.id)
     * - Created timestamp (status.audit.created_at)
     * - Initial version (status.audit.version = 1)
     * Example:
     * Input: WorkflowInstance with workflow_id="wfl_123", environment_refs=["env_prod"]
     * Output: WorkflowInstance with id="wfi_abc456", created_at="2025-01-11T10:00:00Z"
     * </pre>
     */
    public void create(ai.stigmer.agentic.workflowinstance.v1.WorkflowInstance request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.workflowinstance.v1.WorkflowInstance> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getCreateMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * Update an existing workflow instance.
     * Modifies the configuration of an existing WorkflowInstance.
     * You can update:
     * - spec.description (change descriptive text)
     * - spec.environment_refs (add/remove/reorder environment bindings)
     * - metadata.labels, metadata.tags, metadata.annotations
     * You cannot update:
     * - spec.workflow_id (must delete and recreate to change template)
     * - metadata.id (immutable resource identifier)
     * - metadata.org (immutable after creation)
     * Authorization:
     * Requires "update" permission on the specific WorkflowInstance resource.
     * Field path "metadata.id" identifies which resource to authorize.
     * Versioning:
     * Each update increments status.audit.version and updates status.audit.updated_at.
     * Returns:
     * The updated WorkflowInstance with:
     * - Incremented version number
     * - Updated timestamp
     * - Modified spec fields
     * Error: PERMISSION_DENIED if user lacks update permission
     * </pre>
     */
    public void update(ai.stigmer.agentic.workflowinstance.v1.WorkflowInstance request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.workflowinstance.v1.WorkflowInstance> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getUpdateMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * Delete a workflow instance.
     * Permanently removes a WorkflowInstance resource.
     * Important:
     * - Deletion is permanent and cannot be undone
     * - Does NOT delete the referenced Workflow template (templates are reusable)
     * - Does NOT delete the referenced Environment resources (environments are reusable)
     * - DOES cascade delete any dependent WorkflowExecution resources (executions belong to instance)
     * Authorization:
     * Requires "delete" permission on the specific WorkflowInstance resource.
     * Field path "value" extracts the resource ID from WorkflowInstanceId wrapper.
     * Use Cases:
     * - Remove deprecated instances
     * - Clean up test/dev instances
     * - Decommission old deployment configurations
     * Returns:
     * The deleted WorkflowInstance (final state before deletion).
     * Useful for audit logs and confirming what was deleted.
     * Error: PERMISSION_DENIED if user lacks delete permission
     * Error: NOT_FOUND if instance ID doesn't exist
     * </pre>
     */
    public void delete(ai.stigmer.agentic.workflowinstance.v1.WorkflowInstanceId request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.workflowinstance.v1.WorkflowInstance> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getDeleteMethod(), getCallOptions()), request, responseObserver);
    }
  }

  /**
   * A stub to allow clients to do synchronous rpc calls to service WorkflowInstanceCommandController.
   * <pre>
   * WorkflowInstanceCommandController handles write operations (Create, Update, Delete) for WorkflowInstance resources.
   * This service provides the CUD (Create, Update, Delete) operations following the
   * Command-Query Separation pattern. All RPCs that modify state go through this controller.
   * Authorization:
   * - create: Custom authorization logic (validates workflow_id access, environment_refs access)
   * - update: Standard authorization (requires update permission on the instance)
   * - delete: Standard authorization (requires delete permission on the instance)
   * All workflow instances belong to an organization.
   * </pre>
   */
  public static final class WorkflowInstanceCommandControllerBlockingV2Stub
      extends io.grpc.stub.AbstractBlockingStub<WorkflowInstanceCommandControllerBlockingV2Stub> {
    private WorkflowInstanceCommandControllerBlockingV2Stub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected WorkflowInstanceCommandControllerBlockingV2Stub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new WorkflowInstanceCommandControllerBlockingV2Stub(channel, callOptions);
    }

    /**
     * <pre>
     * Create or update a workflow instance.
     * The authorization and state-operation are determined depending on whether the workflow instance
     * is going to be created or updated which is determined as part of the request execution.
     * </pre>
     */
    public ai.stigmer.agentic.workflowinstance.v1.WorkflowInstance apply(ai.stigmer.agentic.workflowinstance.v1.WorkflowInstance request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getApplyMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Create a new workflow instance.
     * Creates a configured deployment of a Workflow template with environment bindings.
     * Input validation:
     * - metadata.org must be specified
     * - spec.workflow_id must be a valid Workflow resource ID
     * - spec.environment_refs must reference valid Environment resources
     * Authorization:
     * Uses custom authorization logic to verify:
     * 1. User has permission to access the referenced Workflow template
     * 2. User has permission to access all referenced Environment resources
     * 3. Owner scope is valid for the user's organization/identity
     * Returns:
     * The created WorkflowInstance with:
     * - Assigned resource ID (metadata.id)
     * - Created timestamp (status.audit.created_at)
     * - Initial version (status.audit.version = 1)
     * Example:
     * Input: WorkflowInstance with workflow_id="wfl_123", environment_refs=["env_prod"]
     * Output: WorkflowInstance with id="wfi_abc456", created_at="2025-01-11T10:00:00Z"
     * </pre>
     */
    public ai.stigmer.agentic.workflowinstance.v1.WorkflowInstance create(ai.stigmer.agentic.workflowinstance.v1.WorkflowInstance request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getCreateMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Update an existing workflow instance.
     * Modifies the configuration of an existing WorkflowInstance.
     * You can update:
     * - spec.description (change descriptive text)
     * - spec.environment_refs (add/remove/reorder environment bindings)
     * - metadata.labels, metadata.tags, metadata.annotations
     * You cannot update:
     * - spec.workflow_id (must delete and recreate to change template)
     * - metadata.id (immutable resource identifier)
     * - metadata.org (immutable after creation)
     * Authorization:
     * Requires "update" permission on the specific WorkflowInstance resource.
     * Field path "metadata.id" identifies which resource to authorize.
     * Versioning:
     * Each update increments status.audit.version and updates status.audit.updated_at.
     * Returns:
     * The updated WorkflowInstance with:
     * - Incremented version number
     * - Updated timestamp
     * - Modified spec fields
     * Error: PERMISSION_DENIED if user lacks update permission
     * </pre>
     */
    public ai.stigmer.agentic.workflowinstance.v1.WorkflowInstance update(ai.stigmer.agentic.workflowinstance.v1.WorkflowInstance request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getUpdateMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Delete a workflow instance.
     * Permanently removes a WorkflowInstance resource.
     * Important:
     * - Deletion is permanent and cannot be undone
     * - Does NOT delete the referenced Workflow template (templates are reusable)
     * - Does NOT delete the referenced Environment resources (environments are reusable)
     * - DOES cascade delete any dependent WorkflowExecution resources (executions belong to instance)
     * Authorization:
     * Requires "delete" permission on the specific WorkflowInstance resource.
     * Field path "value" extracts the resource ID from WorkflowInstanceId wrapper.
     * Use Cases:
     * - Remove deprecated instances
     * - Clean up test/dev instances
     * - Decommission old deployment configurations
     * Returns:
     * The deleted WorkflowInstance (final state before deletion).
     * Useful for audit logs and confirming what was deleted.
     * Error: PERMISSION_DENIED if user lacks delete permission
     * Error: NOT_FOUND if instance ID doesn't exist
     * </pre>
     */
    public ai.stigmer.agentic.workflowinstance.v1.WorkflowInstance delete(ai.stigmer.agentic.workflowinstance.v1.WorkflowInstanceId request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getDeleteMethod(), getCallOptions(), request);
    }
  }

  /**
   * A stub to allow clients to do limited synchronous rpc calls to service WorkflowInstanceCommandController.
   * <pre>
   * WorkflowInstanceCommandController handles write operations (Create, Update, Delete) for WorkflowInstance resources.
   * This service provides the CUD (Create, Update, Delete) operations following the
   * Command-Query Separation pattern. All RPCs that modify state go through this controller.
   * Authorization:
   * - create: Custom authorization logic (validates workflow_id access, environment_refs access)
   * - update: Standard authorization (requires update permission on the instance)
   * - delete: Standard authorization (requires delete permission on the instance)
   * All workflow instances belong to an organization.
   * </pre>
   */
  public static final class WorkflowInstanceCommandControllerBlockingStub
      extends io.grpc.stub.AbstractBlockingStub<WorkflowInstanceCommandControllerBlockingStub> {
    private WorkflowInstanceCommandControllerBlockingStub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected WorkflowInstanceCommandControllerBlockingStub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new WorkflowInstanceCommandControllerBlockingStub(channel, callOptions);
    }

    /**
     * <pre>
     * Create or update a workflow instance.
     * The authorization and state-operation are determined depending on whether the workflow instance
     * is going to be created or updated which is determined as part of the request execution.
     * </pre>
     */
    public ai.stigmer.agentic.workflowinstance.v1.WorkflowInstance apply(ai.stigmer.agentic.workflowinstance.v1.WorkflowInstance request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getApplyMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Create a new workflow instance.
     * Creates a configured deployment of a Workflow template with environment bindings.
     * Input validation:
     * - metadata.org must be specified
     * - spec.workflow_id must be a valid Workflow resource ID
     * - spec.environment_refs must reference valid Environment resources
     * Authorization:
     * Uses custom authorization logic to verify:
     * 1. User has permission to access the referenced Workflow template
     * 2. User has permission to access all referenced Environment resources
     * 3. Owner scope is valid for the user's organization/identity
     * Returns:
     * The created WorkflowInstance with:
     * - Assigned resource ID (metadata.id)
     * - Created timestamp (status.audit.created_at)
     * - Initial version (status.audit.version = 1)
     * Example:
     * Input: WorkflowInstance with workflow_id="wfl_123", environment_refs=["env_prod"]
     * Output: WorkflowInstance with id="wfi_abc456", created_at="2025-01-11T10:00:00Z"
     * </pre>
     */
    public ai.stigmer.agentic.workflowinstance.v1.WorkflowInstance create(ai.stigmer.agentic.workflowinstance.v1.WorkflowInstance request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getCreateMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Update an existing workflow instance.
     * Modifies the configuration of an existing WorkflowInstance.
     * You can update:
     * - spec.description (change descriptive text)
     * - spec.environment_refs (add/remove/reorder environment bindings)
     * - metadata.labels, metadata.tags, metadata.annotations
     * You cannot update:
     * - spec.workflow_id (must delete and recreate to change template)
     * - metadata.id (immutable resource identifier)
     * - metadata.org (immutable after creation)
     * Authorization:
     * Requires "update" permission on the specific WorkflowInstance resource.
     * Field path "metadata.id" identifies which resource to authorize.
     * Versioning:
     * Each update increments status.audit.version and updates status.audit.updated_at.
     * Returns:
     * The updated WorkflowInstance with:
     * - Incremented version number
     * - Updated timestamp
     * - Modified spec fields
     * Error: PERMISSION_DENIED if user lacks update permission
     * </pre>
     */
    public ai.stigmer.agentic.workflowinstance.v1.WorkflowInstance update(ai.stigmer.agentic.workflowinstance.v1.WorkflowInstance request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getUpdateMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Delete a workflow instance.
     * Permanently removes a WorkflowInstance resource.
     * Important:
     * - Deletion is permanent and cannot be undone
     * - Does NOT delete the referenced Workflow template (templates are reusable)
     * - Does NOT delete the referenced Environment resources (environments are reusable)
     * - DOES cascade delete any dependent WorkflowExecution resources (executions belong to instance)
     * Authorization:
     * Requires "delete" permission on the specific WorkflowInstance resource.
     * Field path "value" extracts the resource ID from WorkflowInstanceId wrapper.
     * Use Cases:
     * - Remove deprecated instances
     * - Clean up test/dev instances
     * - Decommission old deployment configurations
     * Returns:
     * The deleted WorkflowInstance (final state before deletion).
     * Useful for audit logs and confirming what was deleted.
     * Error: PERMISSION_DENIED if user lacks delete permission
     * Error: NOT_FOUND if instance ID doesn't exist
     * </pre>
     */
    public ai.stigmer.agentic.workflowinstance.v1.WorkflowInstance delete(ai.stigmer.agentic.workflowinstance.v1.WorkflowInstanceId request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getDeleteMethod(), getCallOptions(), request);
    }
  }

  /**
   * A stub to allow clients to do ListenableFuture-style rpc calls to service WorkflowInstanceCommandController.
   * <pre>
   * WorkflowInstanceCommandController handles write operations (Create, Update, Delete) for WorkflowInstance resources.
   * This service provides the CUD (Create, Update, Delete) operations following the
   * Command-Query Separation pattern. All RPCs that modify state go through this controller.
   * Authorization:
   * - create: Custom authorization logic (validates workflow_id access, environment_refs access)
   * - update: Standard authorization (requires update permission on the instance)
   * - delete: Standard authorization (requires delete permission on the instance)
   * All workflow instances belong to an organization.
   * </pre>
   */
  public static final class WorkflowInstanceCommandControllerFutureStub
      extends io.grpc.stub.AbstractFutureStub<WorkflowInstanceCommandControllerFutureStub> {
    private WorkflowInstanceCommandControllerFutureStub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected WorkflowInstanceCommandControllerFutureStub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new WorkflowInstanceCommandControllerFutureStub(channel, callOptions);
    }

    /**
     * <pre>
     * Create or update a workflow instance.
     * The authorization and state-operation are determined depending on whether the workflow instance
     * is going to be created or updated which is determined as part of the request execution.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.agentic.workflowinstance.v1.WorkflowInstance> apply(
        ai.stigmer.agentic.workflowinstance.v1.WorkflowInstance request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getApplyMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * Create a new workflow instance.
     * Creates a configured deployment of a Workflow template with environment bindings.
     * Input validation:
     * - metadata.org must be specified
     * - spec.workflow_id must be a valid Workflow resource ID
     * - spec.environment_refs must reference valid Environment resources
     * Authorization:
     * Uses custom authorization logic to verify:
     * 1. User has permission to access the referenced Workflow template
     * 2. User has permission to access all referenced Environment resources
     * 3. Owner scope is valid for the user's organization/identity
     * Returns:
     * The created WorkflowInstance with:
     * - Assigned resource ID (metadata.id)
     * - Created timestamp (status.audit.created_at)
     * - Initial version (status.audit.version = 1)
     * Example:
     * Input: WorkflowInstance with workflow_id="wfl_123", environment_refs=["env_prod"]
     * Output: WorkflowInstance with id="wfi_abc456", created_at="2025-01-11T10:00:00Z"
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.agentic.workflowinstance.v1.WorkflowInstance> create(
        ai.stigmer.agentic.workflowinstance.v1.WorkflowInstance request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getCreateMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * Update an existing workflow instance.
     * Modifies the configuration of an existing WorkflowInstance.
     * You can update:
     * - spec.description (change descriptive text)
     * - spec.environment_refs (add/remove/reorder environment bindings)
     * - metadata.labels, metadata.tags, metadata.annotations
     * You cannot update:
     * - spec.workflow_id (must delete and recreate to change template)
     * - metadata.id (immutable resource identifier)
     * - metadata.org (immutable after creation)
     * Authorization:
     * Requires "update" permission on the specific WorkflowInstance resource.
     * Field path "metadata.id" identifies which resource to authorize.
     * Versioning:
     * Each update increments status.audit.version and updates status.audit.updated_at.
     * Returns:
     * The updated WorkflowInstance with:
     * - Incremented version number
     * - Updated timestamp
     * - Modified spec fields
     * Error: PERMISSION_DENIED if user lacks update permission
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.agentic.workflowinstance.v1.WorkflowInstance> update(
        ai.stigmer.agentic.workflowinstance.v1.WorkflowInstance request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getUpdateMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * Delete a workflow instance.
     * Permanently removes a WorkflowInstance resource.
     * Important:
     * - Deletion is permanent and cannot be undone
     * - Does NOT delete the referenced Workflow template (templates are reusable)
     * - Does NOT delete the referenced Environment resources (environments are reusable)
     * - DOES cascade delete any dependent WorkflowExecution resources (executions belong to instance)
     * Authorization:
     * Requires "delete" permission on the specific WorkflowInstance resource.
     * Field path "value" extracts the resource ID from WorkflowInstanceId wrapper.
     * Use Cases:
     * - Remove deprecated instances
     * - Clean up test/dev instances
     * - Decommission old deployment configurations
     * Returns:
     * The deleted WorkflowInstance (final state before deletion).
     * Useful for audit logs and confirming what was deleted.
     * Error: PERMISSION_DENIED if user lacks delete permission
     * Error: NOT_FOUND if instance ID doesn't exist
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.agentic.workflowinstance.v1.WorkflowInstance> delete(
        ai.stigmer.agentic.workflowinstance.v1.WorkflowInstanceId request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getDeleteMethod(), getCallOptions()), request);
    }
  }

  private static final int METHODID_APPLY = 0;
  private static final int METHODID_CREATE = 1;
  private static final int METHODID_UPDATE = 2;
  private static final int METHODID_DELETE = 3;

  private static final class MethodHandlers<Req, Resp> implements
      io.grpc.stub.ServerCalls.UnaryMethod<Req, Resp>,
      io.grpc.stub.ServerCalls.ServerStreamingMethod<Req, Resp>,
      io.grpc.stub.ServerCalls.ClientStreamingMethod<Req, Resp>,
      io.grpc.stub.ServerCalls.BidiStreamingMethod<Req, Resp> {
    private final AsyncService serviceImpl;
    private final int methodId;

    MethodHandlers(AsyncService serviceImpl, int methodId) {
      this.serviceImpl = serviceImpl;
      this.methodId = methodId;
    }

    @java.lang.Override
    @java.lang.SuppressWarnings("unchecked")
    public void invoke(Req request, io.grpc.stub.StreamObserver<Resp> responseObserver) {
      switch (methodId) {
        case METHODID_APPLY:
          serviceImpl.apply((ai.stigmer.agentic.workflowinstance.v1.WorkflowInstance) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.agentic.workflowinstance.v1.WorkflowInstance>) responseObserver);
          break;
        case METHODID_CREATE:
          serviceImpl.create((ai.stigmer.agentic.workflowinstance.v1.WorkflowInstance) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.agentic.workflowinstance.v1.WorkflowInstance>) responseObserver);
          break;
        case METHODID_UPDATE:
          serviceImpl.update((ai.stigmer.agentic.workflowinstance.v1.WorkflowInstance) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.agentic.workflowinstance.v1.WorkflowInstance>) responseObserver);
          break;
        case METHODID_DELETE:
          serviceImpl.delete((ai.stigmer.agentic.workflowinstance.v1.WorkflowInstanceId) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.agentic.workflowinstance.v1.WorkflowInstance>) responseObserver);
          break;
        default:
          throw new AssertionError();
      }
    }

    @java.lang.Override
    @java.lang.SuppressWarnings("unchecked")
    public io.grpc.stub.StreamObserver<Req> invoke(
        io.grpc.stub.StreamObserver<Resp> responseObserver) {
      switch (methodId) {
        default:
          throw new AssertionError();
      }
    }
  }

  public static final io.grpc.ServerServiceDefinition bindService(AsyncService service) {
    return io.grpc.ServerServiceDefinition.builder(getServiceDescriptor())
        .addMethod(
          getApplyMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.agentic.workflowinstance.v1.WorkflowInstance,
              ai.stigmer.agentic.workflowinstance.v1.WorkflowInstance>(
                service, METHODID_APPLY)))
        .addMethod(
          getCreateMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.agentic.workflowinstance.v1.WorkflowInstance,
              ai.stigmer.agentic.workflowinstance.v1.WorkflowInstance>(
                service, METHODID_CREATE)))
        .addMethod(
          getUpdateMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.agentic.workflowinstance.v1.WorkflowInstance,
              ai.stigmer.agentic.workflowinstance.v1.WorkflowInstance>(
                service, METHODID_UPDATE)))
        .addMethod(
          getDeleteMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.agentic.workflowinstance.v1.WorkflowInstanceId,
              ai.stigmer.agentic.workflowinstance.v1.WorkflowInstance>(
                service, METHODID_DELETE)))
        .build();
  }

  private static abstract class WorkflowInstanceCommandControllerBaseDescriptorSupplier
      implements io.grpc.protobuf.ProtoFileDescriptorSupplier, io.grpc.protobuf.ProtoServiceDescriptorSupplier {
    WorkflowInstanceCommandControllerBaseDescriptorSupplier() {}

    @java.lang.Override
    public com.google.protobuf.Descriptors.FileDescriptor getFileDescriptor() {
      return ai.stigmer.agentic.workflowinstance.v1.CommandProto.getDescriptor();
    }

    @java.lang.Override
    public com.google.protobuf.Descriptors.ServiceDescriptor getServiceDescriptor() {
      return getFileDescriptor().findServiceByName("WorkflowInstanceCommandController");
    }
  }

  private static final class WorkflowInstanceCommandControllerFileDescriptorSupplier
      extends WorkflowInstanceCommandControllerBaseDescriptorSupplier {
    WorkflowInstanceCommandControllerFileDescriptorSupplier() {}
  }

  private static final class WorkflowInstanceCommandControllerMethodDescriptorSupplier
      extends WorkflowInstanceCommandControllerBaseDescriptorSupplier
      implements io.grpc.protobuf.ProtoMethodDescriptorSupplier {
    private final java.lang.String methodName;

    WorkflowInstanceCommandControllerMethodDescriptorSupplier(java.lang.String methodName) {
      this.methodName = methodName;
    }

    @java.lang.Override
    public com.google.protobuf.Descriptors.MethodDescriptor getMethodDescriptor() {
      return getServiceDescriptor().findMethodByName(methodName);
    }
  }

  private static volatile io.grpc.ServiceDescriptor serviceDescriptor;

  public static io.grpc.ServiceDescriptor getServiceDescriptor() {
    io.grpc.ServiceDescriptor result = serviceDescriptor;
    if (result == null) {
      synchronized (WorkflowInstanceCommandControllerGrpc.class) {
        result = serviceDescriptor;
        if (result == null) {
          serviceDescriptor = result = io.grpc.ServiceDescriptor.newBuilder(SERVICE_NAME)
              .setSchemaDescriptor(new WorkflowInstanceCommandControllerFileDescriptorSupplier())
              .addMethod(getApplyMethod())
              .addMethod(getCreateMethod())
              .addMethod(getUpdateMethod())
              .addMethod(getDeleteMethod())
              .build();
        }
      }
    }
    return result;
  }
}
