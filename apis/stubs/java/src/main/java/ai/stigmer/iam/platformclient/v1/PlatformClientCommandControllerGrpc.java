package ai.stigmer.iam.platformclient.v1;

import static io.grpc.MethodDescriptor.generateFullMethodName;

/**
 * <pre>
 * PlatformClientCommandController provides write operations for platform client resources.
 * Platform clients hold OAuth2 credentials (client_id + client_secret) for
 * platform builders embedding Stigmer into their products. The client_secret
 * is generated server-side and returned only once in the create and
 * rotateSecret responses.
 * &#64;internal
 * PlatformClients hold credential material (client_secret_hash) and are always
 * org-private. There is no updateVisibility RPC — public visibility is
 * intentionally unsupported to prevent credential leakage.
 * </pre>
 */
@io.grpc.stub.annotations.GrpcGenerated
public final class PlatformClientCommandControllerGrpc {

  private PlatformClientCommandControllerGrpc() {}

  public static final java.lang.String SERVICE_NAME = "ai.stigmer.iam.platformclient.v1.PlatformClientCommandController";

  // Static method descriptors that strictly reflect the proto.
  private static volatile io.grpc.MethodDescriptor<ai.stigmer.iam.platformclient.v1.PlatformClient,
      ai.stigmer.iam.platformclient.v1.PlatformClientCreateResponse> getCreateMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "create",
      requestType = ai.stigmer.iam.platformclient.v1.PlatformClient.class,
      responseType = ai.stigmer.iam.platformclient.v1.PlatformClientCreateResponse.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.iam.platformclient.v1.PlatformClient,
      ai.stigmer.iam.platformclient.v1.PlatformClientCreateResponse> getCreateMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.iam.platformclient.v1.PlatformClient, ai.stigmer.iam.platformclient.v1.PlatformClientCreateResponse> getCreateMethod;
    if ((getCreateMethod = PlatformClientCommandControllerGrpc.getCreateMethod) == null) {
      synchronized (PlatformClientCommandControllerGrpc.class) {
        if ((getCreateMethod = PlatformClientCommandControllerGrpc.getCreateMethod) == null) {
          PlatformClientCommandControllerGrpc.getCreateMethod = getCreateMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.iam.platformclient.v1.PlatformClient, ai.stigmer.iam.platformclient.v1.PlatformClientCreateResponse>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "create"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.iam.platformclient.v1.PlatformClient.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.iam.platformclient.v1.PlatformClientCreateResponse.getDefaultInstance()))
              .setSchemaDescriptor(new PlatformClientCommandControllerMethodDescriptorSupplier("create"))
              .build();
        }
      }
    }
    return getCreateMethod;
  }

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.iam.platformclient.v1.PlatformClient,
      ai.stigmer.iam.platformclient.v1.PlatformClient> getUpdateMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "update",
      requestType = ai.stigmer.iam.platformclient.v1.PlatformClient.class,
      responseType = ai.stigmer.iam.platformclient.v1.PlatformClient.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.iam.platformclient.v1.PlatformClient,
      ai.stigmer.iam.platformclient.v1.PlatformClient> getUpdateMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.iam.platformclient.v1.PlatformClient, ai.stigmer.iam.platformclient.v1.PlatformClient> getUpdateMethod;
    if ((getUpdateMethod = PlatformClientCommandControllerGrpc.getUpdateMethod) == null) {
      synchronized (PlatformClientCommandControllerGrpc.class) {
        if ((getUpdateMethod = PlatformClientCommandControllerGrpc.getUpdateMethod) == null) {
          PlatformClientCommandControllerGrpc.getUpdateMethod = getUpdateMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.iam.platformclient.v1.PlatformClient, ai.stigmer.iam.platformclient.v1.PlatformClient>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "update"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.iam.platformclient.v1.PlatformClient.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.iam.platformclient.v1.PlatformClient.getDefaultInstance()))
              .setSchemaDescriptor(new PlatformClientCommandControllerMethodDescriptorSupplier("update"))
              .build();
        }
      }
    }
    return getUpdateMethod;
  }

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.commons.apiresource.ApiResourceDeleteInput,
      ai.stigmer.iam.platformclient.v1.PlatformClient> getDeleteMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "delete",
      requestType = ai.stigmer.commons.apiresource.ApiResourceDeleteInput.class,
      responseType = ai.stigmer.iam.platformclient.v1.PlatformClient.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.commons.apiresource.ApiResourceDeleteInput,
      ai.stigmer.iam.platformclient.v1.PlatformClient> getDeleteMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.commons.apiresource.ApiResourceDeleteInput, ai.stigmer.iam.platformclient.v1.PlatformClient> getDeleteMethod;
    if ((getDeleteMethod = PlatformClientCommandControllerGrpc.getDeleteMethod) == null) {
      synchronized (PlatformClientCommandControllerGrpc.class) {
        if ((getDeleteMethod = PlatformClientCommandControllerGrpc.getDeleteMethod) == null) {
          PlatformClientCommandControllerGrpc.getDeleteMethod = getDeleteMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.commons.apiresource.ApiResourceDeleteInput, ai.stigmer.iam.platformclient.v1.PlatformClient>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "delete"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.commons.apiresource.ApiResourceDeleteInput.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.iam.platformclient.v1.PlatformClient.getDefaultInstance()))
              .setSchemaDescriptor(new PlatformClientCommandControllerMethodDescriptorSupplier("delete"))
              .build();
        }
      }
    }
    return getDeleteMethod;
  }

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.iam.platformclient.v1.PlatformClientId,
      ai.stigmer.iam.platformclient.v1.PlatformClientCreateResponse> getRotateSecretMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "rotateSecret",
      requestType = ai.stigmer.iam.platformclient.v1.PlatformClientId.class,
      responseType = ai.stigmer.iam.platformclient.v1.PlatformClientCreateResponse.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.iam.platformclient.v1.PlatformClientId,
      ai.stigmer.iam.platformclient.v1.PlatformClientCreateResponse> getRotateSecretMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.iam.platformclient.v1.PlatformClientId, ai.stigmer.iam.platformclient.v1.PlatformClientCreateResponse> getRotateSecretMethod;
    if ((getRotateSecretMethod = PlatformClientCommandControllerGrpc.getRotateSecretMethod) == null) {
      synchronized (PlatformClientCommandControllerGrpc.class) {
        if ((getRotateSecretMethod = PlatformClientCommandControllerGrpc.getRotateSecretMethod) == null) {
          PlatformClientCommandControllerGrpc.getRotateSecretMethod = getRotateSecretMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.iam.platformclient.v1.PlatformClientId, ai.stigmer.iam.platformclient.v1.PlatformClientCreateResponse>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "rotateSecret"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.iam.platformclient.v1.PlatformClientId.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.iam.platformclient.v1.PlatformClientCreateResponse.getDefaultInstance()))
              .setSchemaDescriptor(new PlatformClientCommandControllerMethodDescriptorSupplier("rotateSecret"))
              .build();
        }
      }
    }
    return getRotateSecretMethod;
  }

  /**
   * Creates a new async stub that supports all call types for the service
   */
  public static PlatformClientCommandControllerStub newStub(io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<PlatformClientCommandControllerStub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<PlatformClientCommandControllerStub>() {
        @java.lang.Override
        public PlatformClientCommandControllerStub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new PlatformClientCommandControllerStub(channel, callOptions);
        }
      };
    return PlatformClientCommandControllerStub.newStub(factory, channel);
  }

  /**
   * Creates a new blocking-style stub that supports all types of calls on the service
   */
  public static PlatformClientCommandControllerBlockingV2Stub newBlockingV2Stub(
      io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<PlatformClientCommandControllerBlockingV2Stub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<PlatformClientCommandControllerBlockingV2Stub>() {
        @java.lang.Override
        public PlatformClientCommandControllerBlockingV2Stub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new PlatformClientCommandControllerBlockingV2Stub(channel, callOptions);
        }
      };
    return PlatformClientCommandControllerBlockingV2Stub.newStub(factory, channel);
  }

  /**
   * Creates a new blocking-style stub that supports unary and streaming output calls on the service
   */
  public static PlatformClientCommandControllerBlockingStub newBlockingStub(
      io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<PlatformClientCommandControllerBlockingStub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<PlatformClientCommandControllerBlockingStub>() {
        @java.lang.Override
        public PlatformClientCommandControllerBlockingStub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new PlatformClientCommandControllerBlockingStub(channel, callOptions);
        }
      };
    return PlatformClientCommandControllerBlockingStub.newStub(factory, channel);
  }

  /**
   * Creates a new ListenableFuture-style stub that supports unary calls on the service
   */
  public static PlatformClientCommandControllerFutureStub newFutureStub(
      io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<PlatformClientCommandControllerFutureStub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<PlatformClientCommandControllerFutureStub>() {
        @java.lang.Override
        public PlatformClientCommandControllerFutureStub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new PlatformClientCommandControllerFutureStub(channel, callOptions);
        }
      };
    return PlatformClientCommandControllerFutureStub.newStub(factory, channel);
  }

  /**
   * <pre>
   * PlatformClientCommandController provides write operations for platform client resources.
   * Platform clients hold OAuth2 credentials (client_id + client_secret) for
   * platform builders embedding Stigmer into their products. The client_secret
   * is generated server-side and returned only once in the create and
   * rotateSecret responses.
   * &#64;internal
   * PlatformClients hold credential material (client_secret_hash) and are always
   * org-private. There is no updateVisibility RPC — public visibility is
   * intentionally unsupported to prevent credential leakage.
   * </pre>
   */
  public interface AsyncService {

    /**
     * <pre>
     * Create a platform client.
     * Generates a new client_id (stgm_cid_ prefix) and client_secret (stgm_cs_ prefix).
     * The raw client_secret is included in the response and is never returned again.
     * Store it securely before discarding the response.
     * The creator's organization owns the platform client. The creator is granted
     * the owner role automatically.
     * The slug `system-share-client` is platform-reserved (it identifies the org's
     * system-managed share client) and is rejected with INVALID_ARGUMENT — including
     * when derived from the resource name.
     * &#64;internal
     * Authorization: Requires can_create_platform_client permission in the organization.
     * </pre>
     */
    default void create(ai.stigmer.iam.platformclient.v1.PlatformClient request,
        io.grpc.stub.StreamObserver<ai.stigmer.iam.platformclient.v1.PlatformClientCreateResponse> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getCreateMethod(), responseObserver);
    }

    /**
     * <pre>
     * Update an existing platform client.
     * Only mutable fields can be changed: auto_provision_accounts, auto_grant_on_org,
     * auto_grant_role, and allowed_origins. Credential fields (client_id,
     * client_secret_hash, secret_fingerprint) are immutable after creation.
     * Use rotateSecret to change the client secret.
     * &#64;internal
     * Authorization: Requires can_edit permission on the platform client resource.
     * </pre>
     */
    default void update(ai.stigmer.iam.platformclient.v1.PlatformClient request,
        io.grpc.stub.StreamObserver<ai.stigmer.iam.platformclient.v1.PlatformClient> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getUpdateMethod(), responseObserver);
    }

    /**
     * <pre>
     * Delete a platform client.
     * Immediately invalidates the client_id and client_secret. Any tokens
     * previously minted by this platform client remain valid until their
     * own expiration — deletion does not revoke already-issued tokens.
     * &#64;internal
     * Authorization: Requires can_delete permission on the platform client resource.
     * </pre>
     */
    default void delete(ai.stigmer.commons.apiresource.ApiResourceDeleteInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.iam.platformclient.v1.PlatformClient> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getDeleteMethod(), responseObserver);
    }

    /**
     * <pre>
     * Rotate the client secret.
     * Generates a new client_secret, invalidates the old one immediately,
     * and returns the new raw secret in the response. The client_id remains
     * unchanged — platform builders do not need to update their client_id
     * configuration after rotation.
     * &#64;internal
     * Authorization: Requires can_edit permission on the platform client resource.
     * </pre>
     */
    default void rotateSecret(ai.stigmer.iam.platformclient.v1.PlatformClientId request,
        io.grpc.stub.StreamObserver<ai.stigmer.iam.platformclient.v1.PlatformClientCreateResponse> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getRotateSecretMethod(), responseObserver);
    }
  }

  /**
   * Base class for the server implementation of the service PlatformClientCommandController.
   * <pre>
   * PlatformClientCommandController provides write operations for platform client resources.
   * Platform clients hold OAuth2 credentials (client_id + client_secret) for
   * platform builders embedding Stigmer into their products. The client_secret
   * is generated server-side and returned only once in the create and
   * rotateSecret responses.
   * &#64;internal
   * PlatformClients hold credential material (client_secret_hash) and are always
   * org-private. There is no updateVisibility RPC — public visibility is
   * intentionally unsupported to prevent credential leakage.
   * </pre>
   */
  public static abstract class PlatformClientCommandControllerImplBase
      implements io.grpc.BindableService, AsyncService {

    @java.lang.Override public final io.grpc.ServerServiceDefinition bindService() {
      return PlatformClientCommandControllerGrpc.bindService(this);
    }
  }

  /**
   * A stub to allow clients to do asynchronous rpc calls to service PlatformClientCommandController.
   * <pre>
   * PlatformClientCommandController provides write operations for platform client resources.
   * Platform clients hold OAuth2 credentials (client_id + client_secret) for
   * platform builders embedding Stigmer into their products. The client_secret
   * is generated server-side and returned only once in the create and
   * rotateSecret responses.
   * &#64;internal
   * PlatformClients hold credential material (client_secret_hash) and are always
   * org-private. There is no updateVisibility RPC — public visibility is
   * intentionally unsupported to prevent credential leakage.
   * </pre>
   */
  public static final class PlatformClientCommandControllerStub
      extends io.grpc.stub.AbstractAsyncStub<PlatformClientCommandControllerStub> {
    private PlatformClientCommandControllerStub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected PlatformClientCommandControllerStub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new PlatformClientCommandControllerStub(channel, callOptions);
    }

    /**
     * <pre>
     * Create a platform client.
     * Generates a new client_id (stgm_cid_ prefix) and client_secret (stgm_cs_ prefix).
     * The raw client_secret is included in the response and is never returned again.
     * Store it securely before discarding the response.
     * The creator's organization owns the platform client. The creator is granted
     * the owner role automatically.
     * The slug `system-share-client` is platform-reserved (it identifies the org's
     * system-managed share client) and is rejected with INVALID_ARGUMENT — including
     * when derived from the resource name.
     * &#64;internal
     * Authorization: Requires can_create_platform_client permission in the organization.
     * </pre>
     */
    public void create(ai.stigmer.iam.platformclient.v1.PlatformClient request,
        io.grpc.stub.StreamObserver<ai.stigmer.iam.platformclient.v1.PlatformClientCreateResponse> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getCreateMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * Update an existing platform client.
     * Only mutable fields can be changed: auto_provision_accounts, auto_grant_on_org,
     * auto_grant_role, and allowed_origins. Credential fields (client_id,
     * client_secret_hash, secret_fingerprint) are immutable after creation.
     * Use rotateSecret to change the client secret.
     * &#64;internal
     * Authorization: Requires can_edit permission on the platform client resource.
     * </pre>
     */
    public void update(ai.stigmer.iam.platformclient.v1.PlatformClient request,
        io.grpc.stub.StreamObserver<ai.stigmer.iam.platformclient.v1.PlatformClient> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getUpdateMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * Delete a platform client.
     * Immediately invalidates the client_id and client_secret. Any tokens
     * previously minted by this platform client remain valid until their
     * own expiration — deletion does not revoke already-issued tokens.
     * &#64;internal
     * Authorization: Requires can_delete permission on the platform client resource.
     * </pre>
     */
    public void delete(ai.stigmer.commons.apiresource.ApiResourceDeleteInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.iam.platformclient.v1.PlatformClient> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getDeleteMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * Rotate the client secret.
     * Generates a new client_secret, invalidates the old one immediately,
     * and returns the new raw secret in the response. The client_id remains
     * unchanged — platform builders do not need to update their client_id
     * configuration after rotation.
     * &#64;internal
     * Authorization: Requires can_edit permission on the platform client resource.
     * </pre>
     */
    public void rotateSecret(ai.stigmer.iam.platformclient.v1.PlatformClientId request,
        io.grpc.stub.StreamObserver<ai.stigmer.iam.platformclient.v1.PlatformClientCreateResponse> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getRotateSecretMethod(), getCallOptions()), request, responseObserver);
    }
  }

  /**
   * A stub to allow clients to do synchronous rpc calls to service PlatformClientCommandController.
   * <pre>
   * PlatformClientCommandController provides write operations for platform client resources.
   * Platform clients hold OAuth2 credentials (client_id + client_secret) for
   * platform builders embedding Stigmer into their products. The client_secret
   * is generated server-side and returned only once in the create and
   * rotateSecret responses.
   * &#64;internal
   * PlatformClients hold credential material (client_secret_hash) and are always
   * org-private. There is no updateVisibility RPC — public visibility is
   * intentionally unsupported to prevent credential leakage.
   * </pre>
   */
  public static final class PlatformClientCommandControllerBlockingV2Stub
      extends io.grpc.stub.AbstractBlockingStub<PlatformClientCommandControllerBlockingV2Stub> {
    private PlatformClientCommandControllerBlockingV2Stub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected PlatformClientCommandControllerBlockingV2Stub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new PlatformClientCommandControllerBlockingV2Stub(channel, callOptions);
    }

    /**
     * <pre>
     * Create a platform client.
     * Generates a new client_id (stgm_cid_ prefix) and client_secret (stgm_cs_ prefix).
     * The raw client_secret is included in the response and is never returned again.
     * Store it securely before discarding the response.
     * The creator's organization owns the platform client. The creator is granted
     * the owner role automatically.
     * The slug `system-share-client` is platform-reserved (it identifies the org's
     * system-managed share client) and is rejected with INVALID_ARGUMENT — including
     * when derived from the resource name.
     * &#64;internal
     * Authorization: Requires can_create_platform_client permission in the organization.
     * </pre>
     */
    public ai.stigmer.iam.platformclient.v1.PlatformClientCreateResponse create(ai.stigmer.iam.platformclient.v1.PlatformClient request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getCreateMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Update an existing platform client.
     * Only mutable fields can be changed: auto_provision_accounts, auto_grant_on_org,
     * auto_grant_role, and allowed_origins. Credential fields (client_id,
     * client_secret_hash, secret_fingerprint) are immutable after creation.
     * Use rotateSecret to change the client secret.
     * &#64;internal
     * Authorization: Requires can_edit permission on the platform client resource.
     * </pre>
     */
    public ai.stigmer.iam.platformclient.v1.PlatformClient update(ai.stigmer.iam.platformclient.v1.PlatformClient request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getUpdateMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Delete a platform client.
     * Immediately invalidates the client_id and client_secret. Any tokens
     * previously minted by this platform client remain valid until their
     * own expiration — deletion does not revoke already-issued tokens.
     * &#64;internal
     * Authorization: Requires can_delete permission on the platform client resource.
     * </pre>
     */
    public ai.stigmer.iam.platformclient.v1.PlatformClient delete(ai.stigmer.commons.apiresource.ApiResourceDeleteInput request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getDeleteMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Rotate the client secret.
     * Generates a new client_secret, invalidates the old one immediately,
     * and returns the new raw secret in the response. The client_id remains
     * unchanged — platform builders do not need to update their client_id
     * configuration after rotation.
     * &#64;internal
     * Authorization: Requires can_edit permission on the platform client resource.
     * </pre>
     */
    public ai.stigmer.iam.platformclient.v1.PlatformClientCreateResponse rotateSecret(ai.stigmer.iam.platformclient.v1.PlatformClientId request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getRotateSecretMethod(), getCallOptions(), request);
    }
  }

  /**
   * A stub to allow clients to do limited synchronous rpc calls to service PlatformClientCommandController.
   * <pre>
   * PlatformClientCommandController provides write operations for platform client resources.
   * Platform clients hold OAuth2 credentials (client_id + client_secret) for
   * platform builders embedding Stigmer into their products. The client_secret
   * is generated server-side and returned only once in the create and
   * rotateSecret responses.
   * &#64;internal
   * PlatformClients hold credential material (client_secret_hash) and are always
   * org-private. There is no updateVisibility RPC — public visibility is
   * intentionally unsupported to prevent credential leakage.
   * </pre>
   */
  public static final class PlatformClientCommandControllerBlockingStub
      extends io.grpc.stub.AbstractBlockingStub<PlatformClientCommandControllerBlockingStub> {
    private PlatformClientCommandControllerBlockingStub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected PlatformClientCommandControllerBlockingStub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new PlatformClientCommandControllerBlockingStub(channel, callOptions);
    }

    /**
     * <pre>
     * Create a platform client.
     * Generates a new client_id (stgm_cid_ prefix) and client_secret (stgm_cs_ prefix).
     * The raw client_secret is included in the response and is never returned again.
     * Store it securely before discarding the response.
     * The creator's organization owns the platform client. The creator is granted
     * the owner role automatically.
     * The slug `system-share-client` is platform-reserved (it identifies the org's
     * system-managed share client) and is rejected with INVALID_ARGUMENT — including
     * when derived from the resource name.
     * &#64;internal
     * Authorization: Requires can_create_platform_client permission in the organization.
     * </pre>
     */
    public ai.stigmer.iam.platformclient.v1.PlatformClientCreateResponse create(ai.stigmer.iam.platformclient.v1.PlatformClient request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getCreateMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Update an existing platform client.
     * Only mutable fields can be changed: auto_provision_accounts, auto_grant_on_org,
     * auto_grant_role, and allowed_origins. Credential fields (client_id,
     * client_secret_hash, secret_fingerprint) are immutable after creation.
     * Use rotateSecret to change the client secret.
     * &#64;internal
     * Authorization: Requires can_edit permission on the platform client resource.
     * </pre>
     */
    public ai.stigmer.iam.platformclient.v1.PlatformClient update(ai.stigmer.iam.platformclient.v1.PlatformClient request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getUpdateMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Delete a platform client.
     * Immediately invalidates the client_id and client_secret. Any tokens
     * previously minted by this platform client remain valid until their
     * own expiration — deletion does not revoke already-issued tokens.
     * &#64;internal
     * Authorization: Requires can_delete permission on the platform client resource.
     * </pre>
     */
    public ai.stigmer.iam.platformclient.v1.PlatformClient delete(ai.stigmer.commons.apiresource.ApiResourceDeleteInput request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getDeleteMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Rotate the client secret.
     * Generates a new client_secret, invalidates the old one immediately,
     * and returns the new raw secret in the response. The client_id remains
     * unchanged — platform builders do not need to update their client_id
     * configuration after rotation.
     * &#64;internal
     * Authorization: Requires can_edit permission on the platform client resource.
     * </pre>
     */
    public ai.stigmer.iam.platformclient.v1.PlatformClientCreateResponse rotateSecret(ai.stigmer.iam.platformclient.v1.PlatformClientId request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getRotateSecretMethod(), getCallOptions(), request);
    }
  }

  /**
   * A stub to allow clients to do ListenableFuture-style rpc calls to service PlatformClientCommandController.
   * <pre>
   * PlatformClientCommandController provides write operations for platform client resources.
   * Platform clients hold OAuth2 credentials (client_id + client_secret) for
   * platform builders embedding Stigmer into their products. The client_secret
   * is generated server-side and returned only once in the create and
   * rotateSecret responses.
   * &#64;internal
   * PlatformClients hold credential material (client_secret_hash) and are always
   * org-private. There is no updateVisibility RPC — public visibility is
   * intentionally unsupported to prevent credential leakage.
   * </pre>
   */
  public static final class PlatformClientCommandControllerFutureStub
      extends io.grpc.stub.AbstractFutureStub<PlatformClientCommandControllerFutureStub> {
    private PlatformClientCommandControllerFutureStub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected PlatformClientCommandControllerFutureStub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new PlatformClientCommandControllerFutureStub(channel, callOptions);
    }

    /**
     * <pre>
     * Create a platform client.
     * Generates a new client_id (stgm_cid_ prefix) and client_secret (stgm_cs_ prefix).
     * The raw client_secret is included in the response and is never returned again.
     * Store it securely before discarding the response.
     * The creator's organization owns the platform client. The creator is granted
     * the owner role automatically.
     * The slug `system-share-client` is platform-reserved (it identifies the org's
     * system-managed share client) and is rejected with INVALID_ARGUMENT — including
     * when derived from the resource name.
     * &#64;internal
     * Authorization: Requires can_create_platform_client permission in the organization.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.iam.platformclient.v1.PlatformClientCreateResponse> create(
        ai.stigmer.iam.platformclient.v1.PlatformClient request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getCreateMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * Update an existing platform client.
     * Only mutable fields can be changed: auto_provision_accounts, auto_grant_on_org,
     * auto_grant_role, and allowed_origins. Credential fields (client_id,
     * client_secret_hash, secret_fingerprint) are immutable after creation.
     * Use rotateSecret to change the client secret.
     * &#64;internal
     * Authorization: Requires can_edit permission on the platform client resource.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.iam.platformclient.v1.PlatformClient> update(
        ai.stigmer.iam.platformclient.v1.PlatformClient request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getUpdateMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * Delete a platform client.
     * Immediately invalidates the client_id and client_secret. Any tokens
     * previously minted by this platform client remain valid until their
     * own expiration — deletion does not revoke already-issued tokens.
     * &#64;internal
     * Authorization: Requires can_delete permission on the platform client resource.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.iam.platformclient.v1.PlatformClient> delete(
        ai.stigmer.commons.apiresource.ApiResourceDeleteInput request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getDeleteMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * Rotate the client secret.
     * Generates a new client_secret, invalidates the old one immediately,
     * and returns the new raw secret in the response. The client_id remains
     * unchanged — platform builders do not need to update their client_id
     * configuration after rotation.
     * &#64;internal
     * Authorization: Requires can_edit permission on the platform client resource.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.iam.platformclient.v1.PlatformClientCreateResponse> rotateSecret(
        ai.stigmer.iam.platformclient.v1.PlatformClientId request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getRotateSecretMethod(), getCallOptions()), request);
    }
  }

  private static final int METHODID_CREATE = 0;
  private static final int METHODID_UPDATE = 1;
  private static final int METHODID_DELETE = 2;
  private static final int METHODID_ROTATE_SECRET = 3;

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
        case METHODID_CREATE:
          serviceImpl.create((ai.stigmer.iam.platformclient.v1.PlatformClient) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.iam.platformclient.v1.PlatformClientCreateResponse>) responseObserver);
          break;
        case METHODID_UPDATE:
          serviceImpl.update((ai.stigmer.iam.platformclient.v1.PlatformClient) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.iam.platformclient.v1.PlatformClient>) responseObserver);
          break;
        case METHODID_DELETE:
          serviceImpl.delete((ai.stigmer.commons.apiresource.ApiResourceDeleteInput) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.iam.platformclient.v1.PlatformClient>) responseObserver);
          break;
        case METHODID_ROTATE_SECRET:
          serviceImpl.rotateSecret((ai.stigmer.iam.platformclient.v1.PlatformClientId) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.iam.platformclient.v1.PlatformClientCreateResponse>) responseObserver);
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
          getCreateMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.iam.platformclient.v1.PlatformClient,
              ai.stigmer.iam.platformclient.v1.PlatformClientCreateResponse>(
                service, METHODID_CREATE)))
        .addMethod(
          getUpdateMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.iam.platformclient.v1.PlatformClient,
              ai.stigmer.iam.platformclient.v1.PlatformClient>(
                service, METHODID_UPDATE)))
        .addMethod(
          getDeleteMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.commons.apiresource.ApiResourceDeleteInput,
              ai.stigmer.iam.platformclient.v1.PlatformClient>(
                service, METHODID_DELETE)))
        .addMethod(
          getRotateSecretMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.iam.platformclient.v1.PlatformClientId,
              ai.stigmer.iam.platformclient.v1.PlatformClientCreateResponse>(
                service, METHODID_ROTATE_SECRET)))
        .build();
  }

  private static abstract class PlatformClientCommandControllerBaseDescriptorSupplier
      implements io.grpc.protobuf.ProtoFileDescriptorSupplier, io.grpc.protobuf.ProtoServiceDescriptorSupplier {
    PlatformClientCommandControllerBaseDescriptorSupplier() {}

    @java.lang.Override
    public com.google.protobuf.Descriptors.FileDescriptor getFileDescriptor() {
      return ai.stigmer.iam.platformclient.v1.CommandProto.getDescriptor();
    }

    @java.lang.Override
    public com.google.protobuf.Descriptors.ServiceDescriptor getServiceDescriptor() {
      return getFileDescriptor().findServiceByName("PlatformClientCommandController");
    }
  }

  private static final class PlatformClientCommandControllerFileDescriptorSupplier
      extends PlatformClientCommandControllerBaseDescriptorSupplier {
    PlatformClientCommandControllerFileDescriptorSupplier() {}
  }

  private static final class PlatformClientCommandControllerMethodDescriptorSupplier
      extends PlatformClientCommandControllerBaseDescriptorSupplier
      implements io.grpc.protobuf.ProtoMethodDescriptorSupplier {
    private final java.lang.String methodName;

    PlatformClientCommandControllerMethodDescriptorSupplier(java.lang.String methodName) {
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
      synchronized (PlatformClientCommandControllerGrpc.class) {
        result = serviceDescriptor;
        if (result == null) {
          serviceDescriptor = result = io.grpc.ServiceDescriptor.newBuilder(SERVICE_NAME)
              .setSchemaDescriptor(new PlatformClientCommandControllerFileDescriptorSupplier())
              .addMethod(getCreateMethod())
              .addMethod(getUpdateMethod())
              .addMethod(getDeleteMethod())
              .addMethod(getRotateSecretMethod())
              .build();
        }
      }
    }
    return result;
  }
}
