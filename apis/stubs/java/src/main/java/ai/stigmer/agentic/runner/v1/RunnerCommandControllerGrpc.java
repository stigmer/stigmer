package ai.stigmer.agentic.runner.v1;

import static io.grpc.MethodDescriptor.generateFullMethodName;

/**
 * <pre>
 * RunnerCommandController handles write operations and the bidirectional
 * command stream for runners.
 * Two creation patterns are supported:
 * 1. **CLI/Desktop (persistent runners)**: The client calls apply with a slug
 *    stored in ~/.stigmer/runner.json. If the runner exists, it reactivates.
 *    If not, it creates. This is the primary registration path.
 * 2. **Platform (ephemeral runners)**: The execution workflow calls create
 *    with metadata label stigmer.ai/system-managed: "true". The runner is
 *    torn down via delete when the execution completes.
 * After registration, the runner opens the connect bidi stream — its only
 * ongoing communication channel with the server. Heartbeats flow runner to
 * server; commands (e.g., ListDirectory) flow server to runner.
 * </pre>
 */
@io.grpc.stub.annotations.GrpcGenerated
public final class RunnerCommandControllerGrpc {

  private RunnerCommandControllerGrpc() {}

  public static final java.lang.String SERVICE_NAME = "ai.stigmer.agentic.runner.v1.RunnerCommandController";

