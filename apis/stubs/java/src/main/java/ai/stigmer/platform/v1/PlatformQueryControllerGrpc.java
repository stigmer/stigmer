package ai.stigmer.platform.v1;

import static io.grpc.MethodDescriptor.generateFullMethodName;

/**
 * <pre>
 * Query service for server identity, capabilities, and runner bootstrap.
 * Clients call getServerInfo on startup to learn the server edition
 * and version, replacing URL-based guessing. The RPC is public
 * (no authentication required) so it can be called before login.
 * Embedded runners call getRunnerBootstrapConfig during boot to discover
 * the Temporal coordinates they need to join the execution backbone, so
 * integrators never hardcode infrastructure addresses.
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

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.platform.v1.GetRunnerBootstrapConfigInput,
      ai.stigmer.platform.v1.GetRunnerBootstrapConfigOutput> getGetRunnerBootstrapConfigMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "getRunnerBootstrapConfig",
      requestType = ai.stigmer.platform.v1.GetRunnerBootstrapConfigInput.class,
      responseType = ai.stigmer.platform.v1.GetRunnerBootstrapConfigOutput.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.platform.v1.GetRunnerBootstrapConfigInput,
      ai.stigmer.platform.v1.GetRunnerBootstrapConfigOutput> getGetRunnerBootstrapConfigMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.platform.v1.GetRunnerBootstrapConfigInput, ai.stigmer.platform.v1.GetRunnerBootstrapConfigOutput> getGetRunnerBootstrapConfigMethod;
    if ((getGetRunnerBootstrapConfigMethod = PlatformQueryControllerGrpc.getGetRunnerBootstrapConfigMethod) == null) {
      synchronized (PlatformQueryControllerGrpc.class) {
        if ((getGetRunnerBootstrapConfigMethod = PlatformQueryControllerGrpc.getGetRunnerBootstrapConfigMethod) == null) {
          PlatformQueryControllerGrpc.getGetRunnerBootstrapConfigMethod = getGetRunnerBootstrapConfigMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.platform.v1.GetRunnerBootstrapConfigInput, ai.stigmer.platform.v1.GetRunnerBootstrapConfigOutput>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "getRunnerBootstrapConfig"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.platform.v1.GetRunnerBootstrapConfigInput.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.platform.v1.GetRunnerBootstrapConfigOutput.getDefaultInstance()))
              .setSchemaDescriptor(new PlatformQueryControllerMethodDescriptorSupplier("getRunnerBootstrapConfig"))
              .build();
        }
      }
    }
    return getGetRunnerBootstrapConfigMethod;
  }

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.platform.v1.GetRunnerScopedTokenInput,
      ai.stigmer.platform.v1.GetRunnerScopedTokenOutput> getGetRunnerScopedTokenMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "getRunnerScopedToken",
      requestType = ai.stigmer.platform.v1.GetRunnerScopedTokenInput.class,
      responseType = ai.stigmer.platform.v1.GetRunnerScopedTokenOutput.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.platform.v1.GetRunnerScopedTokenInput,
      ai.stigmer.platform.v1.GetRunnerScopedTokenOutput> getGetRunnerScopedTokenMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.platform.v1.GetRunnerScopedTokenInput, ai.stigmer.platform.v1.GetRunnerScopedTokenOutput> getGetRunnerScopedTokenMethod;
    if ((getGetRunnerScopedTokenMethod = PlatformQueryControllerGrpc.getGetRunnerScopedTokenMethod) == null) {
      synchronized (PlatformQueryControllerGrpc.class) {
        if ((getGetRunnerScopedTokenMethod = PlatformQueryControllerGrpc.getGetRunnerScopedTokenMethod) == null) {
          PlatformQueryControllerGrpc.getGetRunnerScopedTokenMethod = getGetRunnerScopedTokenMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.platform.v1.GetRunnerScopedTokenInput, ai.stigmer.platform.v1.GetRunnerScopedTokenOutput>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "getRunnerScopedToken"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.platform.v1.GetRunnerScopedTokenInput.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.platform.v1.GetRunnerScopedTokenOutput.getDefaultInstance()))
              .setSchemaDescriptor(new PlatformQueryControllerMethodDescriptorSupplier("getRunnerScopedToken"))
              .build();
        }
      }
    }
    return getGetRunnerScopedTokenMethod;
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
   * Query service for server identity, capabilities, and runner bootstrap.
   * Clients call getServerInfo on startup to learn the server edition
   * and version, replacing URL-based guessing. The RPC is public
   * (no authentication required) so it can be called before login.
   * Embedded runners call getRunnerBootstrapConfig during boot to discover
   * the Temporal coordinates they need to join the execution backbone, so
   * integrators never hardcode infrastructure addresses.
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

    /**
     * <pre>
     * Returns everything an embedded runner needs to bootstrap itself.
     * An embedded runner (a desktop or web app hosting the runner for local
     * execution) needs two things at boot, both of which are details it should
     * not have to know or hold ahead of time: the Temporal frontend coordinates
     * to poll for work, and a Stigmer-signed identity to authenticate its
     * Cursor-proxy traffic. This RPC lets the runner self-bootstrap through the
     * one authenticated door it already opens at startup: it presents the token
     * it already holds and the control plane returns the environment's Temporal
     * coordinates plus a freshly minted runner access token. The contract for a
     * cloud embedder collapses to a single endpoint plus a token.
     * Authenticated (not public): the response reveals an infrastructure
     * coordinate and mints a token bound to the caller, so any valid token is
     * required, but no specific FGA permission is — every authenticated caller in
     * an environment shares one Temporal cluster, and task queues are
     * per-session/execution and gated separately by control-plane session access.
     * &#64;internal
     * The minted runner access token (iss=stigmer, sub=caller identity account)
     * is a cloud-only capability — OSS has no Cursor proxy and leaves the token
     * fields empty. The handler degrades gracefully: if minting is unavailable
     * (signing key unconfigured, or no caller identity), it returns the Temporal
     * coordinates with an empty token rather than failing the runner's boot.
     * </pre>
     */
    default void getRunnerBootstrapConfig(ai.stigmer.platform.v1.GetRunnerBootstrapConfigInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.platform.v1.GetRunnerBootstrapConfigOutput> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getGetRunnerBootstrapConfigMethod(), responseObserver);
    }

    /**
     * <pre>
     * Exchanges an embedded runner's bootstrap credential for a token scoped to
     * one unit of dispatched work.
     * The bootstrap token from getRunnerBootstrapConfig identifies a runner but
     * is minted before any execution exists, so it carries no session or
     * execution scope. Secrets are only released to runner credentials bound to
     * the exact work they serve. At task start the runner presents its bootstrap
     * token and names the execution it was dispatched; the control plane verifies
     * the caller and returns a short-lived token scoped to that work, which the
     * runner then uses for its ExecutionContext fetch. This makes a desktop
     * runner indistinguishable, at the secret-release gate, from a
     * server-provisioned sandbox runner.
     * The token fields are empty when the server cannot mint (OSS, or no signing
     * key configured) — the runner falls back to its existing credential.
     * &#64;internal
     * Cloud mints via SandboxTokenService: an agent_execution_id yields a
     * token_type=sandbox token carrying the execution's parent session_id (one
     * session sandbox serves multi-turn executions); a workflow_execution_id
     * yields token_type=workflow_sandbox carrying that id. Both are then bound by
     * RunnerScopeVerifier on the getByExecutionId decrypt path exactly like
     * cloud-sandbox-injected tokens (stigmer-cloud#155/#156).
     * is_skip_authorization because the FGA target is derived from the input
     * oneof, which the declarative interceptor cannot express — the handler
     * enforces authorization itself (same pattern as getRunnerBootstrapConfig):
     * the caller must present a runner-class token_type=embedded_runner
     * credential AND pass the same can_view check getByExecutionId performs on
     * the named execution.
     * The pool_claim arm is the one exception to the embedded_runner rule: it is
     * presented by a warm-pool sandbox holding a token_type=pool_sandbox
     * credential, and is authorized against the pool claim record instead of an
     * execution (see the arm's own doc).
     * </pre>
     */
    default void getRunnerScopedToken(ai.stigmer.platform.v1.GetRunnerScopedTokenInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.platform.v1.GetRunnerScopedTokenOutput> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getGetRunnerScopedTokenMethod(), responseObserver);
    }
  }

  /**
   * Base class for the server implementation of the service PlatformQueryController.
   * <pre>
   * Query service for server identity, capabilities, and runner bootstrap.
   * Clients call getServerInfo on startup to learn the server edition
   * and version, replacing URL-based guessing. The RPC is public
   * (no authentication required) so it can be called before login.
   * Embedded runners call getRunnerBootstrapConfig during boot to discover
   * the Temporal coordinates they need to join the execution backbone, so
   * integrators never hardcode infrastructure addresses.
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
   * Query service for server identity, capabilities, and runner bootstrap.
   * Clients call getServerInfo on startup to learn the server edition
   * and version, replacing URL-based guessing. The RPC is public
   * (no authentication required) so it can be called before login.
   * Embedded runners call getRunnerBootstrapConfig during boot to discover
   * the Temporal coordinates they need to join the execution backbone, so
   * integrators never hardcode infrastructure addresses.
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

    /**
     * <pre>
     * Returns everything an embedded runner needs to bootstrap itself.
     * An embedded runner (a desktop or web app hosting the runner for local
     * execution) needs two things at boot, both of which are details it should
     * not have to know or hold ahead of time: the Temporal frontend coordinates
     * to poll for work, and a Stigmer-signed identity to authenticate its
     * Cursor-proxy traffic. This RPC lets the runner self-bootstrap through the
     * one authenticated door it already opens at startup: it presents the token
     * it already holds and the control plane returns the environment's Temporal
     * coordinates plus a freshly minted runner access token. The contract for a
     * cloud embedder collapses to a single endpoint plus a token.
     * Authenticated (not public): the response reveals an infrastructure
     * coordinate and mints a token bound to the caller, so any valid token is
     * required, but no specific FGA permission is — every authenticated caller in
     * an environment shares one Temporal cluster, and task queues are
     * per-session/execution and gated separately by control-plane session access.
     * &#64;internal
     * The minted runner access token (iss=stigmer, sub=caller identity account)
     * is a cloud-only capability — OSS has no Cursor proxy and leaves the token
     * fields empty. The handler degrades gracefully: if minting is unavailable
     * (signing key unconfigured, or no caller identity), it returns the Temporal
     * coordinates with an empty token rather than failing the runner's boot.
     * </pre>
     */
    public void getRunnerBootstrapConfig(ai.stigmer.platform.v1.GetRunnerBootstrapConfigInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.platform.v1.GetRunnerBootstrapConfigOutput> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getGetRunnerBootstrapConfigMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * Exchanges an embedded runner's bootstrap credential for a token scoped to
     * one unit of dispatched work.
     * The bootstrap token from getRunnerBootstrapConfig identifies a runner but
     * is minted before any execution exists, so it carries no session or
     * execution scope. Secrets are only released to runner credentials bound to
     * the exact work they serve. At task start the runner presents its bootstrap
     * token and names the execution it was dispatched; the control plane verifies
     * the caller and returns a short-lived token scoped to that work, which the
     * runner then uses for its ExecutionContext fetch. This makes a desktop
     * runner indistinguishable, at the secret-release gate, from a
     * server-provisioned sandbox runner.
     * The token fields are empty when the server cannot mint (OSS, or no signing
     * key configured) — the runner falls back to its existing credential.
     * &#64;internal
     * Cloud mints via SandboxTokenService: an agent_execution_id yields a
     * token_type=sandbox token carrying the execution's parent session_id (one
     * session sandbox serves multi-turn executions); a workflow_execution_id
     * yields token_type=workflow_sandbox carrying that id. Both are then bound by
     * RunnerScopeVerifier on the getByExecutionId decrypt path exactly like
     * cloud-sandbox-injected tokens (stigmer-cloud#155/#156).
     * is_skip_authorization because the FGA target is derived from the input
     * oneof, which the declarative interceptor cannot express — the handler
     * enforces authorization itself (same pattern as getRunnerBootstrapConfig):
     * the caller must present a runner-class token_type=embedded_runner
     * credential AND pass the same can_view check getByExecutionId performs on
     * the named execution.
     * The pool_claim arm is the one exception to the embedded_runner rule: it is
     * presented by a warm-pool sandbox holding a token_type=pool_sandbox
     * credential, and is authorized against the pool claim record instead of an
     * execution (see the arm's own doc).
     * </pre>
     */
    public void getRunnerScopedToken(ai.stigmer.platform.v1.GetRunnerScopedTokenInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.platform.v1.GetRunnerScopedTokenOutput> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getGetRunnerScopedTokenMethod(), getCallOptions()), request, responseObserver);
    }
  }

  /**
   * A stub to allow clients to do synchronous rpc calls to service PlatformQueryController.
   * <pre>
   * Query service for server identity, capabilities, and runner bootstrap.
   * Clients call getServerInfo on startup to learn the server edition
   * and version, replacing URL-based guessing. The RPC is public
   * (no authentication required) so it can be called before login.
   * Embedded runners call getRunnerBootstrapConfig during boot to discover
   * the Temporal coordinates they need to join the execution backbone, so
   * integrators never hardcode infrastructure addresses.
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

    /**
     * <pre>
     * Returns everything an embedded runner needs to bootstrap itself.
     * An embedded runner (a desktop or web app hosting the runner for local
     * execution) needs two things at boot, both of which are details it should
     * not have to know or hold ahead of time: the Temporal frontend coordinates
     * to poll for work, and a Stigmer-signed identity to authenticate its
     * Cursor-proxy traffic. This RPC lets the runner self-bootstrap through the
     * one authenticated door it already opens at startup: it presents the token
     * it already holds and the control plane returns the environment's Temporal
     * coordinates plus a freshly minted runner access token. The contract for a
     * cloud embedder collapses to a single endpoint plus a token.
     * Authenticated (not public): the response reveals an infrastructure
     * coordinate and mints a token bound to the caller, so any valid token is
     * required, but no specific FGA permission is — every authenticated caller in
     * an environment shares one Temporal cluster, and task queues are
     * per-session/execution and gated separately by control-plane session access.
     * &#64;internal
     * The minted runner access token (iss=stigmer, sub=caller identity account)
     * is a cloud-only capability — OSS has no Cursor proxy and leaves the token
     * fields empty. The handler degrades gracefully: if minting is unavailable
     * (signing key unconfigured, or no caller identity), it returns the Temporal
     * coordinates with an empty token rather than failing the runner's boot.
     * </pre>
     */
    public ai.stigmer.platform.v1.GetRunnerBootstrapConfigOutput getRunnerBootstrapConfig(ai.stigmer.platform.v1.GetRunnerBootstrapConfigInput request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getGetRunnerBootstrapConfigMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Exchanges an embedded runner's bootstrap credential for a token scoped to
     * one unit of dispatched work.
     * The bootstrap token from getRunnerBootstrapConfig identifies a runner but
     * is minted before any execution exists, so it carries no session or
     * execution scope. Secrets are only released to runner credentials bound to
     * the exact work they serve. At task start the runner presents its bootstrap
     * token and names the execution it was dispatched; the control plane verifies
     * the caller and returns a short-lived token scoped to that work, which the
     * runner then uses for its ExecutionContext fetch. This makes a desktop
     * runner indistinguishable, at the secret-release gate, from a
     * server-provisioned sandbox runner.
     * The token fields are empty when the server cannot mint (OSS, or no signing
     * key configured) — the runner falls back to its existing credential.
     * &#64;internal
     * Cloud mints via SandboxTokenService: an agent_execution_id yields a
     * token_type=sandbox token carrying the execution's parent session_id (one
     * session sandbox serves multi-turn executions); a workflow_execution_id
     * yields token_type=workflow_sandbox carrying that id. Both are then bound by
     * RunnerScopeVerifier on the getByExecutionId decrypt path exactly like
     * cloud-sandbox-injected tokens (stigmer-cloud#155/#156).
     * is_skip_authorization because the FGA target is derived from the input
     * oneof, which the declarative interceptor cannot express — the handler
     * enforces authorization itself (same pattern as getRunnerBootstrapConfig):
     * the caller must present a runner-class token_type=embedded_runner
     * credential AND pass the same can_view check getByExecutionId performs on
     * the named execution.
     * The pool_claim arm is the one exception to the embedded_runner rule: it is
     * presented by a warm-pool sandbox holding a token_type=pool_sandbox
     * credential, and is authorized against the pool claim record instead of an
     * execution (see the arm's own doc).
     * </pre>
     */
    public ai.stigmer.platform.v1.GetRunnerScopedTokenOutput getRunnerScopedToken(ai.stigmer.platform.v1.GetRunnerScopedTokenInput request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getGetRunnerScopedTokenMethod(), getCallOptions(), request);
    }
  }

  /**
   * A stub to allow clients to do limited synchronous rpc calls to service PlatformQueryController.
   * <pre>
   * Query service for server identity, capabilities, and runner bootstrap.
   * Clients call getServerInfo on startup to learn the server edition
   * and version, replacing URL-based guessing. The RPC is public
   * (no authentication required) so it can be called before login.
   * Embedded runners call getRunnerBootstrapConfig during boot to discover
   * the Temporal coordinates they need to join the execution backbone, so
   * integrators never hardcode infrastructure addresses.
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

    /**
     * <pre>
     * Returns everything an embedded runner needs to bootstrap itself.
     * An embedded runner (a desktop or web app hosting the runner for local
     * execution) needs two things at boot, both of which are details it should
     * not have to know or hold ahead of time: the Temporal frontend coordinates
     * to poll for work, and a Stigmer-signed identity to authenticate its
     * Cursor-proxy traffic. This RPC lets the runner self-bootstrap through the
     * one authenticated door it already opens at startup: it presents the token
     * it already holds and the control plane returns the environment's Temporal
     * coordinates plus a freshly minted runner access token. The contract for a
     * cloud embedder collapses to a single endpoint plus a token.
     * Authenticated (not public): the response reveals an infrastructure
     * coordinate and mints a token bound to the caller, so any valid token is
     * required, but no specific FGA permission is — every authenticated caller in
     * an environment shares one Temporal cluster, and task queues are
     * per-session/execution and gated separately by control-plane session access.
     * &#64;internal
     * The minted runner access token (iss=stigmer, sub=caller identity account)
     * is a cloud-only capability — OSS has no Cursor proxy and leaves the token
     * fields empty. The handler degrades gracefully: if minting is unavailable
     * (signing key unconfigured, or no caller identity), it returns the Temporal
     * coordinates with an empty token rather than failing the runner's boot.
     * </pre>
     */
    public ai.stigmer.platform.v1.GetRunnerBootstrapConfigOutput getRunnerBootstrapConfig(ai.stigmer.platform.v1.GetRunnerBootstrapConfigInput request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getGetRunnerBootstrapConfigMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Exchanges an embedded runner's bootstrap credential for a token scoped to
     * one unit of dispatched work.
     * The bootstrap token from getRunnerBootstrapConfig identifies a runner but
     * is minted before any execution exists, so it carries no session or
     * execution scope. Secrets are only released to runner credentials bound to
     * the exact work they serve. At task start the runner presents its bootstrap
     * token and names the execution it was dispatched; the control plane verifies
     * the caller and returns a short-lived token scoped to that work, which the
     * runner then uses for its ExecutionContext fetch. This makes a desktop
     * runner indistinguishable, at the secret-release gate, from a
     * server-provisioned sandbox runner.
     * The token fields are empty when the server cannot mint (OSS, or no signing
     * key configured) — the runner falls back to its existing credential.
     * &#64;internal
     * Cloud mints via SandboxTokenService: an agent_execution_id yields a
     * token_type=sandbox token carrying the execution's parent session_id (one
     * session sandbox serves multi-turn executions); a workflow_execution_id
     * yields token_type=workflow_sandbox carrying that id. Both are then bound by
     * RunnerScopeVerifier on the getByExecutionId decrypt path exactly like
     * cloud-sandbox-injected tokens (stigmer-cloud#155/#156).
     * is_skip_authorization because the FGA target is derived from the input
     * oneof, which the declarative interceptor cannot express — the handler
     * enforces authorization itself (same pattern as getRunnerBootstrapConfig):
     * the caller must present a runner-class token_type=embedded_runner
     * credential AND pass the same can_view check getByExecutionId performs on
     * the named execution.
     * The pool_claim arm is the one exception to the embedded_runner rule: it is
     * presented by a warm-pool sandbox holding a token_type=pool_sandbox
     * credential, and is authorized against the pool claim record instead of an
     * execution (see the arm's own doc).
     * </pre>
     */
    public ai.stigmer.platform.v1.GetRunnerScopedTokenOutput getRunnerScopedToken(ai.stigmer.platform.v1.GetRunnerScopedTokenInput request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getGetRunnerScopedTokenMethod(), getCallOptions(), request);
    }
  }

  /**
   * A stub to allow clients to do ListenableFuture-style rpc calls to service PlatformQueryController.
   * <pre>
   * Query service for server identity, capabilities, and runner bootstrap.
   * Clients call getServerInfo on startup to learn the server edition
   * and version, replacing URL-based guessing. The RPC is public
   * (no authentication required) so it can be called before login.
   * Embedded runners call getRunnerBootstrapConfig during boot to discover
   * the Temporal coordinates they need to join the execution backbone, so
   * integrators never hardcode infrastructure addresses.
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

    /**
     * <pre>
     * Returns everything an embedded runner needs to bootstrap itself.
     * An embedded runner (a desktop or web app hosting the runner for local
     * execution) needs two things at boot, both of which are details it should
     * not have to know or hold ahead of time: the Temporal frontend coordinates
     * to poll for work, and a Stigmer-signed identity to authenticate its
     * Cursor-proxy traffic. This RPC lets the runner self-bootstrap through the
     * one authenticated door it already opens at startup: it presents the token
     * it already holds and the control plane returns the environment's Temporal
     * coordinates plus a freshly minted runner access token. The contract for a
     * cloud embedder collapses to a single endpoint plus a token.
     * Authenticated (not public): the response reveals an infrastructure
     * coordinate and mints a token bound to the caller, so any valid token is
     * required, but no specific FGA permission is — every authenticated caller in
     * an environment shares one Temporal cluster, and task queues are
     * per-session/execution and gated separately by control-plane session access.
     * &#64;internal
     * The minted runner access token (iss=stigmer, sub=caller identity account)
     * is a cloud-only capability — OSS has no Cursor proxy and leaves the token
     * fields empty. The handler degrades gracefully: if minting is unavailable
     * (signing key unconfigured, or no caller identity), it returns the Temporal
     * coordinates with an empty token rather than failing the runner's boot.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.platform.v1.GetRunnerBootstrapConfigOutput> getRunnerBootstrapConfig(
        ai.stigmer.platform.v1.GetRunnerBootstrapConfigInput request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getGetRunnerBootstrapConfigMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * Exchanges an embedded runner's bootstrap credential for a token scoped to
     * one unit of dispatched work.
     * The bootstrap token from getRunnerBootstrapConfig identifies a runner but
     * is minted before any execution exists, so it carries no session or
     * execution scope. Secrets are only released to runner credentials bound to
     * the exact work they serve. At task start the runner presents its bootstrap
     * token and names the execution it was dispatched; the control plane verifies
     * the caller and returns a short-lived token scoped to that work, which the
     * runner then uses for its ExecutionContext fetch. This makes a desktop
     * runner indistinguishable, at the secret-release gate, from a
     * server-provisioned sandbox runner.
     * The token fields are empty when the server cannot mint (OSS, or no signing
     * key configured) — the runner falls back to its existing credential.
     * &#64;internal
     * Cloud mints via SandboxTokenService: an agent_execution_id yields a
     * token_type=sandbox token carrying the execution's parent session_id (one
     * session sandbox serves multi-turn executions); a workflow_execution_id
     * yields token_type=workflow_sandbox carrying that id. Both are then bound by
     * RunnerScopeVerifier on the getByExecutionId decrypt path exactly like
     * cloud-sandbox-injected tokens (stigmer-cloud#155/#156).
     * is_skip_authorization because the FGA target is derived from the input
     * oneof, which the declarative interceptor cannot express — the handler
     * enforces authorization itself (same pattern as getRunnerBootstrapConfig):
     * the caller must present a runner-class token_type=embedded_runner
     * credential AND pass the same can_view check getByExecutionId performs on
     * the named execution.
     * The pool_claim arm is the one exception to the embedded_runner rule: it is
     * presented by a warm-pool sandbox holding a token_type=pool_sandbox
     * credential, and is authorized against the pool claim record instead of an
     * execution (see the arm's own doc).
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.platform.v1.GetRunnerScopedTokenOutput> getRunnerScopedToken(
        ai.stigmer.platform.v1.GetRunnerScopedTokenInput request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getGetRunnerScopedTokenMethod(), getCallOptions()), request);
    }
  }

  private static final int METHODID_GET_SERVER_INFO = 0;
  private static final int METHODID_GET_RUNNER_BOOTSTRAP_CONFIG = 1;
  private static final int METHODID_GET_RUNNER_SCOPED_TOKEN = 2;

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
        case METHODID_GET_RUNNER_BOOTSTRAP_CONFIG:
          serviceImpl.getRunnerBootstrapConfig((ai.stigmer.platform.v1.GetRunnerBootstrapConfigInput) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.platform.v1.GetRunnerBootstrapConfigOutput>) responseObserver);
          break;
        case METHODID_GET_RUNNER_SCOPED_TOKEN:
          serviceImpl.getRunnerScopedToken((ai.stigmer.platform.v1.GetRunnerScopedTokenInput) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.platform.v1.GetRunnerScopedTokenOutput>) responseObserver);
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
        .addMethod(
          getGetRunnerBootstrapConfigMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.platform.v1.GetRunnerBootstrapConfigInput,
              ai.stigmer.platform.v1.GetRunnerBootstrapConfigOutput>(
                service, METHODID_GET_RUNNER_BOOTSTRAP_CONFIG)))
        .addMethod(
          getGetRunnerScopedTokenMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.platform.v1.GetRunnerScopedTokenInput,
              ai.stigmer.platform.v1.GetRunnerScopedTokenOutput>(
                service, METHODID_GET_RUNNER_SCOPED_TOKEN)))
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
              .addMethod(getGetRunnerBootstrapConfigMethod())
              .addMethod(getGetRunnerScopedTokenMethod())
              .build();
        }
      }
    }
    return result;
  }
}
