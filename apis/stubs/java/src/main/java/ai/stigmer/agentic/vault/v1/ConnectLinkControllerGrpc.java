package ai.stigmer.agentic.vault.v1;

import static io.grpc.MethodDescriptor.generateFullMethodName;

/**
 * <pre>
 * ConnectLinkController serves the page a Connect link opens: someone
 * without a Stigmer account signs in at an address, and the login is saved
 * into the vault the link was made for (VaultCommandController.
 * createConnectLink).
 * Every method is public: the link's secret is the authority, and nothing
 * else is asked. An unknown, expired or used link answers NOT_FOUND, the same
 * for all three, so a guessed or forwarded link learns nothing.
 * </pre>
 */
@io.grpc.stub.annotations.GrpcGenerated
public final class ConnectLinkControllerGrpc {

  private ConnectLinkControllerGrpc() {}

  public static final java.lang.String SERVICE_NAME = "ai.stigmer.agentic.vault.v1.ConnectLinkController";

  // Static method descriptors that strictly reflect the proto.
  private static volatile io.grpc.MethodDescriptor<ai.stigmer.agentic.vault.v1.ConnectLinkTokenInput,
      ai.stigmer.agentic.vault.v1.ConnectLinkInfo> getGetConnectLinkMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "getConnectLink",
      requestType = ai.stigmer.agentic.vault.v1.ConnectLinkTokenInput.class,
      responseType = ai.stigmer.agentic.vault.v1.ConnectLinkInfo.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.agentic.vault.v1.ConnectLinkTokenInput,
      ai.stigmer.agentic.vault.v1.ConnectLinkInfo> getGetConnectLinkMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.agentic.vault.v1.ConnectLinkTokenInput, ai.stigmer.agentic.vault.v1.ConnectLinkInfo> getGetConnectLinkMethod;
    if ((getGetConnectLinkMethod = ConnectLinkControllerGrpc.getGetConnectLinkMethod) == null) {
      synchronized (ConnectLinkControllerGrpc.class) {
        if ((getGetConnectLinkMethod = ConnectLinkControllerGrpc.getGetConnectLinkMethod) == null) {
          ConnectLinkControllerGrpc.getGetConnectLinkMethod = getGetConnectLinkMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.agentic.vault.v1.ConnectLinkTokenInput, ai.stigmer.agentic.vault.v1.ConnectLinkInfo>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "getConnectLink"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.vault.v1.ConnectLinkTokenInput.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.vault.v1.ConnectLinkInfo.getDefaultInstance()))
              .setSchemaDescriptor(new ConnectLinkControllerMethodDescriptorSupplier("getConnectLink"))
              .build();
        }
      }
    }
    return getGetConnectLinkMethod;
  }

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.agentic.vault.v1.ConnectLinkTokenInput,
      ai.stigmer.agentic.vault.v1.StartConnectLinkOutput> getStartConnectLinkMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "startConnectLink",
      requestType = ai.stigmer.agentic.vault.v1.ConnectLinkTokenInput.class,
      responseType = ai.stigmer.agentic.vault.v1.StartConnectLinkOutput.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.agentic.vault.v1.ConnectLinkTokenInput,
      ai.stigmer.agentic.vault.v1.StartConnectLinkOutput> getStartConnectLinkMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.agentic.vault.v1.ConnectLinkTokenInput, ai.stigmer.agentic.vault.v1.StartConnectLinkOutput> getStartConnectLinkMethod;
    if ((getStartConnectLinkMethod = ConnectLinkControllerGrpc.getStartConnectLinkMethod) == null) {
      synchronized (ConnectLinkControllerGrpc.class) {
        if ((getStartConnectLinkMethod = ConnectLinkControllerGrpc.getStartConnectLinkMethod) == null) {
          ConnectLinkControllerGrpc.getStartConnectLinkMethod = getStartConnectLinkMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.agentic.vault.v1.ConnectLinkTokenInput, ai.stigmer.agentic.vault.v1.StartConnectLinkOutput>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "startConnectLink"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.vault.v1.ConnectLinkTokenInput.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.vault.v1.StartConnectLinkOutput.getDefaultInstance()))
              .setSchemaDescriptor(new ConnectLinkControllerMethodDescriptorSupplier("startConnectLink"))
              .build();
        }
      }
    }
    return getStartConnectLinkMethod;
  }

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.agentic.vault.v1.CompleteConnectLinkInput,
      ai.stigmer.agentic.vault.v1.CompleteConnectLinkOutput> getCompleteConnectLinkMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "completeConnectLink",
      requestType = ai.stigmer.agentic.vault.v1.CompleteConnectLinkInput.class,
      responseType = ai.stigmer.agentic.vault.v1.CompleteConnectLinkOutput.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.agentic.vault.v1.CompleteConnectLinkInput,
      ai.stigmer.agentic.vault.v1.CompleteConnectLinkOutput> getCompleteConnectLinkMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.agentic.vault.v1.CompleteConnectLinkInput, ai.stigmer.agentic.vault.v1.CompleteConnectLinkOutput> getCompleteConnectLinkMethod;
    if ((getCompleteConnectLinkMethod = ConnectLinkControllerGrpc.getCompleteConnectLinkMethod) == null) {
      synchronized (ConnectLinkControllerGrpc.class) {
        if ((getCompleteConnectLinkMethod = ConnectLinkControllerGrpc.getCompleteConnectLinkMethod) == null) {
          ConnectLinkControllerGrpc.getCompleteConnectLinkMethod = getCompleteConnectLinkMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.agentic.vault.v1.CompleteConnectLinkInput, ai.stigmer.agentic.vault.v1.CompleteConnectLinkOutput>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "completeConnectLink"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.vault.v1.CompleteConnectLinkInput.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.vault.v1.CompleteConnectLinkOutput.getDefaultInstance()))
              .setSchemaDescriptor(new ConnectLinkControllerMethodDescriptorSupplier("completeConnectLink"))
              .build();
        }
      }
    }
    return getCompleteConnectLinkMethod;
  }

  /**
   * Creates a new async stub that supports all call types for the service
   */
  public static ConnectLinkControllerStub newStub(io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<ConnectLinkControllerStub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<ConnectLinkControllerStub>() {
        @java.lang.Override
        public ConnectLinkControllerStub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new ConnectLinkControllerStub(channel, callOptions);
        }
      };
    return ConnectLinkControllerStub.newStub(factory, channel);
  }

  /**
   * Creates a new blocking-style stub that supports all types of calls on the service
   */
  public static ConnectLinkControllerBlockingV2Stub newBlockingV2Stub(
      io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<ConnectLinkControllerBlockingV2Stub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<ConnectLinkControllerBlockingV2Stub>() {
        @java.lang.Override
        public ConnectLinkControllerBlockingV2Stub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new ConnectLinkControllerBlockingV2Stub(channel, callOptions);
        }
      };
    return ConnectLinkControllerBlockingV2Stub.newStub(factory, channel);
  }

  /**
   * Creates a new blocking-style stub that supports unary and streaming output calls on the service
   */
  public static ConnectLinkControllerBlockingStub newBlockingStub(
      io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<ConnectLinkControllerBlockingStub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<ConnectLinkControllerBlockingStub>() {
        @java.lang.Override
        public ConnectLinkControllerBlockingStub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new ConnectLinkControllerBlockingStub(channel, callOptions);
        }
      };
    return ConnectLinkControllerBlockingStub.newStub(factory, channel);
  }

  /**
   * Creates a new ListenableFuture-style stub that supports unary calls on the service
   */
  public static ConnectLinkControllerFutureStub newFutureStub(
      io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<ConnectLinkControllerFutureStub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<ConnectLinkControllerFutureStub>() {
        @java.lang.Override
        public ConnectLinkControllerFutureStub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new ConnectLinkControllerFutureStub(channel, callOptions);
        }
      };
    return ConnectLinkControllerFutureStub.newStub(factory, channel);
  }

  /**
   * <pre>
   * ConnectLinkController serves the page a Connect link opens: someone
   * without a Stigmer account signs in at an address, and the login is saved
   * into the vault the link was made for (VaultCommandController.
   * createConnectLink).
   * Every method is public: the link's secret is the authority, and nothing
   * else is asked. An unknown, expired or used link answers NOT_FOUND, the same
   * for all three, so a guessed or forwarded link learns nothing.
   * </pre>
   */
  public interface AsyncService {

    /**
     * <pre>
     * What a Connect link is for, to show before the customer continues.
     * </pre>
     */
    default void getConnectLink(ai.stigmer.agentic.vault.v1.ConnectLinkTokenInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.vault.v1.ConnectLinkInfo> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getGetConnectLinkMethod(), responseObserver);
    }

    /**
     * <pre>
     * Start the sign-in a Connect link is for. Answers the login page to send
     * the customer to; it returns them to the console's callback page.
     * </pre>
     */
    default void startConnectLink(ai.stigmer.agentic.vault.v1.ConnectLinkTokenInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.vault.v1.StartConnectLinkOutput> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getStartConnectLinkMethod(), responseObserver);
    }

    /**
     * <pre>
     * Finish a Connect link's sign-in and spend the link. Answers where to
     * send the customer: the link's return URL with stigmer_connect=connected,
     * or stigmer_connect=error and a short reason when the sign-in failed
     * after the login page (the link then stays usable until it expires).
     * </pre>
     */
    default void completeConnectLink(ai.stigmer.agentic.vault.v1.CompleteConnectLinkInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.vault.v1.CompleteConnectLinkOutput> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getCompleteConnectLinkMethod(), responseObserver);
    }
  }

  /**
   * Base class for the server implementation of the service ConnectLinkController.
   * <pre>
   * ConnectLinkController serves the page a Connect link opens: someone
   * without a Stigmer account signs in at an address, and the login is saved
   * into the vault the link was made for (VaultCommandController.
   * createConnectLink).
   * Every method is public: the link's secret is the authority, and nothing
   * else is asked. An unknown, expired or used link answers NOT_FOUND, the same
   * for all three, so a guessed or forwarded link learns nothing.
   * </pre>
   */
  public static abstract class ConnectLinkControllerImplBase
      implements io.grpc.BindableService, AsyncService {

    @java.lang.Override public final io.grpc.ServerServiceDefinition bindService() {
      return ConnectLinkControllerGrpc.bindService(this);
    }
  }

  /**
   * A stub to allow clients to do asynchronous rpc calls to service ConnectLinkController.
   * <pre>
   * ConnectLinkController serves the page a Connect link opens: someone
   * without a Stigmer account signs in at an address, and the login is saved
   * into the vault the link was made for (VaultCommandController.
   * createConnectLink).
   * Every method is public: the link's secret is the authority, and nothing
   * else is asked. An unknown, expired or used link answers NOT_FOUND, the same
   * for all three, so a guessed or forwarded link learns nothing.
   * </pre>
   */
  public static final class ConnectLinkControllerStub
      extends io.grpc.stub.AbstractAsyncStub<ConnectLinkControllerStub> {
    private ConnectLinkControllerStub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected ConnectLinkControllerStub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new ConnectLinkControllerStub(channel, callOptions);
    }

    /**
     * <pre>
     * What a Connect link is for, to show before the customer continues.
     * </pre>
     */
    public void getConnectLink(ai.stigmer.agentic.vault.v1.ConnectLinkTokenInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.vault.v1.ConnectLinkInfo> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getGetConnectLinkMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * Start the sign-in a Connect link is for. Answers the login page to send
     * the customer to; it returns them to the console's callback page.
     * </pre>
     */
    public void startConnectLink(ai.stigmer.agentic.vault.v1.ConnectLinkTokenInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.vault.v1.StartConnectLinkOutput> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getStartConnectLinkMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * Finish a Connect link's sign-in and spend the link. Answers where to
     * send the customer: the link's return URL with stigmer_connect=connected,
     * or stigmer_connect=error and a short reason when the sign-in failed
     * after the login page (the link then stays usable until it expires).
     * </pre>
     */
    public void completeConnectLink(ai.stigmer.agentic.vault.v1.CompleteConnectLinkInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.vault.v1.CompleteConnectLinkOutput> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getCompleteConnectLinkMethod(), getCallOptions()), request, responseObserver);
    }
  }

  /**
   * A stub to allow clients to do synchronous rpc calls to service ConnectLinkController.
   * <pre>
   * ConnectLinkController serves the page a Connect link opens: someone
   * without a Stigmer account signs in at an address, and the login is saved
   * into the vault the link was made for (VaultCommandController.
   * createConnectLink).
   * Every method is public: the link's secret is the authority, and nothing
   * else is asked. An unknown, expired or used link answers NOT_FOUND, the same
   * for all three, so a guessed or forwarded link learns nothing.
   * </pre>
   */
  public static final class ConnectLinkControllerBlockingV2Stub
      extends io.grpc.stub.AbstractBlockingStub<ConnectLinkControllerBlockingV2Stub> {
    private ConnectLinkControllerBlockingV2Stub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected ConnectLinkControllerBlockingV2Stub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new ConnectLinkControllerBlockingV2Stub(channel, callOptions);
    }

    /**
     * <pre>
     * What a Connect link is for, to show before the customer continues.
     * </pre>
     */
    public ai.stigmer.agentic.vault.v1.ConnectLinkInfo getConnectLink(ai.stigmer.agentic.vault.v1.ConnectLinkTokenInput request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getGetConnectLinkMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Start the sign-in a Connect link is for. Answers the login page to send
     * the customer to; it returns them to the console's callback page.
     * </pre>
     */
    public ai.stigmer.agentic.vault.v1.StartConnectLinkOutput startConnectLink(ai.stigmer.agentic.vault.v1.ConnectLinkTokenInput request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getStartConnectLinkMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Finish a Connect link's sign-in and spend the link. Answers where to
     * send the customer: the link's return URL with stigmer_connect=connected,
     * or stigmer_connect=error and a short reason when the sign-in failed
     * after the login page (the link then stays usable until it expires).
     * </pre>
     */
    public ai.stigmer.agentic.vault.v1.CompleteConnectLinkOutput completeConnectLink(ai.stigmer.agentic.vault.v1.CompleteConnectLinkInput request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getCompleteConnectLinkMethod(), getCallOptions(), request);
    }
  }

  /**
   * A stub to allow clients to do limited synchronous rpc calls to service ConnectLinkController.
   * <pre>
   * ConnectLinkController serves the page a Connect link opens: someone
   * without a Stigmer account signs in at an address, and the login is saved
   * into the vault the link was made for (VaultCommandController.
   * createConnectLink).
   * Every method is public: the link's secret is the authority, and nothing
   * else is asked. An unknown, expired or used link answers NOT_FOUND, the same
   * for all three, so a guessed or forwarded link learns nothing.
   * </pre>
   */
  public static final class ConnectLinkControllerBlockingStub
      extends io.grpc.stub.AbstractBlockingStub<ConnectLinkControllerBlockingStub> {
    private ConnectLinkControllerBlockingStub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected ConnectLinkControllerBlockingStub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new ConnectLinkControllerBlockingStub(channel, callOptions);
    }

    /**
     * <pre>
     * What a Connect link is for, to show before the customer continues.
     * </pre>
     */
    public ai.stigmer.agentic.vault.v1.ConnectLinkInfo getConnectLink(ai.stigmer.agentic.vault.v1.ConnectLinkTokenInput request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getGetConnectLinkMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Start the sign-in a Connect link is for. Answers the login page to send
     * the customer to; it returns them to the console's callback page.
     * </pre>
     */
    public ai.stigmer.agentic.vault.v1.StartConnectLinkOutput startConnectLink(ai.stigmer.agentic.vault.v1.ConnectLinkTokenInput request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getStartConnectLinkMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Finish a Connect link's sign-in and spend the link. Answers where to
     * send the customer: the link's return URL with stigmer_connect=connected,
     * or stigmer_connect=error and a short reason when the sign-in failed
     * after the login page (the link then stays usable until it expires).
     * </pre>
     */
    public ai.stigmer.agentic.vault.v1.CompleteConnectLinkOutput completeConnectLink(ai.stigmer.agentic.vault.v1.CompleteConnectLinkInput request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getCompleteConnectLinkMethod(), getCallOptions(), request);
    }
  }

  /**
   * A stub to allow clients to do ListenableFuture-style rpc calls to service ConnectLinkController.
   * <pre>
   * ConnectLinkController serves the page a Connect link opens: someone
   * without a Stigmer account signs in at an address, and the login is saved
   * into the vault the link was made for (VaultCommandController.
   * createConnectLink).
   * Every method is public: the link's secret is the authority, and nothing
   * else is asked. An unknown, expired or used link answers NOT_FOUND, the same
   * for all three, so a guessed or forwarded link learns nothing.
   * </pre>
   */
  public static final class ConnectLinkControllerFutureStub
      extends io.grpc.stub.AbstractFutureStub<ConnectLinkControllerFutureStub> {
    private ConnectLinkControllerFutureStub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected ConnectLinkControllerFutureStub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new ConnectLinkControllerFutureStub(channel, callOptions);
    }

    /**
     * <pre>
     * What a Connect link is for, to show before the customer continues.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.agentic.vault.v1.ConnectLinkInfo> getConnectLink(
        ai.stigmer.agentic.vault.v1.ConnectLinkTokenInput request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getGetConnectLinkMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * Start the sign-in a Connect link is for. Answers the login page to send
     * the customer to; it returns them to the console's callback page.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.agentic.vault.v1.StartConnectLinkOutput> startConnectLink(
        ai.stigmer.agentic.vault.v1.ConnectLinkTokenInput request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getStartConnectLinkMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * Finish a Connect link's sign-in and spend the link. Answers where to
     * send the customer: the link's return URL with stigmer_connect=connected,
     * or stigmer_connect=error and a short reason when the sign-in failed
     * after the login page (the link then stays usable until it expires).
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.agentic.vault.v1.CompleteConnectLinkOutput> completeConnectLink(
        ai.stigmer.agentic.vault.v1.CompleteConnectLinkInput request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getCompleteConnectLinkMethod(), getCallOptions()), request);
    }
  }

  private static final int METHODID_GET_CONNECT_LINK = 0;
  private static final int METHODID_START_CONNECT_LINK = 1;
  private static final int METHODID_COMPLETE_CONNECT_LINK = 2;

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
        case METHODID_GET_CONNECT_LINK:
          serviceImpl.getConnectLink((ai.stigmer.agentic.vault.v1.ConnectLinkTokenInput) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.agentic.vault.v1.ConnectLinkInfo>) responseObserver);
          break;
        case METHODID_START_CONNECT_LINK:
          serviceImpl.startConnectLink((ai.stigmer.agentic.vault.v1.ConnectLinkTokenInput) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.agentic.vault.v1.StartConnectLinkOutput>) responseObserver);
          break;
        case METHODID_COMPLETE_CONNECT_LINK:
          serviceImpl.completeConnectLink((ai.stigmer.agentic.vault.v1.CompleteConnectLinkInput) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.agentic.vault.v1.CompleteConnectLinkOutput>) responseObserver);
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
          getGetConnectLinkMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.agentic.vault.v1.ConnectLinkTokenInput,
              ai.stigmer.agentic.vault.v1.ConnectLinkInfo>(
                service, METHODID_GET_CONNECT_LINK)))
        .addMethod(
          getStartConnectLinkMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.agentic.vault.v1.ConnectLinkTokenInput,
              ai.stigmer.agentic.vault.v1.StartConnectLinkOutput>(
                service, METHODID_START_CONNECT_LINK)))
        .addMethod(
          getCompleteConnectLinkMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.agentic.vault.v1.CompleteConnectLinkInput,
              ai.stigmer.agentic.vault.v1.CompleteConnectLinkOutput>(
                service, METHODID_COMPLETE_CONNECT_LINK)))
        .build();
  }

  private static abstract class ConnectLinkControllerBaseDescriptorSupplier
      implements io.grpc.protobuf.ProtoFileDescriptorSupplier, io.grpc.protobuf.ProtoServiceDescriptorSupplier {
    ConnectLinkControllerBaseDescriptorSupplier() {}

    @java.lang.Override
    public com.google.protobuf.Descriptors.FileDescriptor getFileDescriptor() {
      return ai.stigmer.agentic.vault.v1.ConnectLinkProto.getDescriptor();
    }

    @java.lang.Override
    public com.google.protobuf.Descriptors.ServiceDescriptor getServiceDescriptor() {
      return getFileDescriptor().findServiceByName("ConnectLinkController");
    }
  }

  private static final class ConnectLinkControllerFileDescriptorSupplier
      extends ConnectLinkControllerBaseDescriptorSupplier {
    ConnectLinkControllerFileDescriptorSupplier() {}
  }

  private static final class ConnectLinkControllerMethodDescriptorSupplier
      extends ConnectLinkControllerBaseDescriptorSupplier
      implements io.grpc.protobuf.ProtoMethodDescriptorSupplier {
    private final java.lang.String methodName;

    ConnectLinkControllerMethodDescriptorSupplier(java.lang.String methodName) {
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
      synchronized (ConnectLinkControllerGrpc.class) {
        result = serviceDescriptor;
        if (result == null) {
          serviceDescriptor = result = io.grpc.ServiceDescriptor.newBuilder(SERVICE_NAME)
              .setSchemaDescriptor(new ConnectLinkControllerFileDescriptorSupplier())
              .addMethod(getGetConnectLinkMethod())
              .addMethod(getStartConnectLinkMethod())
              .addMethod(getCompleteConnectLinkMethod())
              .build();
        }
      }
    }
    return result;
  }
}
