package ai.stigmer.agentic.workflow.v1;

import static io.grpc.MethodDescriptor.generateFullMethodName;

/**
 * <pre>
 * WorkflowQueryController handles read operations for workflows.
 * </pre>
 */
@io.grpc.stub.annotations.GrpcGenerated
public final class WorkflowQueryControllerGrpc {

  private WorkflowQueryControllerGrpc() {}

  public static final java.lang.String SERVICE_NAME = "ai.stigmer.agentic.workflow.v1.WorkflowQueryController";

  // Static method descriptors that strictly reflect the proto.
  private static volatile io.grpc.MethodDescriptor<ai.stigmer.agentic.workflow.v1.WorkflowId,
      ai.stigmer.agentic.workflow.v1.Workflow> getGetMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "get",
      requestType = ai.stigmer.agentic.workflow.v1.WorkflowId.class,
      responseType = ai.stigmer.agentic.workflow.v1.Workflow.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.agentic.workflow.v1.WorkflowId,
      ai.stigmer.agentic.workflow.v1.Workflow> getGetMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.agentic.workflow.v1.WorkflowId, ai.stigmer.agentic.workflow.v1.Workflow> getGetMethod;
    if ((getGetMethod = WorkflowQueryControllerGrpc.getGetMethod) == null) {
      synchronized (WorkflowQueryControllerGrpc.class) {
        if ((getGetMethod = WorkflowQueryControllerGrpc.getGetMethod) == null) {
          WorkflowQueryControllerGrpc.getGetMethod = getGetMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.agentic.workflow.v1.WorkflowId, ai.stigmer.agentic.workflow.v1.Workflow>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "get"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.workflow.v1.WorkflowId.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.workflow.v1.Workflow.getDefaultInstance()))
              .setSchemaDescriptor(new WorkflowQueryControllerMethodDescriptorSupplier("get"))
              .build();
        }
      }
    }
    return getGetMethod;
  }

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.commons.apiresource.ApiResourceReference,
      ai.stigmer.agentic.workflow.v1.Workflow> getGetByReferenceMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "getByReference",
      requestType = ai.stigmer.commons.apiresource.ApiResourceReference.class,
      responseType = ai.stigmer.agentic.workflow.v1.Workflow.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.commons.apiresource.ApiResourceReference,
      ai.stigmer.agentic.workflow.v1.Workflow> getGetByReferenceMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.commons.apiresource.ApiResourceReference, ai.stigmer.agentic.workflow.v1.Workflow> getGetByReferenceMethod;
    if ((getGetByReferenceMethod = WorkflowQueryControllerGrpc.getGetByReferenceMethod) == null) {
      synchronized (WorkflowQueryControllerGrpc.class) {
        if ((getGetByReferenceMethod = WorkflowQueryControllerGrpc.getGetByReferenceMethod) == null) {
          WorkflowQueryControllerGrpc.getGetByReferenceMethod = getGetByReferenceMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.commons.apiresource.ApiResourceReference, ai.stigmer.agentic.workflow.v1.Workflow>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "getByReference"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.commons.apiresource.ApiResourceReference.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.workflow.v1.Workflow.getDefaultInstance()))
              .setSchemaDescriptor(new WorkflowQueryControllerMethodDescriptorSupplier("getByReference"))
              .build();
        }
      }
    }
    return getGetByReferenceMethod;
  }

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.agentic.workflow.v1.ListWorkflowVersionsInput,
      ai.stigmer.agentic.workflow.v1.ListWorkflowVersionsResponse> getListVersionsMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "listVersions",
      requestType = ai.stigmer.agentic.workflow.v1.ListWorkflowVersionsInput.class,
      responseType = ai.stigmer.agentic.workflow.v1.ListWorkflowVersionsResponse.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.agentic.workflow.v1.ListWorkflowVersionsInput,
      ai.stigmer.agentic.workflow.v1.ListWorkflowVersionsResponse> getListVersionsMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.agentic.workflow.v1.ListWorkflowVersionsInput, ai.stigmer.agentic.workflow.v1.ListWorkflowVersionsResponse> getListVersionsMethod;
    if ((getListVersionsMethod = WorkflowQueryControllerGrpc.getListVersionsMethod) == null) {
      synchronized (WorkflowQueryControllerGrpc.class) {
        if ((getListVersionsMethod = WorkflowQueryControllerGrpc.getListVersionsMethod) == null) {
          WorkflowQueryControllerGrpc.getListVersionsMethod = getListVersionsMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.agentic.workflow.v1.ListWorkflowVersionsInput, ai.stigmer.agentic.workflow.v1.ListWorkflowVersionsResponse>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "listVersions"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.workflow.v1.ListWorkflowVersionsInput.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.workflow.v1.ListWorkflowVersionsResponse.getDefaultInstance()))
              .setSchemaDescriptor(new WorkflowQueryControllerMethodDescriptorSupplier("listVersions"))
              .build();
        }
      }
    }
    return getListVersionsMethod;
  }

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.agentic.workflow.v1.GetWorkflowVersionInput,
      ai.stigmer.agentic.workflow.v1.WorkflowVersionEntry> getGetVersionMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "getVersion",
      requestType = ai.stigmer.agentic.workflow.v1.GetWorkflowVersionInput.class,
      responseType = ai.stigmer.agentic.workflow.v1.WorkflowVersionEntry.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.agentic.workflow.v1.GetWorkflowVersionInput,
      ai.stigmer.agentic.workflow.v1.WorkflowVersionEntry> getGetVersionMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.agentic.workflow.v1.GetWorkflowVersionInput, ai.stigmer.agentic.workflow.v1.WorkflowVersionEntry> getGetVersionMethod;
    if ((getGetVersionMethod = WorkflowQueryControllerGrpc.getGetVersionMethod) == null) {
      synchronized (WorkflowQueryControllerGrpc.class) {
        if ((getGetVersionMethod = WorkflowQueryControllerGrpc.getGetVersionMethod) == null) {
          WorkflowQueryControllerGrpc.getGetVersionMethod = getGetVersionMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.agentic.workflow.v1.GetWorkflowVersionInput, ai.stigmer.agentic.workflow.v1.WorkflowVersionEntry>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "getVersion"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.workflow.v1.GetWorkflowVersionInput.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.workflow.v1.WorkflowVersionEntry.getDefaultInstance()))
              .setSchemaDescriptor(new WorkflowQueryControllerMethodDescriptorSupplier("getVersion"))
              .build();
        }
      }
    }
    return getGetVersionMethod;
  }

  /**
   * Creates a new async stub that supports all call types for the service
   */
  public static WorkflowQueryControllerStub newStub(io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<WorkflowQueryControllerStub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<WorkflowQueryControllerStub>() {
        @java.lang.Override
        public WorkflowQueryControllerStub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new WorkflowQueryControllerStub(channel, callOptions);
        }
      };
    return WorkflowQueryControllerStub.newStub(factory, channel);
  }

  /**
   * Creates a new blocking-style stub that supports all types of calls on the service
   */
  public static WorkflowQueryControllerBlockingV2Stub newBlockingV2Stub(
      io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<WorkflowQueryControllerBlockingV2Stub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<WorkflowQueryControllerBlockingV2Stub>() {
        @java.lang.Override
        public WorkflowQueryControllerBlockingV2Stub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new WorkflowQueryControllerBlockingV2Stub(channel, callOptions);
        }
      };
    return WorkflowQueryControllerBlockingV2Stub.newStub(factory, channel);
  }

  /**
   * Creates a new blocking-style stub that supports unary and streaming output calls on the service
   */
  public static WorkflowQueryControllerBlockingStub newBlockingStub(
      io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<WorkflowQueryControllerBlockingStub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<WorkflowQueryControllerBlockingStub>() {
        @java.lang.Override
        public WorkflowQueryControllerBlockingStub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new WorkflowQueryControllerBlockingStub(channel, callOptions);
        }
      };
    return WorkflowQueryControllerBlockingStub.newStub(factory, channel);
  }

  /**
   * Creates a new ListenableFuture-style stub that supports unary calls on the service
   */
  public static WorkflowQueryControllerFutureStub newFutureStub(
      io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<WorkflowQueryControllerFutureStub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<WorkflowQueryControllerFutureStub>() {
        @java.lang.Override
        public WorkflowQueryControllerFutureStub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new WorkflowQueryControllerFutureStub(channel, callOptions);
        }
      };
    return WorkflowQueryControllerFutureStub.newStub(factory, channel);
  }

  /**
   * <pre>
   * WorkflowQueryController handles read operations for workflows.
   * </pre>
   */
  public interface AsyncService {

    /**
     * <pre>
     * Get a single workflow by ID.
     * </pre>
     */
    default void get(ai.stigmer.agentic.workflow.v1.WorkflowId request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.workflow.v1.Workflow> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getGetMethod(), responseObserver);
    }

    /**
     * <pre>
     * Get a workflow by its organization-scoped reference (org/slug) with version support.
     * Version resolution (via ApiResourceReference.version field):
     * - Empty/"latest" → Returns the current version
     * - Tag name (e.g., "stable", "v1.0") → Resolves to the version with this tag
     * - SHA256 hash (64 hex chars) → Returns the exact immutable version
     * &#64;internal
     * Custom authorization in handler — checks both direct resource access
     * and organization-level visibility permissions.
     * </pre>
     */
    default void getByReference(ai.stigmer.commons.apiresource.ApiResourceReference request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.workflow.v1.Workflow> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getGetByReferenceMethod(), responseObserver);
    }

    /**
     * <pre>
     * List version history for a workflow.
     * Returns all historical versions ordered by applied_at (newest first).
     * Each entry includes the version hash, applied timestamp, actor, tag,
     * git provenance, and the validated CNCF YAML for historical access.
     * &#64;internal
     * Authorization is handled in the handler after resolving the workflow.
     * (Input uses org+slug, not workflow ID, so proto-level auth cannot work)
     * &#64;since Workflow Versioning
     * </pre>
     */
    default void listVersions(ai.stigmer.agentic.workflow.v1.ListWorkflowVersionsInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.workflow.v1.ListWorkflowVersionsResponse> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getListVersionsMethod(), responseObserver);
    }

    /**
     * <pre>
     * Get a specific historical version of a workflow by its content hash.
     * Used by the runner (to hydrate execution from a pinned version) and
     * the execution viewer (to render the graph for historical executions).
     * &#64;internal
     * Authorization uses can_view on the workflow resource.
     * &#64;since Workflow Versioning
     * </pre>
     */
    default void getVersion(ai.stigmer.agentic.workflow.v1.GetWorkflowVersionInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.workflow.v1.WorkflowVersionEntry> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getGetVersionMethod(), responseObserver);
    }
  }

  /**
   * Base class for the server implementation of the service WorkflowQueryController.
   * <pre>
   * WorkflowQueryController handles read operations for workflows.
   * </pre>
   */
  public static abstract class WorkflowQueryControllerImplBase
      implements io.grpc.BindableService, AsyncService {

    @java.lang.Override public final io.grpc.ServerServiceDefinition bindService() {
      return WorkflowQueryControllerGrpc.bindService(this);
    }
  }

  /**
   * A stub to allow clients to do asynchronous rpc calls to service WorkflowQueryController.
   * <pre>
   * WorkflowQueryController handles read operations for workflows.
   * </pre>
   */
  public static final class WorkflowQueryControllerStub
      extends io.grpc.stub.AbstractAsyncStub<WorkflowQueryControllerStub> {
    private WorkflowQueryControllerStub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected WorkflowQueryControllerStub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new WorkflowQueryControllerStub(channel, callOptions);
    }

    /**
     * <pre>
     * Get a single workflow by ID.
     * </pre>
     */
    public void get(ai.stigmer.agentic.workflow.v1.WorkflowId request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.workflow.v1.Workflow> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getGetMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * Get a workflow by its organization-scoped reference (org/slug) with version support.
     * Version resolution (via ApiResourceReference.version field):
     * - Empty/"latest" → Returns the current version
     * - Tag name (e.g., "stable", "v1.0") → Resolves to the version with this tag
     * - SHA256 hash (64 hex chars) → Returns the exact immutable version
     * &#64;internal
     * Custom authorization in handler — checks both direct resource access
     * and organization-level visibility permissions.
     * </pre>
     */
    public void getByReference(ai.stigmer.commons.apiresource.ApiResourceReference request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.workflow.v1.Workflow> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getGetByReferenceMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * List version history for a workflow.
     * Returns all historical versions ordered by applied_at (newest first).
     * Each entry includes the version hash, applied timestamp, actor, tag,
     * git provenance, and the validated CNCF YAML for historical access.
     * &#64;internal
     * Authorization is handled in the handler after resolving the workflow.
     * (Input uses org+slug, not workflow ID, so proto-level auth cannot work)
     * &#64;since Workflow Versioning
     * </pre>
     */
    public void listVersions(ai.stigmer.agentic.workflow.v1.ListWorkflowVersionsInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.workflow.v1.ListWorkflowVersionsResponse> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getListVersionsMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * Get a specific historical version of a workflow by its content hash.
     * Used by the runner (to hydrate execution from a pinned version) and
     * the execution viewer (to render the graph for historical executions).
     * &#64;internal
     * Authorization uses can_view on the workflow resource.
     * &#64;since Workflow Versioning
     * </pre>
     */
    public void getVersion(ai.stigmer.agentic.workflow.v1.GetWorkflowVersionInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.workflow.v1.WorkflowVersionEntry> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getGetVersionMethod(), getCallOptions()), request, responseObserver);
    }
  }

  /**
   * A stub to allow clients to do synchronous rpc calls to service WorkflowQueryController.
   * <pre>
   * WorkflowQueryController handles read operations for workflows.
   * </pre>
   */
  public static final class WorkflowQueryControllerBlockingV2Stub
      extends io.grpc.stub.AbstractBlockingStub<WorkflowQueryControllerBlockingV2Stub> {
    private WorkflowQueryControllerBlockingV2Stub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected WorkflowQueryControllerBlockingV2Stub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new WorkflowQueryControllerBlockingV2Stub(channel, callOptions);
    }

    /**
     * <pre>
     * Get a single workflow by ID.
     * </pre>
     */
    public ai.stigmer.agentic.workflow.v1.Workflow get(ai.stigmer.agentic.workflow.v1.WorkflowId request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getGetMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Get a workflow by its organization-scoped reference (org/slug) with version support.
     * Version resolution (via ApiResourceReference.version field):
     * - Empty/"latest" → Returns the current version
     * - Tag name (e.g., "stable", "v1.0") → Resolves to the version with this tag
     * - SHA256 hash (64 hex chars) → Returns the exact immutable version
     * &#64;internal
     * Custom authorization in handler — checks both direct resource access
     * and organization-level visibility permissions.
     * </pre>
     */
    public ai.stigmer.agentic.workflow.v1.Workflow getByReference(ai.stigmer.commons.apiresource.ApiResourceReference request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getGetByReferenceMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * List version history for a workflow.
     * Returns all historical versions ordered by applied_at (newest first).
     * Each entry includes the version hash, applied timestamp, actor, tag,
     * git provenance, and the validated CNCF YAML for historical access.
     * &#64;internal
     * Authorization is handled in the handler after resolving the workflow.
     * (Input uses org+slug, not workflow ID, so proto-level auth cannot work)
     * &#64;since Workflow Versioning
     * </pre>
     */
    public ai.stigmer.agentic.workflow.v1.ListWorkflowVersionsResponse listVersions(ai.stigmer.agentic.workflow.v1.ListWorkflowVersionsInput request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getListVersionsMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Get a specific historical version of a workflow by its content hash.
     * Used by the runner (to hydrate execution from a pinned version) and
     * the execution viewer (to render the graph for historical executions).
     * &#64;internal
     * Authorization uses can_view on the workflow resource.
     * &#64;since Workflow Versioning
     * </pre>
     */
    public ai.stigmer.agentic.workflow.v1.WorkflowVersionEntry getVersion(ai.stigmer.agentic.workflow.v1.GetWorkflowVersionInput request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getGetVersionMethod(), getCallOptions(), request);
    }
  }

  /**
   * A stub to allow clients to do limited synchronous rpc calls to service WorkflowQueryController.
   * <pre>
   * WorkflowQueryController handles read operations for workflows.
   * </pre>
   */
  public static final class WorkflowQueryControllerBlockingStub
      extends io.grpc.stub.AbstractBlockingStub<WorkflowQueryControllerBlockingStub> {
    private WorkflowQueryControllerBlockingStub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected WorkflowQueryControllerBlockingStub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new WorkflowQueryControllerBlockingStub(channel, callOptions);
    }

    /**
     * <pre>
     * Get a single workflow by ID.
     * </pre>
     */
    public ai.stigmer.agentic.workflow.v1.Workflow get(ai.stigmer.agentic.workflow.v1.WorkflowId request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getGetMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Get a workflow by its organization-scoped reference (org/slug) with version support.
     * Version resolution (via ApiResourceReference.version field):
     * - Empty/"latest" → Returns the current version
     * - Tag name (e.g., "stable", "v1.0") → Resolves to the version with this tag
     * - SHA256 hash (64 hex chars) → Returns the exact immutable version
     * &#64;internal
     * Custom authorization in handler — checks both direct resource access
     * and organization-level visibility permissions.
     * </pre>
     */
    public ai.stigmer.agentic.workflow.v1.Workflow getByReference(ai.stigmer.commons.apiresource.ApiResourceReference request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getGetByReferenceMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * List version history for a workflow.
     * Returns all historical versions ordered by applied_at (newest first).
     * Each entry includes the version hash, applied timestamp, actor, tag,
     * git provenance, and the validated CNCF YAML for historical access.
     * &#64;internal
     * Authorization is handled in the handler after resolving the workflow.
     * (Input uses org+slug, not workflow ID, so proto-level auth cannot work)
     * &#64;since Workflow Versioning
     * </pre>
     */
    public ai.stigmer.agentic.workflow.v1.ListWorkflowVersionsResponse listVersions(ai.stigmer.agentic.workflow.v1.ListWorkflowVersionsInput request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getListVersionsMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Get a specific historical version of a workflow by its content hash.
     * Used by the runner (to hydrate execution from a pinned version) and
     * the execution viewer (to render the graph for historical executions).
     * &#64;internal
     * Authorization uses can_view on the workflow resource.
     * &#64;since Workflow Versioning
     * </pre>
     */
    public ai.stigmer.agentic.workflow.v1.WorkflowVersionEntry getVersion(ai.stigmer.agentic.workflow.v1.GetWorkflowVersionInput request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getGetVersionMethod(), getCallOptions(), request);
    }
  }

  /**
   * A stub to allow clients to do ListenableFuture-style rpc calls to service WorkflowQueryController.
   * <pre>
   * WorkflowQueryController handles read operations for workflows.
   * </pre>
   */
  public static final class WorkflowQueryControllerFutureStub
      extends io.grpc.stub.AbstractFutureStub<WorkflowQueryControllerFutureStub> {
    private WorkflowQueryControllerFutureStub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected WorkflowQueryControllerFutureStub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new WorkflowQueryControllerFutureStub(channel, callOptions);
    }

    /**
     * <pre>
     * Get a single workflow by ID.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.agentic.workflow.v1.Workflow> get(
        ai.stigmer.agentic.workflow.v1.WorkflowId request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getGetMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * Get a workflow by its organization-scoped reference (org/slug) with version support.
     * Version resolution (via ApiResourceReference.version field):
     * - Empty/"latest" → Returns the current version
     * - Tag name (e.g., "stable", "v1.0") → Resolves to the version with this tag
     * - SHA256 hash (64 hex chars) → Returns the exact immutable version
     * &#64;internal
     * Custom authorization in handler — checks both direct resource access
     * and organization-level visibility permissions.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.agentic.workflow.v1.Workflow> getByReference(
        ai.stigmer.commons.apiresource.ApiResourceReference request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getGetByReferenceMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * List version history for a workflow.
     * Returns all historical versions ordered by applied_at (newest first).
     * Each entry includes the version hash, applied timestamp, actor, tag,
     * git provenance, and the validated CNCF YAML for historical access.
     * &#64;internal
     * Authorization is handled in the handler after resolving the workflow.
     * (Input uses org+slug, not workflow ID, so proto-level auth cannot work)
     * &#64;since Workflow Versioning
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.agentic.workflow.v1.ListWorkflowVersionsResponse> listVersions(
        ai.stigmer.agentic.workflow.v1.ListWorkflowVersionsInput request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getListVersionsMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * Get a specific historical version of a workflow by its content hash.
     * Used by the runner (to hydrate execution from a pinned version) and
     * the execution viewer (to render the graph for historical executions).
     * &#64;internal
     * Authorization uses can_view on the workflow resource.
     * &#64;since Workflow Versioning
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.agentic.workflow.v1.WorkflowVersionEntry> getVersion(
        ai.stigmer.agentic.workflow.v1.GetWorkflowVersionInput request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getGetVersionMethod(), getCallOptions()), request);
    }
  }

  private static final int METHODID_GET = 0;
  private static final int METHODID_GET_BY_REFERENCE = 1;
  private static final int METHODID_LIST_VERSIONS = 2;
  private static final int METHODID_GET_VERSION = 3;

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
          serviceImpl.get((ai.stigmer.agentic.workflow.v1.WorkflowId) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.agentic.workflow.v1.Workflow>) responseObserver);
          break;
        case METHODID_GET_BY_REFERENCE:
          serviceImpl.getByReference((ai.stigmer.commons.apiresource.ApiResourceReference) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.agentic.workflow.v1.Workflow>) responseObserver);
          break;
        case METHODID_LIST_VERSIONS:
          serviceImpl.listVersions((ai.stigmer.agentic.workflow.v1.ListWorkflowVersionsInput) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.agentic.workflow.v1.ListWorkflowVersionsResponse>) responseObserver);
          break;
        case METHODID_GET_VERSION:
          serviceImpl.getVersion((ai.stigmer.agentic.workflow.v1.GetWorkflowVersionInput) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.agentic.workflow.v1.WorkflowVersionEntry>) responseObserver);
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
              ai.stigmer.agentic.workflow.v1.WorkflowId,
              ai.stigmer.agentic.workflow.v1.Workflow>(
                service, METHODID_GET)))
        .addMethod(
          getGetByReferenceMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.commons.apiresource.ApiResourceReference,
              ai.stigmer.agentic.workflow.v1.Workflow>(
                service, METHODID_GET_BY_REFERENCE)))
        .addMethod(
          getListVersionsMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.agentic.workflow.v1.ListWorkflowVersionsInput,
              ai.stigmer.agentic.workflow.v1.ListWorkflowVersionsResponse>(
                service, METHODID_LIST_VERSIONS)))
        .addMethod(
          getGetVersionMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.agentic.workflow.v1.GetWorkflowVersionInput,
              ai.stigmer.agentic.workflow.v1.WorkflowVersionEntry>(
                service, METHODID_GET_VERSION)))
        .build();
  }

  private static abstract class WorkflowQueryControllerBaseDescriptorSupplier
      implements io.grpc.protobuf.ProtoFileDescriptorSupplier, io.grpc.protobuf.ProtoServiceDescriptorSupplier {
    WorkflowQueryControllerBaseDescriptorSupplier() {}

    @java.lang.Override
    public com.google.protobuf.Descriptors.FileDescriptor getFileDescriptor() {
      return ai.stigmer.agentic.workflow.v1.QueryProto.getDescriptor();
    }

    @java.lang.Override
    public com.google.protobuf.Descriptors.ServiceDescriptor getServiceDescriptor() {
      return getFileDescriptor().findServiceByName("WorkflowQueryController");
    }
  }

  private static final class WorkflowQueryControllerFileDescriptorSupplier
      extends WorkflowQueryControllerBaseDescriptorSupplier {
    WorkflowQueryControllerFileDescriptorSupplier() {}
  }

  private static final class WorkflowQueryControllerMethodDescriptorSupplier
      extends WorkflowQueryControllerBaseDescriptorSupplier
      implements io.grpc.protobuf.ProtoMethodDescriptorSupplier {
    private final java.lang.String methodName;

    WorkflowQueryControllerMethodDescriptorSupplier(java.lang.String methodName) {
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
      synchronized (WorkflowQueryControllerGrpc.class) {
        result = serviceDescriptor;
        if (result == null) {
          serviceDescriptor = result = io.grpc.ServiceDescriptor.newBuilder(SERVICE_NAME)
              .setSchemaDescriptor(new WorkflowQueryControllerFileDescriptorSupplier())
              .addMethod(getGetMethod())
              .addMethod(getGetByReferenceMethod())
              .addMethod(getListVersionsMethod())
              .addMethod(getGetVersionMethod())
              .build();
        }
      }
    }
    return result;
  }
}
