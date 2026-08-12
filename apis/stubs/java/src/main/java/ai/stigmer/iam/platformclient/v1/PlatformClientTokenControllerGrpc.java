package ai.stigmer.iam.platformclient.v1;

import static io.grpc.MethodDescriptor.generateFullMethodName;

/**
 * <pre>
 * PlatformClientTokenController provides token-minting operations for
 * platform builders embedding Stigmer into their products.
 * This service is distinct from the CRUD controllers — it does not manage
 * a resource lifecycle. Instead, it issues Stigmer-signed JWTs on behalf
 * of platform builder users, authenticated via PlatformClient credentials
 * (client_id + client_secret).
 * The minted JWT is signed by Stigmer's own key pair (not Auth0). The auth
 * chain validates these tokens via a dedicated PlatformClientTokenAuthenticationProvider
 * that checks the Stigmer-issued signature and resolves the identity account.
 * mintGuestToken is the credential-free exception: no client_id/client_secret.
 * It mints a guest-scoped JWT for anonymous visitors of a shared agent's
 * hosted page, gated on an enabled public-audience AgentShare
 * (ai.stigmer.agentic.agentshare.v1).
 * </pre>
 */
@io.grpc.stub.annotations.GrpcGenerated
public final class PlatformClientTokenControllerGrpc {

  private PlatformClientTokenControllerGrpc() {}

  public static final java.lang.String SERVICE_NAME = "ai.stigmer.iam.platformclient.v1.PlatformClientTokenController";

