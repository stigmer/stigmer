package ai.stigmer.billing.providerkey.v1;

import static io.grpc.MethodDescriptor.generateFullMethodName;

/**
 * <pre>
 * ProviderKeyCommandController saves and removes an organization's own LLM
 * provider keys.
 * Provider keys are not a standard API Resource, so there is no
 * api_resource_kind annotation. Every write authorizes against the
 * organization with can_manage_billing, the permission the organization's
 * own billing writes use.
 * </pre>
 */
@io.grpc.stub.annotations.GrpcGenerated
public final class ProviderKeyCommandControllerGrpc {

  private ProviderKeyCommandControllerGrpc() {}

  public static final java.lang.String SERVICE_NAME = "ai.stigmer.billing.providerkey.v1.ProviderKeyCommandController";

  // Static method descriptors that strictly reflect the proto.
  private static volatile io.grpc.MethodDescriptor<ai.stigmer.billing.providerkey.v1.SetProviderKeyInput,
      ai.stigmer.billing.providerkey.v1.ProviderKey> getSetMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "set",
      requestType = ai.stigmer.billing.providerkey.v1.SetProviderKeyInput.class,
      responseType = ai.stigmer.billing.providerkey.v1.ProviderKey.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.billing.providerkey.v1.SetProviderKeyInput,
      ai.stigmer.billing.providerkey.v1.ProviderKey> getSetMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.billing.providerkey.v1.SetProviderKeyInput, ai.stigmer.billing.providerkey.v1.ProviderKey> getSetMethod;
    if ((getSetMethod = ProviderKeyCommandControllerGrpc.getSetMethod) == null) {
      synchronized (ProviderKeyCommandControllerGrpc.class) {
        if ((getSetMethod = ProviderKeyCommandControllerGrpc.getSetMethod) == null) {
          ProviderKeyCommandControllerGrpc.getSetMethod = getSetMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.billing.providerkey.v1.SetProviderKeyInput, ai.stigmer.billing.providerkey.v1.ProviderKey>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "set"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.billing.providerkey.v1.SetProviderKeyInput.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.billing.providerkey.v1.ProviderKey.getDefaultInstance()))
              .setSchemaDescriptor(new ProviderKeyCommandControllerMethodDescriptorSupplier("set"))
              .build();
        }
      }
    }
    return getSetMethod;
  }

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.billing.providerkey.v1.DeleteProviderKeyInput,
      ai.stigmer.billing.providerkey.v1.ProviderKey> getDeleteMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "delete",
      requestType = ai.stigmer.billing.providerkey.v1.DeleteProviderKeyInput.class,
      responseType = ai.stigmer.billing.providerkey.v1.ProviderKey.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.billing.providerkey.v1.DeleteProviderKeyInput,
      ai.stigmer.billing.providerkey.v1.ProviderKey> getDeleteMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.billing.providerkey.v1.DeleteProviderKeyInput, ai.stigmer.billing.providerkey.v1.ProviderKey> getDeleteMethod;
    if ((getDeleteMethod = ProviderKeyCommandControllerGrpc.getDeleteMethod) == null) {
      synchronized (ProviderKeyCommandControllerGrpc.class) {
        if ((getDeleteMethod = ProviderKeyCommandControllerGrpc.getDeleteMethod) == null) {
          ProviderKeyCommandControllerGrpc.getDeleteMethod = getDeleteMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.billing.providerkey.v1.DeleteProviderKeyInput, ai.stigmer.billing.providerkey.v1.ProviderKey>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "delete"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.billing.providerkey.v1.DeleteProviderKeyInput.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.billing.providerkey.v1.ProviderKey.getDefaultInstance()))
              .setSchemaDescriptor(new ProviderKeyCommandControllerMethodDescriptorSupplier("delete"))
              .build();
        }
      }
    }
    return getDeleteMethod;
  }

  /**
   * Creates a new async stub that supports all call types for the service
   */
  public static ProviderKeyCommandControllerStub newStub(io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<ProviderKeyCommandControllerStub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<ProviderKeyCommandControllerStub>() {
        @java.lang.Override
        public ProviderKeyCommandControllerStub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new ProviderKeyCommandControllerStub(channel, callOptions);
        }
      };
    return ProviderKeyCommandControllerStub.newStub(factory, channel);
  }

  /**
   * Creates a new blocking-style stub that supports all types of calls on the service
   */
  public static ProviderKeyCommandControllerBlockingV2Stub newBlockingV2Stub(
      io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<ProviderKeyCommandControllerBlockingV2Stub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<ProviderKeyCommandControllerBlockingV2Stub>() {
        @java.lang.Override
        public ProviderKeyCommandControllerBlockingV2Stub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new ProviderKeyCommandControllerBlockingV2Stub(channel, callOptions);
        }
      };
    return ProviderKeyCommandControllerBlockingV2Stub.newStub(factory, channel);
  }

  /**
   * Creates a new blocking-style stub that supports unary and streaming output calls on the service
   */
  public static ProviderKeyCommandControllerBlockingStub newBlockingStub(
      io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<ProviderKeyCommandControllerBlockingStub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<ProviderKeyCommandControllerBlockingStub>() {
        @java.lang.Override
        public ProviderKeyCommandControllerBlockingStub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new ProviderKeyCommandControllerBlockingStub(channel, callOptions);
        }
      };
    return ProviderKeyCommandControllerBlockingStub.newStub(factory, channel);
  }

  /**
   * Creates a new ListenableFuture-style stub that supports unary calls on the service
   */
  public static ProviderKeyCommandControllerFutureStub newFutureStub(
      io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<ProviderKeyCommandControllerFutureStub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<ProviderKeyCommandControllerFutureStub>() {
        @java.lang.Override
        public ProviderKeyCommandControllerFutureStub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new ProviderKeyCommandControllerFutureStub(channel, callOptions);
        }
      };
    return ProviderKeyCommandControllerFutureStub.newStub(factory, channel);
  }

  /**
   * <pre>
   * ProviderKeyCommandController saves and removes an organization's own LLM
   * provider keys.
   * Provider keys are not a standard API Resource, so there is no
   * api_resource_kind annotation. Every write authorizes against the
   * organization with can_manage_billing, the permission the organization's
   * own billing writes use.
   * </pre>
   */
  public interface AsyncService {

    /**
     * <pre>
     * Save the organization's key for a provider.
     * The key is checked once against the provider before it is saved, and a
     * key the provider rejects is refused with INVALID_ARGUMENT. Refused with
     * FAILED_PRECONDITION, reason PLAN_UPGRADE_REQUIRED, when the
     * organization's plan does not include bring-your-own provider keys.
     * Returns the saved key without its secret.
     * </pre>
     */
    default void set(ai.stigmer.billing.providerkey.v1.SetProviderKeyInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.billing.providerkey.v1.ProviderKey> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getSetMethod(), responseObserver);
    }

    /**
     * <pre>
     * Remove the organization's key for a provider.
     * Allowed on every plan, so an organization that left the plan can always
     * remove what it saved. NOT_FOUND when the organization holds no key for
     * the provider. Returns the removed key without its secret.
     * </pre>
     */
    default void delete(ai.stigmer.billing.providerkey.v1.DeleteProviderKeyInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.billing.providerkey.v1.ProviderKey> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getDeleteMethod(), responseObserver);
    }
  }

  /**
   * Base class for the server implementation of the service ProviderKeyCommandController.
   * <pre>
   * ProviderKeyCommandController saves and removes an organization's own LLM
   * provider keys.
   * Provider keys are not a standard API Resource, so there is no
   * api_resource_kind annotation. Every write authorizes against the
   * organization with can_manage_billing, the permission the organization's
   * own billing writes use.
   * </pre>
   */
  public static abstract class ProviderKeyCommandControllerImplBase
      implements io.grpc.BindableService, AsyncService {

    @java.lang.Override public final io.grpc.ServerServiceDefinition bindService() {
      return ProviderKeyCommandControllerGrpc.bindService(this);
    }
  }

  /**
   * A stub to allow clients to do asynchronous rpc calls to service ProviderKeyCommandController.
   * <pre>
   * ProviderKeyCommandController saves and removes an organization's own LLM
   * provider keys.
   * Provider keys are not a standard API Resource, so there is no
   * api_resource_kind annotation. Every write authorizes against the
   * organization with can_manage_billing, the permission the organization's
   * own billing writes use.
   * </pre>
   */
  public static final class ProviderKeyCommandControllerStub
      extends io.grpc.stub.AbstractAsyncStub<ProviderKeyCommandControllerStub> {
    private ProviderKeyCommandControllerStub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected ProviderKeyCommandControllerStub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new ProviderKeyCommandControllerStub(channel, callOptions);
    }

    /**
     * <pre>
     * Save the organization's key for a provider.
     * The key is checked once against the provider before it is saved, and a
     * key the provider rejects is refused with INVALID_ARGUMENT. Refused with
     * FAILED_PRECONDITION, reason PLAN_UPGRADE_REQUIRED, when the
     * organization's plan does not include bring-your-own provider keys.
     * Returns the saved key without its secret.
     * </pre>
     */
    public void set(ai.stigmer.billing.providerkey.v1.SetProviderKeyInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.billing.providerkey.v1.ProviderKey> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getSetMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * Remove the organization's key for a provider.
     * Allowed on every plan, so an organization that left the plan can always
     * remove what it saved. NOT_FOUND when the organization holds no key for
     * the provider. Returns the removed key without its secret.
     * </pre>
     */
    public void delete(ai.stigmer.billing.providerkey.v1.DeleteProviderKeyInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.billing.providerkey.v1.ProviderKey> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getDeleteMethod(), getCallOptions()), request, responseObserver);
    }
  }

  /**
   * A stub to allow clients to do synchronous rpc calls to service ProviderKeyCommandController.
   * <pre>
   * ProviderKeyCommandController saves and removes an organization's own LLM
   * provider keys.
   * Provider keys are not a standard API Resource, so there is no
   * api_resource_kind annotation. Every write authorizes against the
   * organization with can_manage_billing, the permission the organization's
   * own billing writes use.
   * </pre>
   */
  public static final class ProviderKeyCommandControllerBlockingV2Stub
      extends io.grpc.stub.AbstractBlockingStub<ProviderKeyCommandControllerBlockingV2Stub> {
    private ProviderKeyCommandControllerBlockingV2Stub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected ProviderKeyCommandControllerBlockingV2Stub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new ProviderKeyCommandControllerBlockingV2Stub(channel, callOptions);
    }

    /**
     * <pre>
     * Save the organization's key for a provider.
     * The key is checked once against the provider before it is saved, and a
     * key the provider rejects is refused with INVALID_ARGUMENT. Refused with
     * FAILED_PRECONDITION, reason PLAN_UPGRADE_REQUIRED, when the
     * organization's plan does not include bring-your-own provider keys.
     * Returns the saved key without its secret.
     * </pre>
     */
    public ai.stigmer.billing.providerkey.v1.ProviderKey set(ai.stigmer.billing.providerkey.v1.SetProviderKeyInput request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getSetMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Remove the organization's key for a provider.
     * Allowed on every plan, so an organization that left the plan can always
     * remove what it saved. NOT_FOUND when the organization holds no key for
     * the provider. Returns the removed key without its secret.
     * </pre>
     */
    public ai.stigmer.billing.providerkey.v1.ProviderKey delete(ai.stigmer.billing.providerkey.v1.DeleteProviderKeyInput request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getDeleteMethod(), getCallOptions(), request);
    }
  }

  /**
   * A stub to allow clients to do limited synchronous rpc calls to service ProviderKeyCommandController.
   * <pre>
   * ProviderKeyCommandController saves and removes an organization's own LLM
   * provider keys.
   * Provider keys are not a standard API Resource, so there is no
   * api_resource_kind annotation. Every write authorizes against the
   * organization with can_manage_billing, the permission the organization's
   * own billing writes use.
   * </pre>
   */
  public static final class ProviderKeyCommandControllerBlockingStub
      extends io.grpc.stub.AbstractBlockingStub<ProviderKeyCommandControllerBlockingStub> {
    private ProviderKeyCommandControllerBlockingStub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected ProviderKeyCommandControllerBlockingStub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new ProviderKeyCommandControllerBlockingStub(channel, callOptions);
    }

    /**
     * <pre>
     * Save the organization's key for a provider.
     * The key is checked once against the provider before it is saved, and a
     * key the provider rejects is refused with INVALID_ARGUMENT. Refused with
     * FAILED_PRECONDITION, reason PLAN_UPGRADE_REQUIRED, when the
     * organization's plan does not include bring-your-own provider keys.
     * Returns the saved key without its secret.
     * </pre>
     */
    public ai.stigmer.billing.providerkey.v1.ProviderKey set(ai.stigmer.billing.providerkey.v1.SetProviderKeyInput request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getSetMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Remove the organization's key for a provider.
     * Allowed on every plan, so an organization that left the plan can always
     * remove what it saved. NOT_FOUND when the organization holds no key for
     * the provider. Returns the removed key without its secret.
     * </pre>
     */
    public ai.stigmer.billing.providerkey.v1.ProviderKey delete(ai.stigmer.billing.providerkey.v1.DeleteProviderKeyInput request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getDeleteMethod(), getCallOptions(), request);
    }
  }

  /**
   * A stub to allow clients to do ListenableFuture-style rpc calls to service ProviderKeyCommandController.
   * <pre>
   * ProviderKeyCommandController saves and removes an organization's own LLM
   * provider keys.
   * Provider keys are not a standard API Resource, so there is no
   * api_resource_kind annotation. Every write authorizes against the
   * organization with can_manage_billing, the permission the organization's
   * own billing writes use.
   * </pre>
   */
  public static final class ProviderKeyCommandControllerFutureStub
      extends io.grpc.stub.AbstractFutureStub<ProviderKeyCommandControllerFutureStub> {
    private ProviderKeyCommandControllerFutureStub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected ProviderKeyCommandControllerFutureStub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new ProviderKeyCommandControllerFutureStub(channel, callOptions);
    }

    /**
     * <pre>
     * Save the organization's key for a provider.
     * The key is checked once against the provider before it is saved, and a
     * key the provider rejects is refused with INVALID_ARGUMENT. Refused with
     * FAILED_PRECONDITION, reason PLAN_UPGRADE_REQUIRED, when the
     * organization's plan does not include bring-your-own provider keys.
     * Returns the saved key without its secret.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.billing.providerkey.v1.ProviderKey> set(
        ai.stigmer.billing.providerkey.v1.SetProviderKeyInput request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getSetMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * Remove the organization's key for a provider.
     * Allowed on every plan, so an organization that left the plan can always
     * remove what it saved. NOT_FOUND when the organization holds no key for
     * the provider. Returns the removed key without its secret.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.billing.providerkey.v1.ProviderKey> delete(
        ai.stigmer.billing.providerkey.v1.DeleteProviderKeyInput request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getDeleteMethod(), getCallOptions()), request);
    }
  }

  private static final int METHODID_SET = 0;
  private static final int METHODID_DELETE = 1;

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
        case METHODID_SET:
          serviceImpl.set((ai.stigmer.billing.providerkey.v1.SetProviderKeyInput) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.billing.providerkey.v1.ProviderKey>) responseObserver);
          break;
        case METHODID_DELETE:
          serviceImpl.delete((ai.stigmer.billing.providerkey.v1.DeleteProviderKeyInput) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.billing.providerkey.v1.ProviderKey>) responseObserver);
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
          getSetMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.billing.providerkey.v1.SetProviderKeyInput,
              ai.stigmer.billing.providerkey.v1.ProviderKey>(
                service, METHODID_SET)))
        .addMethod(
          getDeleteMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.billing.providerkey.v1.DeleteProviderKeyInput,
              ai.stigmer.billing.providerkey.v1.ProviderKey>(
                service, METHODID_DELETE)))
        .build();
  }

  private static abstract class ProviderKeyCommandControllerBaseDescriptorSupplier
      implements io.grpc.protobuf.ProtoFileDescriptorSupplier, io.grpc.protobuf.ProtoServiceDescriptorSupplier {
    ProviderKeyCommandControllerBaseDescriptorSupplier() {}

    @java.lang.Override
    public com.google.protobuf.Descriptors.FileDescriptor getFileDescriptor() {
      return ai.stigmer.billing.providerkey.v1.CommandProto.getDescriptor();
    }

    @java.lang.Override
    public com.google.protobuf.Descriptors.ServiceDescriptor getServiceDescriptor() {
      return getFileDescriptor().findServiceByName("ProviderKeyCommandController");
    }
  }

  private static final class ProviderKeyCommandControllerFileDescriptorSupplier
      extends ProviderKeyCommandControllerBaseDescriptorSupplier {
    ProviderKeyCommandControllerFileDescriptorSupplier() {}
  }

  private static final class ProviderKeyCommandControllerMethodDescriptorSupplier
      extends ProviderKeyCommandControllerBaseDescriptorSupplier
      implements io.grpc.protobuf.ProtoMethodDescriptorSupplier {
    private final java.lang.String methodName;

    ProviderKeyCommandControllerMethodDescriptorSupplier(java.lang.String methodName) {
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
      synchronized (ProviderKeyCommandControllerGrpc.class) {
        result = serviceDescriptor;
        if (result == null) {
          serviceDescriptor = result = io.grpc.ServiceDescriptor.newBuilder(SERVICE_NAME)
              .setSchemaDescriptor(new ProviderKeyCommandControllerFileDescriptorSupplier())
              .addMethod(getSetMethod())
              .addMethod(getDeleteMethod())
              .build();
        }
      }
    }
    return result;
  }
}
