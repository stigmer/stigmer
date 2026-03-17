package ai.stigmer.platform.github.v1;

import static io.grpc.MethodDescriptor.generateFullMethodName;

/**
 * <pre>
 * GitHubService provides OAuth integration with GitHub.
 * This is a platform utility service — not a domain resource.
 * It enables the web console (and SDK consumers) to connect a user's
 * GitHub account via OAuth, then browse and select repositories
 * for workspace configuration.
 * The service handles the server-side OAuth code exchange (protecting
 * the client_secret) and provides the authorize URL so the frontend
 * does not need to know the client_id or redirect_uri.
 * Tokens are ephemeral — they are returned to the caller and never
 * persisted by the backend.
 * </pre>
 */
@io.grpc.stub.annotations.GrpcGenerated
public final class GitHubServiceGrpc {

  private GitHubServiceGrpc() {}

  public static final java.lang.String SERVICE_NAME = "ai.stigmer.platform.github.v1.GitHubService";

  // Static method descriptors that strictly reflect the proto.
  private static volatile io.grpc.MethodDescriptor<ai.stigmer.platform.github.v1.GetOAuthAuthorizeUrlRequest,
      ai.stigmer.platform.github.v1.GetOAuthAuthorizeUrlResponse> getGetOAuthAuthorizeUrlMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "GetOAuthAuthorizeUrl",
      requestType = ai.stigmer.platform.github.v1.GetOAuthAuthorizeUrlRequest.class,
      responseType = ai.stigmer.platform.github.v1.GetOAuthAuthorizeUrlResponse.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.platform.github.v1.GetOAuthAuthorizeUrlRequest,
      ai.stigmer.platform.github.v1.GetOAuthAuthorizeUrlResponse> getGetOAuthAuthorizeUrlMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.platform.github.v1.GetOAuthAuthorizeUrlRequest, ai.stigmer.platform.github.v1.GetOAuthAuthorizeUrlResponse> getGetOAuthAuthorizeUrlMethod;
    if ((getGetOAuthAuthorizeUrlMethod = GitHubServiceGrpc.getGetOAuthAuthorizeUrlMethod) == null) {
      synchronized (GitHubServiceGrpc.class) {
        if ((getGetOAuthAuthorizeUrlMethod = GitHubServiceGrpc.getGetOAuthAuthorizeUrlMethod) == null) {
          GitHubServiceGrpc.getGetOAuthAuthorizeUrlMethod = getGetOAuthAuthorizeUrlMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.platform.github.v1.GetOAuthAuthorizeUrlRequest, ai.stigmer.platform.github.v1.GetOAuthAuthorizeUrlResponse>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "GetOAuthAuthorizeUrl"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.platform.github.v1.GetOAuthAuthorizeUrlRequest.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.platform.github.v1.GetOAuthAuthorizeUrlResponse.getDefaultInstance()))
              .setSchemaDescriptor(new GitHubServiceMethodDescriptorSupplier("GetOAuthAuthorizeUrl"))
              .build();
        }
      }
    }
    return getGetOAuthAuthorizeUrlMethod;
  }

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.platform.github.v1.ExchangeOAuthCodeRequest,
      ai.stigmer.platform.github.v1.ExchangeOAuthCodeResponse> getExchangeOAuthCodeMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "ExchangeOAuthCode",
      requestType = ai.stigmer.platform.github.v1.ExchangeOAuthCodeRequest.class,
      responseType = ai.stigmer.platform.github.v1.ExchangeOAuthCodeResponse.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.platform.github.v1.ExchangeOAuthCodeRequest,
      ai.stigmer.platform.github.v1.ExchangeOAuthCodeResponse> getExchangeOAuthCodeMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.platform.github.v1.ExchangeOAuthCodeRequest, ai.stigmer.platform.github.v1.ExchangeOAuthCodeResponse> getExchangeOAuthCodeMethod;
    if ((getExchangeOAuthCodeMethod = GitHubServiceGrpc.getExchangeOAuthCodeMethod) == null) {
      synchronized (GitHubServiceGrpc.class) {
        if ((getExchangeOAuthCodeMethod = GitHubServiceGrpc.getExchangeOAuthCodeMethod) == null) {
          GitHubServiceGrpc.getExchangeOAuthCodeMethod = getExchangeOAuthCodeMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.platform.github.v1.ExchangeOAuthCodeRequest, ai.stigmer.platform.github.v1.ExchangeOAuthCodeResponse>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "ExchangeOAuthCode"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.platform.github.v1.ExchangeOAuthCodeRequest.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.platform.github.v1.ExchangeOAuthCodeResponse.getDefaultInstance()))
              .setSchemaDescriptor(new GitHubServiceMethodDescriptorSupplier("ExchangeOAuthCode"))
              .build();
        }
      }
    }
    return getExchangeOAuthCodeMethod;
  }

  /**
   * Creates a new async stub that supports all call types for the service
   */
  public static GitHubServiceStub newStub(io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<GitHubServiceStub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<GitHubServiceStub>() {
        @java.lang.Override
        public GitHubServiceStub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new GitHubServiceStub(channel, callOptions);
        }
      };
    return GitHubServiceStub.newStub(factory, channel);
  }

  /**
   * Creates a new blocking-style stub that supports all types of calls on the service
   */
  public static GitHubServiceBlockingV2Stub newBlockingV2Stub(
      io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<GitHubServiceBlockingV2Stub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<GitHubServiceBlockingV2Stub>() {
        @java.lang.Override
        public GitHubServiceBlockingV2Stub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new GitHubServiceBlockingV2Stub(channel, callOptions);
        }
      };
    return GitHubServiceBlockingV2Stub.newStub(factory, channel);
  }

  /**
   * Creates a new blocking-style stub that supports unary and streaming output calls on the service
   */
  public static GitHubServiceBlockingStub newBlockingStub(
      io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<GitHubServiceBlockingStub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<GitHubServiceBlockingStub>() {
        @java.lang.Override
        public GitHubServiceBlockingStub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new GitHubServiceBlockingStub(channel, callOptions);
        }
      };
    return GitHubServiceBlockingStub.newStub(factory, channel);
  }

  /**
   * Creates a new ListenableFuture-style stub that supports unary calls on the service
   */
  public static GitHubServiceFutureStub newFutureStub(
      io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<GitHubServiceFutureStub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<GitHubServiceFutureStub>() {
        @java.lang.Override
        public GitHubServiceFutureStub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new GitHubServiceFutureStub(channel, callOptions);
        }
      };
    return GitHubServiceFutureStub.newStub(factory, channel);
  }

  /**
   * <pre>
   * GitHubService provides OAuth integration with GitHub.
   * This is a platform utility service — not a domain resource.
   * It enables the web console (and SDK consumers) to connect a user's
   * GitHub account via OAuth, then browse and select repositories
   * for workspace configuration.
   * The service handles the server-side OAuth code exchange (protecting
   * the client_secret) and provides the authorize URL so the frontend
   * does not need to know the client_id or redirect_uri.
   * Tokens are ephemeral — they are returned to the caller and never
   * persisted by the backend.
   * </pre>
   */
  public interface AsyncService {

    /**
     * <pre>
     * Returns the GitHub OAuth authorize URL for initiating the OAuth flow.
     * The backend constructs the URL with the registered client_id, requested
     * scopes, and a random state parameter for CSRF protection. The frontend
     * redirects the user to this URL, and GitHub redirects back to the
     * provided redirect_uri with an authorization code.
     * </pre>
     */
    default void getOAuthAuthorizeUrl(ai.stigmer.platform.github.v1.GetOAuthAuthorizeUrlRequest request,
        io.grpc.stub.StreamObserver<ai.stigmer.platform.github.v1.GetOAuthAuthorizeUrlResponse> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getGetOAuthAuthorizeUrlMethod(), responseObserver);
    }

    /**
     * <pre>
     * Exchanges a GitHub OAuth authorization code for an access token.
     * The frontend calls this after receiving the authorization code from
     * GitHub's OAuth redirect. The backend makes the token exchange request
     * to GitHub using the client_secret (which must never be exposed to
     * the frontend).
     * The returned access_token is NOT stored by the backend. The frontend
     * is responsible for persisting it (e.g., in localStorage) and including
     * it in subsequent requests that need GitHub access.
     * </pre>
     */
    default void exchangeOAuthCode(ai.stigmer.platform.github.v1.ExchangeOAuthCodeRequest request,
        io.grpc.stub.StreamObserver<ai.stigmer.platform.github.v1.ExchangeOAuthCodeResponse> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getExchangeOAuthCodeMethod(), responseObserver);
    }
  }

  /**
   * Base class for the server implementation of the service GitHubService.
   * <pre>
   * GitHubService provides OAuth integration with GitHub.
   * This is a platform utility service — not a domain resource.
   * It enables the web console (and SDK consumers) to connect a user's
   * GitHub account via OAuth, then browse and select repositories
   * for workspace configuration.
   * The service handles the server-side OAuth code exchange (protecting
   * the client_secret) and provides the authorize URL so the frontend
   * does not need to know the client_id or redirect_uri.
   * Tokens are ephemeral — they are returned to the caller and never
   * persisted by the backend.
   * </pre>
   */
  public static abstract class GitHubServiceImplBase
      implements io.grpc.BindableService, AsyncService {

    @java.lang.Override public final io.grpc.ServerServiceDefinition bindService() {
      return GitHubServiceGrpc.bindService(this);
    }
  }

  /**
   * A stub to allow clients to do asynchronous rpc calls to service GitHubService.
   * <pre>
   * GitHubService provides OAuth integration with GitHub.
   * This is a platform utility service — not a domain resource.
   * It enables the web console (and SDK consumers) to connect a user's
   * GitHub account via OAuth, then browse and select repositories
   * for workspace configuration.
   * The service handles the server-side OAuth code exchange (protecting
   * the client_secret) and provides the authorize URL so the frontend
   * does not need to know the client_id or redirect_uri.
   * Tokens are ephemeral — they are returned to the caller and never
   * persisted by the backend.
   * </pre>
   */
  public static final class GitHubServiceStub
      extends io.grpc.stub.AbstractAsyncStub<GitHubServiceStub> {
    private GitHubServiceStub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected GitHubServiceStub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new GitHubServiceStub(channel, callOptions);
    }

    /**
     * <pre>
     * Returns the GitHub OAuth authorize URL for initiating the OAuth flow.
     * The backend constructs the URL with the registered client_id, requested
     * scopes, and a random state parameter for CSRF protection. The frontend
     * redirects the user to this URL, and GitHub redirects back to the
     * provided redirect_uri with an authorization code.
     * </pre>
     */
    public void getOAuthAuthorizeUrl(ai.stigmer.platform.github.v1.GetOAuthAuthorizeUrlRequest request,
        io.grpc.stub.StreamObserver<ai.stigmer.platform.github.v1.GetOAuthAuthorizeUrlResponse> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getGetOAuthAuthorizeUrlMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * Exchanges a GitHub OAuth authorization code for an access token.
     * The frontend calls this after receiving the authorization code from
     * GitHub's OAuth redirect. The backend makes the token exchange request
     * to GitHub using the client_secret (which must never be exposed to
     * the frontend).
     * The returned access_token is NOT stored by the backend. The frontend
     * is responsible for persisting it (e.g., in localStorage) and including
     * it in subsequent requests that need GitHub access.
     * </pre>
     */
    public void exchangeOAuthCode(ai.stigmer.platform.github.v1.ExchangeOAuthCodeRequest request,
        io.grpc.stub.StreamObserver<ai.stigmer.platform.github.v1.ExchangeOAuthCodeResponse> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getExchangeOAuthCodeMethod(), getCallOptions()), request, responseObserver);
    }
  }

  /**
   * A stub to allow clients to do synchronous rpc calls to service GitHubService.
   * <pre>
   * GitHubService provides OAuth integration with GitHub.
   * This is a platform utility service — not a domain resource.
   * It enables the web console (and SDK consumers) to connect a user's
   * GitHub account via OAuth, then browse and select repositories
   * for workspace configuration.
   * The service handles the server-side OAuth code exchange (protecting
   * the client_secret) and provides the authorize URL so the frontend
   * does not need to know the client_id or redirect_uri.
   * Tokens are ephemeral — they are returned to the caller and never
   * persisted by the backend.
   * </pre>
   */
  public static final class GitHubServiceBlockingV2Stub
      extends io.grpc.stub.AbstractBlockingStub<GitHubServiceBlockingV2Stub> {
    private GitHubServiceBlockingV2Stub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected GitHubServiceBlockingV2Stub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new GitHubServiceBlockingV2Stub(channel, callOptions);
    }

    /**
     * <pre>
     * Returns the GitHub OAuth authorize URL for initiating the OAuth flow.
     * The backend constructs the URL with the registered client_id, requested
     * scopes, and a random state parameter for CSRF protection. The frontend
     * redirects the user to this URL, and GitHub redirects back to the
     * provided redirect_uri with an authorization code.
     * </pre>
     */
    public ai.stigmer.platform.github.v1.GetOAuthAuthorizeUrlResponse getOAuthAuthorizeUrl(ai.stigmer.platform.github.v1.GetOAuthAuthorizeUrlRequest request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getGetOAuthAuthorizeUrlMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Exchanges a GitHub OAuth authorization code for an access token.
     * The frontend calls this after receiving the authorization code from
     * GitHub's OAuth redirect. The backend makes the token exchange request
     * to GitHub using the client_secret (which must never be exposed to
     * the frontend).
     * The returned access_token is NOT stored by the backend. The frontend
     * is responsible for persisting it (e.g., in localStorage) and including
     * it in subsequent requests that need GitHub access.
     * </pre>
     */
    public ai.stigmer.platform.github.v1.ExchangeOAuthCodeResponse exchangeOAuthCode(ai.stigmer.platform.github.v1.ExchangeOAuthCodeRequest request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getExchangeOAuthCodeMethod(), getCallOptions(), request);
    }
  }

  /**
   * A stub to allow clients to do limited synchronous rpc calls to service GitHubService.
   * <pre>
   * GitHubService provides OAuth integration with GitHub.
   * This is a platform utility service — not a domain resource.
   * It enables the web console (and SDK consumers) to connect a user's
   * GitHub account via OAuth, then browse and select repositories
   * for workspace configuration.
   * The service handles the server-side OAuth code exchange (protecting
   * the client_secret) and provides the authorize URL so the frontend
   * does not need to know the client_id or redirect_uri.
   * Tokens are ephemeral — they are returned to the caller and never
   * persisted by the backend.
   * </pre>
   */
  public static final class GitHubServiceBlockingStub
      extends io.grpc.stub.AbstractBlockingStub<GitHubServiceBlockingStub> {
    private GitHubServiceBlockingStub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected GitHubServiceBlockingStub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new GitHubServiceBlockingStub(channel, callOptions);
    }

    /**
     * <pre>
     * Returns the GitHub OAuth authorize URL for initiating the OAuth flow.
     * The backend constructs the URL with the registered client_id, requested
     * scopes, and a random state parameter for CSRF protection. The frontend
     * redirects the user to this URL, and GitHub redirects back to the
     * provided redirect_uri with an authorization code.
     * </pre>
     */
    public ai.stigmer.platform.github.v1.GetOAuthAuthorizeUrlResponse getOAuthAuthorizeUrl(ai.stigmer.platform.github.v1.GetOAuthAuthorizeUrlRequest request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getGetOAuthAuthorizeUrlMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Exchanges a GitHub OAuth authorization code for an access token.
     * The frontend calls this after receiving the authorization code from
     * GitHub's OAuth redirect. The backend makes the token exchange request
     * to GitHub using the client_secret (which must never be exposed to
     * the frontend).
     * The returned access_token is NOT stored by the backend. The frontend
     * is responsible for persisting it (e.g., in localStorage) and including
     * it in subsequent requests that need GitHub access.
     * </pre>
     */
    public ai.stigmer.platform.github.v1.ExchangeOAuthCodeResponse exchangeOAuthCode(ai.stigmer.platform.github.v1.ExchangeOAuthCodeRequest request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getExchangeOAuthCodeMethod(), getCallOptions(), request);
    }
  }

  /**
   * A stub to allow clients to do ListenableFuture-style rpc calls to service GitHubService.
   * <pre>
   * GitHubService provides OAuth integration with GitHub.
   * This is a platform utility service — not a domain resource.
   * It enables the web console (and SDK consumers) to connect a user's
   * GitHub account via OAuth, then browse and select repositories
   * for workspace configuration.
   * The service handles the server-side OAuth code exchange (protecting
   * the client_secret) and provides the authorize URL so the frontend
   * does not need to know the client_id or redirect_uri.
   * Tokens are ephemeral — they are returned to the caller and never
   * persisted by the backend.
   * </pre>
   */
  public static final class GitHubServiceFutureStub
      extends io.grpc.stub.AbstractFutureStub<GitHubServiceFutureStub> {
    private GitHubServiceFutureStub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected GitHubServiceFutureStub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new GitHubServiceFutureStub(channel, callOptions);
    }

    /**
     * <pre>
     * Returns the GitHub OAuth authorize URL for initiating the OAuth flow.
     * The backend constructs the URL with the registered client_id, requested
     * scopes, and a random state parameter for CSRF protection. The frontend
     * redirects the user to this URL, and GitHub redirects back to the
     * provided redirect_uri with an authorization code.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.platform.github.v1.GetOAuthAuthorizeUrlResponse> getOAuthAuthorizeUrl(
        ai.stigmer.platform.github.v1.GetOAuthAuthorizeUrlRequest request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getGetOAuthAuthorizeUrlMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * Exchanges a GitHub OAuth authorization code for an access token.
     * The frontend calls this after receiving the authorization code from
     * GitHub's OAuth redirect. The backend makes the token exchange request
     * to GitHub using the client_secret (which must never be exposed to
     * the frontend).
     * The returned access_token is NOT stored by the backend. The frontend
     * is responsible for persisting it (e.g., in localStorage) and including
     * it in subsequent requests that need GitHub access.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.platform.github.v1.ExchangeOAuthCodeResponse> exchangeOAuthCode(
        ai.stigmer.platform.github.v1.ExchangeOAuthCodeRequest request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getExchangeOAuthCodeMethod(), getCallOptions()), request);
    }
  }

  private static final int METHODID_GET_OAUTH_AUTHORIZE_URL = 0;
  private static final int METHODID_EXCHANGE_OAUTH_CODE = 1;

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
        case METHODID_GET_OAUTH_AUTHORIZE_URL:
          serviceImpl.getOAuthAuthorizeUrl((ai.stigmer.platform.github.v1.GetOAuthAuthorizeUrlRequest) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.platform.github.v1.GetOAuthAuthorizeUrlResponse>) responseObserver);
          break;
        case METHODID_EXCHANGE_OAUTH_CODE:
          serviceImpl.exchangeOAuthCode((ai.stigmer.platform.github.v1.ExchangeOAuthCodeRequest) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.platform.github.v1.ExchangeOAuthCodeResponse>) responseObserver);
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
          getGetOAuthAuthorizeUrlMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.platform.github.v1.GetOAuthAuthorizeUrlRequest,
              ai.stigmer.platform.github.v1.GetOAuthAuthorizeUrlResponse>(
                service, METHODID_GET_OAUTH_AUTHORIZE_URL)))
        .addMethod(
          getExchangeOAuthCodeMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.platform.github.v1.ExchangeOAuthCodeRequest,
              ai.stigmer.platform.github.v1.ExchangeOAuthCodeResponse>(
                service, METHODID_EXCHANGE_OAUTH_CODE)))
        .build();
  }

  private static abstract class GitHubServiceBaseDescriptorSupplier
      implements io.grpc.protobuf.ProtoFileDescriptorSupplier, io.grpc.protobuf.ProtoServiceDescriptorSupplier {
    GitHubServiceBaseDescriptorSupplier() {}

    @java.lang.Override
    public com.google.protobuf.Descriptors.FileDescriptor getFileDescriptor() {
      return ai.stigmer.platform.github.v1.ServiceProto.getDescriptor();
    }

    @java.lang.Override
    public com.google.protobuf.Descriptors.ServiceDescriptor getServiceDescriptor() {
      return getFileDescriptor().findServiceByName("GitHubService");
    }
  }

  private static final class GitHubServiceFileDescriptorSupplier
      extends GitHubServiceBaseDescriptorSupplier {
    GitHubServiceFileDescriptorSupplier() {}
  }

  private static final class GitHubServiceMethodDescriptorSupplier
      extends GitHubServiceBaseDescriptorSupplier
      implements io.grpc.protobuf.ProtoMethodDescriptorSupplier {
    private final java.lang.String methodName;

    GitHubServiceMethodDescriptorSupplier(java.lang.String methodName) {
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
      synchronized (GitHubServiceGrpc.class) {
        result = serviceDescriptor;
        if (result == null) {
          serviceDescriptor = result = io.grpc.ServiceDescriptor.newBuilder(SERVICE_NAME)
              .setSchemaDescriptor(new GitHubServiceFileDescriptorSupplier())
              .addMethod(getGetOAuthAuthorizeUrlMethod())
              .addMethod(getExchangeOAuthCodeMethod())
              .build();
        }
      }
    }
    return result;
  }
}
