package ai.stigmer.billing.providerkey.v1;

import static io.grpc.MethodDescriptor.generateFullMethodName;

/**
 * <pre>
 * ProviderKeyQueryController reads an organization's own LLM provider keys,
 * never their secrets.
 * Authorizes against the organization with can_view_billing, the permission
 * the organization's billing reads use.
 * </pre>
 */
@io.grpc.stub.annotations.GrpcGenerated
public final class ProviderKeyQueryControllerGrpc {

  private ProviderKeyQueryControllerGrpc() {}

  public static final java.lang.String SERVICE_NAME = "ai.stigmer.billing.providerkey.v1.ProviderKeyQueryController";

  // Static method descriptors that strictly reflect the proto.
  private static volatile io.grpc.MethodDescriptor<ai.stigmer.billing.providerkey.v1.ListProviderKeysInput,
      ai.stigmer.billing.providerkey.v1.ListProviderKeysOutput> getListMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "list",
      requestType = ai.stigmer.billing.providerkey.v1.ListProviderKeysInput.class,
      responseType = ai.stigmer.billing.providerkey.v1.ListProviderKeysOutput.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.billing.providerkey.v1.ListProviderKeysInput,
      ai.stigmer.billing.providerkey.v1.ListProviderKeysOutput> getListMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.billing.providerkey.v1.ListProviderKeysInput, ai.stigmer.billing.providerkey.v1.ListProviderKeysOutput> getListMethod;
    if ((getListMethod = ProviderKeyQueryControllerGrpc.getListMethod) == null) {
      synchronized (ProviderKeyQueryControllerGrpc.class) {
        if ((getListMethod = ProviderKeyQueryControllerGrpc.getListMethod) == null) {
          ProviderKeyQueryControllerGrpc.getListMethod = getListMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.billing.providerkey.v1.ListProviderKeysInput, ai.stigmer.billing.providerkey.v1.ListProviderKeysOutput>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "list"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.billing.providerkey.v1.ListProviderKeysInput.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.billing.providerkey.v1.ListProviderKeysOutput.getDefaultInstance()))
              .setSchemaDescriptor(new ProviderKeyQueryControllerMethodDescriptorSupplier("list"))
              .build();
        }
      }
    }
    return getListMethod;
  }

  /**
   * Creates a new async stub that supports all call types for the service
   */
  public static ProviderKeyQueryControllerStub newStub(io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<ProviderKeyQueryControllerStub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<ProviderKeyQueryControllerStub>() {
        @java.lang.Override
        public ProviderKeyQueryControllerStub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new ProviderKeyQueryControllerStub(channel, callOptions);
        }
      };
    return ProviderKeyQueryControllerStub.newStub(factory, channel);
  }

  /**
   * Creates a new blocking-style stub that supports all types of calls on the service
   */
  public static ProviderKeyQueryControllerBlockingV2Stub newBlockingV2Stub(
      io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<ProviderKeyQueryControllerBlockingV2Stub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<ProviderKeyQueryControllerBlockingV2Stub>() {
        @java.lang.Override
        public ProviderKeyQueryControllerBlockingV2Stub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new ProviderKeyQueryControllerBlockingV2Stub(channel, callOptions);
        }
      };
    return ProviderKeyQueryControllerBlockingV2Stub.newStub(factory, channel);
  }

  /**
   * Creates a new blocking-style stub that supports unary and streaming output calls on the service
   */
  public static ProviderKeyQueryControllerBlockingStub newBlockingStub(
      io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<ProviderKeyQueryControllerBlockingStub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<ProviderKeyQueryControllerBlockingStub>() {
        @java.lang.Override
        public ProviderKeyQueryControllerBlockingStub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new ProviderKeyQueryControllerBlockingStub(channel, callOptions);
        }
      };
    return ProviderKeyQueryControllerBlockingStub.newStub(factory, channel);
  }

  /**
   * Creates a new ListenableFuture-style stub that supports unary calls on the service
   */
  public static ProviderKeyQueryControllerFutureStub newFutureStub(
      io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<ProviderKeyQueryControllerFutureStub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<ProviderKeyQueryControllerFutureStub>() {
        @java.lang.Override
        public ProviderKeyQueryControllerFutureStub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new ProviderKeyQueryControllerFutureStub(channel, callOptions);
        }
      };
    return ProviderKeyQueryControllerFutureStub.newStub(factory, channel);
  }

  /**
   * <pre>
   * ProviderKeyQueryController reads an organization's own LLM provider keys,
   * never their secrets.
   * Authorizes against the organization with can_view_billing, the permission
   * the organization's billing reads use.
   * </pre>
   */
  public interface AsyncService {

    /**
     * <pre>
     * List the keys that serve the organization, its own and any it inherits
     * from its integrator, without their secrets.
     * </pre>
     */
    default void list(ai.stigmer.billing.providerkey.v1.ListProviderKeysInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.billing.providerkey.v1.ListProviderKeysOutput> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getListMethod(), responseObserver);
    }
  }

  /**
   * Base class for the server implementation of the service ProviderKeyQueryController.
   * <pre>
   * ProviderKeyQueryController reads an organization's own LLM provider keys,
   * never their secrets.
   * Authorizes against the organization with can_view_billing, the permission
   * the organization's billing reads use.
   * </pre>
   */
  public static abstract class ProviderKeyQueryControllerImplBase
      implements io.grpc.BindableService, AsyncService {

    @java.lang.Override public final io.grpc.ServerServiceDefinition bindService() {
      return ProviderKeyQueryControllerGrpc.bindService(this);
    }
  }

  /**
   * A stub to allow clients to do asynchronous rpc calls to service ProviderKeyQueryController.
   * <pre>
   * ProviderKeyQueryController reads an organization's own LLM provider keys,
   * never their secrets.
   * Authorizes against the organization with can_view_billing, the permission
   * the organization's billing reads use.
   * </pre>
   */
  public static final class ProviderKeyQueryControllerStub
      extends io.grpc.stub.AbstractAsyncStub<ProviderKeyQueryControllerStub> {
    private ProviderKeyQueryControllerStub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected ProviderKeyQueryControllerStub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new ProviderKeyQueryControllerStub(channel, callOptions);
    }

    /**
     * <pre>
     * List the keys that serve the organization, its own and any it inherits
     * from its integrator, without their secrets.
     * </pre>
     */
    public void list(ai.stigmer.billing.providerkey.v1.ListProviderKeysInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.billing.providerkey.v1.ListProviderKeysOutput> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getListMethod(), getCallOptions()), request, responseObserver);
    }
  }

  /**
   * A stub to allow clients to do synchronous rpc calls to service ProviderKeyQueryController.
   * <pre>
   * ProviderKeyQueryController reads an organization's own LLM provider keys,
   * never their secrets.
   * Authorizes against the organization with can_view_billing, the permission
   * the organization's billing reads use.
   * </pre>
   */
  public static final class ProviderKeyQueryControllerBlockingV2Stub
      extends io.grpc.stub.AbstractBlockingStub<ProviderKeyQueryControllerBlockingV2Stub> {
    private ProviderKeyQueryControllerBlockingV2Stub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected ProviderKeyQueryControllerBlockingV2Stub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new ProviderKeyQueryControllerBlockingV2Stub(channel, callOptions);
    }

    /**
     * <pre>
     * List the keys that serve the organization, its own and any it inherits
     * from its integrator, without their secrets.
     * </pre>
     */
    public ai.stigmer.billing.providerkey.v1.ListProviderKeysOutput list(ai.stigmer.billing.providerkey.v1.ListProviderKeysInput request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getListMethod(), getCallOptions(), request);
    }
  }

  /**
   * A stub to allow clients to do limited synchronous rpc calls to service ProviderKeyQueryController.
   * <pre>
   * ProviderKeyQueryController reads an organization's own LLM provider keys,
   * never their secrets.
   * Authorizes against the organization with can_view_billing, the permission
   * the organization's billing reads use.
   * </pre>
   */
  public static final class ProviderKeyQueryControllerBlockingStub
      extends io.grpc.stub.AbstractBlockingStub<ProviderKeyQueryControllerBlockingStub> {
    private ProviderKeyQueryControllerBlockingStub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected ProviderKeyQueryControllerBlockingStub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new ProviderKeyQueryControllerBlockingStub(channel, callOptions);
    }

    /**
     * <pre>
     * List the keys that serve the organization, its own and any it inherits
     * from its integrator, without their secrets.
     * </pre>
     */
    public ai.stigmer.billing.providerkey.v1.ListProviderKeysOutput list(ai.stigmer.billing.providerkey.v1.ListProviderKeysInput request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getListMethod(), getCallOptions(), request);
    }
  }

  /**
   * A stub to allow clients to do ListenableFuture-style rpc calls to service ProviderKeyQueryController.
   * <pre>
   * ProviderKeyQueryController reads an organization's own LLM provider keys,
   * never their secrets.
   * Authorizes against the organization with can_view_billing, the permission
   * the organization's billing reads use.
   * </pre>
   */
  public static final class ProviderKeyQueryControllerFutureStub
      extends io.grpc.stub.AbstractFutureStub<ProviderKeyQueryControllerFutureStub> {
    private ProviderKeyQueryControllerFutureStub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected ProviderKeyQueryControllerFutureStub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new ProviderKeyQueryControllerFutureStub(channel, callOptions);
    }

    /**
     * <pre>
     * List the keys that serve the organization, its own and any it inherits
     * from its integrator, without their secrets.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.billing.providerkey.v1.ListProviderKeysOutput> list(
        ai.stigmer.billing.providerkey.v1.ListProviderKeysInput request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getListMethod(), getCallOptions()), request);
    }
  }

  private static final int METHODID_LIST = 0;

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
        case METHODID_LIST:
          serviceImpl.list((ai.stigmer.billing.providerkey.v1.ListProviderKeysInput) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.billing.providerkey.v1.ListProviderKeysOutput>) responseObserver);
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
          getListMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.billing.providerkey.v1.ListProviderKeysInput,
              ai.stigmer.billing.providerkey.v1.ListProviderKeysOutput>(
                service, METHODID_LIST)))
        .build();
  }

  private static abstract class ProviderKeyQueryControllerBaseDescriptorSupplier
      implements io.grpc.protobuf.ProtoFileDescriptorSupplier, io.grpc.protobuf.ProtoServiceDescriptorSupplier {
    ProviderKeyQueryControllerBaseDescriptorSupplier() {}

    @java.lang.Override
    public com.google.protobuf.Descriptors.FileDescriptor getFileDescriptor() {
      return ai.stigmer.billing.providerkey.v1.QueryProto.getDescriptor();
    }

    @java.lang.Override
    public com.google.protobuf.Descriptors.ServiceDescriptor getServiceDescriptor() {
      return getFileDescriptor().findServiceByName("ProviderKeyQueryController");
    }
  }

  private static final class ProviderKeyQueryControllerFileDescriptorSupplier
      extends ProviderKeyQueryControllerBaseDescriptorSupplier {
    ProviderKeyQueryControllerFileDescriptorSupplier() {}
  }

  private static final class ProviderKeyQueryControllerMethodDescriptorSupplier
      extends ProviderKeyQueryControllerBaseDescriptorSupplier
      implements io.grpc.protobuf.ProtoMethodDescriptorSupplier {
    private final java.lang.String methodName;

    ProviderKeyQueryControllerMethodDescriptorSupplier(java.lang.String methodName) {
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
      synchronized (ProviderKeyQueryControllerGrpc.class) {
        result = serviceDescriptor;
        if (result == null) {
          serviceDescriptor = result = io.grpc.ServiceDescriptor.newBuilder(SERVICE_NAME)
              .setSchemaDescriptor(new ProviderKeyQueryControllerFileDescriptorSupplier())
              .addMethod(getListMethod())
              .build();
        }
      }
    }
    return result;
  }
}
