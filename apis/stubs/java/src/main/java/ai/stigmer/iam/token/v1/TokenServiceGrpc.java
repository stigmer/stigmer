package ai.stigmer.iam.token.v1;

import static io.grpc.MethodDescriptor.generateFullMethodName;

/**
 * <pre>
 * TokenService mints the short-lived tokens a browser uses to talk to
 * Stigmer on someone's behalf: a person signed in to an organization's own
 * product, or an anonymous visitor of a shared agent's chat link.
 * It manages no resource. Each token is signed by the server's own
 * platform-token key and verified on every request; minting requires a
 * server that authenticates its callers, and a server that trusts every
 * request refuses it FAILED_PRECONDITION, because nothing would ever verify
 * the token.
 * </pre>
 */
@io.grpc.stub.annotations.GrpcGenerated
public final class TokenServiceGrpc {

  private TokenServiceGrpc() {}

  public static final java.lang.String SERVICE_NAME = "ai.stigmer.iam.token.v1.TokenService";

  // Static method descriptors that strictly reflect the proto.
  private static volatile io.grpc.MethodDescriptor<ai.stigmer.iam.token.v1.MintUserTokenRequest,
      ai.stigmer.iam.token.v1.MintUserTokenResponse> getMintUserTokenMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "mintUserToken",
      requestType = ai.stigmer.iam.token.v1.MintUserTokenRequest.class,
      responseType = ai.stigmer.iam.token.v1.MintUserTokenResponse.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.iam.token.v1.MintUserTokenRequest,
      ai.stigmer.iam.token.v1.MintUserTokenResponse> getMintUserTokenMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.iam.token.v1.MintUserTokenRequest, ai.stigmer.iam.token.v1.MintUserTokenResponse> getMintUserTokenMethod;
    if ((getMintUserTokenMethod = TokenServiceGrpc.getMintUserTokenMethod) == null) {
      synchronized (TokenServiceGrpc.class) {
        if ((getMintUserTokenMethod = TokenServiceGrpc.getMintUserTokenMethod) == null) {
          TokenServiceGrpc.getMintUserTokenMethod = getMintUserTokenMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.iam.token.v1.MintUserTokenRequest, ai.stigmer.iam.token.v1.MintUserTokenResponse>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "mintUserToken"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.iam.token.v1.MintUserTokenRequest.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.iam.token.v1.MintUserTokenResponse.getDefaultInstance()))
              .setSchemaDescriptor(new TokenServiceMethodDescriptorSupplier("mintUserToken"))
              .build();
        }
      }
    }
    return getMintUserTokenMethod;
  }

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.iam.token.v1.MintGuestTokenRequest,
      ai.stigmer.iam.token.v1.MintGuestTokenResponse> getMintGuestTokenMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "mintGuestToken",
      requestType = ai.stigmer.iam.token.v1.MintGuestTokenRequest.class,
      responseType = ai.stigmer.iam.token.v1.MintGuestTokenResponse.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.iam.token.v1.MintGuestTokenRequest,
      ai.stigmer.iam.token.v1.MintGuestTokenResponse> getMintGuestTokenMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.iam.token.v1.MintGuestTokenRequest, ai.stigmer.iam.token.v1.MintGuestTokenResponse> getMintGuestTokenMethod;
    if ((getMintGuestTokenMethod = TokenServiceGrpc.getMintGuestTokenMethod) == null) {
      synchronized (TokenServiceGrpc.class) {
        if ((getMintGuestTokenMethod = TokenServiceGrpc.getMintGuestTokenMethod) == null) {
          TokenServiceGrpc.getMintGuestTokenMethod = getMintGuestTokenMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.iam.token.v1.MintGuestTokenRequest, ai.stigmer.iam.token.v1.MintGuestTokenResponse>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "mintGuestToken"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.iam.token.v1.MintGuestTokenRequest.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.iam.token.v1.MintGuestTokenResponse.getDefaultInstance()))
              .setSchemaDescriptor(new TokenServiceMethodDescriptorSupplier("mintGuestToken"))
              .build();
        }
      }
    }
    return getMintGuestTokenMethod;
  }

  /**
   * Creates a new async stub that supports all call types for the service
   */
  public static TokenServiceStub newStub(io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<TokenServiceStub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<TokenServiceStub>() {
        @java.lang.Override
        public TokenServiceStub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new TokenServiceStub(channel, callOptions);
        }
      };
    return TokenServiceStub.newStub(factory, channel);
  }

  /**
   * Creates a new blocking-style stub that supports all types of calls on the service
   */
  public static TokenServiceBlockingV2Stub newBlockingV2Stub(
      io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<TokenServiceBlockingV2Stub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<TokenServiceBlockingV2Stub>() {
        @java.lang.Override
        public TokenServiceBlockingV2Stub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new TokenServiceBlockingV2Stub(channel, callOptions);
        }
      };
    return TokenServiceBlockingV2Stub.newStub(factory, channel);
  }

  /**
   * Creates a new blocking-style stub that supports unary and streaming output calls on the service
   */
  public static TokenServiceBlockingStub newBlockingStub(
      io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<TokenServiceBlockingStub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<TokenServiceBlockingStub>() {
        @java.lang.Override
        public TokenServiceBlockingStub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new TokenServiceBlockingStub(channel, callOptions);
        }
      };
    return TokenServiceBlockingStub.newStub(factory, channel);
  }

  /**
   * Creates a new ListenableFuture-style stub that supports unary calls on the service
   */
  public static TokenServiceFutureStub newFutureStub(
      io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<TokenServiceFutureStub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<TokenServiceFutureStub>() {
        @java.lang.Override
        public TokenServiceFutureStub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new TokenServiceFutureStub(channel, callOptions);
        }
      };
    return TokenServiceFutureStub.newStub(factory, channel);
  }

  /**
   * <pre>
   * TokenService mints the short-lived tokens a browser uses to talk to
   * Stigmer on someone's behalf: a person signed in to an organization's own
   * product, or an anonymous visitor of a shared agent's chat link.
   * It manages no resource. Each token is signed by the server's own
   * platform-token key and verified on every request; minting requires a
   * server that authenticates its callers, and a server that trusts every
   * request refuses it FAILED_PRECONDITION, because nothing would ever verify
   * the token.
   * </pre>
   */
  public interface AsyncService {

    /**
     * <pre>
     * Mint a user token for a person signed in to an organization's own product.
     * The product's backend calls it with a service account's API key and the
     * person's identity, as it would call any server API with its key. Stigmer
     * resolves the person's identity account in the organization the token is
     * for, creates it on first sign-in when the organization's embedding
     * settings allow (granting their sign_in_role), and returns a token that
     * works in that organization only.
     * Only a service account's key may mint, and only one whose account is an
     * administrator of the organization the token is for, or of its parent
     * organization: minting can create accounts and grant a role. A person's
     * key or token is refused PERMISSION_DENIED.
     * The token lives until it expires or until the service account that
     * minted it is deleted, whichever comes first. Rotating the account's key
     * leaves minted tokens working.
     * Error scenarios:
     * - PERMISSION_DENIED: the caller is not a service account, or its account
     *   may not mint for the organization.
     * - FAILED_PRECONDITION: the person has no account and the organization's
     *   embedding settings do not create one, or the server does not
     *   authenticate its callers.
     * - INTERNAL: account provisioning could not be completed. No partial
     *   account is left behind, so the request is safe to retry: a retry
     *   completes the provisioning.
     * Origin enforcement (OrganizationEmbedding.allowed_origins) does not apply
     * to this call: minting is server-to-server, so there is no browser Origin
     * to check. It applies to the browser requests that bear the minted token.
     * </pre>
     */
    default void mintUserToken(ai.stigmer.iam.token.v1.MintUserTokenRequest request,
        io.grpc.stub.StreamObserver<ai.stigmer.iam.token.v1.MintUserTokenResponse> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getMintUserTokenMethod(), responseObserver);
    }

    /**
     * <pre>
     * Mint a guest token for an anonymous visitor of a shared agent's chat link.
     * Resolves the share id from the hosted chat link to an AgentShare and
     * returns a short-lived token scoped to that share's organization. Editions
     * that do not host shared-agent pages answer it UNIMPLEMENTED.
     * </pre>
     */
    default void mintGuestToken(ai.stigmer.iam.token.v1.MintGuestTokenRequest request,
        io.grpc.stub.StreamObserver<ai.stigmer.iam.token.v1.MintGuestTokenResponse> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getMintGuestTokenMethod(), responseObserver);
    }
  }

  /**
   * Base class for the server implementation of the service TokenService.
   * <pre>
   * TokenService mints the short-lived tokens a browser uses to talk to
   * Stigmer on someone's behalf: a person signed in to an organization's own
   * product, or an anonymous visitor of a shared agent's chat link.
   * It manages no resource. Each token is signed by the server's own
   * platform-token key and verified on every request; minting requires a
   * server that authenticates its callers, and a server that trusts every
   * request refuses it FAILED_PRECONDITION, because nothing would ever verify
   * the token.
   * </pre>
   */
  public static abstract class TokenServiceImplBase
      implements io.grpc.BindableService, AsyncService {

    @java.lang.Override public final io.grpc.ServerServiceDefinition bindService() {
      return TokenServiceGrpc.bindService(this);
    }
  }

  /**
   * A stub to allow clients to do asynchronous rpc calls to service TokenService.
   * <pre>
   * TokenService mints the short-lived tokens a browser uses to talk to
   * Stigmer on someone's behalf: a person signed in to an organization's own
   * product, or an anonymous visitor of a shared agent's chat link.
   * It manages no resource. Each token is signed by the server's own
   * platform-token key and verified on every request; minting requires a
   * server that authenticates its callers, and a server that trusts every
   * request refuses it FAILED_PRECONDITION, because nothing would ever verify
   * the token.
   * </pre>
   */
  public static final class TokenServiceStub
      extends io.grpc.stub.AbstractAsyncStub<TokenServiceStub> {
    private TokenServiceStub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected TokenServiceStub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new TokenServiceStub(channel, callOptions);
    }

    /**
     * <pre>
     * Mint a user token for a person signed in to an organization's own product.
     * The product's backend calls it with a service account's API key and the
     * person's identity, as it would call any server API with its key. Stigmer
     * resolves the person's identity account in the organization the token is
     * for, creates it on first sign-in when the organization's embedding
     * settings allow (granting their sign_in_role), and returns a token that
     * works in that organization only.
     * Only a service account's key may mint, and only one whose account is an
     * administrator of the organization the token is for, or of its parent
     * organization: minting can create accounts and grant a role. A person's
     * key or token is refused PERMISSION_DENIED.
     * The token lives until it expires or until the service account that
     * minted it is deleted, whichever comes first. Rotating the account's key
     * leaves minted tokens working.
     * Error scenarios:
     * - PERMISSION_DENIED: the caller is not a service account, or its account
     *   may not mint for the organization.
     * - FAILED_PRECONDITION: the person has no account and the organization's
     *   embedding settings do not create one, or the server does not
     *   authenticate its callers.
     * - INTERNAL: account provisioning could not be completed. No partial
     *   account is left behind, so the request is safe to retry: a retry
     *   completes the provisioning.
     * Origin enforcement (OrganizationEmbedding.allowed_origins) does not apply
     * to this call: minting is server-to-server, so there is no browser Origin
     * to check. It applies to the browser requests that bear the minted token.
     * </pre>
     */
    public void mintUserToken(ai.stigmer.iam.token.v1.MintUserTokenRequest request,
        io.grpc.stub.StreamObserver<ai.stigmer.iam.token.v1.MintUserTokenResponse> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getMintUserTokenMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * Mint a guest token for an anonymous visitor of a shared agent's chat link.
     * Resolves the share id from the hosted chat link to an AgentShare and
     * returns a short-lived token scoped to that share's organization. Editions
     * that do not host shared-agent pages answer it UNIMPLEMENTED.
     * </pre>
     */
    public void mintGuestToken(ai.stigmer.iam.token.v1.MintGuestTokenRequest request,
        io.grpc.stub.StreamObserver<ai.stigmer.iam.token.v1.MintGuestTokenResponse> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getMintGuestTokenMethod(), getCallOptions()), request, responseObserver);
    }
  }

  /**
   * A stub to allow clients to do synchronous rpc calls to service TokenService.
   * <pre>
   * TokenService mints the short-lived tokens a browser uses to talk to
   * Stigmer on someone's behalf: a person signed in to an organization's own
   * product, or an anonymous visitor of a shared agent's chat link.
   * It manages no resource. Each token is signed by the server's own
   * platform-token key and verified on every request; minting requires a
   * server that authenticates its callers, and a server that trusts every
   * request refuses it FAILED_PRECONDITION, because nothing would ever verify
   * the token.
   * </pre>
   */
  public static final class TokenServiceBlockingV2Stub
      extends io.grpc.stub.AbstractBlockingStub<TokenServiceBlockingV2Stub> {
    private TokenServiceBlockingV2Stub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected TokenServiceBlockingV2Stub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new TokenServiceBlockingV2Stub(channel, callOptions);
    }

    /**
     * <pre>
     * Mint a user token for a person signed in to an organization's own product.
     * The product's backend calls it with a service account's API key and the
     * person's identity, as it would call any server API with its key. Stigmer
     * resolves the person's identity account in the organization the token is
     * for, creates it on first sign-in when the organization's embedding
     * settings allow (granting their sign_in_role), and returns a token that
     * works in that organization only.
     * Only a service account's key may mint, and only one whose account is an
     * administrator of the organization the token is for, or of its parent
     * organization: minting can create accounts and grant a role. A person's
     * key or token is refused PERMISSION_DENIED.
     * The token lives until it expires or until the service account that
     * minted it is deleted, whichever comes first. Rotating the account's key
     * leaves minted tokens working.
     * Error scenarios:
     * - PERMISSION_DENIED: the caller is not a service account, or its account
     *   may not mint for the organization.
     * - FAILED_PRECONDITION: the person has no account and the organization's
     *   embedding settings do not create one, or the server does not
     *   authenticate its callers.
     * - INTERNAL: account provisioning could not be completed. No partial
     *   account is left behind, so the request is safe to retry: a retry
     *   completes the provisioning.
     * Origin enforcement (OrganizationEmbedding.allowed_origins) does not apply
     * to this call: minting is server-to-server, so there is no browser Origin
     * to check. It applies to the browser requests that bear the minted token.
     * </pre>
     */
    public ai.stigmer.iam.token.v1.MintUserTokenResponse mintUserToken(ai.stigmer.iam.token.v1.MintUserTokenRequest request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getMintUserTokenMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Mint a guest token for an anonymous visitor of a shared agent's chat link.
     * Resolves the share id from the hosted chat link to an AgentShare and
     * returns a short-lived token scoped to that share's organization. Editions
     * that do not host shared-agent pages answer it UNIMPLEMENTED.
     * </pre>
     */
    public ai.stigmer.iam.token.v1.MintGuestTokenResponse mintGuestToken(ai.stigmer.iam.token.v1.MintGuestTokenRequest request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getMintGuestTokenMethod(), getCallOptions(), request);
    }
  }

  /**
   * A stub to allow clients to do limited synchronous rpc calls to service TokenService.
   * <pre>
   * TokenService mints the short-lived tokens a browser uses to talk to
   * Stigmer on someone's behalf: a person signed in to an organization's own
   * product, or an anonymous visitor of a shared agent's chat link.
   * It manages no resource. Each token is signed by the server's own
   * platform-token key and verified on every request; minting requires a
   * server that authenticates its callers, and a server that trusts every
   * request refuses it FAILED_PRECONDITION, because nothing would ever verify
   * the token.
   * </pre>
   */
  public static final class TokenServiceBlockingStub
      extends io.grpc.stub.AbstractBlockingStub<TokenServiceBlockingStub> {
    private TokenServiceBlockingStub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected TokenServiceBlockingStub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new TokenServiceBlockingStub(channel, callOptions);
    }

    /**
     * <pre>
     * Mint a user token for a person signed in to an organization's own product.
     * The product's backend calls it with a service account's API key and the
     * person's identity, as it would call any server API with its key. Stigmer
     * resolves the person's identity account in the organization the token is
     * for, creates it on first sign-in when the organization's embedding
     * settings allow (granting their sign_in_role), and returns a token that
     * works in that organization only.
     * Only a service account's key may mint, and only one whose account is an
     * administrator of the organization the token is for, or of its parent
     * organization: minting can create accounts and grant a role. A person's
     * key or token is refused PERMISSION_DENIED.
     * The token lives until it expires or until the service account that
     * minted it is deleted, whichever comes first. Rotating the account's key
     * leaves minted tokens working.
     * Error scenarios:
     * - PERMISSION_DENIED: the caller is not a service account, or its account
     *   may not mint for the organization.
     * - FAILED_PRECONDITION: the person has no account and the organization's
     *   embedding settings do not create one, or the server does not
     *   authenticate its callers.
     * - INTERNAL: account provisioning could not be completed. No partial
     *   account is left behind, so the request is safe to retry: a retry
     *   completes the provisioning.
     * Origin enforcement (OrganizationEmbedding.allowed_origins) does not apply
     * to this call: minting is server-to-server, so there is no browser Origin
     * to check. It applies to the browser requests that bear the minted token.
     * </pre>
     */
    public ai.stigmer.iam.token.v1.MintUserTokenResponse mintUserToken(ai.stigmer.iam.token.v1.MintUserTokenRequest request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getMintUserTokenMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Mint a guest token for an anonymous visitor of a shared agent's chat link.
     * Resolves the share id from the hosted chat link to an AgentShare and
     * returns a short-lived token scoped to that share's organization. Editions
     * that do not host shared-agent pages answer it UNIMPLEMENTED.
     * </pre>
     */
    public ai.stigmer.iam.token.v1.MintGuestTokenResponse mintGuestToken(ai.stigmer.iam.token.v1.MintGuestTokenRequest request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getMintGuestTokenMethod(), getCallOptions(), request);
    }
  }

  /**
   * A stub to allow clients to do ListenableFuture-style rpc calls to service TokenService.
   * <pre>
   * TokenService mints the short-lived tokens a browser uses to talk to
   * Stigmer on someone's behalf: a person signed in to an organization's own
   * product, or an anonymous visitor of a shared agent's chat link.
   * It manages no resource. Each token is signed by the server's own
   * platform-token key and verified on every request; minting requires a
   * server that authenticates its callers, and a server that trusts every
   * request refuses it FAILED_PRECONDITION, because nothing would ever verify
   * the token.
   * </pre>
   */
  public static final class TokenServiceFutureStub
      extends io.grpc.stub.AbstractFutureStub<TokenServiceFutureStub> {
    private TokenServiceFutureStub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected TokenServiceFutureStub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new TokenServiceFutureStub(channel, callOptions);
    }

    /**
     * <pre>
     * Mint a user token for a person signed in to an organization's own product.
     * The product's backend calls it with a service account's API key and the
     * person's identity, as it would call any server API with its key. Stigmer
     * resolves the person's identity account in the organization the token is
     * for, creates it on first sign-in when the organization's embedding
     * settings allow (granting their sign_in_role), and returns a token that
     * works in that organization only.
     * Only a service account's key may mint, and only one whose account is an
     * administrator of the organization the token is for, or of its parent
     * organization: minting can create accounts and grant a role. A person's
     * key or token is refused PERMISSION_DENIED.
     * The token lives until it expires or until the service account that
     * minted it is deleted, whichever comes first. Rotating the account's key
     * leaves minted tokens working.
     * Error scenarios:
     * - PERMISSION_DENIED: the caller is not a service account, or its account
     *   may not mint for the organization.
     * - FAILED_PRECONDITION: the person has no account and the organization's
     *   embedding settings do not create one, or the server does not
     *   authenticate its callers.
     * - INTERNAL: account provisioning could not be completed. No partial
     *   account is left behind, so the request is safe to retry: a retry
     *   completes the provisioning.
     * Origin enforcement (OrganizationEmbedding.allowed_origins) does not apply
     * to this call: minting is server-to-server, so there is no browser Origin
     * to check. It applies to the browser requests that bear the minted token.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.iam.token.v1.MintUserTokenResponse> mintUserToken(
        ai.stigmer.iam.token.v1.MintUserTokenRequest request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getMintUserTokenMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * Mint a guest token for an anonymous visitor of a shared agent's chat link.
     * Resolves the share id from the hosted chat link to an AgentShare and
     * returns a short-lived token scoped to that share's organization. Editions
     * that do not host shared-agent pages answer it UNIMPLEMENTED.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.iam.token.v1.MintGuestTokenResponse> mintGuestToken(
        ai.stigmer.iam.token.v1.MintGuestTokenRequest request) {
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
          serviceImpl.mintUserToken((ai.stigmer.iam.token.v1.MintUserTokenRequest) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.iam.token.v1.MintUserTokenResponse>) responseObserver);
          break;
        case METHODID_MINT_GUEST_TOKEN:
          serviceImpl.mintGuestToken((ai.stigmer.iam.token.v1.MintGuestTokenRequest) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.iam.token.v1.MintGuestTokenResponse>) responseObserver);
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
              ai.stigmer.iam.token.v1.MintUserTokenRequest,
              ai.stigmer.iam.token.v1.MintUserTokenResponse>(
                service, METHODID_MINT_USER_TOKEN)))
        .addMethod(
          getMintGuestTokenMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.iam.token.v1.MintGuestTokenRequest,
              ai.stigmer.iam.token.v1.MintGuestTokenResponse>(
                service, METHODID_MINT_GUEST_TOKEN)))
        .build();
  }

  private static abstract class TokenServiceBaseDescriptorSupplier
      implements io.grpc.protobuf.ProtoFileDescriptorSupplier, io.grpc.protobuf.ProtoServiceDescriptorSupplier {
    TokenServiceBaseDescriptorSupplier() {}

    @java.lang.Override
    public com.google.protobuf.Descriptors.FileDescriptor getFileDescriptor() {
      return ai.stigmer.iam.token.v1.TokenProto.getDescriptor();
    }

    @java.lang.Override
    public com.google.protobuf.Descriptors.ServiceDescriptor getServiceDescriptor() {
      return getFileDescriptor().findServiceByName("TokenService");
    }
  }

  private static final class TokenServiceFileDescriptorSupplier
      extends TokenServiceBaseDescriptorSupplier {
    TokenServiceFileDescriptorSupplier() {}
  }

  private static final class TokenServiceMethodDescriptorSupplier
      extends TokenServiceBaseDescriptorSupplier
      implements io.grpc.protobuf.ProtoMethodDescriptorSupplier {
    private final java.lang.String methodName;

    TokenServiceMethodDescriptorSupplier(java.lang.String methodName) {
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
      synchronized (TokenServiceGrpc.class) {
        result = serviceDescriptor;
        if (result == null) {
          serviceDescriptor = result = io.grpc.ServiceDescriptor.newBuilder(SERVICE_NAME)
              .setSchemaDescriptor(new TokenServiceFileDescriptorSupplier())
              .addMethod(getMintUserTokenMethod())
              .addMethod(getMintGuestTokenMethod())
              .build();
        }
      }
    }
    return result;
  }
}