  // Static method descriptors that strictly reflect the proto.
  private static volatile io.grpc.MethodDescriptor<ai.stigmer.agentic.runner.v1.Runner,
      ai.stigmer.agentic.runner.v1.Runner> getApplyMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "apply",
      requestType = ai.stigmer.agentic.runner.v1.Runner.class,
      responseType = ai.stigmer.agentic.runner.v1.Runner.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.agentic.runner.v1.Runner,
      ai.stigmer.agentic.runner.v1.Runner> getApplyMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.agentic.runner.v1.Runner, ai.stigmer.agentic.runner.v1.Runner> getApplyMethod;
    if ((getApplyMethod = RunnerCommandControllerGrpc.getApplyMethod) == null) {
      synchronized (RunnerCommandControllerGrpc.class) {
        if ((getApplyMethod = RunnerCommandControllerGrpc.getApplyMethod) == null) {
          RunnerCommandControllerGrpc.getApplyMethod = getApplyMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.agentic.runner.v1.Runner, ai.stigmer.agentic.runner.v1.Runner>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "apply"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.runner.v1.Runner.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.runner.v1.Runner.getDefaultInstance()))
              .setSchemaDescriptor(new RunnerCommandControllerMethodDescriptorSupplier("apply"))
              .build();
        }
      }
    }
    return getApplyMethod;
  }

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.agentic.runner.v1.Runner,
      ai.stigmer.agentic.runner.v1.Runner> getCreateMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "create",
      requestType = ai.stigmer.agentic.runner.v1.Runner.class,
      responseType = ai.stigmer.agentic.runner.v1.Runner.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.agentic.runner.v1.Runner,
      ai.stigmer.agentic.runner.v1.Runner> getCreateMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.agentic.runner.v1.Runner, ai.stigmer.agentic.runner.v1.Runner> getCreateMethod;
    if ((getCreateMethod = RunnerCommandControllerGrpc.getCreateMethod) == null) {
      synchronized (RunnerCommandControllerGrpc.class) {
        if ((getCreateMethod = RunnerCommandControllerGrpc.getCreateMethod) == null) {
          RunnerCommandControllerGrpc.getCreateMethod = getCreateMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.agentic.runner.v1.Runner, ai.stigmer.agentic.runner.v1.Runner>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "create"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.runner.v1.Runner.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.runner.v1.Runner.getDefaultInstance()))
              .setSchemaDescriptor(new RunnerCommandControllerMethodDescriptorSupplier("create"))
              .build();
        }
      }
    }
    return getCreateMethod;
  }

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.agentic.runner.v1.Runner,
      ai.stigmer.agentic.runner.v1.Runner> getUpdateMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "update",
      requestType = ai.stigmer.agentic.runner.v1.Runner.class,
      responseType = ai.stigmer.agentic.runner.v1.Runner.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.agentic.runner.v1.Runner,
      ai.stigmer.agentic.runner.v1.Runner> getUpdateMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.agentic.runner.v1.Runner, ai.stigmer.agentic.runner.v1.Runner> getUpdateMethod;
    if ((getUpdateMethod = RunnerCommandControllerGrpc.getUpdateMethod) == null) {
      synchronized (RunnerCommandControllerGrpc.class) {
        if ((getUpdateMethod = RunnerCommandControllerGrpc.getUpdateMethod) == null) {
          RunnerCommandControllerGrpc.getUpdateMethod = getUpdateMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.agentic.runner.v1.Runner, ai.stigmer.agentic.runner.v1.Runner>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "update"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.runner.v1.Runner.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.runner.v1.Runner.getDefaultInstance()))
              .setSchemaDescriptor(new RunnerCommandControllerMethodDescriptorSupplier("update"))
              .build();
        }
      }
    }
    return getUpdateMethod;
  }

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.agentic.runner.v1.RunnerId,
      ai.stigmer.agentic.runner.v1.Runner> getDeleteMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "delete",
      requestType = ai.stigmer.agentic.runner.v1.RunnerId.class,
      responseType = ai.stigmer.agentic.runner.v1.Runner.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.agentic.runner.v1.RunnerId,
      ai.stigmer.agentic.runner.v1.Runner> getDeleteMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.agentic.runner.v1.RunnerId, ai.stigmer.agentic.runner.v1.Runner> getDeleteMethod;
    if ((getDeleteMethod = RunnerCommandControllerGrpc.getDeleteMethod) == null) {
      synchronized (RunnerCommandControllerGrpc.class) {
        if ((getDeleteMethod = RunnerCommandControllerGrpc.getDeleteMethod) == null) {
          RunnerCommandControllerGrpc.getDeleteMethod = getDeleteMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.agentic.runner.v1.RunnerId, ai.stigmer.agentic.runner.v1.Runner>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "delete"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.runner.v1.RunnerId.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.runner.v1.Runner.getDefaultInstance()))
              .setSchemaDescriptor(new RunnerCommandControllerMethodDescriptorSupplier("delete"))
              .build();
        }
      }
    }
    return getDeleteMethod;
  }

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.agentic.runner.v1.RunnerSendCommandInput,
      ai.stigmer.agentic.runner.v1.RunnerCommandResponse> getSendCommandMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "sendCommand",
      requestType = ai.stigmer.agentic.runner.v1.RunnerSendCommandInput.class,
      responseType = ai.stigmer.agentic.runner.v1.RunnerCommandResponse.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.agentic.runner.v1.RunnerSendCommandInput,
      ai.stigmer.agentic.runner.v1.RunnerCommandResponse> getSendCommandMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.agentic.runner.v1.RunnerSendCommandInput, ai.stigmer.agentic.runner.v1.RunnerCommandResponse> getSendCommandMethod;
    if ((getSendCommandMethod = RunnerCommandControllerGrpc.getSendCommandMethod) == null) {
      synchronized (RunnerCommandControllerGrpc.class) {
        if ((getSendCommandMethod = RunnerCommandControllerGrpc.getSendCommandMethod) == null) {
          RunnerCommandControllerGrpc.getSendCommandMethod = getSendCommandMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.agentic.runner.v1.RunnerSendCommandInput, ai.stigmer.agentic.runner.v1.RunnerCommandResponse>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "sendCommand"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.runner.v1.RunnerSendCommandInput.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.runner.v1.RunnerCommandResponse.getDefaultInstance()))
              .setSchemaDescriptor(new RunnerCommandControllerMethodDescriptorSupplier("sendCommand"))
              .build();
        }
      }
    }
    return getSendCommandMethod;
  }

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.agentic.runner.v1.RunnerStopInput,
      ai.stigmer.agentic.runner.v1.Runner> getStopMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "stop",
      requestType = ai.stigmer.agentic.runner.v1.RunnerStopInput.class,
      responseType = ai.stigmer.agentic.runner.v1.Runner.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.agentic.runner.v1.RunnerStopInput,
      ai.stigmer.agentic.runner.v1.Runner> getStopMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.agentic.runner.v1.RunnerStopInput, ai.stigmer.agentic.runner.v1.Runner> getStopMethod;
    if ((getStopMethod = RunnerCommandControllerGrpc.getStopMethod) == null) {
      synchronized (RunnerCommandControllerGrpc.class) {
        if ((getStopMethod = RunnerCommandControllerGrpc.getStopMethod) == null) {
          RunnerCommandControllerGrpc.getStopMethod = getStopMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.agentic.runner.v1.RunnerStopInput, ai.stigmer.agentic.runner.v1.Runner>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "stop"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.runner.v1.RunnerStopInput.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.runner.v1.Runner.getDefaultInstance()))
              .setSchemaDescriptor(new RunnerCommandControllerMethodDescriptorSupplier("stop"))
              .build();
        }
      }
    }
    return getStopMethod;
  }

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.agentic.runner.v1.RunnerStreamClientMessage,
      ai.stigmer.agentic.runner.v1.RunnerStreamServerMessage> getConnectMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "connect",
      requestType = ai.stigmer.agentic.runner.v1.RunnerStreamClientMessage.class,
      responseType = ai.stigmer.agentic.runner.v1.RunnerStreamServerMessage.class,
      methodType = io.grpc.MethodDescriptor.MethodType.BIDI_STREAMING)
  public static io.grpc.MethodDescriptor<ai.stigmer.agentic.runner.v1.RunnerStreamClientMessage,
      ai.stigmer.agentic.runner.v1.RunnerStreamServerMessage> getConnectMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.agentic.runner.v1.RunnerStreamClientMessage, ai.stigmer.agentic.runner.v1.RunnerStreamServerMessage> getConnectMethod;
    if ((getConnectMethod = RunnerCommandControllerGrpc.getConnectMethod) == null) {
      synchronized (RunnerCommandControllerGrpc.class) {
        if ((getConnectMethod = RunnerCommandControllerGrpc.getConnectMethod) == null) {
          RunnerCommandControllerGrpc.getConnectMethod = getConnectMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.agentic.runner.v1.RunnerStreamClientMessage, ai.stigmer.agentic.runner.v1.RunnerStreamServerMessage>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.BIDI_STREAMING)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "connect"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.runner.v1.RunnerStreamClientMessage.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.runner.v1.RunnerStreamServerMessage.getDefaultInstance()))
              .setSchemaDescriptor(new RunnerCommandControllerMethodDescriptorSupplier("connect"))
              .build();
        }
      }
    }
    return getConnectMethod;
  }

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.agentic.runner.v1.CreateLaunchTokenRequest,
      ai.stigmer.agentic.runner.v1.CreateLaunchTokenResponse> getCreateLaunchTokenMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "createLaunchToken",
      requestType = ai.stigmer.agentic.runner.v1.CreateLaunchTokenRequest.class,
      responseType = ai.stigmer.agentic.runner.v1.CreateLaunchTokenResponse.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.agentic.runner.v1.CreateLaunchTokenRequest,
      ai.stigmer.agentic.runner.v1.CreateLaunchTokenResponse> getCreateLaunchTokenMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.agentic.runner.v1.CreateLaunchTokenRequest, ai.stigmer.agentic.runner.v1.CreateLaunchTokenResponse> getCreateLaunchTokenMethod;
    if ((getCreateLaunchTokenMethod = RunnerCommandControllerGrpc.getCreateLaunchTokenMethod) == null) {
      synchronized (RunnerCommandControllerGrpc.class) {
        if ((getCreateLaunchTokenMethod = RunnerCommandControllerGrpc.getCreateLaunchTokenMethod) == null) {
          RunnerCommandControllerGrpc.getCreateLaunchTokenMethod = getCreateLaunchTokenMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.agentic.runner.v1.CreateLaunchTokenRequest, ai.stigmer.agentic.runner.v1.CreateLaunchTokenResponse>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "createLaunchToken"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.runner.v1.CreateLaunchTokenRequest.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.runner.v1.CreateLaunchTokenResponse.getDefaultInstance()))
              .setSchemaDescriptor(new RunnerCommandControllerMethodDescriptorSupplier("createLaunchToken"))
              .build();
        }
      }
    }
    return getCreateLaunchTokenMethod;
  }

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.agentic.runner.v1.ExchangeLaunchTokenRequest,
      ai.stigmer.agentic.runner.v1.ExchangeLaunchTokenResponse> getExchangeLaunchTokenMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "exchangeLaunchToken",
      requestType = ai.stigmer.agentic.runner.v1.ExchangeLaunchTokenRequest.class,
      responseType = ai.stigmer.agentic.runner.v1.ExchangeLaunchTokenResponse.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.agentic.runner.v1.ExchangeLaunchTokenRequest,
      ai.stigmer.agentic.runner.v1.ExchangeLaunchTokenResponse> getExchangeLaunchTokenMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.agentic.runner.v1.ExchangeLaunchTokenRequest, ai.stigmer.agentic.runner.v1.ExchangeLaunchTokenResponse> getExchangeLaunchTokenMethod;
    if ((getExchangeLaunchTokenMethod = RunnerCommandControllerGrpc.getExchangeLaunchTokenMethod) == null) {
      synchronized (RunnerCommandControllerGrpc.class) {
        if ((getExchangeLaunchTokenMethod = RunnerCommandControllerGrpc.getExchangeLaunchTokenMethod) == null) {
          RunnerCommandControllerGrpc.getExchangeLaunchTokenMethod = getExchangeLaunchTokenMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.agentic.runner.v1.ExchangeLaunchTokenRequest, ai.stigmer.agentic.runner.v1.ExchangeLaunchTokenResponse>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "exchangeLaunchToken"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.runner.v1.ExchangeLaunchTokenRequest.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.runner.v1.ExchangeLaunchTokenResponse.getDefaultInstance()))
              .setSchemaDescriptor(new RunnerCommandControllerMethodDescriptorSupplier("exchangeLaunchToken"))
              .build();
        }
      }
    }
    return getExchangeLaunchTokenMethod;
  }

  /**
   * Creates a new async stub that supports all call types for the service
   */
  public static RunnerCommandControllerStub newStub(io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<RunnerCommandControllerStub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<RunnerCommandControllerStub>() {
        @java.lang.Override
        public RunnerCommandControllerStub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new RunnerCommandControllerStub(channel, callOptions);
        }
      };
    return RunnerCommandControllerStub.newStub(factory, channel);
  }

  /**
   * Creates a new blocking-style stub that supports all types of calls on the service
   */
  public static RunnerCommandControllerBlockingV2Stub newBlockingV2Stub(
      io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<RunnerCommandControllerBlockingV2Stub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<RunnerCommandControllerBlockingV2Stub>() {
        @java.lang.Override
        public RunnerCommandControllerBlockingV2Stub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new RunnerCommandControllerBlockingV2Stub(channel, callOptions);
        }
      };
    return RunnerCommandControllerBlockingV2Stub.newStub(factory, channel);
  }

  /**
   * Creates a new blocking-style stub that supports unary and streaming output calls on the service
   */
  public static RunnerCommandControllerBlockingStub newBlockingStub(
      io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<RunnerCommandControllerBlockingStub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<RunnerCommandControllerBlockingStub>() {
        @java.lang.Override
        public RunnerCommandControllerBlockingStub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new RunnerCommandControllerBlockingStub(channel, callOptions);
        }
      };
    return RunnerCommandControllerBlockingStub.newStub(factory, channel);
  }

  /**
   * Creates a new ListenableFuture-style stub that supports unary calls on the service
   */
  public static RunnerCommandControllerFutureStub newFutureStub(
      io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<RunnerCommandControllerFutureStub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<RunnerCommandControllerFutureStub>() {
        @java.lang.Override
        public RunnerCommandControllerFutureStub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new RunnerCommandControllerFutureStub(channel, callOptions);
        }
      };
    return RunnerCommandControllerFutureStub.newStub(factory, channel);
  }

  /**
   * <pre>
   * RunnerCommandController handles write operations and the bidirectional
   * command stream for runners.
   * Two creation patterns are supported:
   * 1. **CLI/Desktop (persistent runners)**: The client calls apply with a slug
   *    stored in ~/.stigmer/runner.json. If the runner exists, it reactivates.
   *    If not, it creates. This is the primary registration path.
   * 2. **Platform (ephemeral runners)**: The execution workflow calls create
   *    with metadata label stigmer.ai/system-managed: "true". The runner is
   *    torn down via delete when the execution completes.
   * After registration, the runner opens the connect bidi stream — its only
   * ongoing communication channel with the server. Heartbeats flow runner to
   * server; commands (e.g., ListDirectory) flow server to runner.
   * </pre>
   */
  public interface AsyncService {

    /**
     * <pre>
     * Create or update a runner.
     * &#64;internal
     * Primary registration path for CLI/Desktop runners. The handler determines
     * whether to create or update based on whether the resource already exists
     * (resolved by org + slug). Authorization is handled in the handler.
     * </pre>
     */
    default void apply(ai.stigmer.agentic.runner.v1.Runner request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.runner.v1.Runner> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getApplyMethod(), responseObserver);
    }

    /**
     * <pre>
     * Create a new runner.
     * &#64;internal
     * Authorization: Caller must have can_create_runner permission in the
     * organization. The server generates the task queue name (runner:{id})
     * and sets the initial phase to PENDING.
     * </pre>
     */
    default void create(ai.stigmer.agentic.runner.v1.Runner request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.runner.v1.Runner> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getCreateMethod(), responseObserver);
    }

    /**
     * <pre>
     * Update an existing runner.
     * &#64;internal
     * Used for updating spec fields (e.g., description). Status fields are
     * updated via the connect stream heartbeat, not via this RPC.
     * </pre>
     */
    default void update(ai.stigmer.agentic.runner.v1.Runner request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.runner.v1.Runner> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getUpdateMethod(), responseObserver);
    }

    /**
     * <pre>
     * Delete a runner.
     * &#64;internal
     * For persistent runners: removes the resource and its task queue.
     * For system-managed runners: called by the execution workflow during
     * cleanup after the execution completes.
     * </pre>
     */
    default void delete(ai.stigmer.agentic.runner.v1.RunnerId request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.runner.v1.Runner> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getDeleteMethod(), responseObserver);
    }

    /**
     * <pre>
     * Send a command to a connected runner and return the response synchronously.
     * This is the API entry point for UI-triggered runner commands. The server
     * looks up the runner's active bidi stream, pushes the command, and blocks
     * until the runner responds or the timeout (10s) expires.
     * Requires an active connect stream — returns UNAVAILABLE if the runner
     * is not connected. Returns FAILED_PRECONDITION if the runner's phase
     * prevents command delivery (STOPPED, PENDING, FAILED).
     * </pre>
     */
    default void sendCommand(ai.stigmer.agentic.runner.v1.RunnerSendCommandInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.runner.v1.RunnerCommandResponse> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getSendCommandMethod(), responseObserver);
    }

    /**
     * <pre>
     * Stop a running runner gracefully.
     * If the runner is connected: sends a StopRunnerRequest via the bidi
     * stream, waits for acknowledgment, then returns the updated Runner.
     * The runner will send a STOPPED heartbeat and close its stream after
     * acknowledging — the phase transition completes asynchronously.
     * If the runner is not connected (offline, already stopped): directly
     * transitions the runner to STOPPED and returns the updated resource.
     * Idempotent: stopping an already-STOPPED or FAILED runner returns the
     * resource as-is without error.
     * </pre>
     */
    default void stop(ai.stigmer.agentic.runner.v1.RunnerStopInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.runner.v1.Runner> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getStopMethod(), responseObserver);
    }

    /**
     * <pre>
     * Establish a bidirectional command stream between the runner and the server.
     * This is the runner's primary ongoing communication channel. The runner
     * pushes heartbeats (liveness + state); the server pushes commands
     * (e.g., ListDirectory for workspace browsing). Both directions use the
     * same open connection.
     * Stream lifecycle:
     *   1. Runner calls apply to register/reactivate, then opens this stream.
     *   2. First message MUST be a RunnerHeartbeat (authenticates via runner_id).
     *   3. Runner sends heartbeats every 30s.
     *   4. Server pushes RunnerCommandRequest when the UI triggers an operation.
     *   5. Runner handles commands locally and sends RunnerCommandResponse.
     *   6. On graceful shutdown: runner sends phase=STOPPED heartbeat, closes stream.
     *   7. On disconnect: server starts heartbeat timeout (90s) -&gt; STOPPED.
     * &#64;internal
     * Authorization is handled via the first heartbeat message: the server
     * looks up the runner_id and verifies ownership. Skipped at the interceptor
     * level because the stream input is not a resource type.
     * </pre>
     */
    default io.grpc.stub.StreamObserver<ai.stigmer.agentic.runner.v1.RunnerStreamClientMessage> connect(
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.runner.v1.RunnerStreamServerMessage> responseObserver) {
      return io.grpc.stub.ServerCalls.asyncUnimplementedStreamingCall(getConnectMethod(), responseObserver);
    }

    /**
     * <pre>
     * Create a one-time launch token for the browser-to-CLI runner handshake.
     * Called by the web console when the user clicks "Launch Local Runner."
     * The server mints a Stigmer JWT for the caller, wraps it in an opaque
     * token stored in Redis (60s TTL, single-use), and returns the token for
     * the browser to embed in a stigmer:// URL.
     * The caller must have can_create_runner permission in the organization —
     * if you can create a runner, you can create a launch token.
     * </pre>
     */
    default void createLaunchToken(ai.stigmer.agentic.runner.v1.CreateLaunchTokenRequest request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.runner.v1.CreateLaunchTokenResponse> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getCreateLaunchTokenMethod(), responseObserver);
    }

    /**
     * <pre>
     * Exchange a one-time launch token for long-lived runner credentials.
     * Called by the CLI (or Desktop app) after receiving a stigmer:// URL from
     * the OS. The token is consumed atomically — a second exchange attempt
     * returns NOT_FOUND.
     * &#64;internal
     * This RPC is public — no Bearer token is required. The one-time launch
     * token IS the proof of authorization: it was created by an authenticated
     * user with can_create_runner permission, and can only be used once.
     * </pre>
     */
    default void exchangeLaunchToken(ai.stigmer.agentic.runner.v1.ExchangeLaunchTokenRequest request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.runner.v1.ExchangeLaunchTokenResponse> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getExchangeLaunchTokenMethod(), responseObserver);
    }
  }

  /**
   * Base class for the server implementation of the service RunnerCommandController.
   * <pre>
   * RunnerCommandController handles write operations and the bidirectional
   * command stream for runners.
   * Two creation patterns are supported:
   * 1. **CLI/Desktop (persistent runners)**: The client calls apply with a slug
   *    stored in ~/.stigmer/runner.json. If the runner exists, it reactivates.
   *    If not, it creates. This is the primary registration path.
   * 2. **Platform (ephemeral runners)**: The execution workflow calls create
   *    with metadata label stigmer.ai/system-managed: "true". The runner is
   *    torn down via delete when the execution completes.
   * After registration, the runner opens the connect bidi stream — its only
   * ongoing communication channel with the server. Heartbeats flow runner to
   * server; commands (e.g., ListDirectory) flow server to runner.
   * </pre>
   */
  public static abstract class RunnerCommandControllerImplBase
      implements io.grpc.BindableService, AsyncService {

    @java.lang.Override public final io.grpc.ServerServiceDefinition bindService() {
      return RunnerCommandControllerGrpc.bindService(this);
    }
  }

  /**
   * A stub to allow clients to do asynchronous rpc calls to service RunnerCommandController.
   * <pre>
   * RunnerCommandController handles write operations and the bidirectional
   * command stream for runners.
   * Two creation patterns are supported:
   * 1. **CLI/Desktop (persistent runners)**: The client calls apply with a slug
   *    stored in ~/.stigmer/runner.json. If the runner exists, it reactivates.
   *    If not, it creates. This is the primary registration path.
   * 2. **Platform (ephemeral runners)**: The execution workflow calls create
   *    with metadata label stigmer.ai/system-managed: "true". The runner is
   *    torn down via delete when the execution completes.
   * After registration, the runner opens the connect bidi stream — its only
   * ongoing communication channel with the server. Heartbeats flow runner to
   * server; commands (e.g., ListDirectory) flow server to runner.
   * </pre>
   */
  public static final class RunnerCommandControllerStub
      extends io.grpc.stub.AbstractAsyncStub<RunnerCommandControllerStub> {
    private RunnerCommandControllerStub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected RunnerCommandControllerStub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new RunnerCommandControllerStub(channel, callOptions);
    }

    /**
     * <pre>
     * Create or update a runner.
     * &#64;internal
     * Primary registration path for CLI/Desktop runners. The handler determines
     * whether to create or update based on whether the resource already exists
     * (resolved by org + slug). Authorization is handled in the handler.
     * </pre>
     */
    public void apply(ai.stigmer.agentic.runner.v1.Runner request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.runner.v1.Runner> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getApplyMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * Create a new runner.
     * &#64;internal
     * Authorization: Caller must have can_create_runner permission in the
     * organization. The server generates the task queue name (runner:{id})
     * and sets the initial phase to PENDING.
     * </pre>
     */
    public void create(ai.stigmer.agentic.runner.v1.Runner request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.runner.v1.Runner> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getCreateMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * Update an existing runner.
     * &#64;internal
     * Used for updating spec fields (e.g., description). Status fields are
     * updated via the connect stream heartbeat, not via this RPC.
     * </pre>
     */
    public void update(ai.stigmer.agentic.runner.v1.Runner request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.runner.v1.Runner> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getUpdateMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * Delete a runner.
     * &#64;internal
     * For persistent runners: removes the resource and its task queue.
     * For system-managed runners: called by the execution workflow during
     * cleanup after the execution completes.
     * </pre>
     */
    public void delete(ai.stigmer.agentic.runner.v1.RunnerId request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.runner.v1.Runner> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getDeleteMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * Send a command to a connected runner and return the response synchronously.
     * This is the API entry point for UI-triggered runner commands. The server
     * looks up the runner's active bidi stream, pushes the command, and blocks
     * until the runner responds or the timeout (10s) expires.
     * Requires an active connect stream — returns UNAVAILABLE if the runner
     * is not connected. Returns FAILED_PRECONDITION if the runner's phase
     * prevents command delivery (STOPPED, PENDING, FAILED).
     * </pre>
     */
    public void sendCommand(ai.stigmer.agentic.runner.v1.RunnerSendCommandInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.runner.v1.RunnerCommandResponse> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getSendCommandMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * Stop a running runner gracefully.
     * If the runner is connected: sends a StopRunnerRequest via the bidi
     * stream, waits for acknowledgment, then returns the updated Runner.
     * The runner will send a STOPPED heartbeat and close its stream after
     * acknowledging — the phase transition completes asynchronously.
     * If the runner is not connected (offline, already stopped): directly
     * transitions the runner to STOPPED and returns the updated resource.
     * Idempotent: stopping an already-STOPPED or FAILED runner returns the
     * resource as-is without error.
     * </pre>
     */
    public void stop(ai.stigmer.agentic.runner.v1.RunnerStopInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.runner.v1.Runner> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getStopMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * Establish a bidirectional command stream between the runner and the server.
     * This is the runner's primary ongoing communication channel. The runner
     * pushes heartbeats (liveness + state); the server pushes commands
     * (e.g., ListDirectory for workspace browsing). Both directions use the
     * same open connection.
     * Stream lifecycle:
     *   1. Runner calls apply to register/reactivate, then opens this stream.
     *   2. First message MUST be a RunnerHeartbeat (authenticates via runner_id).
     *   3. Runner sends heartbeats every 30s.
     *   4. Server pushes RunnerCommandRequest when the UI triggers an operation.
     *   5. Runner handles commands locally and sends RunnerCommandResponse.
     *   6. On graceful shutdown: runner sends phase=STOPPED heartbeat, closes stream.
     *   7. On disconnect: server starts heartbeat timeout (90s) -&gt; STOPPED.
     * &#64;internal
     * Authorization is handled via the first heartbeat message: the server
     * looks up the runner_id and verifies ownership. Skipped at the interceptor
     * level because the stream input is not a resource type.
     * </pre>
     */
    public io.grpc.stub.StreamObserver<ai.stigmer.agentic.runner.v1.RunnerStreamClientMessage> connect(
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.runner.v1.RunnerStreamServerMessage> responseObserver) {
      return io.grpc.stub.ClientCalls.asyncBidiStreamingCall(
          getChannel().newCall(getConnectMethod(), getCallOptions()), responseObserver);
    }

    /**
     * <pre>
     * Create a one-time launch token for the browser-to-CLI runner handshake.
     * Called by the web console when the user clicks "Launch Local Runner."
     * The server mints a Stigmer JWT for the caller, wraps it in an opaque
     * token stored in Redis (60s TTL, single-use), and returns the token for
     * the browser to embed in a stigmer:// URL.
     * The caller must have can_create_runner permission in the organization —
     * if you can create a runner, you can create a launch token.
     * </pre>
     */
    public void createLaunchToken(ai.stigmer.agentic.runner.v1.CreateLaunchTokenRequest request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.runner.v1.CreateLaunchTokenResponse> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getCreateLaunchTokenMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * Exchange a one-time launch token for long-lived runner credentials.
     * Called by the CLI (or Desktop app) after receiving a stigmer:// URL from
     * the OS. The token is consumed atomically — a second exchange attempt
     * returns NOT_FOUND.
     * &#64;internal
     * This RPC is public — no Bearer token is required. The one-time launch
     * token IS the proof of authorization: it was created by an authenticated
     * user with can_create_runner permission, and can only be used once.
     * </pre>
     */
    public void exchangeLaunchToken(ai.stigmer.agentic.runner.v1.ExchangeLaunchTokenRequest request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.runner.v1.ExchangeLaunchTokenResponse> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getExchangeLaunchTokenMethod(), getCallOptions()), request, responseObserver);
    }
  }

  /**
   * A stub to allow clients to do synchronous rpc calls to service RunnerCommandController.
   * <pre>
   * RunnerCommandController handles write operations and the bidirectional
   * command stream for runners.
   * Two creation patterns are supported:
   * 1. **CLI/Desktop (persistent runners)**: The client calls apply with a slug
   *    stored in ~/.stigmer/runner.json. If the runner exists, it reactivates.
   *    If not, it creates. This is the primary registration path.
   * 2. **Platform (ephemeral runners)**: The execution workflow calls create
   *    with metadata label stigmer.ai/system-managed: "true". The runner is
   *    torn down via delete when the execution completes.
   * After registration, the runner opens the connect bidi stream — its only
   * ongoing communication channel with the server. Heartbeats flow runner to
   * server; commands (e.g., ListDirectory) flow server to runner.
   * </pre>
   */
  public static final class RunnerCommandControllerBlockingV2Stub
      extends io.grpc.stub.AbstractBlockingStub<RunnerCommandControllerBlockingV2Stub> {
    private RunnerCommandControllerBlockingV2Stub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected RunnerCommandControllerBlockingV2Stub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new RunnerCommandControllerBlockingV2Stub(channel, callOptions);
    }

    /**
     * <pre>
     * Create or update a runner.
     * &#64;internal
     * Primary registration path for CLI/Desktop runners. The handler determines
     * whether to create or update based on whether the resource already exists
     * (resolved by org + slug). Authorization is handled in the handler.
     * </pre>
     */
    public ai.stigmer.agentic.runner.v1.Runner apply(ai.stigmer.agentic.runner.v1.Runner request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getApplyMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Create a new runner.
     * &#64;internal
     * Authorization: Caller must have can_create_runner permission in the
     * organization. The server generates the task queue name (runner:{id})
     * and sets the initial phase to PENDING.
     * </pre>
     */
    public ai.stigmer.agentic.runner.v1.Runner create(ai.stigmer.agentic.runner.v1.Runner request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getCreateMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Update an existing runner.
     * &#64;internal
     * Used for updating spec fields (e.g., description). Status fields are
     * updated via the connect stream heartbeat, not via this RPC.
     * </pre>
     */
    public ai.stigmer.agentic.runner.v1.Runner update(ai.stigmer.agentic.runner.v1.Runner request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getUpdateMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Delete a runner.
     * &#64;internal
     * For persistent runners: removes the resource and its task queue.
     * For system-managed runners: called by the execution workflow during
     * cleanup after the execution completes.
     * </pre>
     */
    public ai.stigmer.agentic.runner.v1.Runner delete(ai.stigmer.agentic.runner.v1.RunnerId request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getDeleteMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Send a command to a connected runner and return the response synchronously.
     * This is the API entry point for UI-triggered runner commands. The server
     * looks up the runner's active bidi stream, pushes the command, and blocks
     * until the runner responds or the timeout (10s) expires.
     * Requires an active connect stream — returns UNAVAILABLE if the runner
     * is not connected. Returns FAILED_PRECONDITION if the runner's phase
     * prevents command delivery (STOPPED, PENDING, FAILED).
     * </pre>
     */
    public ai.stigmer.agentic.runner.v1.RunnerCommandResponse sendCommand(ai.stigmer.agentic.runner.v1.RunnerSendCommandInput request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getSendCommandMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Stop a running runner gracefully.
     * If the runner is connected: sends a StopRunnerRequest via the bidi
     * stream, waits for acknowledgment, then returns the updated Runner.
     * The runner will send a STOPPED heartbeat and close its stream after
     * acknowledging — the phase transition completes asynchronously.
     * If the runner is not connected (offline, already stopped): directly
     * transitions the runner to STOPPED and returns the updated resource.
     * Idempotent: stopping an already-STOPPED or FAILED runner returns the
     * resource as-is without error.
     * </pre>
     */
    public ai.stigmer.agentic.runner.v1.Runner stop(ai.stigmer.agentic.runner.v1.RunnerStopInput request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getStopMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Establish a bidirectional command stream between the runner and the server.
     * This is the runner's primary ongoing communication channel. The runner
     * pushes heartbeats (liveness + state); the server pushes commands
     * (e.g., ListDirectory for workspace browsing). Both directions use the
     * same open connection.
     * Stream lifecycle:
     *   1. Runner calls apply to register/reactivate, then opens this stream.
     *   2. First message MUST be a RunnerHeartbeat (authenticates via runner_id).
     *   3. Runner sends heartbeats every 30s.
     *   4. Server pushes RunnerCommandRequest when the UI triggers an operation.
     *   5. Runner handles commands locally and sends RunnerCommandResponse.
     *   6. On graceful shutdown: runner sends phase=STOPPED heartbeat, closes stream.
     *   7. On disconnect: server starts heartbeat timeout (90s) -&gt; STOPPED.
     * &#64;internal
     * Authorization is handled via the first heartbeat message: the server
     * looks up the runner_id and verifies ownership. Skipped at the interceptor
     * level because the stream input is not a resource type.
     * </pre>
     */
    @io.grpc.ExperimentalApi("https://github.com/grpc/grpc-java/issues/10918")
    public io.grpc.stub.BlockingClientCall<ai.stigmer.agentic.runner.v1.RunnerStreamClientMessage, ai.stigmer.agentic.runner.v1.RunnerStreamServerMessage>
        connect() {
      return io.grpc.stub.ClientCalls.blockingBidiStreamingCall(
          getChannel(), getConnectMethod(), getCallOptions());
    }

    /**
     * <pre>
     * Create a one-time launch token for the browser-to-CLI runner handshake.
     * Called by the web console when the user clicks "Launch Local Runner."
     * The server mints a Stigmer JWT for the caller, wraps it in an opaque
     * token stored in Redis (60s TTL, single-use), and returns the token for
     * the browser to embed in a stigmer:// URL.
     * The caller must have can_create_runner permission in the organization —
     * if you can create a runner, you can create a launch token.
     * </pre>
     */
    public ai.stigmer.agentic.runner.v1.CreateLaunchTokenResponse createLaunchToken(ai.stigmer.agentic.runner.v1.CreateLaunchTokenRequest request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getCreateLaunchTokenMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Exchange a one-time launch token for long-lived runner credentials.
     * Called by the CLI (or Desktop app) after receiving a stigmer:// URL from
     * the OS. The token is consumed atomically — a second exchange attempt
     * returns NOT_FOUND.
     * &#64;internal
     * This RPC is public — no Bearer token is required. The one-time launch
     * token IS the proof of authorization: it was created by an authenticated
     * user with can_create_runner permission, and can only be used once.
     * </pre>
     */
    public ai.stigmer.agentic.runner.v1.ExchangeLaunchTokenResponse exchangeLaunchToken(ai.stigmer.agentic.runner.v1.ExchangeLaunchTokenRequest request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getExchangeLaunchTokenMethod(), getCallOptions(), request);
    }
  }

  /**
   * A stub to allow clients to do limited synchronous rpc calls to service RunnerCommandController.
   * <pre>
   * RunnerCommandController handles write operations and the bidirectional
   * command stream for runners.
   * Two creation patterns are supported:
   * 1. **CLI/Desktop (persistent runners)**: The client calls apply with a slug
   *    stored in ~/.stigmer/runner.json. If the runner exists, it reactivates.
   *    If not, it creates. This is the primary registration path.
   * 2. **Platform (ephemeral runners)**: The execution workflow calls create
   *    with metadata label stigmer.ai/system-managed: "true". The runner is
   *    torn down via delete when the execution completes.
   * After registration, the runner opens the connect bidi stream — its only
   * ongoing communication channel with the server. Heartbeats flow runner to
   * server; commands (e.g., ListDirectory) flow server to runner.
   * </pre>
   */
  public static final class RunnerCommandControllerBlockingStub
      extends io.grpc.stub.AbstractBlockingStub<RunnerCommandControllerBlockingStub> {
    private RunnerCommandControllerBlockingStub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected RunnerCommandControllerBlockingStub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new RunnerCommandControllerBlockingStub(channel, callOptions);
    }

    /**
     * <pre>
     * Create or update a runner.
     * &#64;internal
     * Primary registration path for CLI/Desktop runners. The handler determines
     * whether to create or update based on whether the resource already exists
     * (resolved by org + slug). Authorization is handled in the handler.
     * </pre>
     */
    public ai.stigmer.agentic.runner.v1.Runner apply(ai.stigmer.agentic.runner.v1.Runner request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getApplyMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Create a new runner.
     * &#64;internal
     * Authorization: Caller must have can_create_runner permission in the
     * organization. The server generates the task queue name (runner:{id})
     * and sets the initial phase to PENDING.
     * </pre>
     */
    public ai.stigmer.agentic.runner.v1.Runner create(ai.stigmer.agentic.runner.v1.Runner request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getCreateMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Update an existing runner.
     * &#64;internal
     * Used for updating spec fields (e.g., description). Status fields are
     * updated via the connect stream heartbeat, not via this RPC.
     * </pre>
     */
    public ai.stigmer.agentic.runner.v1.Runner update(ai.stigmer.agentic.runner.v1.Runner request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getUpdateMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Delete a runner.
     * &#64;internal
     * For persistent runners: removes the resource and its task queue.
     * For system-managed runners: called by the execution workflow during
     * cleanup after the execution completes.
     * </pre>
     */
    public ai.stigmer.agentic.runner.v1.Runner delete(ai.stigmer.agentic.runner.v1.RunnerId request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getDeleteMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Send a command to a connected runner and return the response synchronously.
     * This is the API entry point for UI-triggered runner commands. The server
     * looks up the runner's active bidi stream, pushes the command, and blocks
     * until the runner responds or the timeout (10s) expires.
     * Requires an active connect stream — returns UNAVAILABLE if the runner
     * is not connected. Returns FAILED_PRECONDITION if the runner's phase
     * prevents command delivery (STOPPED, PENDING, FAILED).
     * </pre>
     */
    public ai.stigmer.agentic.runner.v1.RunnerCommandResponse sendCommand(ai.stigmer.agentic.runner.v1.RunnerSendCommandInput request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getSendCommandMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Stop a running runner gracefully.
     * If the runner is connected: sends a StopRunnerRequest via the bidi
     * stream, waits for acknowledgment, then returns the updated Runner.
     * The runner will send a STOPPED heartbeat and close its stream after
     * acknowledging — the phase transition completes asynchronously.
     * If the runner is not connected (offline, already stopped): directly
     * transitions the runner to STOPPED and returns the updated resource.
     * Idempotent: stopping an already-STOPPED or FAILED runner returns the
     * resource as-is without error.
     * </pre>
     */
    public ai.stigmer.agentic.runner.v1.Runner stop(ai.stigmer.agentic.runner.v1.RunnerStopInput request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getStopMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Create a one-time launch token for the browser-to-CLI runner handshake.
     * Called by the web console when the user clicks "Launch Local Runner."
     * The server mints a Stigmer JWT for the caller, wraps it in an opaque
     * token stored in Redis (60s TTL, single-use), and returns the token for
     * the browser to embed in a stigmer:// URL.
     * The caller must have can_create_runner permission in the organization —
     * if you can create a runner, you can create a launch token.
     * </pre>
     */
    public ai.stigmer.agentic.runner.v1.CreateLaunchTokenResponse createLaunchToken(ai.stigmer.agentic.runner.v1.CreateLaunchTokenRequest request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getCreateLaunchTokenMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Exchange a one-time launch token for long-lived runner credentials.
     * Called by the CLI (or Desktop app) after receiving a stigmer:// URL from
     * the OS. The token is consumed atomically — a second exchange attempt
     * returns NOT_FOUND.
     * &#64;internal
     * This RPC is public — no Bearer token is required. The one-time launch
     * token IS the proof of authorization: it was created by an authenticated
     * user with can_create_runner permission, and can only be used once.
     * </pre>
     */
    public ai.stigmer.agentic.runner.v1.ExchangeLaunchTokenResponse exchangeLaunchToken(ai.stigmer.agentic.runner.v1.ExchangeLaunchTokenRequest request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getExchangeLaunchTokenMethod(), getCallOptions(), request);
    }
  }

  /**
   * A stub to allow clients to do ListenableFuture-style rpc calls to service RunnerCommandController.
   * <pre>
   * RunnerCommandController handles write operations and the bidirectional
   * command stream for runners.
   * Two creation patterns are supported:
   * 1. **CLI/Desktop (persistent runners)**: The client calls apply with a slug
   *    stored in ~/.stigmer/runner.json. If the runner exists, it reactivates.
   *    If not, it creates. This is the primary registration path.
   * 2. **Platform (ephemeral runners)**: The execution workflow calls create
   *    with metadata label stigmer.ai/system-managed: "true". The runner is
   *    torn down via delete when the execution completes.
   * After registration, the runner opens the connect bidi stream — its only
   * ongoing communication channel with the server. Heartbeats flow runner to
   * server; commands (e.g., ListDirectory) flow server to runner.
   * </pre>
   */
  public static final class RunnerCommandControllerFutureStub
      extends io.grpc.stub.AbstractFutureStub<RunnerCommandControllerFutureStub> {
    private RunnerCommandControllerFutureStub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected RunnerCommandControllerFutureStub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new RunnerCommandControllerFutureStub(channel, callOptions);
    }

    /**
     * <pre>
     * Create or update a runner.
     * &#64;internal
     * Primary registration path for CLI/Desktop runners. The handler determines
     * whether to create or update based on whether the resource already exists
     * (resolved by org + slug). Authorization is handled in the handler.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.agentic.runner.v1.Runner> apply(
        ai.stigmer.agentic.runner.v1.Runner request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getApplyMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * Create a new runner.
     * &#64;internal
     * Authorization: Caller must have can_create_runner permission in the
     * organization. The server generates the task queue name (runner:{id})
     * and sets the initial phase to PENDING.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.agentic.runner.v1.Runner> create(
        ai.stigmer.agentic.runner.v1.Runner request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getCreateMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * Update an existing runner.
     * &#64;internal
     * Used for updating spec fields (e.g., description). Status fields are
     * updated via the connect stream heartbeat, not via this RPC.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.agentic.runner.v1.Runner> update(
        ai.stigmer.agentic.runner.v1.Runner request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getUpdateMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * Delete a runner.
     * &#64;internal
     * For persistent runners: removes the resource and its task queue.
     * For system-managed runners: called by the execution workflow during
     * cleanup after the execution completes.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.agentic.runner.v1.Runner> delete(
        ai.stigmer.agentic.runner.v1.RunnerId request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getDeleteMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * Send a command to a connected runner and return the response synchronously.
     * This is the API entry point for UI-triggered runner commands. The server
     * looks up the runner's active bidi stream, pushes the command, and blocks
     * until the runner responds or the timeout (10s) expires.
     * Requires an active connect stream — returns UNAVAILABLE if the runner
     * is not connected. Returns FAILED_PRECONDITION if the runner's phase
     * prevents command delivery (STOPPED, PENDING, FAILED).
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.agentic.runner.v1.RunnerCommandResponse> sendCommand(
        ai.stigmer.agentic.runner.v1.RunnerSendCommandInput request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getSendCommandMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * Stop a running runner gracefully.
     * If the runner is connected: sends a StopRunnerRequest via the bidi
     * stream, waits for acknowledgment, then returns the updated Runner.
     * The runner will send a STOPPED heartbeat and close its stream after
     * acknowledging — the phase transition completes asynchronously.
     * If the runner is not connected (offline, already stopped): directly
     * transitions the runner to STOPPED and returns the updated resource.
     * Idempotent: stopping an already-STOPPED or FAILED runner returns the
     * resource as-is without error.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.agentic.runner.v1.Runner> stop(
        ai.stigmer.agentic.runner.v1.RunnerStopInput request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getStopMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * Create a one-time launch token for the browser-to-CLI runner handshake.
     * Called by the web console when the user clicks "Launch Local Runner."
     * The server mints a Stigmer JWT for the caller, wraps it in an opaque
     * token stored in Redis (60s TTL, single-use), and returns the token for
     * the browser to embed in a stigmer:// URL.
     * The caller must have can_create_runner permission in the organization —
     * if you can create a runner, you can create a launch token.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.agentic.runner.v1.CreateLaunchTokenResponse> createLaunchToken(
        ai.stigmer.agentic.runner.v1.CreateLaunchTokenRequest request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getCreateLaunchTokenMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * Exchange a one-time launch token for long-lived runner credentials.
     * Called by the CLI (or Desktop app) after receiving a stigmer:// URL from
     * the OS. The token is consumed atomically — a second exchange attempt
     * returns NOT_FOUND.
     * &#64;internal
     * This RPC is public — no Bearer token is required. The one-time launch
     * token IS the proof of authorization: it was created by an authenticated
     * user with can_create_runner permission, and can only be used once.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.agentic.runner.v1.ExchangeLaunchTokenResponse> exchangeLaunchToken(
        ai.stigmer.agentic.runner.v1.ExchangeLaunchTokenRequest request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getExchangeLaunchTokenMethod(), getCallOptions()), request);
    }
  }

  private static final int METHODID_APPLY = 0;
  private static final int METHODID_CREATE = 1;
  private static final int METHODID_UPDATE = 2;
  private static final int METHODID_DELETE = 3;
  private static final int METHODID_SEND_COMMAND = 4;
  private static final int METHODID_STOP = 5;
  private static final int METHODID_CREATE_LAUNCH_TOKEN = 6;
  private static final int METHODID_EXCHANGE_LAUNCH_TOKEN = 7;
  private static final int METHODID_CONNECT = 8;

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
        case METHODID_APPLY:
          serviceImpl.apply((ai.stigmer.agentic.runner.v1.Runner) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.agentic.runner.v1.Runner>) responseObserver);
          break;
        case METHODID_CREATE:
          serviceImpl.create((ai.stigmer.agentic.runner.v1.Runner) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.agentic.runner.v1.Runner>) responseObserver);
          break;
        case METHODID_UPDATE:
          serviceImpl.update((ai.stigmer.agentic.runner.v1.Runner) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.agentic.runner.v1.Runner>) responseObserver);
          break;
        case METHODID_DELETE:
          serviceImpl.delete((ai.stigmer.agentic.runner.v1.RunnerId) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.agentic.runner.v1.Runner>) responseObserver);
          break;
        case METHODID_SEND_COMMAND:
          serviceImpl.sendCommand((ai.stigmer.agentic.runner.v1.RunnerSendCommandInput) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.agentic.runner.v1.RunnerCommandResponse>) responseObserver);
          break;
        case METHODID_STOP:
          serviceImpl.stop((ai.stigmer.agentic.runner.v1.RunnerStopInput) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.agentic.runner.v1.Runner>) responseObserver);
          break;
        case METHODID_CREATE_LAUNCH_TOKEN:
          serviceImpl.createLaunchToken((ai.stigmer.agentic.runner.v1.CreateLaunchTokenRequest) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.agentic.runner.v1.CreateLaunchTokenResponse>) responseObserver);
          break;
        case METHODID_EXCHANGE_LAUNCH_TOKEN:
          serviceImpl.exchangeLaunchToken((ai.stigmer.agentic.runner.v1.ExchangeLaunchTokenRequest) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.agentic.runner.v1.ExchangeLaunchTokenResponse>) responseObserver);
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
        case METHODID_CONNECT:
          return (io.grpc.stub.StreamObserver<Req>) serviceImpl.connect(
              (io.grpc.stub.StreamObserver<ai.stigmer.agentic.runner.v1.RunnerStreamServerMessage>) responseObserver);
        default:
          throw new AssertionError();
      }
    }
  }

  public static final io.grpc.ServerServiceDefinition bindService(AsyncService service) {
    return io.grpc.ServerServiceDefinition.builder(getServiceDescriptor())
        .addMethod(
          getApplyMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.agentic.runner.v1.Runner,
              ai.stigmer.agentic.runner.v1.Runner>(
                service, METHODID_APPLY)))
        .addMethod(
          getCreateMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.agentic.runner.v1.Runner,
              ai.stigmer.agentic.runner.v1.Runner>(
                service, METHODID_CREATE)))
        .addMethod(
          getUpdateMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.agentic.runner.v1.Runner,
              ai.stigmer.agentic.runner.v1.Runner>(
                service, METHODID_UPDATE)))
        .addMethod(
          getDeleteMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.agentic.runner.v1.RunnerId,
              ai.stigmer.agentic.runner.v1.Runner>(
                service, METHODID_DELETE)))
        .addMethod(
          getSendCommandMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.agentic.runner.v1.RunnerSendCommandInput,
              ai.stigmer.agentic.runner.v1.RunnerCommandResponse>(
                service, METHODID_SEND_COMMAND)))
        .addMethod(
          getStopMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.agentic.runner.v1.RunnerStopInput,
              ai.stigmer.agentic.runner.v1.Runner>(
                service, METHODID_STOP)))
        .addMethod(
          getConnectMethod(),
          io.grpc.stub.ServerCalls.asyncBidiStreamingCall(
            new MethodHandlers<
              ai.stigmer.agentic.runner.v1.RunnerStreamClientMessage,
              ai.stigmer.agentic.runner.v1.RunnerStreamServerMessage>(
                service, METHODID_CONNECT)))
        .addMethod(
          getCreateLaunchTokenMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.agentic.runner.v1.CreateLaunchTokenRequest,
              ai.stigmer.agentic.runner.v1.CreateLaunchTokenResponse>(
                service, METHODID_CREATE_LAUNCH_TOKEN)))
        .addMethod(
          getExchangeLaunchTokenMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.agentic.runner.v1.ExchangeLaunchTokenRequest,
              ai.stigmer.agentic.runner.v1.ExchangeLaunchTokenResponse>(
                service, METHODID_EXCHANGE_LAUNCH_TOKEN)))
        .build();
  }

  private static abstract class RunnerCommandControllerBaseDescriptorSupplier
      implements io.grpc.protobuf.ProtoFileDescriptorSupplier, io.grpc.protobuf.ProtoServiceDescriptorSupplier {
    RunnerCommandControllerBaseDescriptorSupplier() {}

    @java.lang.Override
    public com.google.protobuf.Descriptors.FileDescriptor getFileDescriptor() {
      return ai.stigmer.agentic.runner.v1.CommandProto.getDescriptor();
    }

    @java.lang.Override
    public com.google.protobuf.Descriptors.ServiceDescriptor getServiceDescriptor() {
      return getFileDescriptor().findServiceByName("RunnerCommandController");
    }
  }

  private static final class RunnerCommandControllerFileDescriptorSupplier
      extends RunnerCommandControllerBaseDescriptorSupplier {
    RunnerCommandControllerFileDescriptorSupplier() {}
  }

  private static final class RunnerCommandControllerMethodDescriptorSupplier
      extends RunnerCommandControllerBaseDescriptorSupplier
      implements io.grpc.protobuf.ProtoMethodDescriptorSupplier {
    private final java.lang.String methodName;

    RunnerCommandControllerMethodDescriptorSupplier(java.lang.String methodName) {
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
      synchronized (RunnerCommandControllerGrpc.class) {
        result = serviceDescriptor;
        if (result == null) {
          serviceDescriptor = result = io.grpc.ServiceDescriptor.newBuilder(SERVICE_NAME)
              .setSchemaDescriptor(new RunnerCommandControllerFileDescriptorSupplier())
              .addMethod(getApplyMethod())
              .addMethod(getCreateMethod())
              .addMethod(getUpdateMethod())
              .addMethod(getDeleteMethod())
              .addMethod(getSendCommandMethod())
              .addMethod(getStopMethod())
              .addMethod(getConnectMethod())
              .addMethod(getCreateLaunchTokenMethod())
              .addMethod(getExchangeLaunchTokenMethod())
              .build();
        }
      }
    }
    return result;
  }
}
