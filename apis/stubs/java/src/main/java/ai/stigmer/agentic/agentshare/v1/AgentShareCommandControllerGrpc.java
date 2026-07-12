package ai.stigmer.agentic.agentshare.v1;

import static io.grpc.MethodDescriptor.generateFullMethodName;

/**
 * <pre>
 * AgentShareCommandController handles write operations for agent shares.
 * </pre>
 */
@io.grpc.stub.annotations.GrpcGenerated
public final class AgentShareCommandControllerGrpc {

  private AgentShareCommandControllerGrpc() {}

  public static final java.lang.String SERVICE_NAME = "ai.stigmer.agentic.agentshare.v1.AgentShareCommandController";

  // Static method descriptors that strictly reflect the proto.
  private static volatile io.grpc.MethodDescriptor<ai.stigmer.agentic.agentshare.v1.AgentShare,
      ai.stigmer.agentic.agentshare.v1.AgentShare> getApplyMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "apply",
      requestType = ai.stigmer.agentic.agentshare.v1.AgentShare.class,
      responseType = ai.stigmer.agentic.agentshare.v1.AgentShare.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.agentic.agentshare.v1.AgentShare,
      ai.stigmer.agentic.agentshare.v1.AgentShare> getApplyMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.agentic.agentshare.v1.AgentShare, ai.stigmer.agentic.agentshare.v1.AgentShare> getApplyMethod;
    if ((getApplyMethod = AgentShareCommandControllerGrpc.getApplyMethod) == null) {
      synchronized (AgentShareCommandControllerGrpc.class) {
        if ((getApplyMethod = AgentShareCommandControllerGrpc.getApplyMethod) == null) {
          AgentShareCommandControllerGrpc.getApplyMethod = getApplyMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.agentic.agentshare.v1.AgentShare, ai.stigmer.agentic.agentshare.v1.AgentShare>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "apply"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.agentshare.v1.AgentShare.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.agentshare.v1.AgentShare.getDefaultInstance()))
              .setSchemaDescriptor(new AgentShareCommandControllerMethodDescriptorSupplier("apply"))
              .build();
        }
      }
    }
    return getApplyMethod;
  }

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.agentic.agentshare.v1.AgentShare,
      ai.stigmer.agentic.agentshare.v1.AgentShare> getCreateMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "create",
      requestType = ai.stigmer.agentic.agentshare.v1.AgentShare.class,
      responseType = ai.stigmer.agentic.agentshare.v1.AgentShare.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.agentic.agentshare.v1.AgentShare,
      ai.stigmer.agentic.agentshare.v1.AgentShare> getCreateMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.agentic.agentshare.v1.AgentShare, ai.stigmer.agentic.agentshare.v1.AgentShare> getCreateMethod;
    if ((getCreateMethod = AgentShareCommandControllerGrpc.getCreateMethod) == null) {
      synchronized (AgentShareCommandControllerGrpc.class) {
        if ((getCreateMethod = AgentShareCommandControllerGrpc.getCreateMethod) == null) {
          AgentShareCommandControllerGrpc.getCreateMethod = getCreateMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.agentic.agentshare.v1.AgentShare, ai.stigmer.agentic.agentshare.v1.AgentShare>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "create"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.agentshare.v1.AgentShare.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.agentshare.v1.AgentShare.getDefaultInstance()))
              .setSchemaDescriptor(new AgentShareCommandControllerMethodDescriptorSupplier("create"))
              .build();
        }
      }
    }
    return getCreateMethod;
  }

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.agentic.agentshare.v1.AgentShare,
      ai.stigmer.agentic.agentshare.v1.AgentShare> getUpdateMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "update",
      requestType = ai.stigmer.agentic.agentshare.v1.AgentShare.class,
      responseType = ai.stigmer.agentic.agentshare.v1.AgentShare.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.agentic.agentshare.v1.AgentShare,
      ai.stigmer.agentic.agentshare.v1.AgentShare> getUpdateMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.agentic.agentshare.v1.AgentShare, ai.stigmer.agentic.agentshare.v1.AgentShare> getUpdateMethod;
    if ((getUpdateMethod = AgentShareCommandControllerGrpc.getUpdateMethod) == null) {
      synchronized (AgentShareCommandControllerGrpc.class) {
        if ((getUpdateMethod = AgentShareCommandControllerGrpc.getUpdateMethod) == null) {
          AgentShareCommandControllerGrpc.getUpdateMethod = getUpdateMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.agentic.agentshare.v1.AgentShare, ai.stigmer.agentic.agentshare.v1.AgentShare>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "update"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.agentshare.v1.AgentShare.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.agentshare.v1.AgentShare.getDefaultInstance()))
              .setSchemaDescriptor(new AgentShareCommandControllerMethodDescriptorSupplier("update"))
              .build();
        }
      }
    }
    return getUpdateMethod;
  }

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.agentic.agentshare.v1.RotateShareLinkInput,
      ai.stigmer.agentic.agentshare.v1.AgentShare> getRotateShareLinkMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "rotateShareLink",
      requestType = ai.stigmer.agentic.agentshare.v1.RotateShareLinkInput.class,
      responseType = ai.stigmer.agentic.agentshare.v1.AgentShare.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.agentic.agentshare.v1.RotateShareLinkInput,
      ai.stigmer.agentic.agentshare.v1.AgentShare> getRotateShareLinkMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.agentic.agentshare.v1.RotateShareLinkInput, ai.stigmer.agentic.agentshare.v1.AgentShare> getRotateShareLinkMethod;
    if ((getRotateShareLinkMethod = AgentShareCommandControllerGrpc.getRotateShareLinkMethod) == null) {
      synchronized (AgentShareCommandControllerGrpc.class) {
        if ((getRotateShareLinkMethod = AgentShareCommandControllerGrpc.getRotateShareLinkMethod) == null) {
          AgentShareCommandControllerGrpc.getRotateShareLinkMethod = getRotateShareLinkMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.agentic.agentshare.v1.RotateShareLinkInput, ai.stigmer.agentic.agentshare.v1.AgentShare>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "rotateShareLink"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.agentshare.v1.RotateShareLinkInput.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.agentshare.v1.AgentShare.getDefaultInstance()))
              .setSchemaDescriptor(new AgentShareCommandControllerMethodDescriptorSupplier("rotateShareLink"))
              .build();
        }
      }
    }
    return getRotateShareLinkMethod;
  }

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.agentic.agentshare.v1.AgentShareId,
      ai.stigmer.agentic.agentshare.v1.AgentShare> getDeleteMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "delete",
      requestType = ai.stigmer.agentic.agentshare.v1.AgentShareId.class,
      responseType = ai.stigmer.agentic.agentshare.v1.AgentShare.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.agentic.agentshare.v1.AgentShareId,
      ai.stigmer.agentic.agentshare.v1.AgentShare> getDeleteMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.agentic.agentshare.v1.AgentShareId, ai.stigmer.agentic.agentshare.v1.AgentShare> getDeleteMethod;
    if ((getDeleteMethod = AgentShareCommandControllerGrpc.getDeleteMethod) == null) {
      synchronized (AgentShareCommandControllerGrpc.class) {
        if ((getDeleteMethod = AgentShareCommandControllerGrpc.getDeleteMethod) == null) {
          AgentShareCommandControllerGrpc.getDeleteMethod = getDeleteMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.agentic.agentshare.v1.AgentShareId, ai.stigmer.agentic.agentshare.v1.AgentShare>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "delete"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.agentshare.v1.AgentShareId.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.agentshare.v1.AgentShare.getDefaultInstance()))
              .setSchemaDescriptor(new AgentShareCommandControllerMethodDescriptorSupplier("delete"))
              .build();
        }
      }
    }
    return getDeleteMethod;
  }

  /**
   * Creates a new async stub that supports all call types for the service
   */
  public static AgentShareCommandControllerStub newStub(io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<AgentShareCommandControllerStub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<AgentShareCommandControllerStub>() {
        @java.lang.Override
        public AgentShareCommandControllerStub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new AgentShareCommandControllerStub(channel, callOptions);
        }
      };
    return AgentShareCommandControllerStub.newStub(factory, channel);
  }

  /**
   * Creates a new blocking-style stub that supports all types of calls on the service
   */
  public static AgentShareCommandControllerBlockingV2Stub newBlockingV2Stub(
      io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<AgentShareCommandControllerBlockingV2Stub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<AgentShareCommandControllerBlockingV2Stub>() {
        @java.lang.Override
        public AgentShareCommandControllerBlockingV2Stub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new AgentShareCommandControllerBlockingV2Stub(channel, callOptions);
        }
      };
    return AgentShareCommandControllerBlockingV2Stub.newStub(factory, channel);
  }

  /**
   * Creates a new blocking-style stub that supports unary and streaming output calls on the service
   */
  public static AgentShareCommandControllerBlockingStub newBlockingStub(
      io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<AgentShareCommandControllerBlockingStub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<AgentShareCommandControllerBlockingStub>() {
        @java.lang.Override
        public AgentShareCommandControllerBlockingStub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new AgentShareCommandControllerBlockingStub(channel, callOptions);
        }
      };
    return AgentShareCommandControllerBlockingStub.newStub(factory, channel);
  }

  /**
   * Creates a new ListenableFuture-style stub that supports unary calls on the service
   */
  public static AgentShareCommandControllerFutureStub newFutureStub(
      io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<AgentShareCommandControllerFutureStub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<AgentShareCommandControllerFutureStub>() {
        @java.lang.Override
        public AgentShareCommandControllerFutureStub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new AgentShareCommandControllerFutureStub(channel, callOptions);
        }
      };
    return AgentShareCommandControllerFutureStub.newStub(factory, channel);
  }

  /**
   * <pre>
   * AgentShareCommandController handles write operations for agent shares.
   * </pre>
   */
  public interface AsyncService {

    /**
     * <pre>
     * Create or update an agent share.
     * &#64;internal
     * The authorization and state-operation are determined depending on
     * whether the share is going to be created or updated, which is resolved
     * as part of the request execution. The share slug defaults to the
     * referenced agent's slug when omitted.
     * </pre>
     */
    default void apply(ai.stigmer.agentic.agentshare.v1.AgentShare request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.agentshare.v1.AgentShare> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getApplyMethod(), responseObserver);
    }

    /**
     * <pre>
     * Create an agent share.
     * Enabling a share is a billing-affecting decision: conversations over
     * the hosted link consume the sharing organization's credits.
     * &#64;internal
     * Authorization: requires can_edit on the REFERENCED AGENT
     * (spec.agent_ref), checked in-handler — the same bar as the former
     * updateSharing RPC, since creating a channel broadens who can chat with
     * the agent runtime. The standard org-scoped create tuples (owner =
     * creator) are written for the share itself; no visibility tuples are
     * written for visitors (guest admission is app-level by design — see
     * AgentShareSpec). Phase A invariant enforced here: metadata.org must
     * equal spec.agent_ref.org.
     * </pre>
     */
    default void create(ai.stigmer.agentic.agentshare.v1.AgentShare request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.agentshare.v1.AgentShare> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getCreateMethod(), responseObserver);
    }

    /**
     * <pre>
     * Update an existing agent share.
     * Replaces the spec wholesale: a manifest that omits audience resets the
     * share to public, and one that omits environment_refs unbinds them
     * (fails closed). The slug and referenced agent are immutable.
     * &#64;internal
     * Authorization: requires can_edit permission on the agent share.
     * status.share_link_token is preserved verbatim (rotateShareLink is its
     * sole writer).
     * </pre>
     */
    default void update(ai.stigmer.agentic.agentshare.v1.AgentShare request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.agentshare.v1.AgentShare> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getUpdateMethod(), responseObserver);
    }

    /**
     * <pre>
     * Rotate the share's link token.
     * Generates a fresh server-side token for the share's hosted chat link.
     * The share URL becomes `/chat/&lt;org&gt;/&lt;slug&gt;?k=&lt;token&gt;` and the previous
     * link (tokened or plain) stops working immediately — including for
     * visitors mid-conversation. Use this to kill a leaked or over-shared
     * public link without disabling the share or changing its slug.
     * The token lives in status.share_link_token, so manifest applies never
     * reset it. Rotation affects public-audience shares only; org-audience
     * access is governed by live org membership instead.
     * &#64;internal
     * Authorization: requires can_edit on the agent share — the same bar as
     * update, since both control shared-link access. The handler is the sole
     * writer of status.share_link_token (server-generated entropy; clients
     * never supply the token).
     * </pre>
     */
    default void rotateShareLink(ai.stigmer.agentic.agentshare.v1.RotateShareLinkInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.agentshare.v1.AgentShare> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getRotateShareLinkMethod(), responseObserver);
    }

    /**
     * <pre>
     * Delete an agent share.
     * Full teardown of the channel: the hosted link stops resolving, live
     * guest tokens die on their next message, and the share's configuration
     * (origins, messages, credentials, link token) is gone. To pause serving
     * while keeping configuration, update the share with enabled=false
     * instead.
     * &#64;internal
     * Authorization: requires can_delete permission on the agent share. The
     * referenced agent is untouched.
     * </pre>
     */
    default void delete(ai.stigmer.agentic.agentshare.v1.AgentShareId request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.agentshare.v1.AgentShare> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getDeleteMethod(), responseObserver);
    }
  }

  /**
   * Base class for the server implementation of the service AgentShareCommandController.
   * <pre>
   * AgentShareCommandController handles write operations for agent shares.
   * </pre>
   */
  public static abstract class AgentShareCommandControllerImplBase
      implements io.grpc.BindableService, AsyncService {

    @java.lang.Override public final io.grpc.ServerServiceDefinition bindService() {
      return AgentShareCommandControllerGrpc.bindService(this);
    }
  }

  /**
   * A stub to allow clients to do asynchronous rpc calls to service AgentShareCommandController.
   * <pre>
   * AgentShareCommandController handles write operations for agent shares.
   * </pre>
   */
  public static final class AgentShareCommandControllerStub
      extends io.grpc.stub.AbstractAsyncStub<AgentShareCommandControllerStub> {
    private AgentShareCommandControllerStub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected AgentShareCommandControllerStub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new AgentShareCommandControllerStub(channel, callOptions);
    }

    /**
     * <pre>
     * Create or update an agent share.
     * &#64;internal
     * The authorization and state-operation are determined depending on
     * whether the share is going to be created or updated, which is resolved
     * as part of the request execution. The share slug defaults to the
     * referenced agent's slug when omitted.
     * </pre>
     */
    public void apply(ai.stigmer.agentic.agentshare.v1.AgentShare request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.agentshare.v1.AgentShare> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getApplyMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * Create an agent share.
     * Enabling a share is a billing-affecting decision: conversations over
     * the hosted link consume the sharing organization's credits.
     * &#64;internal
     * Authorization: requires can_edit on the REFERENCED AGENT
     * (spec.agent_ref), checked in-handler — the same bar as the former
     * updateSharing RPC, since creating a channel broadens who can chat with
     * the agent runtime. The standard org-scoped create tuples (owner =
     * creator) are written for the share itself; no visibility tuples are
     * written for visitors (guest admission is app-level by design — see
     * AgentShareSpec). Phase A invariant enforced here: metadata.org must
     * equal spec.agent_ref.org.
     * </pre>
     */
    public void create(ai.stigmer.agentic.agentshare.v1.AgentShare request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.agentshare.v1.AgentShare> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getCreateMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * Update an existing agent share.
     * Replaces the spec wholesale: a manifest that omits audience resets the
     * share to public, and one that omits environment_refs unbinds them
     * (fails closed). The slug and referenced agent are immutable.
     * &#64;internal
     * Authorization: requires can_edit permission on the agent share.
     * status.share_link_token is preserved verbatim (rotateShareLink is its
     * sole writer).
     * </pre>
     */
    public void update(ai.stigmer.agentic.agentshare.v1.AgentShare request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.agentshare.v1.AgentShare> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getUpdateMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * Rotate the share's link token.
     * Generates a fresh server-side token for the share's hosted chat link.
     * The share URL becomes `/chat/&lt;org&gt;/&lt;slug&gt;?k=&lt;token&gt;` and the previous
     * link (tokened or plain) stops working immediately — including for
     * visitors mid-conversation. Use this to kill a leaked or over-shared
     * public link without disabling the share or changing its slug.
     * The token lives in status.share_link_token, so manifest applies never
     * reset it. Rotation affects public-audience shares only; org-audience
     * access is governed by live org membership instead.
     * &#64;internal
     * Authorization: requires can_edit on the agent share — the same bar as
     * update, since both control shared-link access. The handler is the sole
     * writer of status.share_link_token (server-generated entropy; clients
     * never supply the token).
     * </pre>
     */
    public void rotateShareLink(ai.stigmer.agentic.agentshare.v1.RotateShareLinkInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.agentshare.v1.AgentShare> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getRotateShareLinkMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * Delete an agent share.
     * Full teardown of the channel: the hosted link stops resolving, live
     * guest tokens die on their next message, and the share's configuration
     * (origins, messages, credentials, link token) is gone. To pause serving
     * while keeping configuration, update the share with enabled=false
     * instead.
     * &#64;internal
     * Authorization: requires can_delete permission on the agent share. The
     * referenced agent is untouched.
     * </pre>
     */
    public void delete(ai.stigmer.agentic.agentshare.v1.AgentShareId request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.agentshare.v1.AgentShare> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getDeleteMethod(), getCallOptions()), request, responseObserver);
    }
  }

  /**
   * A stub to allow clients to do synchronous rpc calls to service AgentShareCommandController.
   * <pre>
   * AgentShareCommandController handles write operations for agent shares.
   * </pre>
   */
  public static final class AgentShareCommandControllerBlockingV2Stub
      extends io.grpc.stub.AbstractBlockingStub<AgentShareCommandControllerBlockingV2Stub> {
    private AgentShareCommandControllerBlockingV2Stub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected AgentShareCommandControllerBlockingV2Stub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new AgentShareCommandControllerBlockingV2Stub(channel, callOptions);
    }

    /**
     * <pre>
     * Create or update an agent share.
     * &#64;internal
     * The authorization and state-operation are determined depending on
     * whether the share is going to be created or updated, which is resolved
     * as part of the request execution. The share slug defaults to the
     * referenced agent's slug when omitted.
     * </pre>
     */
    public ai.stigmer.agentic.agentshare.v1.AgentShare apply(ai.stigmer.agentic.agentshare.v1.AgentShare request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getApplyMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Create an agent share.
     * Enabling a share is a billing-affecting decision: conversations over
     * the hosted link consume the sharing organization's credits.
     * &#64;internal
     * Authorization: requires can_edit on the REFERENCED AGENT
     * (spec.agent_ref), checked in-handler — the same bar as the former
     * updateSharing RPC, since creating a channel broadens who can chat with
     * the agent runtime. The standard org-scoped create tuples (owner =
     * creator) are written for the share itself; no visibility tuples are
     * written for visitors (guest admission is app-level by design — see
     * AgentShareSpec). Phase A invariant enforced here: metadata.org must
     * equal spec.agent_ref.org.
     * </pre>
     */
    public ai.stigmer.agentic.agentshare.v1.AgentShare create(ai.stigmer.agentic.agentshare.v1.AgentShare request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getCreateMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Update an existing agent share.
     * Replaces the spec wholesale: a manifest that omits audience resets the
     * share to public, and one that omits environment_refs unbinds them
     * (fails closed). The slug and referenced agent are immutable.
     * &#64;internal
     * Authorization: requires can_edit permission on the agent share.
     * status.share_link_token is preserved verbatim (rotateShareLink is its
     * sole writer).
     * </pre>
     */
    public ai.stigmer.agentic.agentshare.v1.AgentShare update(ai.stigmer.agentic.agentshare.v1.AgentShare request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getUpdateMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Rotate the share's link token.
     * Generates a fresh server-side token for the share's hosted chat link.
     * The share URL becomes `/chat/&lt;org&gt;/&lt;slug&gt;?k=&lt;token&gt;` and the previous
     * link (tokened or plain) stops working immediately — including for
     * visitors mid-conversation. Use this to kill a leaked or over-shared
     * public link without disabling the share or changing its slug.
     * The token lives in status.share_link_token, so manifest applies never
     * reset it. Rotation affects public-audience shares only; org-audience
     * access is governed by live org membership instead.
     * &#64;internal
     * Authorization: requires can_edit on the agent share — the same bar as
     * update, since both control shared-link access. The handler is the sole
     * writer of status.share_link_token (server-generated entropy; clients
     * never supply the token).
     * </pre>
     */
    public ai.stigmer.agentic.agentshare.v1.AgentShare rotateShareLink(ai.stigmer.agentic.agentshare.v1.RotateShareLinkInput request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getRotateShareLinkMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Delete an agent share.
     * Full teardown of the channel: the hosted link stops resolving, live
     * guest tokens die on their next message, and the share's configuration
     * (origins, messages, credentials, link token) is gone. To pause serving
     * while keeping configuration, update the share with enabled=false
     * instead.
     * &#64;internal
     * Authorization: requires can_delete permission on the agent share. The
     * referenced agent is untouched.
     * </pre>
     */
    public ai.stigmer.agentic.agentshare.v1.AgentShare delete(ai.stigmer.agentic.agentshare.v1.AgentShareId request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getDeleteMethod(), getCallOptions(), request);
    }
  }

  /**
   * A stub to allow clients to do limited synchronous rpc calls to service AgentShareCommandController.
   * <pre>
   * AgentShareCommandController handles write operations for agent shares.
   * </pre>
   */
  public static final class AgentShareCommandControllerBlockingStub
      extends io.grpc.stub.AbstractBlockingStub<AgentShareCommandControllerBlockingStub> {
    private AgentShareCommandControllerBlockingStub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected AgentShareCommandControllerBlockingStub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new AgentShareCommandControllerBlockingStub(channel, callOptions);
    }

    /**
     * <pre>
     * Create or update an agent share.
     * &#64;internal
     * The authorization and state-operation are determined depending on
     * whether the share is going to be created or updated, which is resolved
     * as part of the request execution. The share slug defaults to the
     * referenced agent's slug when omitted.
     * </pre>
     */
    public ai.stigmer.agentic.agentshare.v1.AgentShare apply(ai.stigmer.agentic.agentshare.v1.AgentShare request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getApplyMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Create an agent share.
     * Enabling a share is a billing-affecting decision: conversations over
     * the hosted link consume the sharing organization's credits.
     * &#64;internal
     * Authorization: requires can_edit on the REFERENCED AGENT
     * (spec.agent_ref), checked in-handler — the same bar as the former
     * updateSharing RPC, since creating a channel broadens who can chat with
     * the agent runtime. The standard org-scoped create tuples (owner =
     * creator) are written for the share itself; no visibility tuples are
     * written for visitors (guest admission is app-level by design — see
     * AgentShareSpec). Phase A invariant enforced here: metadata.org must
     * equal spec.agent_ref.org.
     * </pre>
     */
    public ai.stigmer.agentic.agentshare.v1.AgentShare create(ai.stigmer.agentic.agentshare.v1.AgentShare request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getCreateMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Update an existing agent share.
     * Replaces the spec wholesale: a manifest that omits audience resets the
     * share to public, and one that omits environment_refs unbinds them
     * (fails closed). The slug and referenced agent are immutable.
     * &#64;internal
     * Authorization: requires can_edit permission on the agent share.
     * status.share_link_token is preserved verbatim (rotateShareLink is its
     * sole writer).
     * </pre>
     */
    public ai.stigmer.agentic.agentshare.v1.AgentShare update(ai.stigmer.agentic.agentshare.v1.AgentShare request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getUpdateMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Rotate the share's link token.
     * Generates a fresh server-side token for the share's hosted chat link.
     * The share URL becomes `/chat/&lt;org&gt;/&lt;slug&gt;?k=&lt;token&gt;` and the previous
     * link (tokened or plain) stops working immediately — including for
     * visitors mid-conversation. Use this to kill a leaked or over-shared
     * public link without disabling the share or changing its slug.
     * The token lives in status.share_link_token, so manifest applies never
     * reset it. Rotation affects public-audience shares only; org-audience
     * access is governed by live org membership instead.
     * &#64;internal
     * Authorization: requires can_edit on the agent share — the same bar as
     * update, since both control shared-link access. The handler is the sole
     * writer of status.share_link_token (server-generated entropy; clients
     * never supply the token).
     * </pre>
     */
    public ai.stigmer.agentic.agentshare.v1.AgentShare rotateShareLink(ai.stigmer.agentic.agentshare.v1.RotateShareLinkInput request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getRotateShareLinkMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Delete an agent share.
     * Full teardown of the channel: the hosted link stops resolving, live
     * guest tokens die on their next message, and the share's configuration
     * (origins, messages, credentials, link token) is gone. To pause serving
     * while keeping configuration, update the share with enabled=false
     * instead.
     * &#64;internal
     * Authorization: requires can_delete permission on the agent share. The
     * referenced agent is untouched.
     * </pre>
     */
    public ai.stigmer.agentic.agentshare.v1.AgentShare delete(ai.stigmer.agentic.agentshare.v1.AgentShareId request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getDeleteMethod(), getCallOptions(), request);
    }
  }

  /**
   * A stub to allow clients to do ListenableFuture-style rpc calls to service AgentShareCommandController.
   * <pre>
   * AgentShareCommandController handles write operations for agent shares.
   * </pre>
   */
  public static final class AgentShareCommandControllerFutureStub
      extends io.grpc.stub.AbstractFutureStub<AgentShareCommandControllerFutureStub> {
    private AgentShareCommandControllerFutureStub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected AgentShareCommandControllerFutureStub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new AgentShareCommandControllerFutureStub(channel, callOptions);
    }

    /**
     * <pre>
     * Create or update an agent share.
     * &#64;internal
     * The authorization and state-operation are determined depending on
     * whether the share is going to be created or updated, which is resolved
     * as part of the request execution. The share slug defaults to the
     * referenced agent's slug when omitted.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.agentic.agentshare.v1.AgentShare> apply(
        ai.stigmer.agentic.agentshare.v1.AgentShare request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getApplyMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * Create an agent share.
     * Enabling a share is a billing-affecting decision: conversations over
     * the hosted link consume the sharing organization's credits.
     * &#64;internal
     * Authorization: requires can_edit on the REFERENCED AGENT
     * (spec.agent_ref), checked in-handler — the same bar as the former
     * updateSharing RPC, since creating a channel broadens who can chat with
     * the agent runtime. The standard org-scoped create tuples (owner =
     * creator) are written for the share itself; no visibility tuples are
     * written for visitors (guest admission is app-level by design — see
     * AgentShareSpec). Phase A invariant enforced here: metadata.org must
     * equal spec.agent_ref.org.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.agentic.agentshare.v1.AgentShare> create(
        ai.stigmer.agentic.agentshare.v1.AgentShare request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getCreateMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * Update an existing agent share.
     * Replaces the spec wholesale: a manifest that omits audience resets the
     * share to public, and one that omits environment_refs unbinds them
     * (fails closed). The slug and referenced agent are immutable.
     * &#64;internal
     * Authorization: requires can_edit permission on the agent share.
     * status.share_link_token is preserved verbatim (rotateShareLink is its
     * sole writer).
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.agentic.agentshare.v1.AgentShare> update(
        ai.stigmer.agentic.agentshare.v1.AgentShare request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getUpdateMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * Rotate the share's link token.
     * Generates a fresh server-side token for the share's hosted chat link.
     * The share URL becomes `/chat/&lt;org&gt;/&lt;slug&gt;?k=&lt;token&gt;` and the previous
     * link (tokened or plain) stops working immediately — including for
     * visitors mid-conversation. Use this to kill a leaked or over-shared
     * public link without disabling the share or changing its slug.
     * The token lives in status.share_link_token, so manifest applies never
     * reset it. Rotation affects public-audience shares only; org-audience
     * access is governed by live org membership instead.
     * &#64;internal
     * Authorization: requires can_edit on the agent share — the same bar as
     * update, since both control shared-link access. The handler is the sole
     * writer of status.share_link_token (server-generated entropy; clients
     * never supply the token).
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.agentic.agentshare.v1.AgentShare> rotateShareLink(
        ai.stigmer.agentic.agentshare.v1.RotateShareLinkInput request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getRotateShareLinkMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * Delete an agent share.
     * Full teardown of the channel: the hosted link stops resolving, live
     * guest tokens die on their next message, and the share's configuration
     * (origins, messages, credentials, link token) is gone. To pause serving
     * while keeping configuration, update the share with enabled=false
     * instead.
     * &#64;internal
     * Authorization: requires can_delete permission on the agent share. The
     * referenced agent is untouched.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.agentic.agentshare.v1.AgentShare> delete(
        ai.stigmer.agentic.agentshare.v1.AgentShareId request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getDeleteMethod(), getCallOptions()), request);
    }
  }

  private static final int METHODID_APPLY = 0;
  private static final int METHODID_CREATE = 1;
  private static final int METHODID_UPDATE = 2;
  private static final int METHODID_ROTATE_SHARE_LINK = 3;
  private static final int METHODID_DELETE = 4;

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
          serviceImpl.apply((ai.stigmer.agentic.agentshare.v1.AgentShare) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.agentic.agentshare.v1.AgentShare>) responseObserver);
          break;
        case METHODID_CREATE:
          serviceImpl.create((ai.stigmer.agentic.agentshare.v1.AgentShare) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.agentic.agentshare.v1.AgentShare>) responseObserver);
          break;
        case METHODID_UPDATE:
          serviceImpl.update((ai.stigmer.agentic.agentshare.v1.AgentShare) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.agentic.agentshare.v1.AgentShare>) responseObserver);
          break;
        case METHODID_ROTATE_SHARE_LINK:
          serviceImpl.rotateShareLink((ai.stigmer.agentic.agentshare.v1.RotateShareLinkInput) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.agentic.agentshare.v1.AgentShare>) responseObserver);
          break;
        case METHODID_DELETE:
          serviceImpl.delete((ai.stigmer.agentic.agentshare.v1.AgentShareId) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.agentic.agentshare.v1.AgentShare>) responseObserver);
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
          getApplyMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.agentic.agentshare.v1.AgentShare,
              ai.stigmer.agentic.agentshare.v1.AgentShare>(
                service, METHODID_APPLY)))
        .addMethod(
          getCreateMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.agentic.agentshare.v1.AgentShare,
              ai.stigmer.agentic.agentshare.v1.AgentShare>(
                service, METHODID_CREATE)))
        .addMethod(
          getUpdateMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.agentic.agentshare.v1.AgentShare,
              ai.stigmer.agentic.agentshare.v1.AgentShare>(
                service, METHODID_UPDATE)))
        .addMethod(
          getRotateShareLinkMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.agentic.agentshare.v1.RotateShareLinkInput,
              ai.stigmer.agentic.agentshare.v1.AgentShare>(
                service, METHODID_ROTATE_SHARE_LINK)))
        .addMethod(
          getDeleteMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.agentic.agentshare.v1.AgentShareId,
              ai.stigmer.agentic.agentshare.v1.AgentShare>(
                service, METHODID_DELETE)))
        .build();
  }

  private static abstract class AgentShareCommandControllerBaseDescriptorSupplier
      implements io.grpc.protobuf.ProtoFileDescriptorSupplier, io.grpc.protobuf.ProtoServiceDescriptorSupplier {
    AgentShareCommandControllerBaseDescriptorSupplier() {}

    @java.lang.Override
    public com.google.protobuf.Descriptors.FileDescriptor getFileDescriptor() {
      return ai.stigmer.agentic.agentshare.v1.CommandProto.getDescriptor();
    }

    @java.lang.Override
    public com.google.protobuf.Descriptors.ServiceDescriptor getServiceDescriptor() {
      return getFileDescriptor().findServiceByName("AgentShareCommandController");
    }
  }

  private static final class AgentShareCommandControllerFileDescriptorSupplier
      extends AgentShareCommandControllerBaseDescriptorSupplier {
    AgentShareCommandControllerFileDescriptorSupplier() {}
  }

  private static final class AgentShareCommandControllerMethodDescriptorSupplier
      extends AgentShareCommandControllerBaseDescriptorSupplier
      implements io.grpc.protobuf.ProtoMethodDescriptorSupplier {
    private final java.lang.String methodName;

    AgentShareCommandControllerMethodDescriptorSupplier(java.lang.String methodName) {
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
      synchronized (AgentShareCommandControllerGrpc.class) {
        result = serviceDescriptor;
        if (result == null) {
          serviceDescriptor = result = io.grpc.ServiceDescriptor.newBuilder(SERVICE_NAME)
              .setSchemaDescriptor(new AgentShareCommandControllerFileDescriptorSupplier())
              .addMethod(getApplyMethod())
              .addMethod(getCreateMethod())
              .addMethod(getUpdateMethod())
              .addMethod(getRotateShareLinkMethod())
              .addMethod(getDeleteMethod())
              .build();
        }
      }
    }
    return result;
  }
}
