package ai.stigmer.platform.v1;

import static io.grpc.MethodDescriptor.generateFullMethodName;

/**
 * <pre>
 * Unauthenticated query service for server identity and capabilities.
 * Clients call getServerInfo on startup to learn the server edition
 * and version, replacing URL-based guessing. The RPC is public
 * (no authentication required) so it can be called before login.
 * </pre>
 */
@io.grpc.stub.annotations.GrpcGenerated
public final class PlatformQueryControllerGrpc {

  private PlatformQueryControllerGrpc() {}

  public static final java.lang.String SERVICE_NAME = "ai.stigmer.platform.v1.PlatformQueryController";

  // Static method descriptors that strictly reflect the proto.
  private static volatile io.grpc.MethodDescriptor<ai.stigmer.platform.v1.GetServerInfoInput,
      ai.stigmer.platform.v1.GetServerInfoOutput> getGetServerInfoMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "getServerInfo",
      requestType = ai.stigmer.platform.v1.GetServerInfoInput.class,
      responseType = ai.stigmer.platform.v1.GetServerInfoOutput.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.platform.v1.GetServerInfoInput,
      ai.stigmer.platform.v1.GetServerInfoOutput> getGetServerInfoMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.platform.v1.GetServerInfoInput, ai.stigmer.platform.v1.GetServerInfoOutput> getGetServerInfoMethod;
    if ((getGetServerInfoMethod = PlatformQueryControllerGrpc.getGetServerInfoMethod) == null) {
      synchronized (PlatformQueryControllerGrpc.class) {
        if ((getGetServerInfoMethod = PlatformQueryControllerGrpc.getGetServerInfoMethod) == null) {
          PlatformQueryControllerGrpc.getGetServerInfoMethod = getGetServerInfoMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.platform.v1.GetServerInfoInput, ai.stigmer.platform.v1.GetServerInfoOutput>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "getServerInfo"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.platform.v1.GetServerInfoInput.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.platform.v1.GetServerInfoOutput.getDefaultInstance()))
              .setSchemaDescriptor(new PlatformQueryControllerMethodDescriptorSupplier("getServerInfo"))
              .build();
        }
      }
    }
    return getGetServerInfoMethod;
  }

  /**
   * Creates a new async stub that supports all call types for the service
   */
  public static PlatformQueryControllerStub newStub(io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<PlatformQueryControllerStub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<PlatformQueryControllerStub>() {
        @java.lang.Override
        public PlatformQueryControllerStub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new PlatformQueryControllerStub(channel, callOptions);
        }
      };
    return PlatformQueryControllerStub.newStub(factory, channel);
  }

  /**
   * Creates a new blocking-style stub that supports all types of calls on the service
   */
  public static PlatformQueryControllerBlockingV2Stub newBlockingV2Stub(
      io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<PlatformQueryControllerBlockingV2Stub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<PlatformQueryControllerBlockingV2Stub>() {
        @java.lang.Override
        public PlatformQueryControllerBlockingV2Stub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new PlatformQueryControllerBlockingV2Stub(channel, callOptions);
        }
      };
    return PlatformQueryControllerBlockingV2Stub.newStub(factory, channel);
  }

  /**
   * Creates a new blocking-style stub that supports unary and streaming output calls on the service
   */
  public static PlatformQueryControllerBlockingStub newBlockingStub(
      io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<PlatformQueryControllerBlockingStub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<PlatformQueryControllerBlockingStub>() {
        @java.lang.Override
        public PlatformQueryControllerBlockingStub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new PlatformQueryControllerBlockingStub(channel, callOptions);
        }
      };
    return PlatformQueryControllerBlockingStub.newStub(factory, channel);
  }

  /**
   * Creates a new ListenableFuture-style stub that supports unary calls on the service
   */
  public static PlatformQueryControllerFutureStub newFutureStub(
      io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<PlatformQueryControllerFutureStub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<PlatformQueryControllerFutureStub>() {
        @java.lang.Override
        public PlatformQueryControllerFutureStub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new PlatformQueryControllerFutureStub(channel, callOptions);
        }
      };
    return PlatformQueryControllerFutureStub.newStub(factory, channel);
  }

  /**
   * <pre>
   * Unauthenticated query service for server identity and capabilities.
   * Clients call getServerInfo on startup to learn the server edition
   * and version, replacing URL-based guessing. The RPC is public
   * (no authentication required) so it can be called before login.
   * </pre>
   */
  public interface AsyncService {

    /**
     * <pre>
     * Returns the server edition and version.
     * This is the authoritative source for deployment mode detection.
     * Clients should call this once on startup and pass the result
     * to StigmerProvider as the deploymentMode prop.
     * </pre>
     */
    default void getServerInfo(ai.stigmer.platform.v1.GetServerInfoInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.platform.v1.GetServerInfoOutput> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getGetServerInfoMethod(), responseObserver);
    }
  }

  /**
   * Base class for the server implementation of the service PlatformQueryController.
   * <pre>
   * Unauthenticated query service for server identity and capabilities.
   * Clients call getServerInfo on startup to learn the server edition
   * and version, replacing URL-based guessing. The RPC is public
   * (no authentication required) so it can be called before login.
   * </pre>
   */
  public static abstract class PlatformQueryControllerImplBase
      implements io.grpc.BindableService, AsyncService {

    @java.lang.Override public final io.grpc.ServerServiceDefinition bindService() {
      return PlatformQueryControllerGrpc.bindService(this);
    }
  }

  /**
   * A stub to allow clients to do asynchronous rpc calls to service PlatformQueryController.
   * <pre>
   * Unauthenticated query service for server identity and capabilities.
   * Clients call getServerInfo on startup to learn the server edition
   * and version, replacing URL-based guessing. The RPC is public
   * (no authentication required) so it can be called before login.
   * </pre>
   */
  public static final class PlatformQueryControllerStub
      extends io.grpc.stub.AbstractAsyncStub<PlatformQueryControllerStub> {
    private PlatformQueryControllerStub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected PlatformQueryControllerStub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new PlatformQueryControllerStub(channel, callOptions);
    }

    /**
     * <pre>
     * Returns the server edition and version.
     * This is the authoritative source for deployment mode detection.
     * Clients should call this once on startup and pass the result
     * to StigmerProvider as the deploymentMode prop.
     * </pre>
     */
    public void getServerInfo(ai.stigmer.platform.v1.GetServerInfoInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.platform.v1.GetServerInfoOutput> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getGetServerInfoMethod(), getCallOptions()), request, responseObserver);
    }
  }

  /**
   * A stub to allow clients to do synchronous rpc calls to service PlatformQueryController.
   * <pre>
   * Unauthenticated query service for server identity and capabilities.
   * Clients call getServerInfo on startup to learn the server edition
   * and version, replacing URL-based guessing. The RPC is public
   * (no authentication required) so it can be called before login.
   * </pre>
   */
  public static final class PlatformQueryControllerBlockingV2Stub
      extends io.grpc.stub.AbstractBlockingStub<PlatformQueryControllerBlockingV2Stub> {
    private PlatformQueryControllerBlockingV2Stub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected PlatformQueryControllerBlockingV2Stub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new PlatformQueryControllerBlockingV2Stub(channel, callOptions);
    }

    /**
     * <pre>
     * Returns the server edition and version.
     * This is the authoritative source for deployment mode detection.
     * Clients should call this once on startup and pass the result
     * to StigmerProvider as the deploymentMode prop.
     * </pre>
     */
    public ai.stigmer.platform.v1.GetServerInfoOutput getServerInfo(ai.stigmer.platform.v1.GetServerInfoInput request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getGetServerInfoMethod(), getCallOptions(), request);
    }
  }

  /**
   * A stub to allow clients to do limited synchronous rpc calls to service PlatformQueryController.
   * <pre>
   * Unauthenticated query service for server identity and capabilities.
   * Clients call getServerInfo on startup to learn the server edition
   * and version, replacing URL-based guessing. The RPC is public
   * (no authentication required) so it can be called before login.
   * </pre>
   */
  public static final class PlatformQueryControllerBlockingStub
      extends io.grpc.stub.AbstractBlockingStub<PlatformQueryControllerBlockingStub> {
    private PlatformQueryControllerBlockingStub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected PlatformQueryControllerBlockingStub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new PlatformQueryControllerBlockingStub(channel, callOptions);
    }

    /**
     * <pre>
     * Returns the server edition and version.
     * This is the authoritative source for deployment mode detection.
     * Clients should call this once on startup and pass the result
     * to StigmerProvider as the deploymentMode prop.
     * </pre>
     */
    public ai.stigmer.platform.v1.GetServerInfoOutput getServerInfo(ai.stigmer.platform.v1.GetServerInfoInput request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getGetServerInfoMethod(), getCallOptions(), request);
    }
  }

  /**
   * A stub to allow clients to do ListenableFuture-style rpc calls to service PlatformQueryController.
   * <pre>
   * Unauthenticated query service for server identity and capabilities.
   * Clients call getServerInfo on startup to learn the server edition
   * and version, replacing URL-based guessing. The RPC is public
   * (no authentication required) so it can be called before login.
   * </pre>
   */
  public static final class PlatformQueryControllerFutureStub
      extends io.grpc.stub.AbstractFutureStub<PlatformQueryControllerFutureStub> {
    private PlatformQueryControllerFutureStub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected PlatformQueryControllerFutureStub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new PlatformQueryControllerFutureStub(channel, callOptions);
    }

    /**
     * <pre>
     * Returns the server edition and version.
     * This is the authoritative source for deployment mode detection.
     * Clients should call this once on startup and pass the result
     * to StigmerProvider as the deploymentMode prop.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.platform.v1.GetServerInfoOutput> getServerInfo(
        ai.stigmer.platform.v1.GetServerInfoInput request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getGetServerInfoMethod(), getCallOptions()), request);
    }
  }

  private static final int METHODID_GET_SERVER_INFO = 0;

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
        case METHODID_GET_SERVER_INFO:
          serviceImpl.getServerInfo((ai.stigmer.platform.v1.GetServerInfoInput) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.platform.v1.GetServerInfoOutput>) responseObserver);
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
          getGetServerInfoMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.platform.v1.GetServerInfoInput,
              ai.stigmer.platform.v1.GetServerInfoOutput>(
                service, METHODID_GET_SERVER_INFO)))
        .build();
  }

  private static abstract class PlatformQueryControllerBaseDescriptorSupplier
      implements io.grpc.protobuf.ProtoFileDescriptorSupplier, io.grpc.protobuf.ProtoServiceDescriptorSupplier {
    PlatformQueryControllerBaseDescriptorSupplier() {}

    @java.lang.Override
    public com.google.protobuf.Descriptors.FileDescriptor getFileDescriptor() {
      return ai.stigmer.platform.v1.ServerInfoProto.getDescriptor();
    }

    @java.lang.Override
    public com.google.protobuf.Descriptors.ServiceDescriptor getServiceDescriptor() {
      return getFileDescriptor().findServiceByName("PlatformQueryController");
    }
  }

  private static final class PlatformQueryControllerFileDescriptorSupplier
      extends PlatformQueryControllerBaseDescriptorSupplier {
    PlatformQueryControllerFileDescriptorSupplier() {}
  }

  private static final class PlatformQueryControllerMethodDescriptorSupplier
      extends PlatformQueryControllerBaseDescriptorSupplier
      implements io.grpc.protobuf.ProtoMethodDescriptorSupplier {
    private final java.lang.String methodName;

    PlatformQueryControllerMethodDescriptorSupplier(java.lang.String methodName) {
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
      synchronized (PlatformQueryControllerGrpc.class) {
        result = serviceDescriptor;
        if (result == null) {
          serviceDescriptor = result = io.grpc.ServiceDescriptor.newBuilder(SERVICE_NAME)
              .setSchemaDescriptor(new PlatformQueryControllerFileDescriptorSupplier())
              .addMethod(getGetServerInfoMethod())
              .build();
        }
      }
    }
    return result;
  }
}
