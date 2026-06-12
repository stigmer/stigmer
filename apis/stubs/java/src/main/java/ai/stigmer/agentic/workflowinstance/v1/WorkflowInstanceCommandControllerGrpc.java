package ai.stigmer.agentic.workflowinstance.v1;

import static io.grpc.MethodDescriptor.generateFullMethodName;

/**
 * <pre>
 * WorkflowInstanceCommandController handles write operations for workflow instances.
 * &#64;internal
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

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.commons.apiresource.UpdateVisibilityInput,
      ai.stigmer.agentic.workflowinstance.v1.WorkflowInstance> getUpdateVisibilityMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "updateVisibility",
      requestType = ai.stigmer.commons.apiresource.UpdateVisibilityInput.class,
      responseType = ai.stigmer.agentic.workflowinstance.v1.WorkflowInstance.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.commons.apiresource.UpdateVisibilityInput,
      ai.stigmer.agentic.workflowinstance.v1.WorkflowInstance> getUpdateVisibilityMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.commons.apiresource.UpdateVisibilityInput, ai.stigmer.agentic.workflowinstance.v1.WorkflowInstance> getUpdateVisibilityMethod;
    if ((getUpdateVisibilityMethod = WorkflowInstanceCommandControllerGrpc.getUpdateVisibilityMethod) == null) {
      synchronized (WorkflowInstanceCommandControllerGrpc.class) {
        if ((getUpdateVisibilityMethod = WorkflowInstanceCommandControllerGrpc.getUpdateVisibilityMethod) == null) {
          WorkflowInstanceCommandControllerGrpc.getUpdateVisibilityMethod = getUpdateVisibilityMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.commons.apiresource.UpdateVisibilityInput, ai.stigmer.agentic.workflowinstance.v1.WorkflowInstance>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "updateVisibility"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.commons.apiresource.UpdateVisibilityInput.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.workflowinstance.v1.WorkflowInstance.getDefaultInstance()))
              .setSchemaDescriptor(new WorkflowInstanceCommandControllerMethodDescriptorSupplier("updateVisibility"))
              .build();
        }
      }
    }
    return getUpdateVisibilityMethod;
  }

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.agentic.workflowinstance.v1.UpdateExecutionVisibilityInput,
      ai.stigmer.agentic.workflowinstance.v1.WorkflowInstance> getUpdateExecutionVisibilityMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "updateExecutionVisibility",
      requestType = ai.stigmer.agentic.workflowinstance.v1.UpdateExecutionVisibilityInput.class,
      responseType = ai.stigmer.agentic.workflowinstance.v1.WorkflowInstance.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.agentic.workflowinstance.v1.UpdateExecutionVisibilityInput,
      ai.stigmer.agentic.workflowinstance.v1.WorkflowInstance> getUpdateExecutionVisibilityMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.agentic.workflowinstance.v1.UpdateExecutionVisibilityInput, ai.stigmer.agentic.workflowinstance.v1.WorkflowInstance> getUpdateExecutionVisibilityMethod;
    if ((getUpdateExecutionVisibilityMethod = WorkflowInstanceCommandControllerGrpc.getUpdateExecutionVisibilityMethod) == null) {
      synchronized (WorkflowInstanceCommandControllerGrpc.class) {
        if ((getUpdateExecutionVisibilityMethod = WorkflowInstanceCommandControllerGrpc.getUpdateExecutionVisibilityMethod) == null) {
          WorkflowInstanceCommandControllerGrpc.getUpdateExecutionVisibilityMethod = getUpdateExecutionVisibilityMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.agentic.workflowinstance.v1.UpdateExecutionVisibilityInput, ai.stigmer.agentic.workflowinstance.v1.WorkflowInstance>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "updateExecutionVisibility"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.workflowinstance.v1.UpdateExecutionVisibilityInput.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.workflowinstance.v1.WorkflowInstance.getDefaultInstance()))
              .setSchemaDescriptor(new WorkflowInstanceCommandControllerMethodDescriptorSupplier("updateExecutionVisibility"))
              .build();
        }
      }
    }
    return getUpdateExecutionVisibilityMethod;
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
   * WorkflowInstanceCommandController handles write operations for workflow instances.
   * &#64;internal
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
     * &#64;internal
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
     * Create a workflow instance.
     * &#64;internal
     * Input validation:
     * - metadata.org must be specified
     * - spec.workflow_id must be a valid Workflow resource ID
     * - spec.environment_refs must reference valid Environment resources
     * Authorization:
     * Uses custom authorization logic to verify:
     * 1. User has permission to access the referenced Workflow template
     * 2. User has permission to access all referenced Environment resources
     * 3. Owner scope is valid for the user's organization/identity
     * </pre>
     */
    default void create(ai.stigmer.agentic.workflowinstance.v1.WorkflowInstance request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.workflowinstance.v1.WorkflowInstance> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getCreateMethod(), responseObserver);
    }

    /**
     * <pre>
     * Update an existing workflow instance.
     * &#64;internal
     * Mutable fields:
     * - spec.description, spec.environment_refs
     * - metadata.labels, metadata.tags, metadata.annotations
     * Immutable fields (must delete and recreate to change):
     * - spec.workflow_id, metadata.id, metadata.org
     * Authorization:
     * Requires "update" permission on the specific WorkflowInstance resource.
     * Field path "metadata.id" identifies which resource to authorize.
     * Each update increments status.audit.version and updates status.audit.updated_at.
     * Error: PERMISSION_DENIED if user lacks update permission
     * </pre>
     */
    default void update(ai.stigmer.agentic.workflowinstance.v1.WorkflowInstance request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.workflowinstance.v1.WorkflowInstance> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getUpdateMethod(), responseObserver);
    }

    /**
     * <pre>
     * Update the visibility of an existing workflow instance.
     * Changes who can view this instance and its executions. Supports the full
     * visibility spectrum: PRIVATE (owner only), ORG (all org members), or
     * PUBLIC (all authenticated users).
     * For workflow instances, visibility has cascading effects on execution
     * observability: workflow executions inherit visibility from their parent
     * instance via FGA. An ORG-visible instance means all org members can see
     * all executions — zero per-execution tuples needed.
     * &#64;internal
     * Authorization: Requires can_edit permission on the workflow instance.
     * Visibility transitions trigger FGA tuple management in Cloud mode:
     * - PRIVATE → ORG: creates workflow_instance#viewer&#64;organization:&lt;org&gt;#member
     * - PRIVATE → PUBLIC: creates workflow_instance#viewer&#64;identity_account:*
     * - ORG → PRIVATE: deletes the org member viewer tuple
     * - PUBLIC → PRIVATE: deletes the wildcard viewer tuple
     * </pre>
     */
    default void updateVisibility(ai.stigmer.commons.apiresource.UpdateVisibilityInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.workflowinstance.v1.WorkflowInstance> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getUpdateVisibilityMethod(), responseObserver);
    }

    /**
     * <pre>
     * Update who can observe the run history (executions) of this instance.
     * This is a SEPARATE axis from updateVisibility: it controls run
     * observability (who sees execution inputs/outputs), not who can see/run
     * the instance itself. Making an instance org-runnable does NOT expose
     * other users' run history — that requires this opt-in.
     * Supported levels: PRIVATE (only the user who ran each execution) and
     * ORGANIZATION (all org members). Public/platform are unsupported.
     * &#64;internal
     * Authorization: requires can_grant_access on the workflow instance —
     * sharing run history is an access-granting action, consistent with the
     * per-execution share flow. In Cloud mode the transition reconciles the
     * instance's `execution_viewer` FGA relation:
     * - PRIVATE -&gt; ORGANIZATION: creates
     *   workflow_instance#execution_viewer&#64;organization:&lt;org&gt;#member
     * - ORGANIZATION -&gt; PRIVATE: deletes that tuple
     * </pre>
     */
    default void updateExecutionVisibility(ai.stigmer.agentic.workflowinstance.v1.UpdateExecutionVisibilityInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.workflowinstance.v1.WorkflowInstance> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getUpdateExecutionVisibilityMethod(), responseObserver);
    }

    /**
     * <pre>
     * Delete a workflow instance.
     * &#64;internal
     * Permanently removes a WorkflowInstance resource.
     * - Does NOT delete the referenced Workflow template (templates are reusable)
     * - Does NOT delete the referenced Environment resources (environments are reusable)
     * - DOES cascade delete any dependent WorkflowExecution resources (executions belong to instance)
     * Authorization:
     * Requires "delete" permission on the specific WorkflowInstance resource.
     * Field path "value" extracts the resource ID from WorkflowInstanceId wrapper.
     * Returns the deleted WorkflowInstance (final state before deletion).
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
   * WorkflowInstanceCommandController handles write operations for workflow instances.
   * &#64;internal
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
   * WorkflowInstanceCommandController handles write operations for workflow instances.
   * &#64;internal
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
     * &#64;internal
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
     * Create a workflow instance.
     * &#64;internal
     * Input validation:
     * - metadata.org must be specified
     * - spec.workflow_id must be a valid Workflow resource ID
     * - spec.environment_refs must reference valid Environment resources
     * Authorization:
     * Uses custom authorization logic to verify:
     * 1. User has permission to access the referenced Workflow template
     * 2. User has permission to access all referenced Environment resources
     * 3. Owner scope is valid for the user's organization/identity
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
     * &#64;internal
     * Mutable fields:
     * - spec.description, spec.environment_refs
     * - metadata.labels, metadata.tags, metadata.annotations
     * Immutable fields (must delete and recreate to change):
     * - spec.workflow_id, metadata.id, metadata.org
     * Authorization:
     * Requires "update" permission on the specific WorkflowInstance resource.
     * Field path "metadata.id" identifies which resource to authorize.
     * Each update increments status.audit.version and updates status.audit.updated_at.
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
     * Update the visibility of an existing workflow instance.
     * Changes who can view this instance and its executions. Supports the full
     * visibility spectrum: PRIVATE (owner only), ORG (all org members), or
     * PUBLIC (all authenticated users).
     * For workflow instances, visibility has cascading effects on execution
     * observability: workflow executions inherit visibility from their parent
     * instance via FGA. An ORG-visible instance means all org members can see
     * all executions — zero per-execution tuples needed.
     * &#64;internal
     * Authorization: Requires can_edit permission on the workflow instance.
     * Visibility transitions trigger FGA tuple management in Cloud mode:
     * - PRIVATE → ORG: creates workflow_instance#viewer&#64;organization:&lt;org&gt;#member
     * - PRIVATE → PUBLIC: creates workflow_instance#viewer&#64;identity_account:*
     * - ORG → PRIVATE: deletes the org member viewer tuple
     * - PUBLIC → PRIVATE: deletes the wildcard viewer tuple
     * </pre>
     */
    public void updateVisibility(ai.stigmer.commons.apiresource.UpdateVisibilityInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.workflowinstance.v1.WorkflowInstance> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getUpdateVisibilityMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * Update who can observe the run history (executions) of this instance.
     * This is a SEPARATE axis from updateVisibility: it controls run
     * observability (who sees execution inputs/outputs), not who can see/run
     * the instance itself. Making an instance org-runnable does NOT expose
     * other users' run history — that requires this opt-in.
     * Supported levels: PRIVATE (only the user who ran each execution) and
     * ORGANIZATION (all org members). Public/platform are unsupported.
     * &#64;internal
     * Authorization: requires can_grant_access on the workflow instance —
     * sharing run history is an access-granting action, consistent with the
     * per-execution share flow. In Cloud mode the transition reconciles the
     * instance's `execution_viewer` FGA relation:
     * - PRIVATE -&gt; ORGANIZATION: creates
     *   workflow_instance#execution_viewer&#64;organization:&lt;org&gt;#member
     * - ORGANIZATION -&gt; PRIVATE: deletes that tuple
     * </pre>
     */
    public void updateExecutionVisibility(ai.stigmer.agentic.workflowinstance.v1.UpdateExecutionVisibilityInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.workflowinstance.v1.WorkflowInstance> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getUpdateExecutionVisibilityMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * Delete a workflow instance.
     * &#64;internal
     * Permanently removes a WorkflowInstance resource.
     * - Does NOT delete the referenced Workflow template (templates are reusable)
     * - Does NOT delete the referenced Environment resources (environments are reusable)
     * - DOES cascade delete any dependent WorkflowExecution resources (executions belong to instance)
     * Authorization:
     * Requires "delete" permission on the specific WorkflowInstance resource.
     * Field path "value" extracts the resource ID from WorkflowInstanceId wrapper.
     * Returns the deleted WorkflowInstance (final state before deletion).
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
   * WorkflowInstanceCommandController handles write operations for workflow instances.
   * &#64;internal
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
     * &#64;internal
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
     * Create a workflow instance.
     * &#64;internal
     * Input validation:
     * - metadata.org must be specified
     * - spec.workflow_id must be a valid Workflow resource ID
     * - spec.environment_refs must reference valid Environment resources
     * Authorization:
     * Uses custom authorization logic to verify:
     * 1. User has permission to access the referenced Workflow template
     * 2. User has permission to access all referenced Environment resources
     * 3. Owner scope is valid for the user's organization/identity
     * </pre>
     */
    public ai.stigmer.agentic.workflowinstance.v1.WorkflowInstance create(ai.stigmer.agentic.workflowinstance.v1.WorkflowInstance request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getCreateMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Update an existing workflow instance.
     * &#64;internal
     * Mutable fields:
     * - spec.description, spec.environment_refs
     * - metadata.labels, metadata.tags, metadata.annotations
     * Immutable fields (must delete and recreate to change):
     * - spec.workflow_id, metadata.id, metadata.org
     * Authorization:
     * Requires "update" permission on the specific WorkflowInstance resource.
     * Field path "metadata.id" identifies which resource to authorize.
     * Each update increments status.audit.version and updates status.audit.updated_at.
     * Error: PERMISSION_DENIED if user lacks update permission
     * </pre>
     */
    public ai.stigmer.agentic.workflowinstance.v1.WorkflowInstance update(ai.stigmer.agentic.workflowinstance.v1.WorkflowInstance request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getUpdateMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Update the visibility of an existing workflow instance.
     * Changes who can view this instance and its executions. Supports the full
     * visibility spectrum: PRIVATE (owner only), ORG (all org members), or
     * PUBLIC (all authenticated users).
     * For workflow instances, visibility has cascading effects on execution
     * observability: workflow executions inherit visibility from their parent
     * instance via FGA. An ORG-visible instance means all org members can see
     * all executions — zero per-execution tuples needed.
     * &#64;internal
     * Authorization: Requires can_edit permission on the workflow instance.
     * Visibility transitions trigger FGA tuple management in Cloud mode:
     * - PRIVATE → ORG: creates workflow_instance#viewer&#64;organization:&lt;org&gt;#member
     * - PRIVATE → PUBLIC: creates workflow_instance#viewer&#64;identity_account:*
     * - ORG → PRIVATE: deletes the org member viewer tuple
     * - PUBLIC → PRIVATE: deletes the wildcard viewer tuple
     * </pre>
     */
    public ai.stigmer.agentic.workflowinstance.v1.WorkflowInstance updateVisibility(ai.stigmer.commons.apiresource.UpdateVisibilityInput request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getUpdateVisibilityMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Update who can observe the run history (executions) of this instance.
     * This is a SEPARATE axis from updateVisibility: it controls run
     * observability (who sees execution inputs/outputs), not who can see/run
     * the instance itself. Making an instance org-runnable does NOT expose
     * other users' run history — that requires this opt-in.
     * Supported levels: PRIVATE (only the user who ran each execution) and
     * ORGANIZATION (all org members). Public/platform are unsupported.
     * &#64;internal
     * Authorization: requires can_grant_access on the workflow instance —
     * sharing run history is an access-granting action, consistent with the
     * per-execution share flow. In Cloud mode the transition reconciles the
     * instance's `execution_viewer` FGA relation:
     * - PRIVATE -&gt; ORGANIZATION: creates
     *   workflow_instance#execution_viewer&#64;organization:&lt;org&gt;#member
     * - ORGANIZATION -&gt; PRIVATE: deletes that tuple
     * </pre>
     */
    public ai.stigmer.agentic.workflowinstance.v1.WorkflowInstance updateExecutionVisibility(ai.stigmer.agentic.workflowinstance.v1.UpdateExecutionVisibilityInput request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getUpdateExecutionVisibilityMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Delete a workflow instance.
     * &#64;internal
     * Permanently removes a WorkflowInstance resource.
     * - Does NOT delete the referenced Workflow template (templates are reusable)
     * - Does NOT delete the referenced Environment resources (environments are reusable)
     * - DOES cascade delete any dependent WorkflowExecution resources (executions belong to instance)
     * Authorization:
     * Requires "delete" permission on the specific WorkflowInstance resource.
     * Field path "value" extracts the resource ID from WorkflowInstanceId wrapper.
     * Returns the deleted WorkflowInstance (final state before deletion).
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
   * WorkflowInstanceCommandController handles write operations for workflow instances.
   * &#64;internal
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
     * &#64;internal
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
     * Create a workflow instance.
     * &#64;internal
     * Input validation:
     * - metadata.org must be specified
     * - spec.workflow_id must be a valid Workflow resource ID
     * - spec.environment_refs must reference valid Environment resources
     * Authorization:
     * Uses custom authorization logic to verify:
     * 1. User has permission to access the referenced Workflow template
     * 2. User has permission to access all referenced Environment resources
     * 3. Owner scope is valid for the user's organization/identity
     * </pre>
     */
    public ai.stigmer.agentic.workflowinstance.v1.WorkflowInstance create(ai.stigmer.agentic.workflowinstance.v1.WorkflowInstance request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getCreateMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Update an existing workflow instance.
     * &#64;internal
     * Mutable fields:
     * - spec.description, spec.environment_refs
     * - metadata.labels, metadata.tags, metadata.annotations
     * Immutable fields (must delete and recreate to change):
     * - spec.workflow_id, metadata.id, metadata.org
     * Authorization:
     * Requires "update" permission on the specific WorkflowInstance resource.
     * Field path "metadata.id" identifies which resource to authorize.
     * Each update increments status.audit.version and updates status.audit.updated_at.
     * Error: PERMISSION_DENIED if user lacks update permission
     * </pre>
     */
    public ai.stigmer.agentic.workflowinstance.v1.WorkflowInstance update(ai.stigmer.agentic.workflowinstance.v1.WorkflowInstance request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getUpdateMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Update the visibility of an existing workflow instance.
     * Changes who can view this instance and its executions. Supports the full
     * visibility spectrum: PRIVATE (owner only), ORG (all org members), or
     * PUBLIC (all authenticated users).
     * For workflow instances, visibility has cascading effects on execution
     * observability: workflow executions inherit visibility from their parent
     * instance via FGA. An ORG-visible instance means all org members can see
     * all executions — zero per-execution tuples needed.
     * &#64;internal
     * Authorization: Requires can_edit permission on the workflow instance.
     * Visibility transitions trigger FGA tuple management in Cloud mode:
     * - PRIVATE → ORG: creates workflow_instance#viewer&#64;organization:&lt;org&gt;#member
     * - PRIVATE → PUBLIC: creates workflow_instance#viewer&#64;identity_account:*
     * - ORG → PRIVATE: deletes the org member viewer tuple
     * - PUBLIC → PRIVATE: deletes the wildcard viewer tuple
     * </pre>
     */
    public ai.stigmer.agentic.workflowinstance.v1.WorkflowInstance updateVisibility(ai.stigmer.commons.apiresource.UpdateVisibilityInput request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getUpdateVisibilityMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Update who can observe the run history (executions) of this instance.
     * This is a SEPARATE axis from updateVisibility: it controls run
     * observability (who sees execution inputs/outputs), not who can see/run
     * the instance itself. Making an instance org-runnable does NOT expose
     * other users' run history — that requires this opt-in.
     * Supported levels: PRIVATE (only the user who ran each execution) and
     * ORGANIZATION (all org members). Public/platform are unsupported.
     * &#64;internal
     * Authorization: requires can_grant_access on the workflow instance —
     * sharing run history is an access-granting action, consistent with the
     * per-execution share flow. In Cloud mode the transition reconciles the
     * instance's `execution_viewer` FGA relation:
     * - PRIVATE -&gt; ORGANIZATION: creates
     *   workflow_instance#execution_viewer&#64;organization:&lt;org&gt;#member
     * - ORGANIZATION -&gt; PRIVATE: deletes that tuple
     * </pre>
     */
    public ai.stigmer.agentic.workflowinstance.v1.WorkflowInstance updateExecutionVisibility(ai.stigmer.agentic.workflowinstance.v1.UpdateExecutionVisibilityInput request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getUpdateExecutionVisibilityMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Delete a workflow instance.
     * &#64;internal
     * Permanently removes a WorkflowInstance resource.
     * - Does NOT delete the referenced Workflow template (templates are reusable)
     * - Does NOT delete the referenced Environment resources (environments are reusable)
     * - DOES cascade delete any dependent WorkflowExecution resources (executions belong to instance)
     * Authorization:
     * Requires "delete" permission on the specific WorkflowInstance resource.
     * Field path "value" extracts the resource ID from WorkflowInstanceId wrapper.
     * Returns the deleted WorkflowInstance (final state before deletion).
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
   * WorkflowInstanceCommandController handles write operations for workflow instances.
   * &#64;internal
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
     * &#64;internal
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
     * Create a workflow instance.
     * &#64;internal
     * Input validation:
     * - metadata.org must be specified
     * - spec.workflow_id must be a valid Workflow resource ID
     * - spec.environment_refs must reference valid Environment resources
     * Authorization:
     * Uses custom authorization logic to verify:
     * 1. User has permission to access the referenced Workflow template
     * 2. User has permission to access all referenced Environment resources
     * 3. Owner scope is valid for the user's organization/identity
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
     * &#64;internal
     * Mutable fields:
     * - spec.description, spec.environment_refs
     * - metadata.labels, metadata.tags, metadata.annotations
     * Immutable fields (must delete and recreate to change):
     * - spec.workflow_id, metadata.id, metadata.org
     * Authorization:
     * Requires "update" permission on the specific WorkflowInstance resource.
     * Field path "metadata.id" identifies which resource to authorize.
     * Each update increments status.audit.version and updates status.audit.updated_at.
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
     * Update the visibility of an existing workflow instance.
     * Changes who can view this instance and its executions. Supports the full
     * visibility spectrum: PRIVATE (owner only), ORG (all org members), or
     * PUBLIC (all authenticated users).
     * For workflow instances, visibility has cascading effects on execution
     * observability: workflow executions inherit visibility from their parent
     * instance via FGA. An ORG-visible instance means all org members can see
     * all executions — zero per-execution tuples needed.
     * &#64;internal
     * Authorization: Requires can_edit permission on the workflow instance.
     * Visibility transitions trigger FGA tuple management in Cloud mode:
     * - PRIVATE → ORG: creates workflow_instance#viewer&#64;organization:&lt;org&gt;#member
     * - PRIVATE → PUBLIC: creates workflow_instance#viewer&#64;identity_account:*
     * - ORG → PRIVATE: deletes the org member viewer tuple
     * - PUBLIC → PRIVATE: deletes the wildcard viewer tuple
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.agentic.workflowinstance.v1.WorkflowInstance> updateVisibility(
        ai.stigmer.commons.apiresource.UpdateVisibilityInput request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getUpdateVisibilityMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * Update who can observe the run history (executions) of this instance.
     * This is a SEPARATE axis from updateVisibility: it controls run
     * observability (who sees execution inputs/outputs), not who can see/run
     * the instance itself. Making an instance org-runnable does NOT expose
     * other users' run history — that requires this opt-in.
     * Supported levels: PRIVATE (only the user who ran each execution) and
     * ORGANIZATION (all org members). Public/platform are unsupported.
     * &#64;internal
     * Authorization: requires can_grant_access on the workflow instance —
     * sharing run history is an access-granting action, consistent with the
     * per-execution share flow. In Cloud mode the transition reconciles the
     * instance's `execution_viewer` FGA relation:
     * - PRIVATE -&gt; ORGANIZATION: creates
     *   workflow_instance#execution_viewer&#64;organization:&lt;org&gt;#member
     * - ORGANIZATION -&gt; PRIVATE: deletes that tuple
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.agentic.workflowinstance.v1.WorkflowInstance> updateExecutionVisibility(
        ai.stigmer.agentic.workflowinstance.v1.UpdateExecutionVisibilityInput request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getUpdateExecutionVisibilityMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * Delete a workflow instance.
     * &#64;internal
     * Permanently removes a WorkflowInstance resource.
     * - Does NOT delete the referenced Workflow template (templates are reusable)
     * - Does NOT delete the referenced Environment resources (environments are reusable)
     * - DOES cascade delete any dependent WorkflowExecution resources (executions belong to instance)
     * Authorization:
     * Requires "delete" permission on the specific WorkflowInstance resource.
     * Field path "value" extracts the resource ID from WorkflowInstanceId wrapper.
     * Returns the deleted WorkflowInstance (final state before deletion).
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
  private static final int METHODID_UPDATE_VISIBILITY = 3;
  private static final int METHODID_UPDATE_EXECUTION_VISIBILITY = 4;
  private static final int METHODID_DELETE = 5;

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
        case METHODID_UPDATE_VISIBILITY:
          serviceImpl.updateVisibility((ai.stigmer.commons.apiresource.UpdateVisibilityInput) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.agentic.workflowinstance.v1.WorkflowInstance>) responseObserver);
          break;
        case METHODID_UPDATE_EXECUTION_VISIBILITY:
          serviceImpl.updateExecutionVisibility((ai.stigmer.agentic.workflowinstance.v1.UpdateExecutionVisibilityInput) request,
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
          getUpdateVisibilityMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.commons.apiresource.UpdateVisibilityInput,
              ai.stigmer.agentic.workflowinstance.v1.WorkflowInstance>(
                service, METHODID_UPDATE_VISIBILITY)))
        .addMethod(
          getUpdateExecutionVisibilityMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.agentic.workflowinstance.v1.UpdateExecutionVisibilityInput,
              ai.stigmer.agentic.workflowinstance.v1.WorkflowInstance>(
                service, METHODID_UPDATE_EXECUTION_VISIBILITY)))
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
              .addMethod(getUpdateVisibilityMethod())
              .addMethod(getUpdateExecutionVisibilityMethod())
              .addMethod(getDeleteMethod())
              .build();
        }
      }
    }
    return result;
  }
}
