package ai.stigmer.agentic.channel.v1;

import static io.grpc.MethodDescriptor.generateFullMethodName;

/**
 * <pre>
 * ChannelCommandController handles write operations for channels.
 * </pre>
 */
@io.grpc.stub.annotations.GrpcGenerated
public final class ChannelCommandControllerGrpc {

  private ChannelCommandControllerGrpc() {}

  public static final java.lang.String SERVICE_NAME = "ai.stigmer.agentic.channel.v1.ChannelCommandController";

  // Static method descriptors that strictly reflect the proto.
  private static volatile io.grpc.MethodDescriptor<ai.stigmer.agentic.channel.v1.Channel,
      ai.stigmer.agentic.channel.v1.Channel> getApplyMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "apply",
      requestType = ai.stigmer.agentic.channel.v1.Channel.class,
      responseType = ai.stigmer.agentic.channel.v1.Channel.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.agentic.channel.v1.Channel,
      ai.stigmer.agentic.channel.v1.Channel> getApplyMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.agentic.channel.v1.Channel, ai.stigmer.agentic.channel.v1.Channel> getApplyMethod;
    if ((getApplyMethod = ChannelCommandControllerGrpc.getApplyMethod) == null) {
      synchronized (ChannelCommandControllerGrpc.class) {
        if ((getApplyMethod = ChannelCommandControllerGrpc.getApplyMethod) == null) {
          ChannelCommandControllerGrpc.getApplyMethod = getApplyMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.agentic.channel.v1.Channel, ai.stigmer.agentic.channel.v1.Channel>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "apply"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.channel.v1.Channel.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.channel.v1.Channel.getDefaultInstance()))
              .setSchemaDescriptor(new ChannelCommandControllerMethodDescriptorSupplier("apply"))
              .build();
        }
      }
    }
    return getApplyMethod;
  }

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.agentic.channel.v1.Channel,
      ai.stigmer.agentic.channel.v1.Channel> getCreateMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "create",
      requestType = ai.stigmer.agentic.channel.v1.Channel.class,
      responseType = ai.stigmer.agentic.channel.v1.Channel.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.agentic.channel.v1.Channel,
      ai.stigmer.agentic.channel.v1.Channel> getCreateMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.agentic.channel.v1.Channel, ai.stigmer.agentic.channel.v1.Channel> getCreateMethod;
    if ((getCreateMethod = ChannelCommandControllerGrpc.getCreateMethod) == null) {
      synchronized (ChannelCommandControllerGrpc.class) {
        if ((getCreateMethod = ChannelCommandControllerGrpc.getCreateMethod) == null) {
          ChannelCommandControllerGrpc.getCreateMethod = getCreateMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.agentic.channel.v1.Channel, ai.stigmer.agentic.channel.v1.Channel>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "create"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.channel.v1.Channel.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.channel.v1.Channel.getDefaultInstance()))
              .setSchemaDescriptor(new ChannelCommandControllerMethodDescriptorSupplier("create"))
              .build();
        }
      }
    }
    return getCreateMethod;
  }

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.agentic.channel.v1.UpdateChannelInput,
      ai.stigmer.agentic.channel.v1.Channel> getUpdateMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "update",
      requestType = ai.stigmer.agentic.channel.v1.UpdateChannelInput.class,
      responseType = ai.stigmer.agentic.channel.v1.Channel.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.agentic.channel.v1.UpdateChannelInput,
      ai.stigmer.agentic.channel.v1.Channel> getUpdateMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.agentic.channel.v1.UpdateChannelInput, ai.stigmer.agentic.channel.v1.Channel> getUpdateMethod;
    if ((getUpdateMethod = ChannelCommandControllerGrpc.getUpdateMethod) == null) {
      synchronized (ChannelCommandControllerGrpc.class) {
        if ((getUpdateMethod = ChannelCommandControllerGrpc.getUpdateMethod) == null) {
          ChannelCommandControllerGrpc.getUpdateMethod = getUpdateMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.agentic.channel.v1.UpdateChannelInput, ai.stigmer.agentic.channel.v1.Channel>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "update"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.channel.v1.UpdateChannelInput.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.channel.v1.Channel.getDefaultInstance()))
              .setSchemaDescriptor(new ChannelCommandControllerMethodDescriptorSupplier("update"))
              .build();
        }
      }
    }
    return getUpdateMethod;
  }

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.commons.apiresource.RenameInput,
      ai.stigmer.agentic.channel.v1.Channel> getRenameMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "rename",
      requestType = ai.stigmer.commons.apiresource.RenameInput.class,
      responseType = ai.stigmer.agentic.channel.v1.Channel.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.commons.apiresource.RenameInput,
      ai.stigmer.agentic.channel.v1.Channel> getRenameMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.commons.apiresource.RenameInput, ai.stigmer.agentic.channel.v1.Channel> getRenameMethod;
    if ((getRenameMethod = ChannelCommandControllerGrpc.getRenameMethod) == null) {
      synchronized (ChannelCommandControllerGrpc.class) {
        if ((getRenameMethod = ChannelCommandControllerGrpc.getRenameMethod) == null) {
          ChannelCommandControllerGrpc.getRenameMethod = getRenameMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.commons.apiresource.RenameInput, ai.stigmer.agentic.channel.v1.Channel>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "rename"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.commons.apiresource.RenameInput.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.channel.v1.Channel.getDefaultInstance()))
              .setSchemaDescriptor(new ChannelCommandControllerMethodDescriptorSupplier("rename"))
              .build();
        }
      }
    }
    return getRenameMethod;
  }

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.agentic.channel.v1.RotateChannelLinkInput,
      ai.stigmer.agentic.channel.v1.Channel> getRotateLinkMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "rotateLink",
      requestType = ai.stigmer.agentic.channel.v1.RotateChannelLinkInput.class,
      responseType = ai.stigmer.agentic.channel.v1.Channel.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.agentic.channel.v1.RotateChannelLinkInput,
      ai.stigmer.agentic.channel.v1.Channel> getRotateLinkMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.agentic.channel.v1.RotateChannelLinkInput, ai.stigmer.agentic.channel.v1.Channel> getRotateLinkMethod;
    if ((getRotateLinkMethod = ChannelCommandControllerGrpc.getRotateLinkMethod) == null) {
      synchronized (ChannelCommandControllerGrpc.class) {
        if ((getRotateLinkMethod = ChannelCommandControllerGrpc.getRotateLinkMethod) == null) {
          ChannelCommandControllerGrpc.getRotateLinkMethod = getRotateLinkMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.agentic.channel.v1.RotateChannelLinkInput, ai.stigmer.agentic.channel.v1.Channel>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "rotateLink"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.channel.v1.RotateChannelLinkInput.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.channel.v1.Channel.getDefaultInstance()))
              .setSchemaDescriptor(new ChannelCommandControllerMethodDescriptorSupplier("rotateLink"))
              .build();
        }
      }
    }
    return getRotateLinkMethod;
  }

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.agentic.channel.v1.InitiateChannelInstallInput,
      ai.stigmer.agentic.channel.v1.InitiateChannelInstallOutput> getInitiateInstallMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "initiateInstall",
      requestType = ai.stigmer.agentic.channel.v1.InitiateChannelInstallInput.class,
      responseType = ai.stigmer.agentic.channel.v1.InitiateChannelInstallOutput.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.agentic.channel.v1.InitiateChannelInstallInput,
      ai.stigmer.agentic.channel.v1.InitiateChannelInstallOutput> getInitiateInstallMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.agentic.channel.v1.InitiateChannelInstallInput, ai.stigmer.agentic.channel.v1.InitiateChannelInstallOutput> getInitiateInstallMethod;
    if ((getInitiateInstallMethod = ChannelCommandControllerGrpc.getInitiateInstallMethod) == null) {
      synchronized (ChannelCommandControllerGrpc.class) {
        if ((getInitiateInstallMethod = ChannelCommandControllerGrpc.getInitiateInstallMethod) == null) {
          ChannelCommandControllerGrpc.getInitiateInstallMethod = getInitiateInstallMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.agentic.channel.v1.InitiateChannelInstallInput, ai.stigmer.agentic.channel.v1.InitiateChannelInstallOutput>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "initiateInstall"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.channel.v1.InitiateChannelInstallInput.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.channel.v1.InitiateChannelInstallOutput.getDefaultInstance()))
              .setSchemaDescriptor(new ChannelCommandControllerMethodDescriptorSupplier("initiateInstall"))
              .build();
        }
      }
    }
    return getInitiateInstallMethod;
  }

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.agentic.channel.v1.CompleteChannelInstallInput,
      ai.stigmer.agentic.channel.v1.Channel> getCompleteInstallMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "completeInstall",
      requestType = ai.stigmer.agentic.channel.v1.CompleteChannelInstallInput.class,
      responseType = ai.stigmer.agentic.channel.v1.Channel.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.agentic.channel.v1.CompleteChannelInstallInput,
      ai.stigmer.agentic.channel.v1.Channel> getCompleteInstallMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.agentic.channel.v1.CompleteChannelInstallInput, ai.stigmer.agentic.channel.v1.Channel> getCompleteInstallMethod;
    if ((getCompleteInstallMethod = ChannelCommandControllerGrpc.getCompleteInstallMethod) == null) {
      synchronized (ChannelCommandControllerGrpc.class) {
        if ((getCompleteInstallMethod = ChannelCommandControllerGrpc.getCompleteInstallMethod) == null) {
          ChannelCommandControllerGrpc.getCompleteInstallMethod = getCompleteInstallMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.agentic.channel.v1.CompleteChannelInstallInput, ai.stigmer.agentic.channel.v1.Channel>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "completeInstall"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.channel.v1.CompleteChannelInstallInput.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.channel.v1.Channel.getDefaultInstance()))
              .setSchemaDescriptor(new ChannelCommandControllerMethodDescriptorSupplier("completeInstall"))
              .build();
        }
      }
    }
    return getCompleteInstallMethod;
  }

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.agentic.channel.v1.ChannelId,
      ai.stigmer.agentic.channel.v1.Channel> getDeleteMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "delete",
      requestType = ai.stigmer.agentic.channel.v1.ChannelId.class,
      responseType = ai.stigmer.agentic.channel.v1.Channel.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.agentic.channel.v1.ChannelId,
      ai.stigmer.agentic.channel.v1.Channel> getDeleteMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.agentic.channel.v1.ChannelId, ai.stigmer.agentic.channel.v1.Channel> getDeleteMethod;
    if ((getDeleteMethod = ChannelCommandControllerGrpc.getDeleteMethod) == null) {
      synchronized (ChannelCommandControllerGrpc.class) {
        if ((getDeleteMethod = ChannelCommandControllerGrpc.getDeleteMethod) == null) {
          ChannelCommandControllerGrpc.getDeleteMethod = getDeleteMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.agentic.channel.v1.ChannelId, ai.stigmer.agentic.channel.v1.Channel>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "delete"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.channel.v1.ChannelId.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.channel.v1.Channel.getDefaultInstance()))
              .setSchemaDescriptor(new ChannelCommandControllerMethodDescriptorSupplier("delete"))
              .build();
        }
      }
    }
    return getDeleteMethod;
  }

  /**
   * Creates a new async stub that supports all call types for the service
   */
  public static ChannelCommandControllerStub newStub(io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<ChannelCommandControllerStub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<ChannelCommandControllerStub>() {
        @java.lang.Override
        public ChannelCommandControllerStub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new ChannelCommandControllerStub(channel, callOptions);
        }
      };
    return ChannelCommandControllerStub.newStub(factory, channel);
  }

  /**
   * Creates a new blocking-style stub that supports all types of calls on the service
   */
  public static ChannelCommandControllerBlockingV2Stub newBlockingV2Stub(
      io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<ChannelCommandControllerBlockingV2Stub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<ChannelCommandControllerBlockingV2Stub>() {
        @java.lang.Override
        public ChannelCommandControllerBlockingV2Stub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new ChannelCommandControllerBlockingV2Stub(channel, callOptions);
        }
      };
    return ChannelCommandControllerBlockingV2Stub.newStub(factory, channel);
  }

  /**
   * Creates a new blocking-style stub that supports unary and streaming output calls on the service
   */
  public static ChannelCommandControllerBlockingStub newBlockingStub(
      io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<ChannelCommandControllerBlockingStub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<ChannelCommandControllerBlockingStub>() {
        @java.lang.Override
        public ChannelCommandControllerBlockingStub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new ChannelCommandControllerBlockingStub(channel, callOptions);
        }
      };
    return ChannelCommandControllerBlockingStub.newStub(factory, channel);
  }

  /**
   * Creates a new ListenableFuture-style stub that supports unary calls on the service
   */
  public static ChannelCommandControllerFutureStub newFutureStub(
      io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<ChannelCommandControllerFutureStub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<ChannelCommandControllerFutureStub>() {
        @java.lang.Override
        public ChannelCommandControllerFutureStub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new ChannelCommandControllerFutureStub(channel, callOptions);
        }
      };
    return ChannelCommandControllerFutureStub.newStub(factory, channel);
  }

  /**
   * <pre>
   * ChannelCommandController handles write operations for channels.
   * </pre>
   */
  public interface AsyncService {

    /**
     * <pre>
     * Create or update a channel.
     * A request that carries metadata.id of a channel in its organization
     * updates that channel, and its slug changes only through rename. A slug
     * the channel was renamed away from, named without the channel's id, is
     * refused with FAILED_PRECONDITION carrying a google.rpc.ErrorInfo detail
     * (domain "stigmer.ai"), because a write by a name that stops resolving
     * after 30 days would later make a second channel:
     *   - SLUG_RENAMED — the slug was renamed: it still leads to the same
     *     channel for reading, but a write names its current slug. Metadata:
     *     slug (the one the request named).
     * </pre>
     */
    default void apply(ai.stigmer.agentic.channel.v1.Channel request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.channel.v1.Channel> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getApplyMethod(), responseObserver);
    }

    /**
     * <pre>
     * Create a channel.
     * Making a channel is a spending decision: conversations arriving over it
     * call models on the channel's organization's own provider keys, and the
     * providers bill the organization for them.
     * A channel created without a name takes the slug `&lt;agent slug&gt;-&lt;type&gt;`
     * (for example `support-agent-web`) and the name `&lt;agent name&gt; (&lt;Type&gt;)`.
     * A slug another channel of the organization holds is refused with
     * ALREADY_EXISTS. A slug another channel was renamed away from, which
     * still leads to it for 30 days, is refused with ALREADY_EXISTS carrying a
     * google.rpc.ErrorInfo detail (domain "stigmer.ai"):
     *   - SLUG_RESERVED — another channel held the slug until a recent
     *     rename, and it still leads there. Metadata: slug.
     * </pre>
     */
    default void create(ai.stigmer.agentic.channel.v1.Channel request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.channel.v1.Channel> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getCreateMethod(), responseObserver);
    }

    /**
     * <pre>
     * Update a channel: the fields update_mask names change, every other
     * field keeps its stored value.
     * The referenced agent and the channel's type are immutable; status
     * (the link token, install facts) is never touched by updates. A mask
     * naming a web channel's audience or the vaults replaces them whole: an
     * empty audience makes the link organization-only, and empty vaults
     * detach them (both fail closed).
     * resource.metadata.id names the channel; apply finds one by slug. The
     * slug changes only through rename, and a mask naming a field another
     * door owns, or a path the channel does not have, is refused with
     * INVALID_ARGUMENT naming the path.
     * An update is refused with ABORTED carrying a google.rpc.ErrorInfo detail
     * (domain "stigmer.ai"):
     *   - ETAG_MISMATCH — resource.metadata.etag is set and the channel changed
     *     since that etag was read: read it again and make the change again.
     *     No metadata.
     *   - WRITE_CONFLICT — the channel kept changing while the update was
     *     being saved: try again. No metadata.
     * </pre>
     */
    default void update(ai.stigmer.agentic.channel.v1.UpdateChannelInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.channel.v1.Channel> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getUpdateMethod(), responseObserver);
    }

    /**
     * <pre>
     * Rename a channel: change its slug, the name the CLI and getByReference
     * address it by.
     * The channel keeps its id, so everything that names it keeps working: a
     * web channel's chat link names its id and does not change, and every
     * answer names it by the new slug. The old slug keeps leading to the
     * channel for reading for 30 days, during which no other channel of the
     * organization can take it and this one can take it back; then it is
     * released. A write that names the old slug is refused with SLUG_RENAMED
     * (see apply). A slug another channel holds is refused with
     * ALREADY_EXISTS, and one another channel was recently renamed away from
     * with SLUG_RESERVED (see create).
     * </pre>
     */
    default void rename(ai.stigmer.commons.apiresource.RenameInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.channel.v1.Channel> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getRenameMethod(), responseObserver);
    }

    /**
     * <pre>
     * Rotate a web channel's link token.
     * Generates a fresh server-side token for the channel's hosted chat link.
     * The link becomes `/chat/&lt;channel id&gt;?k=&lt;token&gt;` and the previous link
     * (tokened or plain) stops working immediately, including for visitors
     * mid-conversation. Use this to kill a leaked or over-shared public link
     * without disabling or deleting the channel. A Slack or WhatsApp channel
     * has no link and is refused with FAILED_PRECONDITION.
     * The token lives in status.web.link_token, so manifest applies never
     * reset it. Rotation affects public-audience links only; org-audience
     * access is governed by live organization membership instead.
     * </pre>
     */
    default void rotateLink(ai.stigmer.agentic.channel.v1.RotateChannelLinkInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.channel.v1.Channel> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getRotateLinkMethod(), responseObserver);
    }

    /**
     * <pre>
     * Start a Slack or WhatsApp channel's install flow.
     * For redirect-installed providers (Slack) the output carries the
     * provider authorization URL to redirect the installing user to, plus
     * the single-use state that completeInstall verifies. For
     * direct-installed providers (WhatsApp) the install runs to completion
     * inside this RPC and the output carries completed=true instead. A web
     * channel has nothing to install and is refused with
     * FAILED_PRECONDITION.
     * Refusals a client should branch on carry a google.rpc.ErrorInfo
     * detail (domain "stigmer.ai") on the standard grpc-status-details-bin
     * trailer, alongside the human-readable FAILED_PRECONDITION message:
     *   - WHATSAPP_NUMBER_ALREADY_CONNECTED — the WhatsApp Business number
     *     already serves an agent through this channel app (one agent per
     *     number per app). Metadata: display_phone_number (the occupied
     *     number), channel_app_id (the serving app).
     * </pre>
     */
    default void initiateInstall(ai.stigmer.agentic.channel.v1.InitiateChannelInstallInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.channel.v1.InitiateChannelInstallOutput> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getInitiateInstallMethod(), responseObserver);
    }

    /**
     * <pre>
     * Complete a Slack channel's install flow.
     * Called by the console after the provider's consent redirect, with the
     * state from initiateInstall and the provider's authorization code. On
     * success the channel's status carries the install facts and the
     * channel begins serving (subject to spec.enabled). A web channel has
     * nothing to install and is refused with FAILED_PRECONDITION.
     * Refusals a client should branch on carry a google.rpc.ErrorInfo
     * detail (domain "stigmer.ai") on the standard grpc-status-details-bin
     * trailer, alongside the human-readable FAILED_PRECONDITION message:
     *   - SLACK_WORKSPACE_ALREADY_CONNECTED — the workspace already hosts
     *     an agent through this serving app (one agent per workspace per
     *     app). Metadata: team_name (the occupied workspace),
     *     channel_app_id (the serving app; empty = platform app).
     *   - CHANNEL_INSTALL_STATE_INVALID — the state parameter is missing,
     *     expired, or replayed; restart the install.
     *   - SLACK_ENTERPRISE_INSTALL_UNSUPPORTED — an Enterprise Grid
     *     org-wide install was attempted; install into a single workspace.
     * Other refusals (unconfigured deployment, provider-refused code
     * exchange) carry no reason: their message is the interface.
     * </pre>
     */
    default void completeInstall(ai.stigmer.agentic.channel.v1.CompleteChannelInstallInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.channel.v1.Channel> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getCompleteInstallMethod(), responseObserver);
    }

    /**
     * <pre>
     * Delete a channel.
     * Full teardown: a web channel's link stops resolving and live guest
     * tokens die on their next message; a Slack or WhatsApp channel's inbound
     * events stop resolving, pending deliveries are abandoned, and its sealed
     * provider credentials are deleted. The channel's configuration is gone.
     * To pause serving while keeping it, update the channel with
     * enabled=false instead.
     * </pre>
     */
    default void delete(ai.stigmer.agentic.channel.v1.ChannelId request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.channel.v1.Channel> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getDeleteMethod(), responseObserver);
    }
  }

  /**
   * Base class for the server implementation of the service ChannelCommandController.
   * <pre>
   * ChannelCommandController handles write operations for channels.
   * </pre>
   */
  public static abstract class ChannelCommandControllerImplBase
      implements io.grpc.BindableService, AsyncService {

    @java.lang.Override public final io.grpc.ServerServiceDefinition bindService() {
      return ChannelCommandControllerGrpc.bindService(this);
    }
  }

  /**
   * A stub to allow clients to do asynchronous rpc calls to service ChannelCommandController.
   * <pre>
   * ChannelCommandController handles write operations for channels.
   * </pre>
   */
  public static final class ChannelCommandControllerStub
      extends io.grpc.stub.AbstractAsyncStub<ChannelCommandControllerStub> {
    private ChannelCommandControllerStub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected ChannelCommandControllerStub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new ChannelCommandControllerStub(channel, callOptions);
    }

    /**
     * <pre>
     * Create or update a channel.
     * A request that carries metadata.id of a channel in its organization
     * updates that channel, and its slug changes only through rename. A slug
     * the channel was renamed away from, named without the channel's id, is
     * refused with FAILED_PRECONDITION carrying a google.rpc.ErrorInfo detail
     * (domain "stigmer.ai"), because a write by a name that stops resolving
     * after 30 days would later make a second channel:
     *   - SLUG_RENAMED — the slug was renamed: it still leads to the same
     *     channel for reading, but a write names its current slug. Metadata:
     *     slug (the one the request named).
     * </pre>
     */
    public void apply(ai.stigmer.agentic.channel.v1.Channel request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.channel.v1.Channel> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getApplyMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * Create a channel.
     * Making a channel is a spending decision: conversations arriving over it
     * call models on the channel's organization's own provider keys, and the
     * providers bill the organization for them.
     * A channel created without a name takes the slug `&lt;agent slug&gt;-&lt;type&gt;`
     * (for example `support-agent-web`) and the name `&lt;agent name&gt; (&lt;Type&gt;)`.
     * A slug another channel of the organization holds is refused with
     * ALREADY_EXISTS. A slug another channel was renamed away from, which
     * still leads to it for 30 days, is refused with ALREADY_EXISTS carrying a
     * google.rpc.ErrorInfo detail (domain "stigmer.ai"):
     *   - SLUG_RESERVED — another channel held the slug until a recent
     *     rename, and it still leads there. Metadata: slug.
     * </pre>
     */
    public void create(ai.stigmer.agentic.channel.v1.Channel request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.channel.v1.Channel> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getCreateMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * Update a channel: the fields update_mask names change, every other
     * field keeps its stored value.
     * The referenced agent and the channel's type are immutable; status
     * (the link token, install facts) is never touched by updates. A mask
     * naming a web channel's audience or the vaults replaces them whole: an
     * empty audience makes the link organization-only, and empty vaults
     * detach them (both fail closed).
     * resource.metadata.id names the channel; apply finds one by slug. The
     * slug changes only through rename, and a mask naming a field another
     * door owns, or a path the channel does not have, is refused with
     * INVALID_ARGUMENT naming the path.
     * An update is refused with ABORTED carrying a google.rpc.ErrorInfo detail
     * (domain "stigmer.ai"):
     *   - ETAG_MISMATCH — resource.metadata.etag is set and the channel changed
     *     since that etag was read: read it again and make the change again.
     *     No metadata.
     *   - WRITE_CONFLICT — the channel kept changing while the update was
     *     being saved: try again. No metadata.
     * </pre>
     */
    public void update(ai.stigmer.agentic.channel.v1.UpdateChannelInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.channel.v1.Channel> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getUpdateMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * Rename a channel: change its slug, the name the CLI and getByReference
     * address it by.
     * The channel keeps its id, so everything that names it keeps working: a
     * web channel's chat link names its id and does not change, and every
     * answer names it by the new slug. The old slug keeps leading to the
     * channel for reading for 30 days, during which no other channel of the
     * organization can take it and this one can take it back; then it is
     * released. A write that names the old slug is refused with SLUG_RENAMED
     * (see apply). A slug another channel holds is refused with
     * ALREADY_EXISTS, and one another channel was recently renamed away from
     * with SLUG_RESERVED (see create).
     * </pre>
     */
    public void rename(ai.stigmer.commons.apiresource.RenameInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.channel.v1.Channel> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getRenameMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * Rotate a web channel's link token.
     * Generates a fresh server-side token for the channel's hosted chat link.
     * The link becomes `/chat/&lt;channel id&gt;?k=&lt;token&gt;` and the previous link
     * (tokened or plain) stops working immediately, including for visitors
     * mid-conversation. Use this to kill a leaked or over-shared public link
     * without disabling or deleting the channel. A Slack or WhatsApp channel
     * has no link and is refused with FAILED_PRECONDITION.
     * The token lives in status.web.link_token, so manifest applies never
     * reset it. Rotation affects public-audience links only; org-audience
     * access is governed by live organization membership instead.
     * </pre>
     */
    public void rotateLink(ai.stigmer.agentic.channel.v1.RotateChannelLinkInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.channel.v1.Channel> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getRotateLinkMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * Start a Slack or WhatsApp channel's install flow.
     * For redirect-installed providers (Slack) the output carries the
     * provider authorization URL to redirect the installing user to, plus
     * the single-use state that completeInstall verifies. For
     * direct-installed providers (WhatsApp) the install runs to completion
     * inside this RPC and the output carries completed=true instead. A web
     * channel has nothing to install and is refused with
     * FAILED_PRECONDITION.
     * Refusals a client should branch on carry a google.rpc.ErrorInfo
     * detail (domain "stigmer.ai") on the standard grpc-status-details-bin
     * trailer, alongside the human-readable FAILED_PRECONDITION message:
     *   - WHATSAPP_NUMBER_ALREADY_CONNECTED — the WhatsApp Business number
     *     already serves an agent through this channel app (one agent per
     *     number per app). Metadata: display_phone_number (the occupied
     *     number), channel_app_id (the serving app).
     * </pre>
     */
    public void initiateInstall(ai.stigmer.agentic.channel.v1.InitiateChannelInstallInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.channel.v1.InitiateChannelInstallOutput> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getInitiateInstallMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * Complete a Slack channel's install flow.
     * Called by the console after the provider's consent redirect, with the
     * state from initiateInstall and the provider's authorization code. On
     * success the channel's status carries the install facts and the
     * channel begins serving (subject to spec.enabled). A web channel has
     * nothing to install and is refused with FAILED_PRECONDITION.
     * Refusals a client should branch on carry a google.rpc.ErrorInfo
     * detail (domain "stigmer.ai") on the standard grpc-status-details-bin
     * trailer, alongside the human-readable FAILED_PRECONDITION message:
     *   - SLACK_WORKSPACE_ALREADY_CONNECTED — the workspace already hosts
     *     an agent through this serving app (one agent per workspace per
     *     app). Metadata: team_name (the occupied workspace),
     *     channel_app_id (the serving app; empty = platform app).
     *   - CHANNEL_INSTALL_STATE_INVALID — the state parameter is missing,
     *     expired, or replayed; restart the install.
     *   - SLACK_ENTERPRISE_INSTALL_UNSUPPORTED — an Enterprise Grid
     *     org-wide install was attempted; install into a single workspace.
     * Other refusals (unconfigured deployment, provider-refused code
     * exchange) carry no reason: their message is the interface.
     * </pre>
     */
    public void completeInstall(ai.stigmer.agentic.channel.v1.CompleteChannelInstallInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.channel.v1.Channel> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getCompleteInstallMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * Delete a channel.
     * Full teardown: a web channel's link stops resolving and live guest
     * tokens die on their next message; a Slack or WhatsApp channel's inbound
     * events stop resolving, pending deliveries are abandoned, and its sealed
     * provider credentials are deleted. The channel's configuration is gone.
     * To pause serving while keeping it, update the channel with
     * enabled=false instead.
     * </pre>
     */
    public void delete(ai.stigmer.agentic.channel.v1.ChannelId request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.channel.v1.Channel> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getDeleteMethod(), getCallOptions()), request, responseObserver);
    }
  }

  /**
   * A stub to allow clients to do synchronous rpc calls to service ChannelCommandController.
   * <pre>
   * ChannelCommandController handles write operations for channels.
   * </pre>
   */
  public static final class ChannelCommandControllerBlockingV2Stub
      extends io.grpc.stub.AbstractBlockingStub<ChannelCommandControllerBlockingV2Stub> {
    private ChannelCommandControllerBlockingV2Stub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected ChannelCommandControllerBlockingV2Stub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new ChannelCommandControllerBlockingV2Stub(channel, callOptions);
    }

    /**
     * <pre>
     * Create or update a channel.
     * A request that carries metadata.id of a channel in its organization
     * updates that channel, and its slug changes only through rename. A slug
     * the channel was renamed away from, named without the channel's id, is
     * refused with FAILED_PRECONDITION carrying a google.rpc.ErrorInfo detail
     * (domain "stigmer.ai"), because a write by a name that stops resolving
     * after 30 days would later make a second channel:
     *   - SLUG_RENAMED — the slug was renamed: it still leads to the same
     *     channel for reading, but a write names its current slug. Metadata:
     *     slug (the one the request named).
     * </pre>
     */
    public ai.stigmer.agentic.channel.v1.Channel apply(ai.stigmer.agentic.channel.v1.Channel request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getApplyMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Create a channel.
     * Making a channel is a spending decision: conversations arriving over it
     * call models on the channel's organization's own provider keys, and the
     * providers bill the organization for them.
     * A channel created without a name takes the slug `&lt;agent slug&gt;-&lt;type&gt;`
     * (for example `support-agent-web`) and the name `&lt;agent name&gt; (&lt;Type&gt;)`.
     * A slug another channel of the organization holds is refused with
     * ALREADY_EXISTS. A slug another channel was renamed away from, which
     * still leads to it for 30 days, is refused with ALREADY_EXISTS carrying a
     * google.rpc.ErrorInfo detail (domain "stigmer.ai"):
     *   - SLUG_RESERVED — another channel held the slug until a recent
     *     rename, and it still leads there. Metadata: slug.
     * </pre>
     */
    public ai.stigmer.agentic.channel.v1.Channel create(ai.stigmer.agentic.channel.v1.Channel request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getCreateMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Update a channel: the fields update_mask names change, every other
     * field keeps its stored value.
     * The referenced agent and the channel's type are immutable; status
     * (the link token, install facts) is never touched by updates. A mask
     * naming a web channel's audience or the vaults replaces them whole: an
     * empty audience makes the link organization-only, and empty vaults
     * detach them (both fail closed).
     * resource.metadata.id names the channel; apply finds one by slug. The
     * slug changes only through rename, and a mask naming a field another
     * door owns, or a path the channel does not have, is refused with
     * INVALID_ARGUMENT naming the path.
     * An update is refused with ABORTED carrying a google.rpc.ErrorInfo detail
     * (domain "stigmer.ai"):
     *   - ETAG_MISMATCH — resource.metadata.etag is set and the channel changed
     *     since that etag was read: read it again and make the change again.
     *     No metadata.
     *   - WRITE_CONFLICT — the channel kept changing while the update was
     *     being saved: try again. No metadata.
     * </pre>
     */
    public ai.stigmer.agentic.channel.v1.Channel update(ai.stigmer.agentic.channel.v1.UpdateChannelInput request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getUpdateMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Rename a channel: change its slug, the name the CLI and getByReference
     * address it by.
     * The channel keeps its id, so everything that names it keeps working: a
     * web channel's chat link names its id and does not change, and every
     * answer names it by the new slug. The old slug keeps leading to the
     * channel for reading for 30 days, during which no other channel of the
     * organization can take it and this one can take it back; then it is
     * released. A write that names the old slug is refused with SLUG_RENAMED
     * (see apply). A slug another channel holds is refused with
     * ALREADY_EXISTS, and one another channel was recently renamed away from
     * with SLUG_RESERVED (see create).
     * </pre>
     */
    public ai.stigmer.agentic.channel.v1.Channel rename(ai.stigmer.commons.apiresource.RenameInput request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getRenameMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Rotate a web channel's link token.
     * Generates a fresh server-side token for the channel's hosted chat link.
     * The link becomes `/chat/&lt;channel id&gt;?k=&lt;token&gt;` and the previous link
     * (tokened or plain) stops working immediately, including for visitors
     * mid-conversation. Use this to kill a leaked or over-shared public link
     * without disabling or deleting the channel. A Slack or WhatsApp channel
     * has no link and is refused with FAILED_PRECONDITION.
     * The token lives in status.web.link_token, so manifest applies never
     * reset it. Rotation affects public-audience links only; org-audience
     * access is governed by live organization membership instead.
     * </pre>
     */
    public ai.stigmer.agentic.channel.v1.Channel rotateLink(ai.stigmer.agentic.channel.v1.RotateChannelLinkInput request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getRotateLinkMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Start a Slack or WhatsApp channel's install flow.
     * For redirect-installed providers (Slack) the output carries the
     * provider authorization URL to redirect the installing user to, plus
     * the single-use state that completeInstall verifies. For
     * direct-installed providers (WhatsApp) the install runs to completion
     * inside this RPC and the output carries completed=true instead. A web
     * channel has nothing to install and is refused with
     * FAILED_PRECONDITION.
     * Refusals a client should branch on carry a google.rpc.ErrorInfo
     * detail (domain "stigmer.ai") on the standard grpc-status-details-bin
     * trailer, alongside the human-readable FAILED_PRECONDITION message:
     *   - WHATSAPP_NUMBER_ALREADY_CONNECTED — the WhatsApp Business number
     *     already serves an agent through this channel app (one agent per
     *     number per app). Metadata: display_phone_number (the occupied
     *     number), channel_app_id (the serving app).
     * </pre>
     */
    public ai.stigmer.agentic.channel.v1.InitiateChannelInstallOutput initiateInstall(ai.stigmer.agentic.channel.v1.InitiateChannelInstallInput request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getInitiateInstallMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Complete a Slack channel's install flow.
     * Called by the console after the provider's consent redirect, with the
     * state from initiateInstall and the provider's authorization code. On
     * success the channel's status carries the install facts and the
     * channel begins serving (subject to spec.enabled). A web channel has
     * nothing to install and is refused with FAILED_PRECONDITION.
     * Refusals a client should branch on carry a google.rpc.ErrorInfo
     * detail (domain "stigmer.ai") on the standard grpc-status-details-bin
     * trailer, alongside the human-readable FAILED_PRECONDITION message:
     *   - SLACK_WORKSPACE_ALREADY_CONNECTED — the workspace already hosts
     *     an agent through this serving app (one agent per workspace per
     *     app). Metadata: team_name (the occupied workspace),
     *     channel_app_id (the serving app; empty = platform app).
     *   - CHANNEL_INSTALL_STATE_INVALID — the state parameter is missing,
     *     expired, or replayed; restart the install.
     *   - SLACK_ENTERPRISE_INSTALL_UNSUPPORTED — an Enterprise Grid
     *     org-wide install was attempted; install into a single workspace.
     * Other refusals (unconfigured deployment, provider-refused code
     * exchange) carry no reason: their message is the interface.
     * </pre>
     */
    public ai.stigmer.agentic.channel.v1.Channel completeInstall(ai.stigmer.agentic.channel.v1.CompleteChannelInstallInput request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getCompleteInstallMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Delete a channel.
     * Full teardown: a web channel's link stops resolving and live guest
     * tokens die on their next message; a Slack or WhatsApp channel's inbound
     * events stop resolving, pending deliveries are abandoned, and its sealed
     * provider credentials are deleted. The channel's configuration is gone.
     * To pause serving while keeping it, update the channel with
     * enabled=false instead.
     * </pre>
     */
    public ai.stigmer.agentic.channel.v1.Channel delete(ai.stigmer.agentic.channel.v1.ChannelId request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getDeleteMethod(), getCallOptions(), request);
    }
  }

  /**
   * A stub to allow clients to do limited synchronous rpc calls to service ChannelCommandController.
   * <pre>
   * ChannelCommandController handles write operations for channels.
   * </pre>
   */
  public static final class ChannelCommandControllerBlockingStub
      extends io.grpc.stub.AbstractBlockingStub<ChannelCommandControllerBlockingStub> {
    private ChannelCommandControllerBlockingStub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected ChannelCommandControllerBlockingStub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new ChannelCommandControllerBlockingStub(channel, callOptions);
    }

    /**
     * <pre>
     * Create or update a channel.
     * A request that carries metadata.id of a channel in its organization
     * updates that channel, and its slug changes only through rename. A slug
     * the channel was renamed away from, named without the channel's id, is
     * refused with FAILED_PRECONDITION carrying a google.rpc.ErrorInfo detail
     * (domain "stigmer.ai"), because a write by a name that stops resolving
     * after 30 days would later make a second channel:
     *   - SLUG_RENAMED — the slug was renamed: it still leads to the same
     *     channel for reading, but a write names its current slug. Metadata:
     *     slug (the one the request named).
     * </pre>
     */
    public ai.stigmer.agentic.channel.v1.Channel apply(ai.stigmer.agentic.channel.v1.Channel request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getApplyMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Create a channel.
     * Making a channel is a spending decision: conversations arriving over it
     * call models on the channel's organization's own provider keys, and the
     * providers bill the organization for them.
     * A channel created without a name takes the slug `&lt;agent slug&gt;-&lt;type&gt;`
     * (for example `support-agent-web`) and the name `&lt;agent name&gt; (&lt;Type&gt;)`.
     * A slug another channel of the organization holds is refused with
     * ALREADY_EXISTS. A slug another channel was renamed away from, which
     * still leads to it for 30 days, is refused with ALREADY_EXISTS carrying a
     * google.rpc.ErrorInfo detail (domain "stigmer.ai"):
     *   - SLUG_RESERVED — another channel held the slug until a recent
     *     rename, and it still leads there. Metadata: slug.
     * </pre>
     */
    public ai.stigmer.agentic.channel.v1.Channel create(ai.stigmer.agentic.channel.v1.Channel request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getCreateMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Update a channel: the fields update_mask names change, every other
     * field keeps its stored value.
     * The referenced agent and the channel's type are immutable; status
     * (the link token, install facts) is never touched by updates. A mask
     * naming a web channel's audience or the vaults replaces them whole: an
     * empty audience makes the link organization-only, and empty vaults
     * detach them (both fail closed).
     * resource.metadata.id names the channel; apply finds one by slug. The
     * slug changes only through rename, and a mask naming a field another
     * door owns, or a path the channel does not have, is refused with
     * INVALID_ARGUMENT naming the path.
     * An update is refused with ABORTED carrying a google.rpc.ErrorInfo detail
     * (domain "stigmer.ai"):
     *   - ETAG_MISMATCH — resource.metadata.etag is set and the channel changed
     *     since that etag was read: read it again and make the change again.
     *     No metadata.
     *   - WRITE_CONFLICT — the channel kept changing while the update was
     *     being saved: try again. No metadata.
     * </pre>
     */
    public ai.stigmer.agentic.channel.v1.Channel update(ai.stigmer.agentic.channel.v1.UpdateChannelInput request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getUpdateMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Rename a channel: change its slug, the name the CLI and getByReference
     * address it by.
     * The channel keeps its id, so everything that names it keeps working: a
     * web channel's chat link names its id and does not change, and every
     * answer names it by the new slug. The old slug keeps leading to the
     * channel for reading for 30 days, during which no other channel of the
     * organization can take it and this one can take it back; then it is
     * released. A write that names the old slug is refused with SLUG_RENAMED
     * (see apply). A slug another channel holds is refused with
     * ALREADY_EXISTS, and one another channel was recently renamed away from
     * with SLUG_RESERVED (see create).
     * </pre>
     */
    public ai.stigmer.agentic.channel.v1.Channel rename(ai.stigmer.commons.apiresource.RenameInput request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getRenameMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Rotate a web channel's link token.
     * Generates a fresh server-side token for the channel's hosted chat link.
     * The link becomes `/chat/&lt;channel id&gt;?k=&lt;token&gt;` and the previous link
     * (tokened or plain) stops working immediately, including for visitors
     * mid-conversation. Use this to kill a leaked or over-shared public link
     * without disabling or deleting the channel. A Slack or WhatsApp channel
     * has no link and is refused with FAILED_PRECONDITION.
     * The token lives in status.web.link_token, so manifest applies never
     * reset it. Rotation affects public-audience links only; org-audience
     * access is governed by live organization membership instead.
     * </pre>
     */
    public ai.stigmer.agentic.channel.v1.Channel rotateLink(ai.stigmer.agentic.channel.v1.RotateChannelLinkInput request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getRotateLinkMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Start a Slack or WhatsApp channel's install flow.
     * For redirect-installed providers (Slack) the output carries the
     * provider authorization URL to redirect the installing user to, plus
     * the single-use state that completeInstall verifies. For
     * direct-installed providers (WhatsApp) the install runs to completion
     * inside this RPC and the output carries completed=true instead. A web
     * channel has nothing to install and is refused with
     * FAILED_PRECONDITION.
     * Refusals a client should branch on carry a google.rpc.ErrorInfo
     * detail (domain "stigmer.ai") on the standard grpc-status-details-bin
     * trailer, alongside the human-readable FAILED_PRECONDITION message:
     *   - WHATSAPP_NUMBER_ALREADY_CONNECTED — the WhatsApp Business number
     *     already serves an agent through this channel app (one agent per
     *     number per app). Metadata: display_phone_number (the occupied
     *     number), channel_app_id (the serving app).
     * </pre>
     */
    public ai.stigmer.agentic.channel.v1.InitiateChannelInstallOutput initiateInstall(ai.stigmer.agentic.channel.v1.InitiateChannelInstallInput request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getInitiateInstallMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Complete a Slack channel's install flow.
     * Called by the console after the provider's consent redirect, with the
     * state from initiateInstall and the provider's authorization code. On
     * success the channel's status carries the install facts and the
     * channel begins serving (subject to spec.enabled). A web channel has
     * nothing to install and is refused with FAILED_PRECONDITION.
     * Refusals a client should branch on carry a google.rpc.ErrorInfo
     * detail (domain "stigmer.ai") on the standard grpc-status-details-bin
     * trailer, alongside the human-readable FAILED_PRECONDITION message:
     *   - SLACK_WORKSPACE_ALREADY_CONNECTED — the workspace already hosts
     *     an agent through this serving app (one agent per workspace per
     *     app). Metadata: team_name (the occupied workspace),
     *     channel_app_id (the serving app; empty = platform app).
     *   - CHANNEL_INSTALL_STATE_INVALID — the state parameter is missing,
     *     expired, or replayed; restart the install.
     *   - SLACK_ENTERPRISE_INSTALL_UNSUPPORTED — an Enterprise Grid
     *     org-wide install was attempted; install into a single workspace.
     * Other refusals (unconfigured deployment, provider-refused code
     * exchange) carry no reason: their message is the interface.
     * </pre>
     */
    public ai.stigmer.agentic.channel.v1.Channel completeInstall(ai.stigmer.agentic.channel.v1.CompleteChannelInstallInput request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getCompleteInstallMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Delete a channel.
     * Full teardown: a web channel's link stops resolving and live guest
     * tokens die on their next message; a Slack or WhatsApp channel's inbound
     * events stop resolving, pending deliveries are abandoned, and its sealed
     * provider credentials are deleted. The channel's configuration is gone.
     * To pause serving while keeping it, update the channel with
     * enabled=false instead.
     * </pre>
     */
    public ai.stigmer.agentic.channel.v1.Channel delete(ai.stigmer.agentic.channel.v1.ChannelId request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getDeleteMethod(), getCallOptions(), request);
    }
  }

  /**
   * A stub to allow clients to do ListenableFuture-style rpc calls to service ChannelCommandController.
   * <pre>
   * ChannelCommandController handles write operations for channels.
   * </pre>
   */
  public static final class ChannelCommandControllerFutureStub
      extends io.grpc.stub.AbstractFutureStub<ChannelCommandControllerFutureStub> {
    private ChannelCommandControllerFutureStub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected ChannelCommandControllerFutureStub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new ChannelCommandControllerFutureStub(channel, callOptions);
    }

    /**
     * <pre>
     * Create or update a channel.
     * A request that carries metadata.id of a channel in its organization
     * updates that channel, and its slug changes only through rename. A slug
     * the channel was renamed away from, named without the channel's id, is
     * refused with FAILED_PRECONDITION carrying a google.rpc.ErrorInfo detail
     * (domain "stigmer.ai"), because a write by a name that stops resolving
     * after 30 days would later make a second channel:
     *   - SLUG_RENAMED — the slug was renamed: it still leads to the same
     *     channel for reading, but a write names its current slug. Metadata:
     *     slug (the one the request named).
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.agentic.channel.v1.Channel> apply(
        ai.stigmer.agentic.channel.v1.Channel request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getApplyMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * Create a channel.
     * Making a channel is a spending decision: conversations arriving over it
     * call models on the channel's organization's own provider keys, and the
     * providers bill the organization for them.
     * A channel created without a name takes the slug `&lt;agent slug&gt;-&lt;type&gt;`
     * (for example `support-agent-web`) and the name `&lt;agent name&gt; (&lt;Type&gt;)`.
     * A slug another channel of the organization holds is refused with
     * ALREADY_EXISTS. A slug another channel was renamed away from, which
     * still leads to it for 30 days, is refused with ALREADY_EXISTS carrying a
     * google.rpc.ErrorInfo detail (domain "stigmer.ai"):
     *   - SLUG_RESERVED — another channel held the slug until a recent
     *     rename, and it still leads there. Metadata: slug.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.agentic.channel.v1.Channel> create(
        ai.stigmer.agentic.channel.v1.Channel request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getCreateMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * Update a channel: the fields update_mask names change, every other
     * field keeps its stored value.
     * The referenced agent and the channel's type are immutable; status
     * (the link token, install facts) is never touched by updates. A mask
     * naming a web channel's audience or the vaults replaces them whole: an
     * empty audience makes the link organization-only, and empty vaults
     * detach them (both fail closed).
     * resource.metadata.id names the channel; apply finds one by slug. The
     * slug changes only through rename, and a mask naming a field another
     * door owns, or a path the channel does not have, is refused with
     * INVALID_ARGUMENT naming the path.
     * An update is refused with ABORTED carrying a google.rpc.ErrorInfo detail
     * (domain "stigmer.ai"):
     *   - ETAG_MISMATCH — resource.metadata.etag is set and the channel changed
     *     since that etag was read: read it again and make the change again.
     *     No metadata.
     *   - WRITE_CONFLICT — the channel kept changing while the update was
     *     being saved: try again. No metadata.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.agentic.channel.v1.Channel> update(
        ai.stigmer.agentic.channel.v1.UpdateChannelInput request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getUpdateMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * Rename a channel: change its slug, the name the CLI and getByReference
     * address it by.
     * The channel keeps its id, so everything that names it keeps working: a
     * web channel's chat link names its id and does not change, and every
     * answer names it by the new slug. The old slug keeps leading to the
     * channel for reading for 30 days, during which no other channel of the
     * organization can take it and this one can take it back; then it is
     * released. A write that names the old slug is refused with SLUG_RENAMED
     * (see apply). A slug another channel holds is refused with
     * ALREADY_EXISTS, and one another channel was recently renamed away from
     * with SLUG_RESERVED (see create).
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.agentic.channel.v1.Channel> rename(
        ai.stigmer.commons.apiresource.RenameInput request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getRenameMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * Rotate a web channel's link token.
     * Generates a fresh server-side token for the channel's hosted chat link.
     * The link becomes `/chat/&lt;channel id&gt;?k=&lt;token&gt;` and the previous link
     * (tokened or plain) stops working immediately, including for visitors
     * mid-conversation. Use this to kill a leaked or over-shared public link
     * without disabling or deleting the channel. A Slack or WhatsApp channel
     * has no link and is refused with FAILED_PRECONDITION.
     * The token lives in status.web.link_token, so manifest applies never
     * reset it. Rotation affects public-audience links only; org-audience
     * access is governed by live organization membership instead.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.agentic.channel.v1.Channel> rotateLink(
        ai.stigmer.agentic.channel.v1.RotateChannelLinkInput request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getRotateLinkMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * Start a Slack or WhatsApp channel's install flow.
     * For redirect-installed providers (Slack) the output carries the
     * provider authorization URL to redirect the installing user to, plus
     * the single-use state that completeInstall verifies. For
     * direct-installed providers (WhatsApp) the install runs to completion
     * inside this RPC and the output carries completed=true instead. A web
     * channel has nothing to install and is refused with
     * FAILED_PRECONDITION.
     * Refusals a client should branch on carry a google.rpc.ErrorInfo
     * detail (domain "stigmer.ai") on the standard grpc-status-details-bin
     * trailer, alongside the human-readable FAILED_PRECONDITION message:
     *   - WHATSAPP_NUMBER_ALREADY_CONNECTED — the WhatsApp Business number
     *     already serves an agent through this channel app (one agent per
     *     number per app). Metadata: display_phone_number (the occupied
     *     number), channel_app_id (the serving app).
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.agentic.channel.v1.InitiateChannelInstallOutput> initiateInstall(
        ai.stigmer.agentic.channel.v1.InitiateChannelInstallInput request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getInitiateInstallMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * Complete a Slack channel's install flow.
     * Called by the console after the provider's consent redirect, with the
     * state from initiateInstall and the provider's authorization code. On
     * success the channel's status carries the install facts and the
     * channel begins serving (subject to spec.enabled). A web channel has
     * nothing to install and is refused with FAILED_PRECONDITION.
     * Refusals a client should branch on carry a google.rpc.ErrorInfo
     * detail (domain "stigmer.ai") on the standard grpc-status-details-bin
     * trailer, alongside the human-readable FAILED_PRECONDITION message:
     *   - SLACK_WORKSPACE_ALREADY_CONNECTED — the workspace already hosts
     *     an agent through this serving app (one agent per workspace per
     *     app). Metadata: team_name (the occupied workspace),
     *     channel_app_id (the serving app; empty = platform app).
     *   - CHANNEL_INSTALL_STATE_INVALID — the state parameter is missing,
     *     expired, or replayed; restart the install.
     *   - SLACK_ENTERPRISE_INSTALL_UNSUPPORTED — an Enterprise Grid
     *     org-wide install was attempted; install into a single workspace.
     * Other refusals (unconfigured deployment, provider-refused code
     * exchange) carry no reason: their message is the interface.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.agentic.channel.v1.Channel> completeInstall(
        ai.stigmer.agentic.channel.v1.CompleteChannelInstallInput request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getCompleteInstallMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * Delete a channel.
     * Full teardown: a web channel's link stops resolving and live guest
     * tokens die on their next message; a Slack or WhatsApp channel's inbound
     * events stop resolving, pending deliveries are abandoned, and its sealed
     * provider credentials are deleted. The channel's configuration is gone.
     * To pause serving while keeping it, update the channel with
     * enabled=false instead.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.agentic.channel.v1.Channel> delete(
        ai.stigmer.agentic.channel.v1.ChannelId request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getDeleteMethod(), getCallOptions()), request);
    }
  }

  private static final int METHODID_APPLY = 0;
  private static final int METHODID_CREATE = 1;
  private static final int METHODID_UPDATE = 2;
  private static final int METHODID_RENAME = 3;
  private static final int METHODID_ROTATE_LINK = 4;
  private static final int METHODID_INITIATE_INSTALL = 5;
  private static final int METHODID_COMPLETE_INSTALL = 6;
  private static final int METHODID_DELETE = 7;

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
          serviceImpl.apply((ai.stigmer.agentic.channel.v1.Channel) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.agentic.channel.v1.Channel>) responseObserver);
          break;
        case METHODID_CREATE:
          serviceImpl.create((ai.stigmer.agentic.channel.v1.Channel) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.agentic.channel.v1.Channel>) responseObserver);
          break;
        case METHODID_UPDATE:
          serviceImpl.update((ai.stigmer.agentic.channel.v1.UpdateChannelInput) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.agentic.channel.v1.Channel>) responseObserver);
          break;
        case METHODID_RENAME:
          serviceImpl.rename((ai.stigmer.commons.apiresource.RenameInput) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.agentic.channel.v1.Channel>) responseObserver);
          break;
        case METHODID_ROTATE_LINK:
          serviceImpl.rotateLink((ai.stigmer.agentic.channel.v1.RotateChannelLinkInput) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.agentic.channel.v1.Channel>) responseObserver);
          break;
        case METHODID_INITIATE_INSTALL:
          serviceImpl.initiateInstall((ai.stigmer.agentic.channel.v1.InitiateChannelInstallInput) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.agentic.channel.v1.InitiateChannelInstallOutput>) responseObserver);
          break;
        case METHODID_COMPLETE_INSTALL:
          serviceImpl.completeInstall((ai.stigmer.agentic.channel.v1.CompleteChannelInstallInput) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.agentic.channel.v1.Channel>) responseObserver);
          break;
        case METHODID_DELETE:
          serviceImpl.delete((ai.stigmer.agentic.channel.v1.ChannelId) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.agentic.channel.v1.Channel>) responseObserver);
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
              ai.stigmer.agentic.channel.v1.Channel,
              ai.stigmer.agentic.channel.v1.Channel>(
                service, METHODID_APPLY)))
        .addMethod(
          getCreateMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.agentic.channel.v1.Channel,
              ai.stigmer.agentic.channel.v1.Channel>(
                service, METHODID_CREATE)))
        .addMethod(
          getUpdateMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.agentic.channel.v1.UpdateChannelInput,
              ai.stigmer.agentic.channel.v1.Channel>(
                service, METHODID_UPDATE)))
        .addMethod(
          getRenameMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.commons.apiresource.RenameInput,
              ai.stigmer.agentic.channel.v1.Channel>(
                service, METHODID_RENAME)))
        .addMethod(
          getRotateLinkMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.agentic.channel.v1.RotateChannelLinkInput,
              ai.stigmer.agentic.channel.v1.Channel>(
                service, METHODID_ROTATE_LINK)))
        .addMethod(
          getInitiateInstallMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.agentic.channel.v1.InitiateChannelInstallInput,
              ai.stigmer.agentic.channel.v1.InitiateChannelInstallOutput>(
                service, METHODID_INITIATE_INSTALL)))
        .addMethod(
          getCompleteInstallMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.agentic.channel.v1.CompleteChannelInstallInput,
              ai.stigmer.agentic.channel.v1.Channel>(
                service, METHODID_COMPLETE_INSTALL)))
        .addMethod(
          getDeleteMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.agentic.channel.v1.ChannelId,
              ai.stigmer.agentic.channel.v1.Channel>(
                service, METHODID_DELETE)))
        .build();
  }

  private static abstract class ChannelCommandControllerBaseDescriptorSupplier
      implements io.grpc.protobuf.ProtoFileDescriptorSupplier, io.grpc.protobuf.ProtoServiceDescriptorSupplier {
    ChannelCommandControllerBaseDescriptorSupplier() {}

    @java.lang.Override
    public com.google.protobuf.Descriptors.FileDescriptor getFileDescriptor() {
      return ai.stigmer.agentic.channel.v1.CommandProto.getDescriptor();
    }

    @java.lang.Override
    public com.google.protobuf.Descriptors.ServiceDescriptor getServiceDescriptor() {
      return getFileDescriptor().findServiceByName("ChannelCommandController");
    }
  }

  private static final class ChannelCommandControllerFileDescriptorSupplier
      extends ChannelCommandControllerBaseDescriptorSupplier {
    ChannelCommandControllerFileDescriptorSupplier() {}
  }

  private static final class ChannelCommandControllerMethodDescriptorSupplier
      extends ChannelCommandControllerBaseDescriptorSupplier
      implements io.grpc.protobuf.ProtoMethodDescriptorSupplier {
    private final java.lang.String methodName;

    ChannelCommandControllerMethodDescriptorSupplier(java.lang.String methodName) {
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
      synchronized (ChannelCommandControllerGrpc.class) {
        result = serviceDescriptor;
        if (result == null) {
          serviceDescriptor = result = io.grpc.ServiceDescriptor.newBuilder(SERVICE_NAME)
              .setSchemaDescriptor(new ChannelCommandControllerFileDescriptorSupplier())
              .addMethod(getApplyMethod())
              .addMethod(getCreateMethod())
              .addMethod(getUpdateMethod())
              .addMethod(getRenameMethod())
              .addMethod(getRotateLinkMethod())
              .addMethod(getInitiateInstallMethod())
              .addMethod(getCompleteInstallMethod())
              .addMethod(getDeleteMethod())
              .build();
        }
      }
    }
    return result;
  }
}