  // Static method descriptors that strictly reflect the proto.
  private static volatile io.grpc.MethodDescriptor<ai.stigmer.iam.platformclient.v1.MintUserTokenRequest,
      ai.stigmer.iam.platformclient.v1.MintUserTokenResponse> getMintUserTokenMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "mintUserToken",
      requestType = ai.stigmer.iam.platformclient.v1.MintUserTokenRequest.class,
      responseType = ai.stigmer.iam.platformclient.v1.MintUserTokenResponse.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.iam.platformclient.v1.MintUserTokenRequest,
      ai.stigmer.iam.platformclient.v1.MintUserTokenResponse> getMintUserTokenMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.iam.platformclient.v1.MintUserTokenRequest, ai.stigmer.iam.platformclient.v1.MintUserTokenResponse> getMintUserTokenMethod;
    if ((getMintUserTokenMethod = PlatformClientTokenControllerGrpc.getMintUserTokenMethod) == null) {
      synchronized (PlatformClientTokenControllerGrpc.class) {
        if ((getMintUserTokenMethod = PlatformClientTokenControllerGrpc.getMintUserTokenMethod) == null) {
          PlatformClientTokenControllerGrpc.getMintUserTokenMethod = getMintUserTokenMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.iam.platformclient.v1.MintUserTokenRequest, ai.stigmer.iam.platformclient.v1.MintUserTokenResponse>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "mintUserToken"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.iam.platformclient.v1.MintUserTokenRequest.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.iam.platformclient.v1.MintUserTokenResponse.getDefaultInstance()))
              .setSchemaDescriptor(new PlatformClientTokenControllerMethodDescriptorSupplier("mintUserToken"))
              .build();
        }
      }
    }
    return getMintUserTokenMethod;
  }

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.iam.platformclient.v1.MintGuestTokenRequest,
      ai.stigmer.iam.platformclient.v1.MintGuestTokenResponse> getMintGuestTokenMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "mintGuestToken",
      requestType = ai.stigmer.iam.platformclient.v1.MintGuestTokenRequest.class,
      responseType = ai.stigmer.iam.platformclient.v1.MintGuestTokenResponse.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.iam.platformclient.v1.MintGuestTokenRequest,
      ai.stigmer.iam.platformclient.v1.MintGuestTokenResponse> getMintGuestTokenMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.iam.platformclient.v1.MintGuestTokenRequest, ai.stigmer.iam.platformclient.v1.MintGuestTokenResponse> getMintGuestTokenMethod;
    if ((getMintGuestTokenMethod = PlatformClientTokenControllerGrpc.getMintGuestTokenMethod) == null) {
      synchronized (PlatformClientTokenControllerGrpc.class) {
        if ((getMintGuestTokenMethod = PlatformClientTokenControllerGrpc.getMintGuestTokenMethod) == null) {
          PlatformClientTokenControllerGrpc.getMintGuestTokenMethod = getMintGuestTokenMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.iam.platformclient.v1.MintGuestTokenRequest, ai.stigmer.iam.platformclient.v1.MintGuestTokenResponse>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "mintGuestToken"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.iam.platformclient.v1.MintGuestTokenRequest.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.iam.platformclient.v1.MintGuestTokenResponse.getDefaultInstance()))
              .setSchemaDescriptor(new PlatformClientTokenControllerMethodDescriptorSupplier("mintGuestToken"))
              .build();
        }
      }
    }
    return getMintGuestTokenMethod;
  }

  /**
   * Creates a new async stub that supports all call types for the service
   */
  public static PlatformClientTokenControllerStub newStub(io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<PlatformClientTokenControllerStub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<PlatformClientTokenControllerStub>() {
        @java.lang.Override
        public PlatformClientTokenControllerStub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new PlatformClientTokenControllerStub(channel, callOptions);
        }
      };
    return PlatformClientTokenControllerStub.newStub(factory, channel);
  }

  /**
   * Creates a new blocking-style stub that supports all types of calls on the service
   */
  public static PlatformClientTokenControllerBlockingV2Stub newBlockingV2Stub(
      io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<PlatformClientTokenControllerBlockingV2Stub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<PlatformClientTokenControllerBlockingV2Stub>() {
        @java.lang.Override
        public PlatformClientTokenControllerBlockingV2Stub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new PlatformClientTokenControllerBlockingV2Stub(channel, callOptions);
        }
      };
    return PlatformClientTokenControllerBlockingV2Stub.newStub(factory, channel);
  }

  /**
   * Creates a new blocking-style stub that supports unary and streaming output calls on the service
   */
  public static PlatformClientTokenControllerBlockingStub newBlockingStub(
      io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<PlatformClientTokenControllerBlockingStub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<PlatformClientTokenControllerBlockingStub>() {
        @java.lang.Override
        public PlatformClientTokenControllerBlockingStub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new PlatformClientTokenControllerBlockingStub(channel, callOptions);
        }
      };
    return PlatformClientTokenControllerBlockingStub.newStub(factory, channel);
  }

  /**
   * Creates a new ListenableFuture-style stub that supports unary calls on the service
   */
  public static PlatformClientTokenControllerFutureStub newFutureStub(
      io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<PlatformClientTokenControllerFutureStub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<PlatformClientTokenControllerFutureStub>() {
        @java.lang.Override
        public PlatformClientTokenControllerFutureStub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new PlatformClientTokenControllerFutureStub(channel, callOptions);
        }
      };
    return PlatformClientTokenControllerFutureStub.newStub(factory, channel);
  }

  /**
   * <pre>
   * PlatformClientTokenController provides token-minting operations for
   * platform builders embedding Stigmer into their products.
   * This service is distinct from the CRUD controllers — it does not manage
   * a resource lifecycle. Instead, it issues Stigmer-signed JWTs on behalf
   * of platform builder users, authenticated via PlatformClient credentials
   * (client_id + client_secret).
   * The minted JWT is signed by Stigmer's own key pair (not Auth0). The auth
   * chain validates these tokens via a dedicated PlatformClientTokenAuthenticationProvider
   * that checks the Stigmer-issued signature and resolves the identity account.
   * mintGuestToken is the credential-free exception: no client_id/client_secret.
   * It mints a guest-scoped JWT for anonymous visitors of a shared agent's
   * hosted page, gated on an enabled public-audience AgentShare
   * (ai.stigmer.agentic.agentshare.v1).
   * </pre>
   */
  public interface AsyncService {

    /**
     * <pre>
     * Mint a user-scoped JWT for browser-based access to Stigmer resources.
     * The platform builder's backend calls this RPC with its PlatformClient
     * credentials (client_id + client_secret) and the end user's identity.
     * Stigmer validates the credentials, optionally JIT-provisions the user's
     * identity account, and returns a Stigmer-signed JWT.
     * The returned JWT can be used by the React SDK (via StigmerProvider's
     * getAccessToken callback) to authenticate API calls from the browser.
     * Authentication flow:
     * 1. Validate client_id + client_secret against stored hash
     * 2. Resolve or JIT-provision the identity account for user_id
     * 3. If auto_grant_on_org is enabled, grant the configured role
     * 4. Sign a JWT with Stigmer's private key containing the user's identity
     * Error scenarios:
     * - UNAUTHENTICATED: Invalid client_id or client_secret
     * - FAILED_PRECONDITION: user_id does not exist and auto_provision_accounts
     *   is false, or the PlatformClient secret has expired
     * - INTERNAL: Account provisioning could not be completed (for example, the
     *   auto_grant_on_org role grant failed). No partial account is left behind
     *   — the account is rolled back — so the request is safe to retry.
     * Origin enforcement (spec.allowed_origins) does NOT apply to this call:
     * minting is server-to-server, so there is no browser Origin to check.
     * It applies to the browser API calls that BEAR the minted token — when
     * the PlatformClient lists allowed_origins, requests whose Origin header
     * is not on the list are refused PERMISSION_DENIED (see the
     * allowed_origins field docs in spec.proto for the exact semantics).
     * &#64;internal
     * This RPC is public — no Bearer token is required. The caller authenticates
     * by providing client_id + client_secret in the request body. The handler
     * validates these credentials as business logic, not via the auth interceptor.
     * </pre>
     */
    default void mintUserToken(ai.stigmer.iam.platformclient.v1.MintUserTokenRequest request,
        io.grpc.stub.StreamObserver<ai.stigmer.iam.platformclient.v1.MintUserTokenResponse> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getMintUserTokenMethod(), responseObserver);
    }

    /**
     * <pre>
     * Mint a guest-scoped JWT for an anonymous visitor of a shared agent's hosted page.
     * Resolves org+slug to an AgentShare, provisions the org's system-managed
     * PlatformClient and guest identity account lazily, and returns a short-lived
     * Stigmer-signed JWT scoped to that org.
     * &#64;internal
     * Public — no Bearer token. No PlatformClient credentials. The handler gates
     * on an enabled public-audience share (NOT_FOUND when disabled or missing)
     * and stamps the resolved share's id into the guest JWT as the share_id
     * claim — the create-time gate re-reads the live share by that id on every
     * session/execution create (decision 011 D6).
     * </pre>
     */
    default void mintGuestToken(ai.stigmer.iam.platformclient.v1.MintGuestTokenRequest request,
        io.grpc.stub.StreamObserver<ai.stigmer.iam.platformclient.v1.MintGuestTokenResponse> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getMintGuestTokenMethod(), responseObserver);
    }
  }

  /**
   * Base class for the server implementation of the service PlatformClientTokenController.
   * <pre>
   * PlatformClientTokenController provides token-minting operations for
   * platform builders embedding Stigmer into their products.
   * This service is distinct from the CRUD controllers — it does not manage
   * a resource lifecycle. Instead, it issues Stigmer-signed JWTs on behalf
   * of platform builder users, authenticated via PlatformClient credentials
   * (client_id + client_secret).
   * The minted JWT is signed by Stigmer's own key pair (not Auth0). The auth
   * chain validates these tokens via a dedicated PlatformClientTokenAuthenticationProvider
   * that checks the Stigmer-issued signature and resolves the identity account.
   * mintGuestToken is the credential-free exception: no client_id/client_secret.
   * It mints a guest-scoped JWT for anonymous visitors of a shared agent's
   * hosted page, gated on an enabled public-audience AgentShare
   * (ai.stigmer.agentic.agentshare.v1).
   * </pre>
   */
  public static abstract class PlatformClientTokenControllerImplBase
      implements io.grpc.BindableService, AsyncService {

    @java.lang.Override public final io.grpc.ServerServiceDefinition bindService() {
      return PlatformClientTokenControllerGrpc.bindService(this);
    }
  }

  /**
   * A stub to allow clients to do asynchronous rpc calls to service PlatformClientTokenController.
   * <pre>
   * PlatformClientTokenController provides token-minting operations for
   * platform builders embedding Stigmer into their products.
   * This service is distinct from the CRUD controllers — it does not manage
   * a resource lifecycle. Instead, it issues Stigmer-signed JWTs on behalf
   * of platform builder users, authenticated via PlatformClient credentials
   * (client_id + client_secret).
   * The minted JWT is signed by Stigmer's own key pair (not Auth0). The auth
   * chain validates these tokens via a dedicated PlatformClientTokenAuthenticationProvider
   * that checks the Stigmer-issued signature and resolves the identity account.
   * mintGuestToken is the credential-free exception: no client_id/client_secret.
   * It mints a guest-scoped JWT for anonymous visitors of a shared agent's
   * hosted page, gated on an enabled public-audience AgentShare
   * (ai.stigmer.agentic.agentshare.v1).
   * </pre>
   */
  public static final class PlatformClientTokenControllerStub
      extends io.grpc.stub.AbstractAsyncStub<PlatformClientTokenControllerStub> {
    private PlatformClientTokenControllerStub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected PlatformClientTokenControllerStub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new PlatformClientTokenControllerStub(channel, callOptions);
    }

    /**
     * <pre>
     * Mint a user-scoped JWT for browser-based access to Stigmer resources.
     * The platform builder's backend calls this RPC with its PlatformClient
     * credentials (client_id + client_secret) and the end user's identity.
     * Stigmer validates the credentials, optionally JIT-provisions the user's
     * identity account, and returns a Stigmer-signed JWT.
     * The returned JWT can be used by the React SDK (via StigmerProvider's
     * getAccessToken callback) to authenticate API calls from the browser.
     * Authentication flow:
     * 1. Validate client_id + client_secret against stored hash
     * 2. Resolve or JIT-provision the identity account for user_id
     * 3. If auto_grant_on_org is enabled, grant the configured role
     * 4. Sign a JWT with Stigmer's private key containing the user's identity
     * Error scenarios:
     * - UNAUTHENTICATED: Invalid client_id or client_secret
     * - FAILED_PRECONDITION: user_id does not exist and auto_provision_accounts
     *   is false, or the PlatformClient secret has expired
     * - INTERNAL: Account provisioning could not be completed (for example, the
     *   auto_grant_on_org role grant failed). No partial account is left behind
     *   — the account is rolled back — so the request is safe to retry.
     * Origin enforcement (spec.allowed_origins) does NOT apply to this call:
     * minting is server-to-server, so there is no browser Origin to check.
     * It applies to the browser API calls that BEAR the minted token — when
     * the PlatformClient lists allowed_origins, requests whose Origin header
     * is not on the list are refused PERMISSION_DENIED (see the
     * allowed_origins field docs in spec.proto for the exact semantics).
     * &#64;internal
     * This RPC is public — no Bearer token is required. The caller authenticates
     * by providing client_id + client_secret in the request body. The handler
     * validates these credentials as business logic, not via the auth interceptor.
     * </pre>
     */
    public void mintUserToken(ai.stigmer.iam.platformclient.v1.MintUserTokenRequest request,
        io.grpc.stub.StreamObserver<ai.stigmer.iam.platformclient.v1.MintUserTokenResponse> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getMintUserTokenMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * Mint a guest-scoped JWT for an anonymous visitor of a shared agent's hosted page.
     * Resolves org+slug to an AgentShare, provisions the org's system-managed
     * PlatformClient and guest identity account lazily, and returns a short-lived
     * Stigmer-signed JWT scoped to that org.
     * &#64;internal
     * Public — no Bearer token. No PlatformClient credentials. The handler gates
     * on an enabled public-audience share (NOT_FOUND when disabled or missing)
     * and stamps the resolved share's id into the guest JWT as the share_id
     * claim — the create-time gate re-reads the live share by that id on every
     * session/execution create (decision 011 D6).
     * </pre>
     */
    public void mintGuestToken(ai.stigmer.iam.platformclient.v1.MintGuestTokenRequest request,
        io.grpc.stub.StreamObserver<ai.stigmer.iam.platformclient.v1.MintGuestTokenResponse> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getMintGuestTokenMethod(), getCallOptions()), request, responseObserver);
    }
  }

  /**
   * A stub to allow clients to do synchronous rpc calls to service PlatformClientTokenController.
   * <pre>
   * PlatformClientTokenController provides token-minting operations for
   * platform builders embedding Stigmer into their products.
   * This service is distinct from the CRUD controllers — it does not manage
   * a resource lifecycle. Instead, it issues Stigmer-signed JWTs on behalf
   * of platform builder users, authenticated via PlatformClient credentials
   * (client_id + client_secret).
   * The minted JWT is signed by Stigmer's own key pair (not Auth0). The auth
   * chain validates these tokens via a dedicated PlatformClientTokenAuthenticationProvider
   * that checks the Stigmer-issued signature and resolves the identity account.
   * mintGuestToken is the credential-free exception: no client_id/client_secret.
   * It mints a guest-scoped JWT for anonymous visitors of a shared agent's
   * hosted page, gated on an enabled public-audience AgentShare
   * (ai.stigmer.agentic.agentshare.v1).
   * </pre>
   */
  public static final class PlatformClientTokenControllerBlockingV2Stub
      extends io.grpc.stub.AbstractBlockingStub<PlatformClientTokenControllerBlockingV2Stub> {
    private PlatformClientTokenControllerBlockingV2Stub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected PlatformClientTokenControllerBlockingV2Stub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new PlatformClientTokenControllerBlockingV2Stub(channel, callOptions);
    }

    /**
     * <pre>
     * Mint a user-scoped JWT for browser-based access to Stigmer resources.
     * The platform builder's backend calls this RPC with its PlatformClient
     * credentials (client_id + client_secret) and the end user's identity.
     * Stigmer validates the credentials, optionally JIT-provisions the user's
     * identity account, and returns a Stigmer-signed JWT.
     * The returned JWT can be used by the React SDK (via StigmerProvider's
     * getAccessToken callback) to authenticate API calls from the browser.
     * Authentication flow:
     * 1. Validate client_id + client_secret against stored hash
     * 2. Resolve or JIT-provision the identity account for user_id
     * 3. If auto_grant_on_org is enabled, grant the configured role
     * 4. Sign a JWT with Stigmer's private key containing the user's identity
     * Error scenarios:
     * - UNAUTHENTICATED: Invalid client_id or client_secret
     * - FAILED_PRECONDITION: user_id does not exist and auto_provision_accounts
     *   is false, or the PlatformClient secret has expired
     * - INTERNAL: Account provisioning could not be completed (for example, the
     *   auto_grant_on_org role grant failed). No partial account is left behind
     *   — the account is rolled back — so the request is safe to retry.
     * Origin enforcement (spec.allowed_origins) does NOT apply to this call:
     * minting is server-to-server, so there is no browser Origin to check.
     * It applies to the browser API calls that BEAR the minted token — when
     * the PlatformClient lists allowed_origins, requests whose Origin header
     * is not on the list are refused PERMISSION_DENIED (see the
     * allowed_origins field docs in spec.proto for the exact semantics).
     * &#64;internal
     * This RPC is public — no Bearer token is required. The caller authenticates
     * by providing client_id + client_secret in the request body. The handler
     * validates these credentials as business logic, not via the auth interceptor.
     * </pre>
     */
    public ai.stigmer.iam.platformclient.v1.MintUserTokenResponse mintUserToken(ai.stigmer.iam.platformclient.v1.MintUserTokenRequest request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getMintUserTokenMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Mint a guest-scoped JWT for an anonymous visitor of a shared agent's hosted page.
     * Resolves org+slug to an AgentShare, provisions the org's system-managed
     * PlatformClient and guest identity account lazily, and returns a short-lived
     * Stigmer-signed JWT scoped to that org.
     * &#64;internal
     * Public — no Bearer token. No PlatformClient credentials. The handler gates
     * on an enabled public-audience share (NOT_FOUND when disabled or missing)
     * and stamps the resolved share's id into the guest JWT as the share_id
     * claim — the create-time gate re-reads the live share by that id on every
     * session/execution create (decision 011 D6).
     * </pre>
     */
    public ai.stigmer.iam.platformclient.v1.MintGuestTokenResponse mintGuestToken(ai.stigmer.iam.platformclient.v1.MintGuestTokenRequest request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getMintGuestTokenMethod(), getCallOptions(), request);
    }
  }

  /**
   * A stub to allow clients to do limited synchronous rpc calls to service PlatformClientTokenController.
   * <pre>
   * PlatformClientTokenController provides token-minting operations for
   * platform builders embedding Stigmer into their products.
   * This service is distinct from the CRUD controllers — it does not manage
   * a resource lifecycle. Instead, it issues Stigmer-signed JWTs on behalf
   * of platform builder users, authenticated via PlatformClient credentials
   * (client_id + client_secret).
   * The minted JWT is signed by Stigmer's own key pair (not Auth0). The auth
   * chain validates these tokens via a dedicated PlatformClientTokenAuthenticationProvider
   * that checks the Stigmer-issued signature and resolves the identity account.
   * mintGuestToken is the credential-free exception: no client_id/client_secret.
   * It mints a guest-scoped JWT for anonymous visitors of a shared agent's
   * hosted page, gated on an enabled public-audience AgentShare
   * (ai.stigmer.agentic.agentshare.v1).
   * </pre>
   */
  public static final class PlatformClientTokenControllerBlockingStub
      extends io.grpc.stub.AbstractBlockingStub<PlatformClientTokenControllerBlockingStub> {
    private PlatformClientTokenControllerBlockingStub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected PlatformClientTokenControllerBlockingStub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new PlatformClientTokenControllerBlockingStub(channel, callOptions);
    }

    /**
     * <pre>
     * Mint a user-scoped JWT for browser-based access to Stigmer resources.
     * The platform builder's backend calls this RPC with its PlatformClient
     * credentials (client_id + client_secret) and the end user's identity.
     * Stigmer validates the credentials, optionally JIT-provisions the user's
     * identity account, and returns a Stigmer-signed JWT.
     * The returned JWT can be used by the React SDK (via StigmerProvider's
     * getAccessToken callback) to authenticate API calls from the browser.
     * Authentication flow:
     * 1. Validate client_id + client_secret against stored hash
     * 2. Resolve or JIT-provision the identity account for user_id
     * 3. If auto_grant_on_org is enabled, grant the configured role
     * 4. Sign a JWT with Stigmer's private key containing the user's identity
     * Error scenarios:
     * - UNAUTHENTICATED: Invalid client_id or client_secret
     * - FAILED_PRECONDITION: user_id does not exist and auto_provision_accounts
     *   is false, or the PlatformClient secret has expired
     * - INTERNAL: Account provisioning could not be completed (for example, the
     *   auto_grant_on_org role grant failed). No partial account is left behind
     *   — the account is rolled back — so the request is safe to retry.
     * Origin enforcement (spec.allowed_origins) does NOT apply to this call:
     * minting is server-to-server, so there is no browser Origin to check.
     * It applies to the browser API calls that BEAR the minted token — when
     * the PlatformClient lists allowed_origins, requests whose Origin header
     * is not on the list are refused PERMISSION_DENIED (see the
     * allowed_origins field docs in spec.proto for the exact semantics).
     * &#64;internal
     * This RPC is public — no Bearer token is required. The caller authenticates
     * by providing client_id + client_secret in the request body. The handler
     * validates these credentials as business logic, not via the auth interceptor.
     * </pre>
     */
    public ai.stigmer.iam.platformclient.v1.MintUserTokenResponse mintUserToken(ai.stigmer.iam.platformclient.v1.MintUserTokenRequest request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getMintUserTokenMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Mint a guest-scoped JWT for an anonymous visitor of a shared agent's hosted page.
     * Resolves org+slug to an AgentShare, provisions the org's system-managed
     * PlatformClient and guest identity account lazily, and returns a short-lived
     * Stigmer-signed JWT scoped to that org.
     * &#64;internal
     * Public — no Bearer token. No PlatformClient credentials. The handler gates
     * on an enabled public-audience share (NOT_FOUND when disabled or missing)
     * and stamps the resolved share's id into the guest JWT as the share_id
     * claim — the create-time gate re-reads the live share by that id on every
     * session/execution create (decision 011 D6).
     * </pre>
     */
    public ai.stigmer.iam.platformclient.v1.MintGuestTokenResponse mintGuestToken(ai.stigmer.iam.platformclient.v1.MintGuestTokenRequest request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getMintGuestTokenMethod(), getCallOptions(), request);
    }
  }

  /**
   * A stub to allow clients to do ListenableFuture-style rpc calls to service PlatformClientTokenController.
   * <pre>
   * PlatformClientTokenController provides token-minting operations for
   * platform builders embedding Stigmer into their products.
   * This service is distinct from the CRUD controllers — it does not manage
   * a resource lifecycle. Instead, it issues Stigmer-signed JWTs on behalf
   * of platform builder users, authenticated via PlatformClient credentials
   * (client_id + client_secret).
   * The minted JWT is signed by Stigmer's own key pair (not Auth0). The auth
   * chain validates these tokens via a dedicated PlatformClientTokenAuthenticationProvider
   * that checks the Stigmer-issued signature and resolves the identity account.
   * mintGuestToken is the credential-free exception: no client_id/client_secret.
   * It mints a guest-scoped JWT for anonymous visitors of a shared agent's
   * hosted page, gated on an enabled public-audience AgentShare
   * (ai.stigmer.agentic.agentshare.v1).
   * </pre>
   */
  public static final class PlatformClientTokenControllerFutureStub
      extends io.grpc.stub.AbstractFutureStub<PlatformClientTokenControllerFutureStub> {
    private PlatformClientTokenControllerFutureStub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected PlatformClientTokenControllerFutureStub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new PlatformClientTokenControllerFutureStub(channel, callOptions);
    }

    /**
     * <pre>
     * Mint a user-scoped JWT for browser-based access to Stigmer resources.
     * The platform builder's backend calls this RPC with its PlatformClient
     * credentials (client_id + client_secret) and the end user's identity.
     * Stigmer validates the credentials, optionally JIT-provisions the user's
     * identity account, and returns a Stigmer-signed JWT.
     * The returned JWT can be used by the React SDK (via StigmerProvider's
     * getAccessToken callback) to authenticate API calls from the browser.
     * Authentication flow:
     * 1. Validate client_id + client_secret against stored hash
     * 2. Resolve or JIT-provision the identity account for user_id
     * 3. If auto_grant_on_org is enabled, grant the configured role
     * 4. Sign a JWT with Stigmer's private key containing the user's identity
     * Error scenarios:
     * - UNAUTHENTICATED: Invalid client_id or client_secret
     * - FAILED_PRECONDITION: user_id does not exist and auto_provision_accounts
     *   is false, or the PlatformClient secret has expired
     * - INTERNAL: Account provisioning could not be completed (for example, the
     *   auto_grant_on_org role grant failed). No partial account is left behind
     *   — the account is rolled back — so the request is safe to retry.
     * Origin enforcement (spec.allowed_origins) does NOT apply to this call:
     * minting is server-to-server, so there is no browser Origin to check.
     * It applies to the browser API calls that BEAR the minted token — when
     * the PlatformClient lists allowed_origins, requests whose Origin header
     * is not on the list are refused PERMISSION_DENIED (see the
     * allowed_origins field docs in spec.proto for the exact semantics).
     * &#64;internal
     * This RPC is public — no Bearer token is required. The caller authenticates
     * by providing client_id + client_secret in the request body. The handler
     * validates these credentials as business logic, not via the auth interceptor.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.iam.platformclient.v1.MintUserTokenResponse> mintUserToken(
        ai.stigmer.iam.platformclient.v1.MintUserTokenRequest request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getMintUserTokenMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * Mint a guest-scoped JWT for an anonymous visitor of a shared agent's hosted page.
     * Resolves org+slug to an AgentShare, provisions the org's system-managed
     * PlatformClient and guest identity account lazily, and returns a short-lived
     * Stigmer-signed JWT scoped to that org.
     * &#64;internal
     * Public — no Bearer token. No PlatformClient credentials. The handler gates
     * on an enabled public-audience share (NOT_FOUND when disabled or missing)
     * and stamps the resolved share's id into the guest JWT as the share_id
     * claim — the create-time gate re-reads the live share by that id on every
     * session/execution create (decision 011 D6).
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.iam.platformclient.v1.MintGuestTokenResponse> mintGuestToken(
        ai.stigmer.iam.platformclient.v1.MintGuestTokenRequest request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getMintGuestTokenMethod(), getCallOptions()), request);
    }
  }

  private static final int METHODID_MINT_USER_TOKEN = 0;
  private static final int METHODID_MINT_GUEST_TOKEN = 1;

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
        case METHODID_MINT_USER_TOKEN:
          serviceImpl.mintUserToken((ai.stigmer.iam.platformclient.v1.MintUserTokenRequest) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.iam.platformclient.v1.MintUserTokenResponse>) responseObserver);
          break;
        case METHODID_MINT_GUEST_TOKEN:
          serviceImpl.mintGuestToken((ai.stigmer.iam.platformclient.v1.MintGuestTokenRequest) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.iam.platformclient.v1.MintGuestTokenResponse>) responseObserver);
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
          getMintUserTokenMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.iam.platformclient.v1.MintUserTokenRequest,
              ai.stigmer.iam.platformclient.v1.MintUserTokenResponse>(
                service, METHODID_MINT_USER_TOKEN)))
        .addMethod(
          getMintGuestTokenMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.iam.platformclient.v1.MintGuestTokenRequest,
              ai.stigmer.iam.platformclient.v1.MintGuestTokenResponse>(
                service, METHODID_MINT_GUEST_TOKEN)))
        .build();
  }

  private static abstract class PlatformClientTokenControllerBaseDescriptorSupplier
      implements io.grpc.protobuf.ProtoFileDescriptorSupplier, io.grpc.protobuf.ProtoServiceDescriptorSupplier {
    PlatformClientTokenControllerBaseDescriptorSupplier() {}

    @java.lang.Override
    public com.google.protobuf.Descriptors.FileDescriptor getFileDescriptor() {
      return ai.stigmer.iam.platformclient.v1.TokenProto.getDescriptor();
    }

    @java.lang.Override
    public com.google.protobuf.Descriptors.ServiceDescriptor getServiceDescriptor() {
      return getFileDescriptor().findServiceByName("PlatformClientTokenController");
    }
  }

  private static final class PlatformClientTokenControllerFileDescriptorSupplier
      extends PlatformClientTokenControllerBaseDescriptorSupplier {
    PlatformClientTokenControllerFileDescriptorSupplier() {}
  }

  private static final class PlatformClientTokenControllerMethodDescriptorSupplier
      extends PlatformClientTokenControllerBaseDescriptorSupplier
      implements io.grpc.protobuf.ProtoMethodDescriptorSupplier {
    private final java.lang.String methodName;

    PlatformClientTokenControllerMethodDescriptorSupplier(java.lang.String methodName) {
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
      synchronized (PlatformClientTokenControllerGrpc.class) {
        result = serviceDescriptor;
        if (result == null) {
          serviceDescriptor = result = io.grpc.ServiceDescriptor.newBuilder(SERVICE_NAME)
              .setSchemaDescriptor(new PlatformClientTokenControllerFileDescriptorSupplier())
              .addMethod(getMintUserTokenMethod())
              .addMethod(getMintGuestTokenMethod())
              .build();
        }
      }
    }
    return result;
  }
}
