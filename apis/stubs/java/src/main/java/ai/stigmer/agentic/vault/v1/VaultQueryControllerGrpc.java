package ai.stigmer.agentic.vault.v1;

import static io.grpc.MethodDescriptor.generateFullMethodName;

/**
 * <pre>
 * VaultQueryController handles read operations for vaults.
 * Every read shows entry names, addresses, descriptions and who saved them,
 * never a value.
 * </pre>
 */
@io.grpc.stub.annotations.GrpcGenerated
public final class VaultQueryControllerGrpc {

  private VaultQueryControllerGrpc() {}

  public static final java.lang.String SERVICE_NAME = "ai.stigmer.agentic.vault.v1.VaultQueryController";

  // Static method descriptors that strictly reflect the proto.
  private static volatile io.grpc.MethodDescriptor<ai.stigmer.commons.apiresource.ApiResourceId,
      ai.stigmer.agentic.vault.v1.Vault> getGetMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "get",
      requestType = ai.stigmer.commons.apiresource.ApiResourceId.class,
      responseType = ai.stigmer.agentic.vault.v1.Vault.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.commons.apiresource.ApiResourceId,
      ai.stigmer.agentic.vault.v1.Vault> getGetMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.commons.apiresource.ApiResourceId, ai.stigmer.agentic.vault.v1.Vault> getGetMethod;
    if ((getGetMethod = VaultQueryControllerGrpc.getGetMethod) == null) {
      synchronized (VaultQueryControllerGrpc.class) {
        if ((getGetMethod = VaultQueryControllerGrpc.getGetMethod) == null) {
          VaultQueryControllerGrpc.getGetMethod = getGetMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.commons.apiresource.ApiResourceId, ai.stigmer.agentic.vault.v1.Vault>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "get"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.commons.apiresource.ApiResourceId.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.vault.v1.Vault.getDefaultInstance()))
              .setSchemaDescriptor(new VaultQueryControllerMethodDescriptorSupplier("get"))
              .build();
        }
      }
    }
    return getGetMethod;
  }

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.commons.apiresource.ApiResourceReference,
      ai.stigmer.agentic.vault.v1.Vault> getGetByReferenceMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "getByReference",
      requestType = ai.stigmer.commons.apiresource.ApiResourceReference.class,
      responseType = ai.stigmer.agentic.vault.v1.Vault.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.commons.apiresource.ApiResourceReference,
      ai.stigmer.agentic.vault.v1.Vault> getGetByReferenceMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.commons.apiresource.ApiResourceReference, ai.stigmer.agentic.vault.v1.Vault> getGetByReferenceMethod;
    if ((getGetByReferenceMethod = VaultQueryControllerGrpc.getGetByReferenceMethod) == null) {
      synchronized (VaultQueryControllerGrpc.class) {
        if ((getGetByReferenceMethod = VaultQueryControllerGrpc.getGetByReferenceMethod) == null) {
          VaultQueryControllerGrpc.getGetByReferenceMethod = getGetByReferenceMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.commons.apiresource.ApiResourceReference, ai.stigmer.agentic.vault.v1.Vault>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "getByReference"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.commons.apiresource.ApiResourceReference.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.vault.v1.Vault.getDefaultInstance()))
              .setSchemaDescriptor(new VaultQueryControllerMethodDescriptorSupplier("getByReference"))
              .build();
        }
      }
    }
    return getGetByReferenceMethod;
  }

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.agentic.vault.v1.GetMyVaultInput,
      ai.stigmer.agentic.vault.v1.Vault> getGetMineMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "getMine",
      requestType = ai.stigmer.agentic.vault.v1.GetMyVaultInput.class,
      responseType = ai.stigmer.agentic.vault.v1.Vault.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.agentic.vault.v1.GetMyVaultInput,
      ai.stigmer.agentic.vault.v1.Vault> getGetMineMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.agentic.vault.v1.GetMyVaultInput, ai.stigmer.agentic.vault.v1.Vault> getGetMineMethod;
    if ((getGetMineMethod = VaultQueryControllerGrpc.getGetMineMethod) == null) {
      synchronized (VaultQueryControllerGrpc.class) {
        if ((getGetMineMethod = VaultQueryControllerGrpc.getGetMineMethod) == null) {
          VaultQueryControllerGrpc.getGetMineMethod = getGetMineMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.agentic.vault.v1.GetMyVaultInput, ai.stigmer.agentic.vault.v1.Vault>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "getMine"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.vault.v1.GetMyVaultInput.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.vault.v1.Vault.getDefaultInstance()))
              .setSchemaDescriptor(new VaultQueryControllerMethodDescriptorSupplier("getMine"))
              .build();
        }
      }
    }
    return getGetMineMethod;
  }

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.agentic.vault.v1.GetVaultByExternalIdInput,
      ai.stigmer.agentic.vault.v1.Vault> getGetByExternalIdMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "getByExternalId",
      requestType = ai.stigmer.agentic.vault.v1.GetVaultByExternalIdInput.class,
      responseType = ai.stigmer.agentic.vault.v1.Vault.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.agentic.vault.v1.GetVaultByExternalIdInput,
      ai.stigmer.agentic.vault.v1.Vault> getGetByExternalIdMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.agentic.vault.v1.GetVaultByExternalIdInput, ai.stigmer.agentic.vault.v1.Vault> getGetByExternalIdMethod;
    if ((getGetByExternalIdMethod = VaultQueryControllerGrpc.getGetByExternalIdMethod) == null) {
      synchronized (VaultQueryControllerGrpc.class) {
        if ((getGetByExternalIdMethod = VaultQueryControllerGrpc.getGetByExternalIdMethod) == null) {
          VaultQueryControllerGrpc.getGetByExternalIdMethod = getGetByExternalIdMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.agentic.vault.v1.GetVaultByExternalIdInput, ai.stigmer.agentic.vault.v1.Vault>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "getByExternalId"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.vault.v1.GetVaultByExternalIdInput.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.vault.v1.Vault.getDefaultInstance()))
              .setSchemaDescriptor(new VaultQueryControllerMethodDescriptorSupplier("getByExternalId"))
              .build();
        }
      }
    }
    return getGetByExternalIdMethod;
  }

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.agentic.vault.v1.ListVaultsRequest,
      ai.stigmer.agentic.vault.v1.VaultList> getListMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "list",
      requestType = ai.stigmer.agentic.vault.v1.ListVaultsRequest.class,
      responseType = ai.stigmer.agentic.vault.v1.VaultList.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.agentic.vault.v1.ListVaultsRequest,
      ai.stigmer.agentic.vault.v1.VaultList> getListMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.agentic.vault.v1.ListVaultsRequest, ai.stigmer.agentic.vault.v1.VaultList> getListMethod;
    if ((getListMethod = VaultQueryControllerGrpc.getListMethod) == null) {
      synchronized (VaultQueryControllerGrpc.class) {
        if ((getListMethod = VaultQueryControllerGrpc.getListMethod) == null) {
          VaultQueryControllerGrpc.getListMethod = getListMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.agentic.vault.v1.ListVaultsRequest, ai.stigmer.agentic.vault.v1.VaultList>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "list"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.vault.v1.ListVaultsRequest.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.vault.v1.VaultList.getDefaultInstance()))
              .setSchemaDescriptor(new VaultQueryControllerMethodDescriptorSupplier("list"))
              .build();
        }
      }
    }
    return getListMethod;
  }

  /**
   * Creates a new async stub that supports all call types for the service
   */
  public static VaultQueryControllerStub newStub(io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<VaultQueryControllerStub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<VaultQueryControllerStub>() {
        @java.lang.Override
        public VaultQueryControllerStub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new VaultQueryControllerStub(channel, callOptions);
        }
      };
    return VaultQueryControllerStub.newStub(factory, channel);
  }

  /**
   * Creates a new blocking-style stub that supports all types of calls on the service
   */
  public static VaultQueryControllerBlockingV2Stub newBlockingV2Stub(
      io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<VaultQueryControllerBlockingV2Stub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<VaultQueryControllerBlockingV2Stub>() {
        @java.lang.Override
        public VaultQueryControllerBlockingV2Stub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new VaultQueryControllerBlockingV2Stub(channel, callOptions);
        }
      };
    return VaultQueryControllerBlockingV2Stub.newStub(factory, channel);
  }

  /**
   * Creates a new blocking-style stub that supports unary and streaming output calls on the service
   */
  public static VaultQueryControllerBlockingStub newBlockingStub(
      io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<VaultQueryControllerBlockingStub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<VaultQueryControllerBlockingStub>() {
        @java.lang.Override
        public VaultQueryControllerBlockingStub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new VaultQueryControllerBlockingStub(channel, callOptions);
        }
      };
    return VaultQueryControllerBlockingStub.newStub(factory, channel);
  }

  /**
   * Creates a new ListenableFuture-style stub that supports unary calls on the service
   */
  public static VaultQueryControllerFutureStub newFutureStub(
      io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<VaultQueryControllerFutureStub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<VaultQueryControllerFutureStub>() {
        @java.lang.Override
        public VaultQueryControllerFutureStub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new VaultQueryControllerFutureStub(channel, callOptions);
        }
      };
    return VaultQueryControllerFutureStub.newStub(factory, channel);
  }

  /**
   * <pre>
   * VaultQueryController handles read operations for vaults.
   * Every read shows entry names, addresses, descriptions and who saved them,
   * never a value.
   * </pre>
   */
  public interface AsyncService {

    /**
     * <pre>
     * Get a vault by ID.
     * </pre>
     */
    default void get(ai.stigmer.commons.apiresource.ApiResourceId request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.vault.v1.Vault> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getGetMethod(), responseObserver);
    }

    /**
     * <pre>
     * Get a vault by its organization-scoped reference (org/slug).
     * </pre>
     */
    default void getByReference(ai.stigmer.commons.apiresource.ApiResourceReference request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.vault.v1.Vault> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getGetByReferenceMethod(), responseObserver);
    }

    /**
     * <pre>
     * Get the caller's own My vault in an organization.
     * Answers NOT_FOUND until the caller saves their first login or secret.
     * </pre>
     */
    default void getMine(ai.stigmer.agentic.vault.v1.GetMyVaultInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.vault.v1.Vault> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getGetMineMethod(), responseObserver);
    }

    /**
     * <pre>
     * Get a shared vault by the integrator's own id for it.
     * </pre>
     */
    default void getByExternalId(ai.stigmer.agentic.vault.v1.GetVaultByExternalIdInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.vault.v1.Vault> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getGetByExternalIdMethod(), responseObserver);
    }

    /**
     * <pre>
     * List the vaults the caller can see in an organization: their own My
     * vault and the shared vaults they may view.
     * </pre>
     */
    default void list(ai.stigmer.agentic.vault.v1.ListVaultsRequest request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.vault.v1.VaultList> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getListMethod(), responseObserver);
    }
  }

  /**
   * Base class for the server implementation of the service VaultQueryController.
   * <pre>
   * VaultQueryController handles read operations for vaults.
   * Every read shows entry names, addresses, descriptions and who saved them,
   * never a value.
   * </pre>
   */
  public static abstract class VaultQueryControllerImplBase
      implements io.grpc.BindableService, AsyncService {

    @java.lang.Override public final io.grpc.ServerServiceDefinition bindService() {
      return VaultQueryControllerGrpc.bindService(this);
    }
  }

  /**
   * A stub to allow clients to do asynchronous rpc calls to service VaultQueryController.
   * <pre>
   * VaultQueryController handles read operations for vaults.
   * Every read shows entry names, addresses, descriptions and who saved them,
   * never a value.
   * </pre>
   */
  public static final class VaultQueryControllerStub
      extends io.grpc.stub.AbstractAsyncStub<VaultQueryControllerStub> {
    private VaultQueryControllerStub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected VaultQueryControllerStub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new VaultQueryControllerStub(channel, callOptions);
    }

    /**
     * <pre>
     * Get a vault by ID.
     * </pre>
     */
    public void get(ai.stigmer.commons.apiresource.ApiResourceId request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.vault.v1.Vault> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getGetMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * Get a vault by its organization-scoped reference (org/slug).
     * </pre>
     */
    public void getByReference(ai.stigmer.commons.apiresource.ApiResourceReference request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.vault.v1.Vault> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getGetByReferenceMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * Get the caller's own My vault in an organization.
     * Answers NOT_FOUND until the caller saves their first login or secret.
     * </pre>
     */
    public void getMine(ai.stigmer.agentic.vault.v1.GetMyVaultInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.vault.v1.Vault> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getGetMineMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * Get a shared vault by the integrator's own id for it.
     * </pre>
     */
    public void getByExternalId(ai.stigmer.agentic.vault.v1.GetVaultByExternalIdInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.vault.v1.Vault> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getGetByExternalIdMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * List the vaults the caller can see in an organization: their own My
     * vault and the shared vaults they may view.
     * </pre>
     */
    public void list(ai.stigmer.agentic.vault.v1.ListVaultsRequest request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.vault.v1.VaultList> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getListMethod(), getCallOptions()), request, responseObserver);
    }
  }

  /**
   * A stub to allow clients to do synchronous rpc calls to service VaultQueryController.
   * <pre>
   * VaultQueryController handles read operations for vaults.
   * Every read shows entry names, addresses, descriptions and who saved them,
   * never a value.
   * </pre>
   */
  public static final class VaultQueryControllerBlockingV2Stub
      extends io.grpc.stub.AbstractBlockingStub<VaultQueryControllerBlockingV2Stub> {
    private VaultQueryControllerBlockingV2Stub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected VaultQueryControllerBlockingV2Stub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new VaultQueryControllerBlockingV2Stub(channel, callOptions);
    }

    /**
     * <pre>
     * Get a vault by ID.
     * </pre>
     */
    public ai.stigmer.agentic.vault.v1.Vault get(ai.stigmer.commons.apiresource.ApiResourceId request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getGetMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Get a vault by its organization-scoped reference (org/slug).
     * </pre>
     */
    public ai.stigmer.agentic.vault.v1.Vault getByReference(ai.stigmer.commons.apiresource.ApiResourceReference request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getGetByReferenceMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Get the caller's own My vault in an organization.
     * Answers NOT_FOUND until the caller saves their first login or secret.
     * </pre>
     */
    public ai.stigmer.agentic.vault.v1.Vault getMine(ai.stigmer.agentic.vault.v1.GetMyVaultInput request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getGetMineMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Get a shared vault by the integrator's own id for it.
     * </pre>
     */
    public ai.stigmer.agentic.vault.v1.Vault getByExternalId(ai.stigmer.agentic.vault.v1.GetVaultByExternalIdInput request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getGetByExternalIdMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * List the vaults the caller can see in an organization: their own My
     * vault and the shared vaults they may view.
     * </pre>
     */
    public ai.stigmer.agentic.vault.v1.VaultList list(ai.stigmer.agentic.vault.v1.ListVaultsRequest request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getListMethod(), getCallOptions(), request);
    }
  }

  /**
   * A stub to allow clients to do limited synchronous rpc calls to service VaultQueryController.
   * <pre>
   * VaultQueryController handles read operations for vaults.
   * Every read shows entry names, addresses, descriptions and who saved them,
   * never a value.
   * </pre>
   */
  public static final class VaultQueryControllerBlockingStub
      extends io.grpc.stub.AbstractBlockingStub<VaultQueryControllerBlockingStub> {
    private VaultQueryControllerBlockingStub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected VaultQueryControllerBlockingStub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new VaultQueryControllerBlockingStub(channel, callOptions);
    }

    /**
     * <pre>
     * Get a vault by ID.
     * </pre>
     */
    public ai.stigmer.agentic.vault.v1.Vault get(ai.stigmer.commons.apiresource.ApiResourceId request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getGetMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Get a vault by its organization-scoped reference (org/slug).
     * </pre>
     */
    public ai.stigmer.agentic.vault.v1.Vault getByReference(ai.stigmer.commons.apiresource.ApiResourceReference request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getGetByReferenceMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Get the caller's own My vault in an organization.
     * Answers NOT_FOUND until the caller saves their first login or secret.
     * </pre>
     */
    public ai.stigmer.agentic.vault.v1.Vault getMine(ai.stigmer.agentic.vault.v1.GetMyVaultInput request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getGetMineMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Get a shared vault by the integrator's own id for it.
     * </pre>
     */
    public ai.stigmer.agentic.vault.v1.Vault getByExternalId(ai.stigmer.agentic.vault.v1.GetVaultByExternalIdInput request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getGetByExternalIdMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * List the vaults the caller can see in an organization: their own My
     * vault and the shared vaults they may view.
     * </pre>
     */
    public ai.stigmer.agentic.vault.v1.VaultList list(ai.stigmer.agentic.vault.v1.ListVaultsRequest request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getListMethod(), getCallOptions(), request);
    }
  }

  /**
   * A stub to allow clients to do ListenableFuture-style rpc calls to service VaultQueryController.
   * <pre>
   * VaultQueryController handles read operations for vaults.
   * Every read shows entry names, addresses, descriptions and who saved them,
   * never a value.
   * </pre>
   */
  public static final class VaultQueryControllerFutureStub
      extends io.grpc.stub.AbstractFutureStub<VaultQueryControllerFutureStub> {
    private VaultQueryControllerFutureStub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected VaultQueryControllerFutureStub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new VaultQueryControllerFutureStub(channel, callOptions);
    }

    /**
     * <pre>
     * Get a vault by ID.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.agentic.vault.v1.Vault> get(
        ai.stigmer.commons.apiresource.ApiResourceId request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getGetMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * Get a vault by its organization-scoped reference (org/slug).
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.agentic.vault.v1.Vault> getByReference(
        ai.stigmer.commons.apiresource.ApiResourceReference request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getGetByReferenceMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * Get the caller's own My vault in an organization.
     * Answers NOT_FOUND until the caller saves their first login or secret.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.agentic.vault.v1.Vault> getMine(
        ai.stigmer.agentic.vault.v1.GetMyVaultInput request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getGetMineMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * Get a shared vault by the integrator's own id for it.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.agentic.vault.v1.Vault> getByExternalId(
        ai.stigmer.agentic.vault.v1.GetVaultByExternalIdInput request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getGetByExternalIdMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * List the vaults the caller can see in an organization: their own My
     * vault and the shared vaults they may view.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.agentic.vault.v1.VaultList> list(
        ai.stigmer.agentic.vault.v1.ListVaultsRequest request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getListMethod(), getCallOptions()), request);
    }
  }

  private static final int METHODID_GET = 0;
  private static final int METHODID_GET_BY_REFERENCE = 1;
  private static final int METHODID_GET_MINE = 2;
  private static final int METHODID_GET_BY_EXTERNAL_ID = 3;
  private static final int METHODID_LIST = 4;

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
              (io.grpc.stub.StreamObserver<ai.stigmer.agentic.vault.v1.Vault>) responseObserver);
          break;
        case METHODID_GET_BY_REFERENCE:
          serviceImpl.getByReference((ai.stigmer.commons.apiresource.ApiResourceReference) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.agentic.vault.v1.Vault>) responseObserver);
          break;
        case METHODID_GET_MINE:
          serviceImpl.getMine((ai.stigmer.agentic.vault.v1.GetMyVaultInput) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.agentic.vault.v1.Vault>) responseObserver);
          break;
        case METHODID_GET_BY_EXTERNAL_ID:
          serviceImpl.getByExternalId((ai.stigmer.agentic.vault.v1.GetVaultByExternalIdInput) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.agentic.vault.v1.Vault>) responseObserver);
          break;
        case METHODID_LIST:
          serviceImpl.list((ai.stigmer.agentic.vault.v1.ListVaultsRequest) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.agentic.vault.v1.VaultList>) responseObserver);
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
              ai.stigmer.agentic.vault.v1.Vault>(
                service, METHODID_GET)))
        .addMethod(
          getGetByReferenceMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.commons.apiresource.ApiResourceReference,
              ai.stigmer.agentic.vault.v1.Vault>(
                service, METHODID_GET_BY_REFERENCE)))
        .addMethod(
          getGetMineMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.agentic.vault.v1.GetMyVaultInput,
              ai.stigmer.agentic.vault.v1.Vault>(
                service, METHODID_GET_MINE)))
        .addMethod(
          getGetByExternalIdMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.agentic.vault.v1.GetVaultByExternalIdInput,
              ai.stigmer.agentic.vault.v1.Vault>(
                service, METHODID_GET_BY_EXTERNAL_ID)))
        .addMethod(
          getListMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.agentic.vault.v1.ListVaultsRequest,
              ai.stigmer.agentic.vault.v1.VaultList>(
                service, METHODID_LIST)))
        .build();
  }

  private static abstract class VaultQueryControllerBaseDescriptorSupplier
      implements io.grpc.protobuf.ProtoFileDescriptorSupplier, io.grpc.protobuf.ProtoServiceDescriptorSupplier {
    VaultQueryControllerBaseDescriptorSupplier() {}

    @java.lang.Override
    public com.google.protobuf.Descriptors.FileDescriptor getFileDescriptor() {
      return ai.stigmer.agentic.vault.v1.QueryProto.getDescriptor();
    }

    @java.lang.Override
    public com.google.protobuf.Descriptors.ServiceDescriptor getServiceDescriptor() {
      return getFileDescriptor().findServiceByName("VaultQueryController");
    }
  }

  private static final class VaultQueryControllerFileDescriptorSupplier
      extends VaultQueryControllerBaseDescriptorSupplier {
    VaultQueryControllerFileDescriptorSupplier() {}
  }

  private static final class VaultQueryControllerMethodDescriptorSupplier
      extends VaultQueryControllerBaseDescriptorSupplier
      implements io.grpc.protobuf.ProtoMethodDescriptorSupplier {
    private final java.lang.String methodName;

    VaultQueryControllerMethodDescriptorSupplier(java.lang.String methodName) {
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
      synchronized (VaultQueryControllerGrpc.class) {
        result = serviceDescriptor;
        if (result == null) {
          serviceDescriptor = result = io.grpc.ServiceDescriptor.newBuilder(SERVICE_NAME)
              .setSchemaDescriptor(new VaultQueryControllerFileDescriptorSupplier())
              .addMethod(getGetMethod())
              .addMethod(getGetByReferenceMethod())
              .addMethod(getGetMineMethod())
              .addMethod(getGetByExternalIdMethod())
              .addMethod(getListMethod())
              .build();
        }
      }
    }
    return result;
  }
}
