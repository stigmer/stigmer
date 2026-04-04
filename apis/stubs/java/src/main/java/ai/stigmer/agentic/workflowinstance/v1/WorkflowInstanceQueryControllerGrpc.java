package ai.stigmer.agentic.workflowinstance.v1;

import static io.grpc.MethodDescriptor.generateFullMethodName;

/**
 * <pre>
 * WorkflowInstanceQueryController handles read operations for workflow instances.
 * &#64;internal
 * This service provides all query operations following the Command-Query Separation pattern.
 * All RPCs that read state without modifying it go through this controller.
 * Authorization:
 * - get: Requires get permission on the specific instance
 * - getByWorkflow: Authorization handled in handler via FGA query (returns filtered instances)
 * - getByReference: Custom authorization (supports flexible reference lookup)
 * All operations respect owner scope visibility rules (users see only their org/identity resources).
 * </pre>
 */
@io.grpc.stub.annotations.GrpcGenerated
public final class WorkflowInstanceQueryControllerGrpc {

  private WorkflowInstanceQueryControllerGrpc() {}

  public static final java.lang.String SERVICE_NAME = "ai.stigmer.agentic.workflowinstance.v1.WorkflowInstanceQueryController";

  // Static method descriptors that strictly reflect the proto.
  private static volatile io.grpc.MethodDescriptor<ai.stigmer.agentic.workflowinstance.v1.WorkflowInstanceId,
      ai.stigmer.agentic.workflowinstance.v1.WorkflowInstance> getGetMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "get",
      requestType = ai.stigmer.agentic.workflowinstance.v1.WorkflowInstanceId.class,
      responseType = ai.stigmer.agentic.workflowinstance.v1.WorkflowInstance.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.agentic.workflowinstance.v1.WorkflowInstanceId,
      ai.stigmer.agentic.workflowinstance.v1.WorkflowInstance> getGetMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.agentic.workflowinstance.v1.WorkflowInstanceId, ai.stigmer.agentic.workflowinstance.v1.WorkflowInstance> getGetMethod;
    if ((getGetMethod = WorkflowInstanceQueryControllerGrpc.getGetMethod) == null) {
      synchronized (WorkflowInstanceQueryControllerGrpc.class) {
        if ((getGetMethod = WorkflowInstanceQueryControllerGrpc.getGetMethod) == null) {
          WorkflowInstanceQueryControllerGrpc.getGetMethod = getGetMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.agentic.workflowinstance.v1.WorkflowInstanceId, ai.stigmer.agentic.workflowinstance.v1.WorkflowInstance>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "get"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.workflowinstance.v1.WorkflowInstanceId.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.workflowinstance.v1.WorkflowInstance.getDefaultInstance()))
              .setSchemaDescriptor(new WorkflowInstanceQueryControllerMethodDescriptorSupplier("get"))
              .build();
        }
      }
    }
    return getGetMethod;
  }

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.agentic.workflowinstance.v1.GetWorkflowInstancesByWorkflowRequest,
      ai.stigmer.agentic.workflowinstance.v1.WorkflowInstanceList> getGetByWorkflowMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "getByWorkflow",
      requestType = ai.stigmer.agentic.workflowinstance.v1.GetWorkflowInstancesByWorkflowRequest.class,
      responseType = ai.stigmer.agentic.workflowinstance.v1.WorkflowInstanceList.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.agentic.workflowinstance.v1.GetWorkflowInstancesByWorkflowRequest,
      ai.stigmer.agentic.workflowinstance.v1.WorkflowInstanceList> getGetByWorkflowMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.agentic.workflowinstance.v1.GetWorkflowInstancesByWorkflowRequest, ai.stigmer.agentic.workflowinstance.v1.WorkflowInstanceList> getGetByWorkflowMethod;
    if ((getGetByWorkflowMethod = WorkflowInstanceQueryControllerGrpc.getGetByWorkflowMethod) == null) {
      synchronized (WorkflowInstanceQueryControllerGrpc.class) {
        if ((getGetByWorkflowMethod = WorkflowInstanceQueryControllerGrpc.getGetByWorkflowMethod) == null) {
          WorkflowInstanceQueryControllerGrpc.getGetByWorkflowMethod = getGetByWorkflowMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.agentic.workflowinstance.v1.GetWorkflowInstancesByWorkflowRequest, ai.stigmer.agentic.workflowinstance.v1.WorkflowInstanceList>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "getByWorkflow"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.workflowinstance.v1.GetWorkflowInstancesByWorkflowRequest.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.workflowinstance.v1.WorkflowInstanceList.getDefaultInstance()))
              .setSchemaDescriptor(new WorkflowInstanceQueryControllerMethodDescriptorSupplier("getByWorkflow"))
              .build();
        }
      }
    }
    return getGetByWorkflowMethod;
  }

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.commons.apiresource.ApiResourceReference,
      ai.stigmer.agentic.workflowinstance.v1.WorkflowInstance> getGetByReferenceMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "getByReference",
      requestType = ai.stigmer.commons.apiresource.ApiResourceReference.class,
      responseType = ai.stigmer.agentic.workflowinstance.v1.WorkflowInstance.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.commons.apiresource.ApiResourceReference,
      ai.stigmer.agentic.workflowinstance.v1.WorkflowInstance> getGetByReferenceMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.commons.apiresource.ApiResourceReference, ai.stigmer.agentic.workflowinstance.v1.WorkflowInstance> getGetByReferenceMethod;
    if ((getGetByReferenceMethod = WorkflowInstanceQueryControllerGrpc.getGetByReferenceMethod) == null) {
      synchronized (WorkflowInstanceQueryControllerGrpc.class) {
        if ((getGetByReferenceMethod = WorkflowInstanceQueryControllerGrpc.getGetByReferenceMethod) == null) {
          WorkflowInstanceQueryControllerGrpc.getGetByReferenceMethod = getGetByReferenceMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.commons.apiresource.ApiResourceReference, ai.stigmer.agentic.workflowinstance.v1.WorkflowInstance>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "getByReference"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.commons.apiresource.ApiResourceReference.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.workflowinstance.v1.WorkflowInstance.getDefaultInstance()))
              .setSchemaDescriptor(new WorkflowInstanceQueryControllerMethodDescriptorSupplier("getByReference"))
              .build();
        }
      }
    }
    return getGetByReferenceMethod;
  }

  /**
   * Creates a new async stub that supports all call types for the service
   */
  public static WorkflowInstanceQueryControllerStub newStub(io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<WorkflowInstanceQueryControllerStub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<WorkflowInstanceQueryControllerStub>() {
        @java.lang.Override
        public WorkflowInstanceQueryControllerStub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new WorkflowInstanceQueryControllerStub(channel, callOptions);
        }
      };
    return WorkflowInstanceQueryControllerStub.newStub(factory, channel);
  }

  /**
   * Creates a new blocking-style stub that supports all types of calls on the service
   */
  public static WorkflowInstanceQueryControllerBlockingV2Stub newBlockingV2Stub(
      io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<WorkflowInstanceQueryControllerBlockingV2Stub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<WorkflowInstanceQueryControllerBlockingV2Stub>() {
        @java.lang.Override
        public WorkflowInstanceQueryControllerBlockingV2Stub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new WorkflowInstanceQueryControllerBlockingV2Stub(channel, callOptions);
        }
      };
    return WorkflowInstanceQueryControllerBlockingV2Stub.newStub(factory, channel);
  }

  /**
   * Creates a new blocking-style stub that supports unary and streaming output calls on the service
   */
  public static WorkflowInstanceQueryControllerBlockingStub newBlockingStub(
      io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<WorkflowInstanceQueryControllerBlockingStub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<WorkflowInstanceQueryControllerBlockingStub>() {
        @java.lang.Override
        public WorkflowInstanceQueryControllerBlockingStub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new WorkflowInstanceQueryControllerBlockingStub(channel, callOptions);
        }
      };
    return WorkflowInstanceQueryControllerBlockingStub.newStub(factory, channel);
  }

  /**
   * Creates a new ListenableFuture-style stub that supports unary calls on the service
   */
  public static WorkflowInstanceQueryControllerFutureStub newFutureStub(
      io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<WorkflowInstanceQueryControllerFutureStub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<WorkflowInstanceQueryControllerFutureStub>() {
        @java.lang.Override
        public WorkflowInstanceQueryControllerFutureStub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new WorkflowInstanceQueryControllerFutureStub(channel, callOptions);
        }
      };
    return WorkflowInstanceQueryControllerFutureStub.newStub(factory, channel);
  }

  /**
   * <pre>
   * WorkflowInstanceQueryController handles read operations for workflow instances.
   * &#64;internal
   * This service provides all query operations following the Command-Query Separation pattern.
   * All RPCs that read state without modifying it go through this controller.
   * Authorization:
   * - get: Requires get permission on the specific instance
   * - getByWorkflow: Authorization handled in handler via FGA query (returns filtered instances)
   * - getByReference: Custom authorization (supports flexible reference lookup)
   * All operations respect owner scope visibility rules (users see only their org/identity resources).
   * </pre>
   */
  public interface AsyncService {

    /**
     * <pre>
     * Get a single workflow instance by ID.
     * &#64;internal
     * Retrieves a specific WorkflowInstance using its unique resource identifier.
     * Authorization:
     * Requires "get" permission on the specific WorkflowInstance.
     * Field path "value" extracts the resource ID from WorkflowInstanceId wrapper.
     * Verifies user has access based on:
     * - Instance owner scope (organization or identity_account)
     * - User's IAM policies
     * Error: PERMISSION_DENIED if user lacks get permission
     * Error: NOT_FOUND if instance ID doesn't exist
     * </pre>
     */
    default void get(ai.stigmer.agentic.workflowinstance.v1.WorkflowInstanceId request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.workflowinstance.v1.WorkflowInstance> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getGetMethod(), responseObserver);
    }

    /**
     * <pre>
     * Get all workflow instances that use a specific workflow template.
     * Returns a paginated list of instances that reference the given workflow ID.
     * &#64;internal
     * Authorization is handled in handler via FGA query for authorized workflow_instance_ids,
     * then filtered by workflow_id. This ensures users only see instances they have access to,
     * even if the parent workflow is shared across organizations.
     * Filtering:
     * Results are filtered by:
     * - User's organization/identity visibility
     * - IAM policies
     * - Owner scope rules
     * Error: PERMISSION_DENIED if user lacks access to the workflow
     * Error: NOT_FOUND if workflow_id doesn't exist
     * </pre>
     */
    default void getByWorkflow(ai.stigmer.agentic.workflowinstance.v1.GetWorkflowInstancesByWorkflowRequest request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.workflowinstance.v1.WorkflowInstanceList> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getGetByWorkflowMethod(), responseObserver);
    }

    /**
     * <pre>
     * Get a workflow instance by reference (ID or slug).
     * &#64;internal
     * Custom authorization in handler — checks both direct resource access
     * and organization-level visibility permissions.
     * Supports lookup by:
     * - ID: {id: "wfi_abc123"}
     * - Slug: {slug: "prod-deploy"}
     * - Name: {name: "Production Deploy"}
     * Error: PERMISSION_DENIED if user lacks access
     * Error: NOT_FOUND if reference doesn't resolve to an instance
     * </pre>
     */
    default void getByReference(ai.stigmer.commons.apiresource.ApiResourceReference request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.workflowinstance.v1.WorkflowInstance> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getGetByReferenceMethod(), responseObserver);
    }
  }

  /**
   * Base class for the server implementation of the service WorkflowInstanceQueryController.
   * <pre>
   * WorkflowInstanceQueryController handles read operations for workflow instances.
   * &#64;internal
   * This service provides all query operations following the Command-Query Separation pattern.
   * All RPCs that read state without modifying it go through this controller.
   * Authorization:
   * - get: Requires get permission on the specific instance
   * - getByWorkflow: Authorization handled in handler via FGA query (returns filtered instances)
   * - getByReference: Custom authorization (supports flexible reference lookup)
   * All operations respect owner scope visibility rules (users see only their org/identity resources).
   * </pre>
   */
  public static abstract class WorkflowInstanceQueryControllerImplBase
      implements io.grpc.BindableService, AsyncService {

    @java.lang.Override public final io.grpc.ServerServiceDefinition bindService() {
      return WorkflowInstanceQueryControllerGrpc.bindService(this);
    }
  }

  /**
   * A stub to allow clients to do asynchronous rpc calls to service WorkflowInstanceQueryController.
   * <pre>
   * WorkflowInstanceQueryController handles read operations for workflow instances.
   * &#64;internal
   * This service provides all query operations following the Command-Query Separation pattern.
   * All RPCs that read state without modifying it go through this controller.
   * Authorization:
   * - get: Requires get permission on the specific instance
   * - getByWorkflow: Authorization handled in handler via FGA query (returns filtered instances)
   * - getByReference: Custom authorization (supports flexible reference lookup)
   * All operations respect owner scope visibility rules (users see only their org/identity resources).
   * </pre>
   */
  public static final class WorkflowInstanceQueryControllerStub
      extends io.grpc.stub.AbstractAsyncStub<WorkflowInstanceQueryControllerStub> {
    private WorkflowInstanceQueryControllerStub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected WorkflowInstanceQueryControllerStub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new WorkflowInstanceQueryControllerStub(channel, callOptions);
    }

    /**
     * <pre>
     * Get a single workflow instance by ID.
     * &#64;internal
     * Retrieves a specific WorkflowInstance using its unique resource identifier.
     * Authorization:
     * Requires "get" permission on the specific WorkflowInstance.
     * Field path "value" extracts the resource ID from WorkflowInstanceId wrapper.
     * Verifies user has access based on:
     * - Instance owner scope (organization or identity_account)
     * - User's IAM policies
     * Error: PERMISSION_DENIED if user lacks get permission
     * Error: NOT_FOUND if instance ID doesn't exist
     * </pre>
     */
    public void get(ai.stigmer.agentic.workflowinstance.v1.WorkflowInstanceId request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.workflowinstance.v1.WorkflowInstance> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getGetMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * Get all workflow instances that use a specific workflow template.
     * Returns a paginated list of instances that reference the given workflow ID.
     * &#64;internal
     * Authorization is handled in handler via FGA query for authorized workflow_instance_ids,
     * then filtered by workflow_id. This ensures users only see instances they have access to,
     * even if the parent workflow is shared across organizations.
     * Filtering:
     * Results are filtered by:
     * - User's organization/identity visibility
     * - IAM policies
     * - Owner scope rules
     * Error: PERMISSION_DENIED if user lacks access to the workflow
     * Error: NOT_FOUND if workflow_id doesn't exist
     * </pre>
     */
    public void getByWorkflow(ai.stigmer.agentic.workflowinstance.v1.GetWorkflowInstancesByWorkflowRequest request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.workflowinstance.v1.WorkflowInstanceList> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getGetByWorkflowMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * Get a workflow instance by reference (ID or slug).
     * &#64;internal
     * Custom authorization in handler — checks both direct resource access
     * and organization-level visibility permissions.
     * Supports lookup by:
     * - ID: {id: "wfi_abc123"}
     * - Slug: {slug: "prod-deploy"}
     * - Name: {name: "Production Deploy"}
     * Error: PERMISSION_DENIED if user lacks access
     * Error: NOT_FOUND if reference doesn't resolve to an instance
     * </pre>
     */
    public void getByReference(ai.stigmer.commons.apiresource.ApiResourceReference request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.workflowinstance.v1.WorkflowInstance> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getGetByReferenceMethod(), getCallOptions()), request, responseObserver);
    }
  }

  /**
   * A stub to allow clients to do synchronous rpc calls to service WorkflowInstanceQueryController.
   * <pre>
   * WorkflowInstanceQueryController handles read operations for workflow instances.
   * &#64;internal
   * This service provides all query operations following the Command-Query Separation pattern.
   * All RPCs that read state without modifying it go through this controller.
   * Authorization:
   * - get: Requires get permission on the specific instance
   * - getByWorkflow: Authorization handled in handler via FGA query (returns filtered instances)
   * - getByReference: Custom authorization (supports flexible reference lookup)
   * All operations respect owner scope visibility rules (users see only their org/identity resources).
   * </pre>
   */
  public static final class WorkflowInstanceQueryControllerBlockingV2Stub
      extends io.grpc.stub.AbstractBlockingStub<WorkflowInstanceQueryControllerBlockingV2Stub> {
    private WorkflowInstanceQueryControllerBlockingV2Stub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected WorkflowInstanceQueryControllerBlockingV2Stub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new WorkflowInstanceQueryControllerBlockingV2Stub(channel, callOptions);
    }

    /**
     * <pre>
     * Get a single workflow instance by ID.
     * &#64;internal
     * Retrieves a specific WorkflowInstance using its unique resource identifier.
     * Authorization:
     * Requires "get" permission on the specific WorkflowInstance.
     * Field path "value" extracts the resource ID from WorkflowInstanceId wrapper.
     * Verifies user has access based on:
     * - Instance owner scope (organization or identity_account)
     * - User's IAM policies
     * Error: PERMISSION_DENIED if user lacks get permission
     * Error: NOT_FOUND if instance ID doesn't exist
     * </pre>
     */
    public ai.stigmer.agentic.workflowinstance.v1.WorkflowInstance get(ai.stigmer.agentic.workflowinstance.v1.WorkflowInstanceId request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getGetMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Get all workflow instances that use a specific workflow template.
     * Returns a paginated list of instances that reference the given workflow ID.
     * &#64;internal
     * Authorization is handled in handler via FGA query for authorized workflow_instance_ids,
     * then filtered by workflow_id. This ensures users only see instances they have access to,
     * even if the parent workflow is shared across organizations.
     * Filtering:
     * Results are filtered by:
     * - User's organization/identity visibility
     * - IAM policies
     * - Owner scope rules
     * Error: PERMISSION_DENIED if user lacks access to the workflow
     * Error: NOT_FOUND if workflow_id doesn't exist
     * </pre>
     */
    public ai.stigmer.agentic.workflowinstance.v1.WorkflowInstanceList getByWorkflow(ai.stigmer.agentic.workflowinstance.v1.GetWorkflowInstancesByWorkflowRequest request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getGetByWorkflowMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Get a workflow instance by reference (ID or slug).
     * &#64;internal
     * Custom authorization in handler — checks both direct resource access
     * and organization-level visibility permissions.
     * Supports lookup by:
     * - ID: {id: "wfi_abc123"}
     * - Slug: {slug: "prod-deploy"}
     * - Name: {name: "Production Deploy"}
     * Error: PERMISSION_DENIED if user lacks access
     * Error: NOT_FOUND if reference doesn't resolve to an instance
     * </pre>
     */
    public ai.stigmer.agentic.workflowinstance.v1.WorkflowInstance getByReference(ai.stigmer.commons.apiresource.ApiResourceReference request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getGetByReferenceMethod(), getCallOptions(), request);
    }
  }

  /**
   * A stub to allow clients to do limited synchronous rpc calls to service WorkflowInstanceQueryController.
   * <pre>
   * WorkflowInstanceQueryController handles read operations for workflow instances.
   * &#64;internal
   * This service provides all query operations following the Command-Query Separation pattern.
   * All RPCs that read state without modifying it go through this controller.
   * Authorization:
   * - get: Requires get permission on the specific instance
   * - getByWorkflow: Authorization handled in handler via FGA query (returns filtered instances)
   * - getByReference: Custom authorization (supports flexible reference lookup)
   * All operations respect owner scope visibility rules (users see only their org/identity resources).
   * </pre>
   */
  public static final class WorkflowInstanceQueryControllerBlockingStub
      extends io.grpc.stub.AbstractBlockingStub<WorkflowInstanceQueryControllerBlockingStub> {
    private WorkflowInstanceQueryControllerBlockingStub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected WorkflowInstanceQueryControllerBlockingStub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new WorkflowInstanceQueryControllerBlockingStub(channel, callOptions);
    }

    /**
     * <pre>
     * Get a single workflow instance by ID.
     * &#64;internal
     * Retrieves a specific WorkflowInstance using its unique resource identifier.
     * Authorization:
     * Requires "get" permission on the specific WorkflowInstance.
     * Field path "value" extracts the resource ID from WorkflowInstanceId wrapper.
     * Verifies user has access based on:
     * - Instance owner scope (organization or identity_account)
     * - User's IAM policies
     * Error: PERMISSION_DENIED if user lacks get permission
     * Error: NOT_FOUND if instance ID doesn't exist
     * </pre>
     */
    public ai.stigmer.agentic.workflowinstance.v1.WorkflowInstance get(ai.stigmer.agentic.workflowinstance.v1.WorkflowInstanceId request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getGetMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Get all workflow instances that use a specific workflow template.
     * Returns a paginated list of instances that reference the given workflow ID.
     * &#64;internal
     * Authorization is handled in handler via FGA query for authorized workflow_instance_ids,
     * then filtered by workflow_id. This ensures users only see instances they have access to,
     * even if the parent workflow is shared across organizations.
     * Filtering:
     * Results are filtered by:
     * - User's organization/identity visibility
     * - IAM policies
     * - Owner scope rules
     * Error: PERMISSION_DENIED if user lacks access to the workflow
     * Error: NOT_FOUND if workflow_id doesn't exist
     * </pre>
     */
    public ai.stigmer.agentic.workflowinstance.v1.WorkflowInstanceList getByWorkflow(ai.stigmer.agentic.workflowinstance.v1.GetWorkflowInstancesByWorkflowRequest request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getGetByWorkflowMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Get a workflow instance by reference (ID or slug).
     * &#64;internal
     * Custom authorization in handler — checks both direct resource access
     * and organization-level visibility permissions.
     * Supports lookup by:
     * - ID: {id: "wfi_abc123"}
     * - Slug: {slug: "prod-deploy"}
     * - Name: {name: "Production Deploy"}
     * Error: PERMISSION_DENIED if user lacks access
     * Error: NOT_FOUND if reference doesn't resolve to an instance
     * </pre>
     */
    public ai.stigmer.agentic.workflowinstance.v1.WorkflowInstance getByReference(ai.stigmer.commons.apiresource.ApiResourceReference request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getGetByReferenceMethod(), getCallOptions(), request);
    }
  }

  /**
   * A stub to allow clients to do ListenableFuture-style rpc calls to service WorkflowInstanceQueryController.
   * <pre>
   * WorkflowInstanceQueryController handles read operations for workflow instances.
   * &#64;internal
   * This service provides all query operations following the Command-Query Separation pattern.
   * All RPCs that read state without modifying it go through this controller.
   * Authorization:
   * - get: Requires get permission on the specific instance
   * - getByWorkflow: Authorization handled in handler via FGA query (returns filtered instances)
   * - getByReference: Custom authorization (supports flexible reference lookup)
   * All operations respect owner scope visibility rules (users see only their org/identity resources).
   * </pre>
   */
  public static final class WorkflowInstanceQueryControllerFutureStub
      extends io.grpc.stub.AbstractFutureStub<WorkflowInstanceQueryControllerFutureStub> {
    private WorkflowInstanceQueryControllerFutureStub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected WorkflowInstanceQueryControllerFutureStub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new WorkflowInstanceQueryControllerFutureStub(channel, callOptions);
    }

    /**
     * <pre>
     * Get a single workflow instance by ID.
     * &#64;internal
     * Retrieves a specific WorkflowInstance using its unique resource identifier.
     * Authorization:
     * Requires "get" permission on the specific WorkflowInstance.
     * Field path "value" extracts the resource ID from WorkflowInstanceId wrapper.
     * Verifies user has access based on:
     * - Instance owner scope (organization or identity_account)
     * - User's IAM policies
     * Error: PERMISSION_DENIED if user lacks get permission
     * Error: NOT_FOUND if instance ID doesn't exist
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.agentic.workflowinstance.v1.WorkflowInstance> get(
        ai.stigmer.agentic.workflowinstance.v1.WorkflowInstanceId request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getGetMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * Get all workflow instances that use a specific workflow template.
     * Returns a paginated list of instances that reference the given workflow ID.
     * &#64;internal
     * Authorization is handled in handler via FGA query for authorized workflow_instance_ids,
     * then filtered by workflow_id. This ensures users only see instances they have access to,
     * even if the parent workflow is shared across organizations.
     * Filtering:
     * Results are filtered by:
     * - User's organization/identity visibility
     * - IAM policies
     * - Owner scope rules
     * Error: PERMISSION_DENIED if user lacks access to the workflow
     * Error: NOT_FOUND if workflow_id doesn't exist
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.agentic.workflowinstance.v1.WorkflowInstanceList> getByWorkflow(
        ai.stigmer.agentic.workflowinstance.v1.GetWorkflowInstancesByWorkflowRequest request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getGetByWorkflowMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * Get a workflow instance by reference (ID or slug).
     * &#64;internal
     * Custom authorization in handler — checks both direct resource access
     * and organization-level visibility permissions.
     * Supports lookup by:
     * - ID: {id: "wfi_abc123"}
     * - Slug: {slug: "prod-deploy"}
     * - Name: {name: "Production Deploy"}
     * Error: PERMISSION_DENIED if user lacks access
     * Error: NOT_FOUND if reference doesn't resolve to an instance
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.agentic.workflowinstance.v1.WorkflowInstance> getByReference(
        ai.stigmer.commons.apiresource.ApiResourceReference request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getGetByReferenceMethod(), getCallOptions()), request);
    }
  }

  private static final int METHODID_GET = 0;
  private static final int METHODID_GET_BY_WORKFLOW = 1;
  private static final int METHODID_GET_BY_REFERENCE = 2;

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
        case METHODID_GET:
          serviceImpl.get((ai.stigmer.agentic.workflowinstance.v1.WorkflowInstanceId) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.agentic.workflowinstance.v1.WorkflowInstance>) responseObserver);
          break;
        case METHODID_GET_BY_WORKFLOW:
          serviceImpl.getByWorkflow((ai.stigmer.agentic.workflowinstance.v1.GetWorkflowInstancesByWorkflowRequest) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.agentic.workflowinstance.v1.WorkflowInstanceList>) responseObserver);
          break;
        case METHODID_GET_BY_REFERENCE:
          serviceImpl.getByReference((ai.stigmer.commons.apiresource.ApiResourceReference) request,
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
          getGetMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.agentic.workflowinstance.v1.WorkflowInstanceId,
              ai.stigmer.agentic.workflowinstance.v1.WorkflowInstance>(
                service, METHODID_GET)))
        .addMethod(
          getGetByWorkflowMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.agentic.workflowinstance.v1.GetWorkflowInstancesByWorkflowRequest,
              ai.stigmer.agentic.workflowinstance.v1.WorkflowInstanceList>(
                service, METHODID_GET_BY_WORKFLOW)))
        .addMethod(
          getGetByReferenceMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.commons.apiresource.ApiResourceReference,
              ai.stigmer.agentic.workflowinstance.v1.WorkflowInstance>(
                service, METHODID_GET_BY_REFERENCE)))
        .build();
  }

  private static abstract class WorkflowInstanceQueryControllerBaseDescriptorSupplier
      implements io.grpc.protobuf.ProtoFileDescriptorSupplier, io.grpc.protobuf.ProtoServiceDescriptorSupplier {
    WorkflowInstanceQueryControllerBaseDescriptorSupplier() {}

    @java.lang.Override
    public com.google.protobuf.Descriptors.FileDescriptor getFileDescriptor() {
      return ai.stigmer.agentic.workflowinstance.v1.QueryProto.getDescriptor();
    }

    @java.lang.Override
    public com.google.protobuf.Descriptors.ServiceDescriptor getServiceDescriptor() {
      return getFileDescriptor().findServiceByName("WorkflowInstanceQueryController");
    }
  }

  private static final class WorkflowInstanceQueryControllerFileDescriptorSupplier
      extends WorkflowInstanceQueryControllerBaseDescriptorSupplier {
    WorkflowInstanceQueryControllerFileDescriptorSupplier() {}
  }

  private static final class WorkflowInstanceQueryControllerMethodDescriptorSupplier
      extends WorkflowInstanceQueryControllerBaseDescriptorSupplier
      implements io.grpc.protobuf.ProtoMethodDescriptorSupplier {
    private final java.lang.String methodName;

    WorkflowInstanceQueryControllerMethodDescriptorSupplier(java.lang.String methodName) {
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
      synchronized (WorkflowInstanceQueryControllerGrpc.class) {
        result = serviceDescriptor;
        if (result == null) {
          serviceDescriptor = result = io.grpc.ServiceDescriptor.newBuilder(SERVICE_NAME)
              .setSchemaDescriptor(new WorkflowInstanceQueryControllerFileDescriptorSupplier())
              .addMethod(getGetMethod())
              .addMethod(getGetByWorkflowMethod())
              .addMethod(getGetByReferenceMethod())
              .build();
        }
      }
    }
    return result;
  }
}
