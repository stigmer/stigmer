package ai.stigmer.tenancy.project.v1;

import static io.grpc.MethodDescriptor.generateFullMethodName;

/**
 * <pre>
 * ProjectCommandController handles write operations for projects.
 * </pre>
 */
@io.grpc.stub.annotations.GrpcGenerated
public final class ProjectCommandControllerGrpc {

  private ProjectCommandControllerGrpc() {}

  public static final java.lang.String SERVICE_NAME = "ai.stigmer.tenancy.project.v1.ProjectCommandController";

  // Static method descriptors that strictly reflect the proto.
  private static volatile io.grpc.MethodDescriptor<ai.stigmer.tenancy.project.v1.Project,
      ai.stigmer.tenancy.project.v1.Project> getApplyMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "apply",
      requestType = ai.stigmer.tenancy.project.v1.Project.class,
      responseType = ai.stigmer.tenancy.project.v1.Project.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.tenancy.project.v1.Project,
      ai.stigmer.tenancy.project.v1.Project> getApplyMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.tenancy.project.v1.Project, ai.stigmer.tenancy.project.v1.Project> getApplyMethod;
    if ((getApplyMethod = ProjectCommandControllerGrpc.getApplyMethod) == null) {
      synchronized (ProjectCommandControllerGrpc.class) {
        if ((getApplyMethod = ProjectCommandControllerGrpc.getApplyMethod) == null) {
          ProjectCommandControllerGrpc.getApplyMethod = getApplyMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.tenancy.project.v1.Project, ai.stigmer.tenancy.project.v1.Project>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "apply"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.tenancy.project.v1.Project.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.tenancy.project.v1.Project.getDefaultInstance()))
              .setSchemaDescriptor(new ProjectCommandControllerMethodDescriptorSupplier("apply"))
              .build();
        }
      }
    }
    return getApplyMethod;
  }

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.tenancy.project.v1.Project,
      ai.stigmer.tenancy.project.v1.Project> getCreateMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "create",
      requestType = ai.stigmer.tenancy.project.v1.Project.class,
      responseType = ai.stigmer.tenancy.project.v1.Project.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.tenancy.project.v1.Project,
      ai.stigmer.tenancy.project.v1.Project> getCreateMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.tenancy.project.v1.Project, ai.stigmer.tenancy.project.v1.Project> getCreateMethod;
    if ((getCreateMethod = ProjectCommandControllerGrpc.getCreateMethod) == null) {
      synchronized (ProjectCommandControllerGrpc.class) {
        if ((getCreateMethod = ProjectCommandControllerGrpc.getCreateMethod) == null) {
          ProjectCommandControllerGrpc.getCreateMethod = getCreateMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.tenancy.project.v1.Project, ai.stigmer.tenancy.project.v1.Project>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "create"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.tenancy.project.v1.Project.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.tenancy.project.v1.Project.getDefaultInstance()))
              .setSchemaDescriptor(new ProjectCommandControllerMethodDescriptorSupplier("create"))
              .build();
        }
      }
    }
    return getCreateMethod;
  }

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.tenancy.project.v1.Project,
      ai.stigmer.tenancy.project.v1.Project> getUpdateMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "update",
      requestType = ai.stigmer.tenancy.project.v1.Project.class,
      responseType = ai.stigmer.tenancy.project.v1.Project.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.tenancy.project.v1.Project,
      ai.stigmer.tenancy.project.v1.Project> getUpdateMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.tenancy.project.v1.Project, ai.stigmer.tenancy.project.v1.Project> getUpdateMethod;
    if ((getUpdateMethod = ProjectCommandControllerGrpc.getUpdateMethod) == null) {
      synchronized (ProjectCommandControllerGrpc.class) {
        if ((getUpdateMethod = ProjectCommandControllerGrpc.getUpdateMethod) == null) {
          ProjectCommandControllerGrpc.getUpdateMethod = getUpdateMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.tenancy.project.v1.Project, ai.stigmer.tenancy.project.v1.Project>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "update"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.tenancy.project.v1.Project.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.tenancy.project.v1.Project.getDefaultInstance()))
              .setSchemaDescriptor(new ProjectCommandControllerMethodDescriptorSupplier("update"))
              .build();
        }
      }
    }
    return getUpdateMethod;
  }

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.tenancy.project.v1.ProjectId,
      ai.stigmer.tenancy.project.v1.Project> getDeleteMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "delete",
      requestType = ai.stigmer.tenancy.project.v1.ProjectId.class,
      responseType = ai.stigmer.tenancy.project.v1.Project.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.tenancy.project.v1.ProjectId,
      ai.stigmer.tenancy.project.v1.Project> getDeleteMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.tenancy.project.v1.ProjectId, ai.stigmer.tenancy.project.v1.Project> getDeleteMethod;
    if ((getDeleteMethod = ProjectCommandControllerGrpc.getDeleteMethod) == null) {
      synchronized (ProjectCommandControllerGrpc.class) {
        if ((getDeleteMethod = ProjectCommandControllerGrpc.getDeleteMethod) == null) {
          ProjectCommandControllerGrpc.getDeleteMethod = getDeleteMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.tenancy.project.v1.ProjectId, ai.stigmer.tenancy.project.v1.Project>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "delete"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.tenancy.project.v1.ProjectId.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.tenancy.project.v1.Project.getDefaultInstance()))
              .setSchemaDescriptor(new ProjectCommandControllerMethodDescriptorSupplier("delete"))
              .build();
        }
      }
    }
    return getDeleteMethod;
  }

  /**
   * Creates a new async stub that supports all call types for the service
   */
  public static ProjectCommandControllerStub newStub(io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<ProjectCommandControllerStub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<ProjectCommandControllerStub>() {
        @java.lang.Override
        public ProjectCommandControllerStub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new ProjectCommandControllerStub(channel, callOptions);
        }
      };
    return ProjectCommandControllerStub.newStub(factory, channel);
  }

  /**
   * Creates a new blocking-style stub that supports all types of calls on the service
   */
  public static ProjectCommandControllerBlockingV2Stub newBlockingV2Stub(
      io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<ProjectCommandControllerBlockingV2Stub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<ProjectCommandControllerBlockingV2Stub>() {
        @java.lang.Override
        public ProjectCommandControllerBlockingV2Stub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new ProjectCommandControllerBlockingV2Stub(channel, callOptions);
        }
      };
    return ProjectCommandControllerBlockingV2Stub.newStub(factory, channel);
  }

  /**
   * Creates a new blocking-style stub that supports unary and streaming output calls on the service
   */
  public static ProjectCommandControllerBlockingStub newBlockingStub(
      io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<ProjectCommandControllerBlockingStub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<ProjectCommandControllerBlockingStub>() {
        @java.lang.Override
        public ProjectCommandControllerBlockingStub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new ProjectCommandControllerBlockingStub(channel, callOptions);
        }
      };
    return ProjectCommandControllerBlockingStub.newStub(factory, channel);
  }

  /**
   * Creates a new ListenableFuture-style stub that supports unary calls on the service
   */
  public static ProjectCommandControllerFutureStub newFutureStub(
      io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<ProjectCommandControllerFutureStub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<ProjectCommandControllerFutureStub>() {
        @java.lang.Override
        public ProjectCommandControllerFutureStub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new ProjectCommandControllerFutureStub(channel, callOptions);
        }
      };
    return ProjectCommandControllerFutureStub.newStub(factory, channel);
  }

  /**
   * <pre>
   * ProjectCommandController handles write operations for projects.
   * </pre>
   */
  public interface AsyncService {

    /**
     * <pre>
     * Create or update a project.
     * The authorization and state-operation are determined depending on whether the project
     * is going to be created or updated which is determined as part of the request execution.
     * </pre>
     */
    default void apply(ai.stigmer.tenancy.project.v1.Project request,
        io.grpc.stub.StreamObserver<ai.stigmer.tenancy.project.v1.Project> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getApplyMethod(), responseObserver);
    }

    /**
     * <pre>
     * Create a new project.
     * Authorization:
     * - Organization-scoped projects: Caller must have can_create_project permission in the organization
     * - Platform-scoped projects: Caller must be a platform operator (handled automatically by common auth step)
     * </pre>
     */
    default void create(ai.stigmer.tenancy.project.v1.Project request,
        io.grpc.stub.StreamObserver<ai.stigmer.tenancy.project.v1.Project> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getCreateMethod(), responseObserver);
    }

    /**
     * <pre>
     * Update an existing project.
     * </pre>
     */
    default void update(ai.stigmer.tenancy.project.v1.Project request,
        io.grpc.stub.StreamObserver<ai.stigmer.tenancy.project.v1.Project> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getUpdateMethod(), responseObserver);
    }

    /**
     * <pre>
     * Delete a project.
     * </pre>
     */
    default void delete(ai.stigmer.tenancy.project.v1.ProjectId request,
        io.grpc.stub.StreamObserver<ai.stigmer.tenancy.project.v1.Project> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getDeleteMethod(), responseObserver);
    }
  }

  /**
   * Base class for the server implementation of the service ProjectCommandController.
   * <pre>
   * ProjectCommandController handles write operations for projects.
   * </pre>
   */
  public static abstract class ProjectCommandControllerImplBase
      implements io.grpc.BindableService, AsyncService {

    @java.lang.Override public final io.grpc.ServerServiceDefinition bindService() {
      return ProjectCommandControllerGrpc.bindService(this);
    }
  }

  /**
   * A stub to allow clients to do asynchronous rpc calls to service ProjectCommandController.
   * <pre>
   * ProjectCommandController handles write operations for projects.
   * </pre>
   */
  public static final class ProjectCommandControllerStub
      extends io.grpc.stub.AbstractAsyncStub<ProjectCommandControllerStub> {
    private ProjectCommandControllerStub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected ProjectCommandControllerStub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new ProjectCommandControllerStub(channel, callOptions);
    }

    /**
     * <pre>
     * Create or update a project.
     * The authorization and state-operation are determined depending on whether the project
     * is going to be created or updated which is determined as part of the request execution.
     * </pre>
     */
    public void apply(ai.stigmer.tenancy.project.v1.Project request,
        io.grpc.stub.StreamObserver<ai.stigmer.tenancy.project.v1.Project> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getApplyMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * Create a new project.
     * Authorization:
     * - Organization-scoped projects: Caller must have can_create_project permission in the organization
     * - Platform-scoped projects: Caller must be a platform operator (handled automatically by common auth step)
     * </pre>
     */
    public void create(ai.stigmer.tenancy.project.v1.Project request,
        io.grpc.stub.StreamObserver<ai.stigmer.tenancy.project.v1.Project> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getCreateMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * Update an existing project.
     * </pre>
     */
    public void update(ai.stigmer.tenancy.project.v1.Project request,
        io.grpc.stub.StreamObserver<ai.stigmer.tenancy.project.v1.Project> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getUpdateMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * Delete a project.
     * </pre>
     */
    public void delete(ai.stigmer.tenancy.project.v1.ProjectId request,
        io.grpc.stub.StreamObserver<ai.stigmer.tenancy.project.v1.Project> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getDeleteMethod(), getCallOptions()), request, responseObserver);
    }
  }

  /**
   * A stub to allow clients to do synchronous rpc calls to service ProjectCommandController.
   * <pre>
   * ProjectCommandController handles write operations for projects.
   * </pre>
   */
  public static final class ProjectCommandControllerBlockingV2Stub
      extends io.grpc.stub.AbstractBlockingStub<ProjectCommandControllerBlockingV2Stub> {
    private ProjectCommandControllerBlockingV2Stub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected ProjectCommandControllerBlockingV2Stub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new ProjectCommandControllerBlockingV2Stub(channel, callOptions);
    }

    /**
     * <pre>
     * Create or update a project.
     * The authorization and state-operation are determined depending on whether the project
     * is going to be created or updated which is determined as part of the request execution.
     * </pre>
     */
    public ai.stigmer.tenancy.project.v1.Project apply(ai.stigmer.tenancy.project.v1.Project request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getApplyMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Create a new project.
     * Authorization:
     * - Organization-scoped projects: Caller must have can_create_project permission in the organization
     * - Platform-scoped projects: Caller must be a platform operator (handled automatically by common auth step)
     * </pre>
     */
    public ai.stigmer.tenancy.project.v1.Project create(ai.stigmer.tenancy.project.v1.Project request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getCreateMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Update an existing project.
     * </pre>
     */
    public ai.stigmer.tenancy.project.v1.Project update(ai.stigmer.tenancy.project.v1.Project request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getUpdateMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Delete a project.
     * </pre>
     */
    public ai.stigmer.tenancy.project.v1.Project delete(ai.stigmer.tenancy.project.v1.ProjectId request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getDeleteMethod(), getCallOptions(), request);
    }
  }

  /**
   * A stub to allow clients to do limited synchronous rpc calls to service ProjectCommandController.
   * <pre>
   * ProjectCommandController handles write operations for projects.
   * </pre>
   */
  public static final class ProjectCommandControllerBlockingStub
      extends io.grpc.stub.AbstractBlockingStub<ProjectCommandControllerBlockingStub> {
    private ProjectCommandControllerBlockingStub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected ProjectCommandControllerBlockingStub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new ProjectCommandControllerBlockingStub(channel, callOptions);
    }

    /**
     * <pre>
     * Create or update a project.
     * The authorization and state-operation are determined depending on whether the project
     * is going to be created or updated which is determined as part of the request execution.
     * </pre>
     */
    public ai.stigmer.tenancy.project.v1.Project apply(ai.stigmer.tenancy.project.v1.Project request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getApplyMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Create a new project.
     * Authorization:
     * - Organization-scoped projects: Caller must have can_create_project permission in the organization
     * - Platform-scoped projects: Caller must be a platform operator (handled automatically by common auth step)
     * </pre>
     */
    public ai.stigmer.tenancy.project.v1.Project create(ai.stigmer.tenancy.project.v1.Project request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getCreateMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Update an existing project.
     * </pre>
     */
    public ai.stigmer.tenancy.project.v1.Project update(ai.stigmer.tenancy.project.v1.Project request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getUpdateMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Delete a project.
     * </pre>
     */
    public ai.stigmer.tenancy.project.v1.Project delete(ai.stigmer.tenancy.project.v1.ProjectId request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getDeleteMethod(), getCallOptions(), request);
    }
  }

  /**
   * A stub to allow clients to do ListenableFuture-style rpc calls to service ProjectCommandController.
   * <pre>
   * ProjectCommandController handles write operations for projects.
   * </pre>
   */
  public static final class ProjectCommandControllerFutureStub
      extends io.grpc.stub.AbstractFutureStub<ProjectCommandControllerFutureStub> {
    private ProjectCommandControllerFutureStub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected ProjectCommandControllerFutureStub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new ProjectCommandControllerFutureStub(channel, callOptions);
    }

    /**
     * <pre>
     * Create or update a project.
     * The authorization and state-operation are determined depending on whether the project
     * is going to be created or updated which is determined as part of the request execution.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.tenancy.project.v1.Project> apply(
        ai.stigmer.tenancy.project.v1.Project request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getApplyMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * Create a new project.
     * Authorization:
     * - Organization-scoped projects: Caller must have can_create_project permission in the organization
     * - Platform-scoped projects: Caller must be a platform operator (handled automatically by common auth step)
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.tenancy.project.v1.Project> create(
        ai.stigmer.tenancy.project.v1.Project request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getCreateMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * Update an existing project.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.tenancy.project.v1.Project> update(
        ai.stigmer.tenancy.project.v1.Project request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getUpdateMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * Delete a project.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.tenancy.project.v1.Project> delete(
        ai.stigmer.tenancy.project.v1.ProjectId request) {
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
          serviceImpl.apply((ai.stigmer.tenancy.project.v1.Project) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.tenancy.project.v1.Project>) responseObserver);
          break;
        case METHODID_CREATE:
          serviceImpl.create((ai.stigmer.tenancy.project.v1.Project) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.tenancy.project.v1.Project>) responseObserver);
          break;
        case METHODID_UPDATE:
          serviceImpl.update((ai.stigmer.tenancy.project.v1.Project) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.tenancy.project.v1.Project>) responseObserver);
          break;
        case METHODID_DELETE:
          serviceImpl.delete((ai.stigmer.tenancy.project.v1.ProjectId) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.tenancy.project.v1.Project>) responseObserver);
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
              ai.stigmer.tenancy.project.v1.Project,
              ai.stigmer.tenancy.project.v1.Project>(
                service, METHODID_APPLY)))
        .addMethod(
          getCreateMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.tenancy.project.v1.Project,
              ai.stigmer.tenancy.project.v1.Project>(
                service, METHODID_CREATE)))
        .addMethod(
          getUpdateMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.tenancy.project.v1.Project,
              ai.stigmer.tenancy.project.v1.Project>(
                service, METHODID_UPDATE)))
        .addMethod(
          getDeleteMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.tenancy.project.v1.ProjectId,
              ai.stigmer.tenancy.project.v1.Project>(
                service, METHODID_DELETE)))
        .build();
  }

  private static abstract class ProjectCommandControllerBaseDescriptorSupplier
      implements io.grpc.protobuf.ProtoFileDescriptorSupplier, io.grpc.protobuf.ProtoServiceDescriptorSupplier {
    ProjectCommandControllerBaseDescriptorSupplier() {}

    @java.lang.Override
    public com.google.protobuf.Descriptors.FileDescriptor getFileDescriptor() {
      return ai.stigmer.tenancy.project.v1.CommandProto.getDescriptor();
    }

    @java.lang.Override
    public com.google.protobuf.Descriptors.ServiceDescriptor getServiceDescriptor() {
      return getFileDescriptor().findServiceByName("ProjectCommandController");
    }
  }

  private static final class ProjectCommandControllerFileDescriptorSupplier
      extends ProjectCommandControllerBaseDescriptorSupplier {
    ProjectCommandControllerFileDescriptorSupplier() {}
  }

  private static final class ProjectCommandControllerMethodDescriptorSupplier
      extends ProjectCommandControllerBaseDescriptorSupplier
      implements io.grpc.protobuf.ProtoMethodDescriptorSupplier {
    private final java.lang.String methodName;

    ProjectCommandControllerMethodDescriptorSupplier(java.lang.String methodName) {
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
      synchronized (ProjectCommandControllerGrpc.class) {
        result = serviceDescriptor;
        if (result == null) {
          serviceDescriptor = result = io.grpc.ServiceDescriptor.newBuilder(SERVICE_NAME)
              .setSchemaDescriptor(new ProjectCommandControllerFileDescriptorSupplier())
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
