package ai.stigmer.agentic.environment.v1;

import static io.grpc.MethodDescriptor.generateFullMethodName;

/**
 * <pre>
 * EnvironmentQueryController provides read operations for Environment resources.
 * </pre>
 */
@io.grpc.stub.annotations.GrpcGenerated
public final class EnvironmentQueryControllerGrpc {

  private EnvironmentQueryControllerGrpc() {}

  public static final java.lang.String SERVICE_NAME = "ai.stigmer.agentic.environment.v1.EnvironmentQueryController";

  // Static method descriptors that strictly reflect the proto.
  private static volatile io.grpc.MethodDescriptor<ai.stigmer.commons.apiresource.ApiResourceId,
      ai.stigmer.agentic.environment.v1.Environment> getGetMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "get",
      requestType = ai.stigmer.commons.apiresource.ApiResourceId.class,
      responseType = ai.stigmer.agentic.environment.v1.Environment.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.commons.apiresource.ApiResourceId,
      ai.stigmer.agentic.environment.v1.Environment> getGetMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.commons.apiresource.ApiResourceId, ai.stigmer.agentic.environment.v1.Environment> getGetMethod;
    if ((getGetMethod = EnvironmentQueryControllerGrpc.getGetMethod) == null) {
      synchronized (EnvironmentQueryControllerGrpc.class) {
        if ((getGetMethod = EnvironmentQueryControllerGrpc.getGetMethod) == null) {
          EnvironmentQueryControllerGrpc.getGetMethod = getGetMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.commons.apiresource.ApiResourceId, ai.stigmer.agentic.environment.v1.Environment>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "get"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.commons.apiresource.ApiResourceId.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.environment.v1.Environment.getDefaultInstance()))
              .setSchemaDescriptor(new EnvironmentQueryControllerMethodDescriptorSupplier("get"))
              .build();
        }
      }
    }
    return getGetMethod;
  }

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.commons.apiresource.ApiResourceReference,
      ai.stigmer.agentic.environment.v1.Environment> getGetByReferenceMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "getByReference",
      requestType = ai.stigmer.commons.apiresource.ApiResourceReference.class,
      responseType = ai.stigmer.agentic.environment.v1.Environment.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.commons.apiresource.ApiResourceReference,
      ai.stigmer.agentic.environment.v1.Environment> getGetByReferenceMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.commons.apiresource.ApiResourceReference, ai.stigmer.agentic.environment.v1.Environment> getGetByReferenceMethod;
    if ((getGetByReferenceMethod = EnvironmentQueryControllerGrpc.getGetByReferenceMethod) == null) {
      synchronized (EnvironmentQueryControllerGrpc.class) {
        if ((getGetByReferenceMethod = EnvironmentQueryControllerGrpc.getGetByReferenceMethod) == null) {
          EnvironmentQueryControllerGrpc.getGetByReferenceMethod = getGetByReferenceMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.commons.apiresource.ApiResourceReference, ai.stigmer.agentic.environment.v1.Environment>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "getByReference"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.commons.apiresource.ApiResourceReference.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.environment.v1.Environment.getDefaultInstance()))
              .setSchemaDescriptor(new EnvironmentQueryControllerMethodDescriptorSupplier("getByReference"))
              .build();
        }
      }
    }
    return getGetByReferenceMethod;
  }

  /**
   * Creates a new async stub that supports all call types for the service
   */
  public static EnvironmentQueryControllerStub newStub(io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<EnvironmentQueryControllerStub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<EnvironmentQueryControllerStub>() {
        @java.lang.Override
        public EnvironmentQueryControllerStub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new EnvironmentQueryControllerStub(channel, callOptions);
        }
      };
    return EnvironmentQueryControllerStub.newStub(factory, channel);
  }

  /**
   * Creates a new blocking-style stub that supports all types of calls on the service
   */
  public static EnvironmentQueryControllerBlockingV2Stub newBlockingV2Stub(
      io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<EnvironmentQueryControllerBlockingV2Stub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<EnvironmentQueryControllerBlockingV2Stub>() {
        @java.lang.Override
        public EnvironmentQueryControllerBlockingV2Stub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new EnvironmentQueryControllerBlockingV2Stub(channel, callOptions);
        }
      };
    return EnvironmentQueryControllerBlockingV2Stub.newStub(factory, channel);
  }

  /**
   * Creates a new blocking-style stub that supports unary and streaming output calls on the service
   */
  public static EnvironmentQueryControllerBlockingStub newBlockingStub(
      io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<EnvironmentQueryControllerBlockingStub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<EnvironmentQueryControllerBlockingStub>() {
        @java.lang.Override
        public EnvironmentQueryControllerBlockingStub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new EnvironmentQueryControllerBlockingStub(channel, callOptions);
        }
      };
    return EnvironmentQueryControllerBlockingStub.newStub(factory, channel);
  }

  /**
   * Creates a new ListenableFuture-style stub that supports unary calls on the service
   */
  public static EnvironmentQueryControllerFutureStub newFutureStub(
      io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<EnvironmentQueryControllerFutureStub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<EnvironmentQueryControllerFutureStub>() {
        @java.lang.Override
        public EnvironmentQueryControllerFutureStub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new EnvironmentQueryControllerFutureStub(channel, callOptions);
        }
      };
    return EnvironmentQueryControllerFutureStub.newStub(factory, channel);
  }

  /**
   * <pre>
   * EnvironmentQueryController provides read operations for Environment resources.
   * </pre>
   */
  public interface AsyncService {

    /**
     * <pre>
     * Get an Environment by ID.
     * </pre>
     */
    default void get(ai.stigmer.commons.apiresource.ApiResourceId request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.environment.v1.Environment> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getGetMethod(), responseObserver);
    }

    /**
     * <pre>
     * Custom authorization in handler
     * </pre>
     */
    default void getByReference(ai.stigmer.commons.apiresource.ApiResourceReference request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.environment.v1.Environment> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getGetByReferenceMethod(), responseObserver);
    }
  }

  /**
   * Base class for the server implementation of the service EnvironmentQueryController.
   * <pre>
   * EnvironmentQueryController provides read operations for Environment resources.
   * </pre>
   */
  public static abstract class EnvironmentQueryControllerImplBase
      implements io.grpc.BindableService, AsyncService {

    @java.lang.Override public final io.grpc.ServerServiceDefinition bindService() {
      return EnvironmentQueryControllerGrpc.bindService(this);
    }
  }

  /**
   * A stub to allow clients to do asynchronous rpc calls to service EnvironmentQueryController.
   * <pre>
   * EnvironmentQueryController provides read operations for Environment resources.
   * </pre>
   */
  public static final class EnvironmentQueryControllerStub
      extends io.grpc.stub.AbstractAsyncStub<EnvironmentQueryControllerStub> {
    private EnvironmentQueryControllerStub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected EnvironmentQueryControllerStub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new EnvironmentQueryControllerStub(channel, callOptions);
    }

    /**
     * <pre>
     * Get an Environment by ID.
     * </pre>
     */
    public void get(ai.stigmer.commons.apiresource.ApiResourceId request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.environment.v1.Environment> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getGetMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * Custom authorization in handler
     * </pre>
     */
    public void getByReference(ai.stigmer.commons.apiresource.ApiResourceReference request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.environment.v1.Environment> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getGetByReferenceMethod(), getCallOptions()), request, responseObserver);
    }
  }

  /**
   * A stub to allow clients to do synchronous rpc calls to service EnvironmentQueryController.
   * <pre>
   * EnvironmentQueryController provides read operations for Environment resources.
   * </pre>
   */
  public static final class EnvironmentQueryControllerBlockingV2Stub
      extends io.grpc.stub.AbstractBlockingStub<EnvironmentQueryControllerBlockingV2Stub> {
    private EnvironmentQueryControllerBlockingV2Stub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected EnvironmentQueryControllerBlockingV2Stub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new EnvironmentQueryControllerBlockingV2Stub(channel, callOptions);
    }

    /**
     * <pre>
     * Get an Environment by ID.
     * </pre>
     */
    public ai.stigmer.agentic.environment.v1.Environment get(ai.stigmer.commons.apiresource.ApiResourceId request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getGetMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Custom authorization in handler
     * </pre>
     */
    public ai.stigmer.agentic.environment.v1.Environment getByReference(ai.stigmer.commons.apiresource.ApiResourceReference request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getGetByReferenceMethod(), getCallOptions(), request);
    }
  }

  /**
   * A stub to allow clients to do limited synchronous rpc calls to service EnvironmentQueryController.
   * <pre>
   * EnvironmentQueryController provides read operations for Environment resources.
   * </pre>
   */
  public static final class EnvironmentQueryControllerBlockingStub
      extends io.grpc.stub.AbstractBlockingStub<EnvironmentQueryControllerBlockingStub> {
    private EnvironmentQueryControllerBlockingStub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected EnvironmentQueryControllerBlockingStub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new EnvironmentQueryControllerBlockingStub(channel, callOptions);
    }

    /**
     * <pre>
     * Get an Environment by ID.
     * </pre>
     */
    public ai.stigmer.agentic.environment.v1.Environment get(ai.stigmer.commons.apiresource.ApiResourceId request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getGetMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Custom authorization in handler
     * </pre>
     */
    public ai.stigmer.agentic.environment.v1.Environment getByReference(ai.stigmer.commons.apiresource.ApiResourceReference request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getGetByReferenceMethod(), getCallOptions(), request);
    }
  }

  /**
   * A stub to allow clients to do ListenableFuture-style rpc calls to service EnvironmentQueryController.
   * <pre>
   * EnvironmentQueryController provides read operations for Environment resources.
   * </pre>
   */
  public static final class EnvironmentQueryControllerFutureStub
      extends io.grpc.stub.AbstractFutureStub<EnvironmentQueryControllerFutureStub> {
    private EnvironmentQueryControllerFutureStub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected EnvironmentQueryControllerFutureStub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new EnvironmentQueryControllerFutureStub(channel, callOptions);
    }

    /**
     * <pre>
     * Get an Environment by ID.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.agentic.environment.v1.Environment> get(
        ai.stigmer.commons.apiresource.ApiResourceId request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getGetMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * Custom authorization in handler
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.agentic.environment.v1.Environment> getByReference(
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
          serviceImpl.get((ai.stigmer.commons.apiresource.ApiResourceId) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.agentic.environment.v1.Environment>) responseObserver);
          break;
        case METHODID_GET_BY_REFERENCE:
          serviceImpl.getByReference((ai.stigmer.commons.apiresource.ApiResourceReference) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.agentic.environment.v1.Environment>) responseObserver);
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
              ai.stigmer.commons.apiresource.ApiResourceId,
              ai.stigmer.agentic.environment.v1.Environment>(
                service, METHODID_GET)))
        .addMethod(
          getGetByReferenceMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.commons.apiresource.ApiResourceReference,
              ai.stigmer.agentic.environment.v1.Environment>(
                service, METHODID_GET_BY_REFERENCE)))
        .build();
  }

  private static abstract class EnvironmentQueryControllerBaseDescriptorSupplier
      implements io.grpc.protobuf.ProtoFileDescriptorSupplier, io.grpc.protobuf.ProtoServiceDescriptorSupplier {
    EnvironmentQueryControllerBaseDescriptorSupplier() {}

    @java.lang.Override
    public com.google.protobuf.Descriptors.FileDescriptor getFileDescriptor() {
      return ai.stigmer.agentic.environment.v1.QueryProto.getDescriptor();
    }

    @java.lang.Override
    public com.google.protobuf.Descriptors.ServiceDescriptor getServiceDescriptor() {
      return getFileDescriptor().findServiceByName("EnvironmentQueryController");
    }
  }

  private static final class EnvironmentQueryControllerFileDescriptorSupplier
      extends EnvironmentQueryControllerBaseDescriptorSupplier {
    EnvironmentQueryControllerFileDescriptorSupplier() {}
  }

  private static final class EnvironmentQueryControllerMethodDescriptorSupplier
      extends EnvironmentQueryControllerBaseDescriptorSupplier
      implements io.grpc.protobuf.ProtoMethodDescriptorSupplier {
    private final java.lang.String methodName;

    EnvironmentQueryControllerMethodDescriptorSupplier(java.lang.String methodName) {
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
      synchronized (EnvironmentQueryControllerGrpc.class) {
        result = serviceDescriptor;
        if (result == null) {
          serviceDescriptor = result = io.grpc.ServiceDescriptor.newBuilder(SERVICE_NAME)
              .setSchemaDescriptor(new EnvironmentQueryControllerFileDescriptorSupplier())
              .addMethod(getGetMethod())
              .addMethod(getGetByReferenceMethod())
              .build();
        }
      }
    }
    return result;
  }
}
