package ai.stigmer.tenancy.project.v1;

import static io.grpc.MethodDescriptor.generateFullMethodName;

/**
 * <pre>
 * ProjectQueryController handles read operations for projects.
 * </pre>
 */
@io.grpc.stub.annotations.GrpcGenerated
public final class ProjectQueryControllerGrpc {

  private ProjectQueryControllerGrpc() {}

  public static final java.lang.String SERVICE_NAME = "ai.stigmer.tenancy.project.v1.ProjectQueryController";

  // Static method descriptors that strictly reflect the proto.
  private static volatile io.grpc.MethodDescriptor<ai.stigmer.tenancy.project.v1.ProjectId,
      ai.stigmer.tenancy.project.v1.Project> getGetMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "get",
      requestType = ai.stigmer.tenancy.project.v1.ProjectId.class,
      responseType = ai.stigmer.tenancy.project.v1.Project.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.tenancy.project.v1.ProjectId,
      ai.stigmer.tenancy.project.v1.Project> getGetMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.tenancy.project.v1.ProjectId, ai.stigmer.tenancy.project.v1.Project> getGetMethod;
    if ((getGetMethod = ProjectQueryControllerGrpc.getGetMethod) == null) {
      synchronized (ProjectQueryControllerGrpc.class) {
        if ((getGetMethod = ProjectQueryControllerGrpc.getGetMethod) == null) {
          ProjectQueryControllerGrpc.getGetMethod = getGetMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.tenancy.project.v1.ProjectId, ai.stigmer.tenancy.project.v1.Project>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "get"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.tenancy.project.v1.ProjectId.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.tenancy.project.v1.Project.getDefaultInstance()))
              .setSchemaDescriptor(new ProjectQueryControllerMethodDescriptorSupplier("get"))
              .build();
        }
      }
    }
    return getGetMethod;
  }

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.commons.apiresource.ApiResourceReference,
      ai.stigmer.tenancy.project.v1.Project> getGetByReferenceMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "getByReference",
      requestType = ai.stigmer.commons.apiresource.ApiResourceReference.class,
      responseType = ai.stigmer.tenancy.project.v1.Project.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.commons.apiresource.ApiResourceReference,
      ai.stigmer.tenancy.project.v1.Project> getGetByReferenceMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.commons.apiresource.ApiResourceReference, ai.stigmer.tenancy.project.v1.Project> getGetByReferenceMethod;
    if ((getGetByReferenceMethod = ProjectQueryControllerGrpc.getGetByReferenceMethod) == null) {
      synchronized (ProjectQueryControllerGrpc.class) {
        if ((getGetByReferenceMethod = ProjectQueryControllerGrpc.getGetByReferenceMethod) == null) {
          ProjectQueryControllerGrpc.getGetByReferenceMethod = getGetByReferenceMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.commons.apiresource.ApiResourceReference, ai.stigmer.tenancy.project.v1.Project>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "getByReference"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.commons.apiresource.ApiResourceReference.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.tenancy.project.v1.Project.getDefaultInstance()))
              .setSchemaDescriptor(new ProjectQueryControllerMethodDescriptorSupplier("getByReference"))
              .build();
        }
      }
    }
    return getGetByReferenceMethod;
  }

  /**
   * Creates a new async stub that supports all call types for the service
   */
  public static ProjectQueryControllerStub newStub(io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<ProjectQueryControllerStub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<ProjectQueryControllerStub>() {
        @java.lang.Override
        public ProjectQueryControllerStub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new ProjectQueryControllerStub(channel, callOptions);
        }
      };
    return ProjectQueryControllerStub.newStub(factory, channel);
  }

  /**
   * Creates a new blocking-style stub that supports all types of calls on the service
   */
  public static ProjectQueryControllerBlockingV2Stub newBlockingV2Stub(
      io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<ProjectQueryControllerBlockingV2Stub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<ProjectQueryControllerBlockingV2Stub>() {
        @java.lang.Override
        public ProjectQueryControllerBlockingV2Stub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new ProjectQueryControllerBlockingV2Stub(channel, callOptions);
        }
      };
    return ProjectQueryControllerBlockingV2Stub.newStub(factory, channel);
  }

  /**
   * Creates a new blocking-style stub that supports unary and streaming output calls on the service
   */
  public static ProjectQueryControllerBlockingStub newBlockingStub(
      io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<ProjectQueryControllerBlockingStub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<ProjectQueryControllerBlockingStub>() {
        @java.lang.Override
        public ProjectQueryControllerBlockingStub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new ProjectQueryControllerBlockingStub(channel, callOptions);
        }
      };
    return ProjectQueryControllerBlockingStub.newStub(factory, channel);
  }

  /**
   * Creates a new ListenableFuture-style stub that supports unary calls on the service
   */
  public static ProjectQueryControllerFutureStub newFutureStub(
      io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<ProjectQueryControllerFutureStub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<ProjectQueryControllerFutureStub>() {
        @java.lang.Override
        public ProjectQueryControllerFutureStub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new ProjectQueryControllerFutureStub(channel, callOptions);
        }
      };
    return ProjectQueryControllerFutureStub.newStub(factory, channel);
  }

  /**
   * <pre>
   * ProjectQueryController handles read operations for projects.
   * </pre>
   */
  public interface AsyncService {

    /**
     * <pre>
     * Get a single project by ID.
     * </pre>
     */
    default void get(ai.stigmer.tenancy.project.v1.ProjectId request,
        io.grpc.stub.StreamObserver<ai.stigmer.tenancy.project.v1.Project> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getGetMethod(), responseObserver);
    }

    /**
     * <pre>
     * Get a project by reference (org/name).
     * &#64;internal
     * Custom authorization is handled in the controller implementation.
     * </pre>
     */
    default void getByReference(ai.stigmer.commons.apiresource.ApiResourceReference request,
        io.grpc.stub.StreamObserver<ai.stigmer.tenancy.project.v1.Project> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getGetByReferenceMethod(), responseObserver);
    }
  }

  /**
   * Base class for the server implementation of the service ProjectQueryController.
   * <pre>
   * ProjectQueryController handles read operations for projects.
   * </pre>
   */
  public static abstract class ProjectQueryControllerImplBase
      implements io.grpc.BindableService, AsyncService {

    @java.lang.Override public final io.grpc.ServerServiceDefinition bindService() {
      return ProjectQueryControllerGrpc.bindService(this);
    }
  }

  /**
   * A stub to allow clients to do asynchronous rpc calls to service ProjectQueryController.
   * <pre>
   * ProjectQueryController handles read operations for projects.
   * </pre>
   */
  public static final class ProjectQueryControllerStub
      extends io.grpc.stub.AbstractAsyncStub<ProjectQueryControllerStub> {
    private ProjectQueryControllerStub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected ProjectQueryControllerStub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new ProjectQueryControllerStub(channel, callOptions);
    }

    /**
     * <pre>
     * Get a single project by ID.
     * </pre>
     */
    public void get(ai.stigmer.tenancy.project.v1.ProjectId request,
        io.grpc.stub.StreamObserver<ai.stigmer.tenancy.project.v1.Project> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getGetMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * Get a project by reference (org/name).
     * &#64;internal
     * Custom authorization is handled in the controller implementation.
     * </pre>
     */
    public void getByReference(ai.stigmer.commons.apiresource.ApiResourceReference request,
        io.grpc.stub.StreamObserver<ai.stigmer.tenancy.project.v1.Project> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getGetByReferenceMethod(), getCallOptions()), request, responseObserver);
    }
  }

  /**
   * A stub to allow clients to do synchronous rpc calls to service ProjectQueryController.
   * <pre>
   * ProjectQueryController handles read operations for projects.
   * </pre>
   */
  public static final class ProjectQueryControllerBlockingV2Stub
      extends io.grpc.stub.AbstractBlockingStub<ProjectQueryControllerBlockingV2Stub> {
    private ProjectQueryControllerBlockingV2Stub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected ProjectQueryControllerBlockingV2Stub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new ProjectQueryControllerBlockingV2Stub(channel, callOptions);
    }

    /**
     * <pre>
     * Get a single project by ID.
     * </pre>
     */
    public ai.stigmer.tenancy.project.v1.Project get(ai.stigmer.tenancy.project.v1.ProjectId request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getGetMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Get a project by reference (org/name).
     * &#64;internal
     * Custom authorization is handled in the controller implementation.
     * </pre>
     */
    public ai.stigmer.tenancy.project.v1.Project getByReference(ai.stigmer.commons.apiresource.ApiResourceReference request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getGetByReferenceMethod(), getCallOptions(), request);
    }
  }

  /**
   * A stub to allow clients to do limited synchronous rpc calls to service ProjectQueryController.
   * <pre>
   * ProjectQueryController handles read operations for projects.
   * </pre>
   */
  public static final class ProjectQueryControllerBlockingStub
      extends io.grpc.stub.AbstractBlockingStub<ProjectQueryControllerBlockingStub> {
    private ProjectQueryControllerBlockingStub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected ProjectQueryControllerBlockingStub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new ProjectQueryControllerBlockingStub(channel, callOptions);
    }

    /**
     * <pre>
     * Get a single project by ID.
     * </pre>
     */
    public ai.stigmer.tenancy.project.v1.Project get(ai.stigmer.tenancy.project.v1.ProjectId request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getGetMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Get a project by reference (org/name).
     * &#64;internal
     * Custom authorization is handled in the controller implementation.
     * </pre>
     */
    public ai.stigmer.tenancy.project.v1.Project getByReference(ai.stigmer.commons.apiresource.ApiResourceReference request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getGetByReferenceMethod(), getCallOptions(), request);
    }
  }

  /**
   * A stub to allow clients to do ListenableFuture-style rpc calls to service ProjectQueryController.
   * <pre>
   * ProjectQueryController handles read operations for projects.
   * </pre>
   */
  public static final class ProjectQueryControllerFutureStub
      extends io.grpc.stub.AbstractFutureStub<ProjectQueryControllerFutureStub> {
    private ProjectQueryControllerFutureStub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected ProjectQueryControllerFutureStub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new ProjectQueryControllerFutureStub(channel, callOptions);
    }

    /**
     * <pre>
     * Get a single project by ID.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.tenancy.project.v1.Project> get(
        ai.stigmer.tenancy.project.v1.ProjectId request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getGetMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * Get a project by reference (org/name).
     * &#64;internal
     * Custom authorization is handled in the controller implementation.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.tenancy.project.v1.Project> getByReference(
        ai.stigmer.commons.apiresource.ApiResourceReference request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getGetByReferenceMethod(), getCallOptions()), request);
    }
  }

  private static final int METHODID_GET = 0;
  private static final int METHODID_GET_BY_REFERENCE = 1;

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
          serviceImpl.get((ai.stigmer.tenancy.project.v1.ProjectId) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.tenancy.project.v1.Project>) responseObserver);
          break;
        case METHODID_GET_BY_REFERENCE:
          serviceImpl.getByReference((ai.stigmer.commons.apiresource.ApiResourceReference) request,
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
          getGetMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.tenancy.project.v1.ProjectId,
              ai.stigmer.tenancy.project.v1.Project>(
                service, METHODID_GET)))
        .addMethod(
          getGetByReferenceMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.commons.apiresource.ApiResourceReference,
              ai.stigmer.tenancy.project.v1.Project>(
                service, METHODID_GET_BY_REFERENCE)))
        .build();
  }

  private static abstract class ProjectQueryControllerBaseDescriptorSupplier
      implements io.grpc.protobuf.ProtoFileDescriptorSupplier, io.grpc.protobuf.ProtoServiceDescriptorSupplier {
    ProjectQueryControllerBaseDescriptorSupplier() {}

    @java.lang.Override
    public com.google.protobuf.Descriptors.FileDescriptor getFileDescriptor() {
      return ai.stigmer.tenancy.project.v1.QueryProto.getDescriptor();
    }

    @java.lang.Override
    public com.google.protobuf.Descriptors.ServiceDescriptor getServiceDescriptor() {
      return getFileDescriptor().findServiceByName("ProjectQueryController");
    }
  }

  private static final class ProjectQueryControllerFileDescriptorSupplier
      extends ProjectQueryControllerBaseDescriptorSupplier {
    ProjectQueryControllerFileDescriptorSupplier() {}
  }

  private static final class ProjectQueryControllerMethodDescriptorSupplier
      extends ProjectQueryControllerBaseDescriptorSupplier
      implements io.grpc.protobuf.ProtoMethodDescriptorSupplier {
    private final java.lang.String methodName;

    ProjectQueryControllerMethodDescriptorSupplier(java.lang.String methodName) {
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
      synchronized (ProjectQueryControllerGrpc.class) {
        result = serviceDescriptor;
        if (result == null) {
          serviceDescriptor = result = io.grpc.ServiceDescriptor.newBuilder(SERVICE_NAME)
              .setSchemaDescriptor(new ProjectQueryControllerFileDescriptorSupplier())
              .addMethod(getGetMethod())
              .addMethod(getGetByReferenceMethod())
              .build();
        }
      }
    }
    return result;
  }
}
