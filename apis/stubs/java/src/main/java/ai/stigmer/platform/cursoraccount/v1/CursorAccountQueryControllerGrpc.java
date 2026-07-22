package ai.stigmer.platform.cursoraccount.v1;

import static io.grpc.MethodDescriptor.generateFullMethodName;

/**
 * <pre>
 * CursorAccountQueryController handles read operations for managed
 * Cursor accounts.
 * Platform-gated like the command controller: even redacted, the resource
 * reveals team structure and per-member spend, which are
 * platform-internal.
 * &#64;internal
 * Cloud-only; not implemented by the OSS Go server.
 * </pre>
 */
@io.grpc.stub.annotations.GrpcGenerated
public final class CursorAccountQueryControllerGrpc {

  private CursorAccountQueryControllerGrpc() {}

  public static final java.lang.String SERVICE_NAME = "ai.stigmer.platform.cursoraccount.v1.CursorAccountQueryController";

  // Static method descriptors that strictly reflect the proto.
  private static volatile io.grpc.MethodDescriptor<ai.stigmer.platform.cursoraccount.v1.ListCursorAccountsInput,
      ai.stigmer.platform.cursoraccount.v1.CursorAccountsResponse> getListCursorAccountsMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "listCursorAccounts",
      requestType = ai.stigmer.platform.cursoraccount.v1.ListCursorAccountsInput.class,
      responseType = ai.stigmer.platform.cursoraccount.v1.CursorAccountsResponse.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.platform.cursoraccount.v1.ListCursorAccountsInput,
      ai.stigmer.platform.cursoraccount.v1.CursorAccountsResponse> getListCursorAccountsMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.platform.cursoraccount.v1.ListCursorAccountsInput, ai.stigmer.platform.cursoraccount.v1.CursorAccountsResponse> getListCursorAccountsMethod;
    if ((getListCursorAccountsMethod = CursorAccountQueryControllerGrpc.getListCursorAccountsMethod) == null) {
      synchronized (CursorAccountQueryControllerGrpc.class) {
        if ((getListCursorAccountsMethod = CursorAccountQueryControllerGrpc.getListCursorAccountsMethod) == null) {
          CursorAccountQueryControllerGrpc.getListCursorAccountsMethod = getListCursorAccountsMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.platform.cursoraccount.v1.ListCursorAccountsInput, ai.stigmer.platform.cursoraccount.v1.CursorAccountsResponse>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "listCursorAccounts"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.platform.cursoraccount.v1.ListCursorAccountsInput.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.platform.cursoraccount.v1.CursorAccountsResponse.getDefaultInstance()))
              .setSchemaDescriptor(new CursorAccountQueryControllerMethodDescriptorSupplier("listCursorAccounts"))
              .build();
        }
      }
    }
    return getListCursorAccountsMethod;
  }

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.platform.cursoraccount.v1.GetCursorAccountViewInput,
      ai.stigmer.platform.cursoraccount.v1.CursorAccountView> getGetCursorAccountViewMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "getCursorAccountView",
      requestType = ai.stigmer.platform.cursoraccount.v1.GetCursorAccountViewInput.class,
      responseType = ai.stigmer.platform.cursoraccount.v1.CursorAccountView.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.platform.cursoraccount.v1.GetCursorAccountViewInput,
      ai.stigmer.platform.cursoraccount.v1.CursorAccountView> getGetCursorAccountViewMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.platform.cursoraccount.v1.GetCursorAccountViewInput, ai.stigmer.platform.cursoraccount.v1.CursorAccountView> getGetCursorAccountViewMethod;
    if ((getGetCursorAccountViewMethod = CursorAccountQueryControllerGrpc.getGetCursorAccountViewMethod) == null) {
      synchronized (CursorAccountQueryControllerGrpc.class) {
        if ((getGetCursorAccountViewMethod = CursorAccountQueryControllerGrpc.getGetCursorAccountViewMethod) == null) {
          CursorAccountQueryControllerGrpc.getGetCursorAccountViewMethod = getGetCursorAccountViewMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.platform.cursoraccount.v1.GetCursorAccountViewInput, ai.stigmer.platform.cursoraccount.v1.CursorAccountView>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "getCursorAccountView"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.platform.cursoraccount.v1.GetCursorAccountViewInput.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.platform.cursoraccount.v1.CursorAccountView.getDefaultInstance()))
              .setSchemaDescriptor(new CursorAccountQueryControllerMethodDescriptorSupplier("getCursorAccountView"))
              .build();
        }
      }
    }
    return getGetCursorAccountViewMethod;
  }

  /**
   * Creates a new async stub that supports all call types for the service
   */
  public static CursorAccountQueryControllerStub newStub(io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<CursorAccountQueryControllerStub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<CursorAccountQueryControllerStub>() {
        @java.lang.Override
        public CursorAccountQueryControllerStub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new CursorAccountQueryControllerStub(channel, callOptions);
        }
      };
    return CursorAccountQueryControllerStub.newStub(factory, channel);
  }

  /**
   * Creates a new blocking-style stub that supports all types of calls on the service
   */
  public static CursorAccountQueryControllerBlockingV2Stub newBlockingV2Stub(
      io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<CursorAccountQueryControllerBlockingV2Stub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<CursorAccountQueryControllerBlockingV2Stub>() {
        @java.lang.Override
        public CursorAccountQueryControllerBlockingV2Stub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new CursorAccountQueryControllerBlockingV2Stub(channel, callOptions);
        }
      };
    return CursorAccountQueryControllerBlockingV2Stub.newStub(factory, channel);
  }

  /**
   * Creates a new blocking-style stub that supports unary and streaming output calls on the service
   */
  public static CursorAccountQueryControllerBlockingStub newBlockingStub(
      io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<CursorAccountQueryControllerBlockingStub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<CursorAccountQueryControllerBlockingStub>() {
        @java.lang.Override
        public CursorAccountQueryControllerBlockingStub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new CursorAccountQueryControllerBlockingStub(channel, callOptions);
        }
      };
    return CursorAccountQueryControllerBlockingStub.newStub(factory, channel);
  }

  /**
   * Creates a new ListenableFuture-style stub that supports unary calls on the service
   */
  public static CursorAccountQueryControllerFutureStub newFutureStub(
      io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<CursorAccountQueryControllerFutureStub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<CursorAccountQueryControllerFutureStub>() {
        @java.lang.Override
        public CursorAccountQueryControllerFutureStub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new CursorAccountQueryControllerFutureStub(channel, callOptions);
        }
      };
    return CursorAccountQueryControllerFutureStub.newStub(factory, channel);
  }

  /**
   * <pre>
   * CursorAccountQueryController handles read operations for managed
   * Cursor accounts.
   * Platform-gated like the command controller: even redacted, the resource
   * reveals team structure and per-member spend, which are
   * platform-internal.
   * &#64;internal
   * Cloud-only; not implemented by the OSS Go server.
   * </pre>
   */
  public interface AsyncService {

    /**
     * <pre>
     * List all Cursor accounts with routing/sync summaries. Key material
     * is always redacted.
     * </pre>
     */
    default void listCursorAccounts(ai.stigmer.platform.cursoraccount.v1.ListCursorAccountsInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.platform.cursoraccount.v1.CursorAccountsResponse> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getListCursorAccountsMethod(), responseObserver);
    }

    /**
     * <pre>
     * Retrieve one account's detail view: the redacted account, the latest
     * roster/spend snapshot, and the computed key-coverage join (which
     * members hold stored keys, which keys lost their owner, who has no
     * key).
     * </pre>
     */
    default void getCursorAccountView(ai.stigmer.platform.cursoraccount.v1.GetCursorAccountViewInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.platform.cursoraccount.v1.CursorAccountView> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getGetCursorAccountViewMethod(), responseObserver);
    }
  }

  /**
   * Base class for the server implementation of the service CursorAccountQueryController.
   * <pre>
   * CursorAccountQueryController handles read operations for managed
   * Cursor accounts.
   * Platform-gated like the command controller: even redacted, the resource
   * reveals team structure and per-member spend, which are
   * platform-internal.
   * &#64;internal
   * Cloud-only; not implemented by the OSS Go server.
   * </pre>
   */
  public static abstract class CursorAccountQueryControllerImplBase
      implements io.grpc.BindableService, AsyncService {

    @java.lang.Override public final io.grpc.ServerServiceDefinition bindService() {
      return CursorAccountQueryControllerGrpc.bindService(this);
    }
  }

  /**
   * A stub to allow clients to do asynchronous rpc calls to service CursorAccountQueryController.
   * <pre>
   * CursorAccountQueryController handles read operations for managed
   * Cursor accounts.
   * Platform-gated like the command controller: even redacted, the resource
   * reveals team structure and per-member spend, which are
   * platform-internal.
   * &#64;internal
   * Cloud-only; not implemented by the OSS Go server.
   * </pre>
   */
  public static final class CursorAccountQueryControllerStub
      extends io.grpc.stub.AbstractAsyncStub<CursorAccountQueryControllerStub> {
    private CursorAccountQueryControllerStub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected CursorAccountQueryControllerStub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new CursorAccountQueryControllerStub(channel, callOptions);
    }

    /**
     * <pre>
     * List all Cursor accounts with routing/sync summaries. Key material
     * is always redacted.
     * </pre>
     */
    public void listCursorAccounts(ai.stigmer.platform.cursoraccount.v1.ListCursorAccountsInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.platform.cursoraccount.v1.CursorAccountsResponse> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getListCursorAccountsMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * Retrieve one account's detail view: the redacted account, the latest
     * roster/spend snapshot, and the computed key-coverage join (which
     * members hold stored keys, which keys lost their owner, who has no
     * key).
     * </pre>
     */
    public void getCursorAccountView(ai.stigmer.platform.cursoraccount.v1.GetCursorAccountViewInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.platform.cursoraccount.v1.CursorAccountView> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getGetCursorAccountViewMethod(), getCallOptions()), request, responseObserver);
    }
  }

  /**
   * A stub to allow clients to do synchronous rpc calls to service CursorAccountQueryController.
   * <pre>
   * CursorAccountQueryController handles read operations for managed
   * Cursor accounts.
   * Platform-gated like the command controller: even redacted, the resource
   * reveals team structure and per-member spend, which are
   * platform-internal.
   * &#64;internal
   * Cloud-only; not implemented by the OSS Go server.
   * </pre>
   */
  public static final class CursorAccountQueryControllerBlockingV2Stub
      extends io.grpc.stub.AbstractBlockingStub<CursorAccountQueryControllerBlockingV2Stub> {
    private CursorAccountQueryControllerBlockingV2Stub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected CursorAccountQueryControllerBlockingV2Stub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new CursorAccountQueryControllerBlockingV2Stub(channel, callOptions);
    }

    /**
     * <pre>
     * List all Cursor accounts with routing/sync summaries. Key material
     * is always redacted.
     * </pre>
     */
    public ai.stigmer.platform.cursoraccount.v1.CursorAccountsResponse listCursorAccounts(ai.stigmer.platform.cursoraccount.v1.ListCursorAccountsInput request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getListCursorAccountsMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Retrieve one account's detail view: the redacted account, the latest
     * roster/spend snapshot, and the computed key-coverage join (which
     * members hold stored keys, which keys lost their owner, who has no
     * key).
     * </pre>
     */
    public ai.stigmer.platform.cursoraccount.v1.CursorAccountView getCursorAccountView(ai.stigmer.platform.cursoraccount.v1.GetCursorAccountViewInput request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getGetCursorAccountViewMethod(), getCallOptions(), request);
    }
  }

  /**
   * A stub to allow clients to do limited synchronous rpc calls to service CursorAccountQueryController.
   * <pre>
   * CursorAccountQueryController handles read operations for managed
   * Cursor accounts.
   * Platform-gated like the command controller: even redacted, the resource
   * reveals team structure and per-member spend, which are
   * platform-internal.
   * &#64;internal
   * Cloud-only; not implemented by the OSS Go server.
   * </pre>
   */
  public static final class CursorAccountQueryControllerBlockingStub
      extends io.grpc.stub.AbstractBlockingStub<CursorAccountQueryControllerBlockingStub> {
    private CursorAccountQueryControllerBlockingStub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected CursorAccountQueryControllerBlockingStub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new CursorAccountQueryControllerBlockingStub(channel, callOptions);
    }

    /**
     * <pre>
     * List all Cursor accounts with routing/sync summaries. Key material
     * is always redacted.
     * </pre>
     */
    public ai.stigmer.platform.cursoraccount.v1.CursorAccountsResponse listCursorAccounts(ai.stigmer.platform.cursoraccount.v1.ListCursorAccountsInput request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getListCursorAccountsMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Retrieve one account's detail view: the redacted account, the latest
     * roster/spend snapshot, and the computed key-coverage join (which
     * members hold stored keys, which keys lost their owner, who has no
     * key).
     * </pre>
     */
    public ai.stigmer.platform.cursoraccount.v1.CursorAccountView getCursorAccountView(ai.stigmer.platform.cursoraccount.v1.GetCursorAccountViewInput request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getGetCursorAccountViewMethod(), getCallOptions(), request);
    }
  }

  /**
   * A stub to allow clients to do ListenableFuture-style rpc calls to service CursorAccountQueryController.
   * <pre>
   * CursorAccountQueryController handles read operations for managed
   * Cursor accounts.
   * Platform-gated like the command controller: even redacted, the resource
   * reveals team structure and per-member spend, which are
   * platform-internal.
   * &#64;internal
   * Cloud-only; not implemented by the OSS Go server.
   * </pre>
   */
  public static final class CursorAccountQueryControllerFutureStub
      extends io.grpc.stub.AbstractFutureStub<CursorAccountQueryControllerFutureStub> {
    private CursorAccountQueryControllerFutureStub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected CursorAccountQueryControllerFutureStub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new CursorAccountQueryControllerFutureStub(channel, callOptions);
    }

    /**
     * <pre>
     * List all Cursor accounts with routing/sync summaries. Key material
     * is always redacted.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.platform.cursoraccount.v1.CursorAccountsResponse> listCursorAccounts(
        ai.stigmer.platform.cursoraccount.v1.ListCursorAccountsInput request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getListCursorAccountsMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * Retrieve one account's detail view: the redacted account, the latest
     * roster/spend snapshot, and the computed key-coverage join (which
     * members hold stored keys, which keys lost their owner, who has no
     * key).
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.platform.cursoraccount.v1.CursorAccountView> getCursorAccountView(
        ai.stigmer.platform.cursoraccount.v1.GetCursorAccountViewInput request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getGetCursorAccountViewMethod(), getCallOptions()), request);
    }
  }

  private static final int METHODID_LIST_CURSOR_ACCOUNTS = 0;
  private static final int METHODID_GET_CURSOR_ACCOUNT_VIEW = 1;

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
        case METHODID_LIST_CURSOR_ACCOUNTS:
          serviceImpl.listCursorAccounts((ai.stigmer.platform.cursoraccount.v1.ListCursorAccountsInput) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.platform.cursoraccount.v1.CursorAccountsResponse>) responseObserver);
          break;
        case METHODID_GET_CURSOR_ACCOUNT_VIEW:
          serviceImpl.getCursorAccountView((ai.stigmer.platform.cursoraccount.v1.GetCursorAccountViewInput) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.platform.cursoraccount.v1.CursorAccountView>) responseObserver);
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
          getListCursorAccountsMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.platform.cursoraccount.v1.ListCursorAccountsInput,
              ai.stigmer.platform.cursoraccount.v1.CursorAccountsResponse>(
                service, METHODID_LIST_CURSOR_ACCOUNTS)))
        .addMethod(
          getGetCursorAccountViewMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.platform.cursoraccount.v1.GetCursorAccountViewInput,
              ai.stigmer.platform.cursoraccount.v1.CursorAccountView>(
                service, METHODID_GET_CURSOR_ACCOUNT_VIEW)))
        .build();
  }

  private static abstract class CursorAccountQueryControllerBaseDescriptorSupplier
      implements io.grpc.protobuf.ProtoFileDescriptorSupplier, io.grpc.protobuf.ProtoServiceDescriptorSupplier {
    CursorAccountQueryControllerBaseDescriptorSupplier() {}

    @java.lang.Override
    public com.google.protobuf.Descriptors.FileDescriptor getFileDescriptor() {
      return ai.stigmer.platform.cursoraccount.v1.QueryProto.getDescriptor();
    }

    @java.lang.Override
    public com.google.protobuf.Descriptors.ServiceDescriptor getServiceDescriptor() {
      return getFileDescriptor().findServiceByName("CursorAccountQueryController");
    }
  }

  private static final class CursorAccountQueryControllerFileDescriptorSupplier
      extends CursorAccountQueryControllerBaseDescriptorSupplier {
    CursorAccountQueryControllerFileDescriptorSupplier() {}
  }

  private static final class CursorAccountQueryControllerMethodDescriptorSupplier
      extends CursorAccountQueryControllerBaseDescriptorSupplier
      implements io.grpc.protobuf.ProtoMethodDescriptorSupplier {
    private final java.lang.String methodName;

    CursorAccountQueryControllerMethodDescriptorSupplier(java.lang.String methodName) {
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
      synchronized (CursorAccountQueryControllerGrpc.class) {
        result = serviceDescriptor;
        if (result == null) {
          serviceDescriptor = result = io.grpc.ServiceDescriptor.newBuilder(SERVICE_NAME)
              .setSchemaDescriptor(new CursorAccountQueryControllerFileDescriptorSupplier())
              .addMethod(getListCursorAccountsMethod())
              .addMethod(getGetCursorAccountViewMethod())
              .build();
        }
      }
    }
    return result;
  }
}
