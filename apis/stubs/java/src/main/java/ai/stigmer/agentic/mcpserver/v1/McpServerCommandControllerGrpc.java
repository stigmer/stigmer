package ai.stigmer.agentic.mcpserver.v1;

import static io.grpc.MethodDescriptor.generateFullMethodName;

/**
 * <pre>
 * McpServerCommandController provides write operations for MCP server resources.
 * &#64;internal
 * Authorization model for writes:
 * - Platform-scoped: Only platform operators can create/modify
 * - Organization-scoped: Org admins can create/modify
 * - Identity-account-scoped: Only the owner can create/modify
 * Primary interface: The `apply` method provides Kubernetes-style idempotent
 * create-or-update semantics, which is the recommended approach for CLI usage.
 * </pre>
 */
@io.grpc.stub.annotations.GrpcGenerated
public final class McpServerCommandControllerGrpc {

  private McpServerCommandControllerGrpc() {}

  public static final java.lang.String SERVICE_NAME = "ai.stigmer.agentic.mcpserver.v1.McpServerCommandController";

  // Static method descriptors that strictly reflect the proto.
  private static volatile io.grpc.MethodDescriptor<ai.stigmer.agentic.mcpserver.v1.McpServer,
      ai.stigmer.agentic.mcpserver.v1.McpServer> getApplyMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "apply",
      requestType = ai.stigmer.agentic.mcpserver.v1.McpServer.class,
      responseType = ai.stigmer.agentic.mcpserver.v1.McpServer.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.agentic.mcpserver.v1.McpServer,
      ai.stigmer.agentic.mcpserver.v1.McpServer> getApplyMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.agentic.mcpserver.v1.McpServer, ai.stigmer.agentic.mcpserver.v1.McpServer> getApplyMethod;
    if ((getApplyMethod = McpServerCommandControllerGrpc.getApplyMethod) == null) {
      synchronized (McpServerCommandControllerGrpc.class) {
        if ((getApplyMethod = McpServerCommandControllerGrpc.getApplyMethod) == null) {
          McpServerCommandControllerGrpc.getApplyMethod = getApplyMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.agentic.mcpserver.v1.McpServer, ai.stigmer.agentic.mcpserver.v1.McpServer>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "apply"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.mcpserver.v1.McpServer.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.mcpserver.v1.McpServer.getDefaultInstance()))
              .setSchemaDescriptor(new McpServerCommandControllerMethodDescriptorSupplier("apply"))
              .build();
        }
      }
    }
    return getApplyMethod;
  }

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.agentic.mcpserver.v1.McpServer,
      ai.stigmer.agentic.mcpserver.v1.McpServer> getCreateMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "create",
      requestType = ai.stigmer.agentic.mcpserver.v1.McpServer.class,
      responseType = ai.stigmer.agentic.mcpserver.v1.McpServer.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.agentic.mcpserver.v1.McpServer,
      ai.stigmer.agentic.mcpserver.v1.McpServer> getCreateMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.agentic.mcpserver.v1.McpServer, ai.stigmer.agentic.mcpserver.v1.McpServer> getCreateMethod;
    if ((getCreateMethod = McpServerCommandControllerGrpc.getCreateMethod) == null) {
      synchronized (McpServerCommandControllerGrpc.class) {
        if ((getCreateMethod = McpServerCommandControllerGrpc.getCreateMethod) == null) {
          McpServerCommandControllerGrpc.getCreateMethod = getCreateMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.agentic.mcpserver.v1.McpServer, ai.stigmer.agentic.mcpserver.v1.McpServer>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "create"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.mcpserver.v1.McpServer.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.mcpserver.v1.McpServer.getDefaultInstance()))
              .setSchemaDescriptor(new McpServerCommandControllerMethodDescriptorSupplier("create"))
              .build();
        }
      }
    }
    return getCreateMethod;
  }

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.agentic.mcpserver.v1.McpServer,
      ai.stigmer.agentic.mcpserver.v1.McpServer> getUpdateMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "update",
      requestType = ai.stigmer.agentic.mcpserver.v1.McpServer.class,
      responseType = ai.stigmer.agentic.mcpserver.v1.McpServer.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.agentic.mcpserver.v1.McpServer,
      ai.stigmer.agentic.mcpserver.v1.McpServer> getUpdateMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.agentic.mcpserver.v1.McpServer, ai.stigmer.agentic.mcpserver.v1.McpServer> getUpdateMethod;
    if ((getUpdateMethod = McpServerCommandControllerGrpc.getUpdateMethod) == null) {
      synchronized (McpServerCommandControllerGrpc.class) {
        if ((getUpdateMethod = McpServerCommandControllerGrpc.getUpdateMethod) == null) {
          McpServerCommandControllerGrpc.getUpdateMethod = getUpdateMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.agentic.mcpserver.v1.McpServer, ai.stigmer.agentic.mcpserver.v1.McpServer>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "update"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.mcpserver.v1.McpServer.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.mcpserver.v1.McpServer.getDefaultInstance()))
              .setSchemaDescriptor(new McpServerCommandControllerMethodDescriptorSupplier("update"))
              .build();
        }
      }
    }
    return getUpdateMethod;
  }

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.commons.apiresource.ApiResourceDeleteInput,
      ai.stigmer.agentic.mcpserver.v1.McpServer> getDeleteMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "delete",
      requestType = ai.stigmer.commons.apiresource.ApiResourceDeleteInput.class,
      responseType = ai.stigmer.agentic.mcpserver.v1.McpServer.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.commons.apiresource.ApiResourceDeleteInput,
      ai.stigmer.agentic.mcpserver.v1.McpServer> getDeleteMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.commons.apiresource.ApiResourceDeleteInput, ai.stigmer.agentic.mcpserver.v1.McpServer> getDeleteMethod;
    if ((getDeleteMethod = McpServerCommandControllerGrpc.getDeleteMethod) == null) {
      synchronized (McpServerCommandControllerGrpc.class) {
        if ((getDeleteMethod = McpServerCommandControllerGrpc.getDeleteMethod) == null) {
          McpServerCommandControllerGrpc.getDeleteMethod = getDeleteMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.commons.apiresource.ApiResourceDeleteInput, ai.stigmer.agentic.mcpserver.v1.McpServer>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "delete"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.commons.apiresource.ApiResourceDeleteInput.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.mcpserver.v1.McpServer.getDefaultInstance()))
              .setSchemaDescriptor(new McpServerCommandControllerMethodDescriptorSupplier("delete"))
              .build();
        }
      }
    }
    return getDeleteMethod;
  }

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.commons.apiresource.UpdateVisibilityInput,
      ai.stigmer.agentic.mcpserver.v1.McpServer> getUpdateVisibilityMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "updateVisibility",
      requestType = ai.stigmer.commons.apiresource.UpdateVisibilityInput.class,
      responseType = ai.stigmer.agentic.mcpserver.v1.McpServer.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.commons.apiresource.UpdateVisibilityInput,
      ai.stigmer.agentic.mcpserver.v1.McpServer> getUpdateVisibilityMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.commons.apiresource.UpdateVisibilityInput, ai.stigmer.agentic.mcpserver.v1.McpServer> getUpdateVisibilityMethod;
    if ((getUpdateVisibilityMethod = McpServerCommandControllerGrpc.getUpdateVisibilityMethod) == null) {
      synchronized (McpServerCommandControllerGrpc.class) {
        if ((getUpdateVisibilityMethod = McpServerCommandControllerGrpc.getUpdateVisibilityMethod) == null) {
          McpServerCommandControllerGrpc.getUpdateVisibilityMethod = getUpdateVisibilityMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.commons.apiresource.UpdateVisibilityInput, ai.stigmer.agentic.mcpserver.v1.McpServer>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "updateVisibility"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.commons.apiresource.UpdateVisibilityInput.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.mcpserver.v1.McpServer.getDefaultInstance()))
              .setSchemaDescriptor(new McpServerCommandControllerMethodDescriptorSupplier("updateVisibility"))
              .build();
        }
      }
    }
    return getUpdateVisibilityMethod;
  }

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.agentic.mcpserver.v1.ConnectInput,
      ai.stigmer.agentic.mcpserver.v1.McpServer> getConnectMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "connect",
      requestType = ai.stigmer.agentic.mcpserver.v1.ConnectInput.class,
      responseType = ai.stigmer.agentic.mcpserver.v1.McpServer.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.agentic.mcpserver.v1.ConnectInput,
      ai.stigmer.agentic.mcpserver.v1.McpServer> getConnectMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.agentic.mcpserver.v1.ConnectInput, ai.stigmer.agentic.mcpserver.v1.McpServer> getConnectMethod;
    if ((getConnectMethod = McpServerCommandControllerGrpc.getConnectMethod) == null) {
      synchronized (McpServerCommandControllerGrpc.class) {
        if ((getConnectMethod = McpServerCommandControllerGrpc.getConnectMethod) == null) {
          McpServerCommandControllerGrpc.getConnectMethod = getConnectMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.agentic.mcpserver.v1.ConnectInput, ai.stigmer.agentic.mcpserver.v1.McpServer>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "connect"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.mcpserver.v1.ConnectInput.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.mcpserver.v1.McpServer.getDefaultInstance()))
              .setSchemaDescriptor(new McpServerCommandControllerMethodDescriptorSupplier("connect"))
              .build();
        }
      }
    }
    return getConnectMethod;
  }

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.agentic.mcpserver.v1.InitiateOAuthConnectInput,
      ai.stigmer.agentic.mcpserver.v1.InitiateOAuthConnectOutput> getInitiateOAuthConnectMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "initiateOAuthConnect",
      requestType = ai.stigmer.agentic.mcpserver.v1.InitiateOAuthConnectInput.class,
      responseType = ai.stigmer.agentic.mcpserver.v1.InitiateOAuthConnectOutput.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.agentic.mcpserver.v1.InitiateOAuthConnectInput,
      ai.stigmer.agentic.mcpserver.v1.InitiateOAuthConnectOutput> getInitiateOAuthConnectMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.agentic.mcpserver.v1.InitiateOAuthConnectInput, ai.stigmer.agentic.mcpserver.v1.InitiateOAuthConnectOutput> getInitiateOAuthConnectMethod;
    if ((getInitiateOAuthConnectMethod = McpServerCommandControllerGrpc.getInitiateOAuthConnectMethod) == null) {
      synchronized (McpServerCommandControllerGrpc.class) {
        if ((getInitiateOAuthConnectMethod = McpServerCommandControllerGrpc.getInitiateOAuthConnectMethod) == null) {
          McpServerCommandControllerGrpc.getInitiateOAuthConnectMethod = getInitiateOAuthConnectMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.agentic.mcpserver.v1.InitiateOAuthConnectInput, ai.stigmer.agentic.mcpserver.v1.InitiateOAuthConnectOutput>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "initiateOAuthConnect"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.mcpserver.v1.InitiateOAuthConnectInput.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.mcpserver.v1.InitiateOAuthConnectOutput.getDefaultInstance()))
              .setSchemaDescriptor(new McpServerCommandControllerMethodDescriptorSupplier("initiateOAuthConnect"))
              .build();
        }
      }
    }
    return getInitiateOAuthConnectMethod;
  }

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.agentic.mcpserver.v1.CompleteOAuthConnectInput,
      ai.stigmer.agentic.mcpserver.v1.CompleteOAuthConnectOutput> getCompleteOAuthConnectMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "completeOAuthConnect",
      requestType = ai.stigmer.agentic.mcpserver.v1.CompleteOAuthConnectInput.class,
      responseType = ai.stigmer.agentic.mcpserver.v1.CompleteOAuthConnectOutput.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.agentic.mcpserver.v1.CompleteOAuthConnectInput,
      ai.stigmer.agentic.mcpserver.v1.CompleteOAuthConnectOutput> getCompleteOAuthConnectMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.agentic.mcpserver.v1.CompleteOAuthConnectInput, ai.stigmer.agentic.mcpserver.v1.CompleteOAuthConnectOutput> getCompleteOAuthConnectMethod;
    if ((getCompleteOAuthConnectMethod = McpServerCommandControllerGrpc.getCompleteOAuthConnectMethod) == null) {
      synchronized (McpServerCommandControllerGrpc.class) {
        if ((getCompleteOAuthConnectMethod = McpServerCommandControllerGrpc.getCompleteOAuthConnectMethod) == null) {
          McpServerCommandControllerGrpc.getCompleteOAuthConnectMethod = getCompleteOAuthConnectMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.agentic.mcpserver.v1.CompleteOAuthConnectInput, ai.stigmer.agentic.mcpserver.v1.CompleteOAuthConnectOutput>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "completeOAuthConnect"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.mcpserver.v1.CompleteOAuthConnectInput.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.mcpserver.v1.CompleteOAuthConnectOutput.getDefaultInstance()))
              .setSchemaDescriptor(new McpServerCommandControllerMethodDescriptorSupplier("completeOAuthConnect"))
              .build();
        }
      }
    }
    return getCompleteOAuthConnectMethod;
  }

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.agentic.mcpserver.v1.DisconnectOAuthInput,
      ai.stigmer.agentic.mcpserver.v1.DisconnectOAuthOutput> getDisconnectOAuthMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "disconnectOAuth",
      requestType = ai.stigmer.agentic.mcpserver.v1.DisconnectOAuthInput.class,
      responseType = ai.stigmer.agentic.mcpserver.v1.DisconnectOAuthOutput.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.agentic.mcpserver.v1.DisconnectOAuthInput,
      ai.stigmer.agentic.mcpserver.v1.DisconnectOAuthOutput> getDisconnectOAuthMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.agentic.mcpserver.v1.DisconnectOAuthInput, ai.stigmer.agentic.mcpserver.v1.DisconnectOAuthOutput> getDisconnectOAuthMethod;
    if ((getDisconnectOAuthMethod = McpServerCommandControllerGrpc.getDisconnectOAuthMethod) == null) {
      synchronized (McpServerCommandControllerGrpc.class) {
        if ((getDisconnectOAuthMethod = McpServerCommandControllerGrpc.getDisconnectOAuthMethod) == null) {
          McpServerCommandControllerGrpc.getDisconnectOAuthMethod = getDisconnectOAuthMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.agentic.mcpserver.v1.DisconnectOAuthInput, ai.stigmer.agentic.mcpserver.v1.DisconnectOAuthOutput>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "disconnectOAuth"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.mcpserver.v1.DisconnectOAuthInput.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.mcpserver.v1.DisconnectOAuthOutput.getDefaultInstance()))
              .setSchemaDescriptor(new McpServerCommandControllerMethodDescriptorSupplier("disconnectOAuth"))
              .build();
        }
      }
    }
    return getDisconnectOAuthMethod;
  }

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.agentic.mcpserver.v1.SetOrgOAuthAppInput,
      ai.stigmer.agentic.mcpserver.v1.SetOrgOAuthAppOutput> getSetOrgOAuthAppMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "setOrgOAuthApp",
      requestType = ai.stigmer.agentic.mcpserver.v1.SetOrgOAuthAppInput.class,
      responseType = ai.stigmer.agentic.mcpserver.v1.SetOrgOAuthAppOutput.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.agentic.mcpserver.v1.SetOrgOAuthAppInput,
      ai.stigmer.agentic.mcpserver.v1.SetOrgOAuthAppOutput> getSetOrgOAuthAppMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.agentic.mcpserver.v1.SetOrgOAuthAppInput, ai.stigmer.agentic.mcpserver.v1.SetOrgOAuthAppOutput> getSetOrgOAuthAppMethod;
    if ((getSetOrgOAuthAppMethod = McpServerCommandControllerGrpc.getSetOrgOAuthAppMethod) == null) {
      synchronized (McpServerCommandControllerGrpc.class) {
        if ((getSetOrgOAuthAppMethod = McpServerCommandControllerGrpc.getSetOrgOAuthAppMethod) == null) {
          McpServerCommandControllerGrpc.getSetOrgOAuthAppMethod = getSetOrgOAuthAppMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.agentic.mcpserver.v1.SetOrgOAuthAppInput, ai.stigmer.agentic.mcpserver.v1.SetOrgOAuthAppOutput>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "setOrgOAuthApp"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.mcpserver.v1.SetOrgOAuthAppInput.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.mcpserver.v1.SetOrgOAuthAppOutput.getDefaultInstance()))
              .setSchemaDescriptor(new McpServerCommandControllerMethodDescriptorSupplier("setOrgOAuthApp"))
              .build();
        }
      }
    }
    return getSetOrgOAuthAppMethod;
  }

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.agentic.mcpserver.v1.DeleteOrgOAuthAppInput,
      ai.stigmer.agentic.mcpserver.v1.DeleteOrgOAuthAppOutput> getDeleteOrgOAuthAppMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "deleteOrgOAuthApp",
      requestType = ai.stigmer.agentic.mcpserver.v1.DeleteOrgOAuthAppInput.class,
      responseType = ai.stigmer.agentic.mcpserver.v1.DeleteOrgOAuthAppOutput.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.agentic.mcpserver.v1.DeleteOrgOAuthAppInput,
      ai.stigmer.agentic.mcpserver.v1.DeleteOrgOAuthAppOutput> getDeleteOrgOAuthAppMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.agentic.mcpserver.v1.DeleteOrgOAuthAppInput, ai.stigmer.agentic.mcpserver.v1.DeleteOrgOAuthAppOutput> getDeleteOrgOAuthAppMethod;
    if ((getDeleteOrgOAuthAppMethod = McpServerCommandControllerGrpc.getDeleteOrgOAuthAppMethod) == null) {
      synchronized (McpServerCommandControllerGrpc.class) {
        if ((getDeleteOrgOAuthAppMethod = McpServerCommandControllerGrpc.getDeleteOrgOAuthAppMethod) == null) {
          McpServerCommandControllerGrpc.getDeleteOrgOAuthAppMethod = getDeleteOrgOAuthAppMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.agentic.mcpserver.v1.DeleteOrgOAuthAppInput, ai.stigmer.agentic.mcpserver.v1.DeleteOrgOAuthAppOutput>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "deleteOrgOAuthApp"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.mcpserver.v1.DeleteOrgOAuthAppInput.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.mcpserver.v1.DeleteOrgOAuthAppOutput.getDefaultInstance()))
              .setSchemaDescriptor(new McpServerCommandControllerMethodDescriptorSupplier("deleteOrgOAuthApp"))
              .build();
        }
      }
    }
    return getDeleteOrgOAuthAppMethod;
  }

  /**
   * Creates a new async stub that supports all call types for the service
   */
  public static McpServerCommandControllerStub newStub(io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<McpServerCommandControllerStub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<McpServerCommandControllerStub>() {
        @java.lang.Override
        public McpServerCommandControllerStub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new McpServerCommandControllerStub(channel, callOptions);
        }
      };
    return McpServerCommandControllerStub.newStub(factory, channel);
  }

  /**
   * Creates a new blocking-style stub that supports all types of calls on the service
   */
  public static McpServerCommandControllerBlockingV2Stub newBlockingV2Stub(
      io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<McpServerCommandControllerBlockingV2Stub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<McpServerCommandControllerBlockingV2Stub>() {
        @java.lang.Override
        public McpServerCommandControllerBlockingV2Stub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new McpServerCommandControllerBlockingV2Stub(channel, callOptions);
        }
      };
    return McpServerCommandControllerBlockingV2Stub.newStub(factory, channel);
  }

  /**
   * Creates a new blocking-style stub that supports unary and streaming output calls on the service
   */
  public static McpServerCommandControllerBlockingStub newBlockingStub(
      io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<McpServerCommandControllerBlockingStub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<McpServerCommandControllerBlockingStub>() {
        @java.lang.Override
        public McpServerCommandControllerBlockingStub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new McpServerCommandControllerBlockingStub(channel, callOptions);
        }
      };
    return McpServerCommandControllerBlockingStub.newStub(factory, channel);
  }

  /**
   * Creates a new ListenableFuture-style stub that supports unary calls on the service
   */
  public static McpServerCommandControllerFutureStub newFutureStub(
      io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<McpServerCommandControllerFutureStub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<McpServerCommandControllerFutureStub>() {
        @java.lang.Override
        public McpServerCommandControllerFutureStub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new McpServerCommandControllerFutureStub(channel, callOptions);
        }
      };
    return McpServerCommandControllerFutureStub.newStub(factory, channel);
  }

  /**
   * <pre>
   * McpServerCommandController provides write operations for MCP server resources.
   * &#64;internal
   * Authorization model for writes:
   * - Platform-scoped: Only platform operators can create/modify
   * - Organization-scoped: Org admins can create/modify
   * - Identity-account-scoped: Only the owner can create/modify
   * Primary interface: The `apply` method provides Kubernetes-style idempotent
   * create-or-update semantics, which is the recommended approach for CLI usage.
   * </pre>
   */
  public interface AsyncService {

    /**
     * <pre>
     * Create or update an MCP server resource.
     * If the resource doesn't exist, creates it. If it exists, updates it.
     * The resource is identified by its (scope, org, slug) combination.
     * &#64;internal
     * The handler determines whether this is a create or update operation
     * and performs appropriate scope-aware authorization:
     * - Create: Requires permission to create in the target scope
     * - Update: Requires can_edit on the existing resource
     * </pre>
     */
    default void apply(ai.stigmer.agentic.mcpserver.v1.McpServer request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.mcpserver.v1.McpServer> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getApplyMethod(), responseObserver);
    }

    /**
     * <pre>
     * Create an MCP server resource.
     * Returns an error if a resource with the same (scope, org, slug) already exists.
     * Use `apply` for idempotent create-or-update semantics.
     * &#64;internal
     * Authorization: Custom authorization in handler.
     * Requires permission to create MCP servers in the specified scope:
     * - Platform: Requires platform operator role
     * - Organization: Requires org admin role or can_create_mcp_server permission
     * - Identity Account: Automatically allowed for the authenticated user
     * </pre>
     */
    default void create(ai.stigmer.agentic.mcpserver.v1.McpServer request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.mcpserver.v1.McpServer> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getCreateMethod(), responseObserver);
    }

    /**
     * <pre>
     * Update an existing MCP server resource.
     * &#64;internal
     * Authorization: Requires can_edit permission on the mcp_server resource.
     * Only the owner (based on scope) can update:
     * - Platform: Platform operators
     * - Organization: Org admins or resource owner
     * - Identity Account: The owner
     * </pre>
     */
    default void update(ai.stigmer.agentic.mcpserver.v1.McpServer request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.mcpserver.v1.McpServer> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getUpdateMethod(), responseObserver);
    }

    /**
     * <pre>
     * Delete an MCP server resource.
     * Permanently removes the MCP server definition.
     * Agents referencing this server will need to be updated.
     * &#64;internal
     * Authorization: Requires can_delete permission on the mcp_server resource.
     * Only the owner can delete:
     * - Platform: Platform operators
     * - Organization: Org admins or resource owner
     * - Identity Account: The owner
     * </pre>
     */
    default void delete(ai.stigmer.commons.apiresource.ApiResourceDeleteInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.mcpserver.v1.McpServer> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getDeleteMethod(), responseObserver);
    }

    /**
     * <pre>
     * Update the visibility of an existing MCP server.
     * Only modifies metadata.visibility, leaving spec, status, and other
     * metadata fields untouched.
     * &#64;internal
     * Authorization: Requires can_edit permission on the mcp_server resource.
     * </pre>
     */
    default void updateVisibility(ai.stigmer.commons.apiresource.UpdateVisibilityInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.mcpserver.v1.McpServer> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getUpdateVisibilityMethod(), responseObserver);
    }

    /**
     * <pre>
     * Connect to an MCP server: discover its tools and classify approval policies.
     * Connects to the MCP server, enumerates tools and resource templates,
     * classifies tool approval policies via a lightweight LLM, and stores the
     * results in status.discovered_capabilities and status.tool_approvals.
     * Blocks until completion (up to ~30 seconds) and returns the updated McpServer.
     * &#64;internal
     * Typical flows:
     * - Web console: user clicks Connect, backend resolves env vars from the
     *   user's personal environment, starts a Temporal workflow on the runner
     *   (stigmer-runner).
     * - CLI: `stigmer discover mcp-server &lt;name&gt;` calls connect with runtime_env
     *   populated from local env vars, delegating discovery to the backend.
     * - Runner backfill: the runner calls connect on first use when
     *   status.discovered_capabilities is empty, passing runtime_env from the
     *   execution context (shared/connect-backfill.ts).
     * Errors:
     * - FAILED_PRECONDITION: Required credentials missing from personal environment
     * - DEADLINE_EXCEEDED: Discovery did not complete within the timeout
     * - NOT_FOUND: MCP server does not exist
     * Authorization: Requires can_connect permission on the mcp_server resource.
     * </pre>
     */
    default void connect(ai.stigmer.agentic.mcpserver.v1.ConnectInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.mcpserver.v1.McpServer> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getConnectMethod(), responseObserver);
    }

    /**
     * <pre>
     * Start the OAuth authorization flow for an MCP server.
     * Performs setup (DCR registration or OAuthApp credential lookup, PKCE
     * generation) and returns an authorization URL for the frontend to
     * redirect the user to. The frontend calls completeOAuthConnect after
     * the user authorizes.
     * &#64;internal
     * Two auth modes determined by the MCP server's spec.auth block:
     * - No oauth_app_ref: MCP Authorization spec (DCR + PKCE). Backend
     *   discovers the authorization server, registers a client via DCR,
     *   and builds the auth URL automatically.
     * - oauth_app_ref set: Vendor OAuth. Backend loads the referenced
     *   OAuthApp for client credentials and endpoint URLs.
     * Errors:
     * - FAILED_PRECONDITION: MCP server has no auth block, or is stdio
     *   without oauth_app_ref (DCR requires HTTP transport)
     * - NOT_FOUND: MCP server or referenced OAuthApp does not exist
     * Authorization: Requires can_connect permission on the mcp_server resource.
     * </pre>
     */
    default void initiateOAuthConnect(ai.stigmer.agentic.mcpserver.v1.InitiateOAuthConnectInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.mcpserver.v1.InitiateOAuthConnectOutput> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getInitiateOAuthConnectMethod(), responseObserver);
    }

    /**
     * <pre>
     * Complete the OAuth authorization flow by exchanging the authorization
     * code for tokens.
     * Called by the frontend after the user is redirected back from the
     * OAuth authorization server. Exchanges the code for tokens, stores
     * them in the user's personal environment, and creates an OAuthGrant
     * record for pre-flight expiry checks.
     * After success, the frontend should call connect() to trigger tool
     * discovery using the freshly acquired token.
     * &#64;internal
     * Errors:
     * - FAILED_PRECONDITION: State parameter is invalid, expired, or does
     *   not match the mcp_server_id
     * - UNAVAILABLE: Token exchange with the authorization server failed
     * - NOT_FOUND: No pending OAuth state found for the given state param
     * Authorization: Requires can_connect permission on the mcp_server resource.
     * </pre>
     */
    default void completeOAuthConnect(ai.stigmer.agentic.mcpserver.v1.CompleteOAuthConnectInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.mcpserver.v1.CompleteOAuthConnectOutput> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getCompleteOAuthConnectMethod(), responseObserver);
    }

    /**
     * <pre>
     * Disconnect the authenticated user's OAuth connection for a resource.
     * Tears down the user's personal OAuth connection by deleting the
     * OAuthGrant and its associated managed environment (which holds the
     * access and refresh tokens). The MCP server definition is unchanged —
     * only the caller's credentials are removed.
     * Other users' connections to the same resource are unaffected.
     * Idempotent: returns disconnected=true when a grant was deleted,
     * disconnected=false when no grant existed. Never returns an error
     * for a missing grant.
     * &#64;internal
     * Authorization: Requires can_connect permission on the mcp_server resource.
     * Uses the same permission as connect/initiateOAuthConnect — if you can
     * establish a connection, you can tear it down.
     * </pre>
     */
    default void disconnectOAuth(ai.stigmer.agentic.mcpserver.v1.DisconnectOAuthInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.mcpserver.v1.DisconnectOAuthOutput> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getDisconnectOAuthMethod(), responseObserver);
    }

    /**
     * <pre>
     * Create or update an org-level BYOA OAuth app override for a resource.
     * Allows an organization to use its own OAuth app credentials instead of
     * the platform default. The handler clones the platform OAuthApp template
     * (endpoint URLs, scopes) and applies the org-provided client credentials.
     * Idempotent: if an override already exists for this resource + org, the
     * existing OAuthApp is updated with the new credentials.
     * Edition scoping: hosted-only. UNIMPLEMENTED on the OSS server by
     * design, as one capability with getOrgOAuthApp and deleteOrgOAuthApp —
     * see the full scoping note on McpServerQueryController.getOrgOAuthApp,
     * the RPC clients probe.
     * &#64;internal
     * Authorization: Requires can_create_oauth_app permission on the organization.
     * This is an org-admin operation — setting credentials that affect all users
     * in the org who connect to this resource.
     * Errors:
     * - FAILED_PRECONDITION: Resource has no auth block or no oauth_app_ref
     *   (BYOA requires a platform template to clone from)
     * - NOT_FOUND: Resource does not exist
     * </pre>
     */
    default void setOrgOAuthApp(ai.stigmer.agentic.mcpserver.v1.SetOrgOAuthAppInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.mcpserver.v1.SetOrgOAuthAppOutput> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getSetOrgOAuthAppMethod(), responseObserver);
    }

    /**
     * <pre>
     * Remove an org-level BYOA override for a resource.
     * Deletes the OAuthAppOverride binding and the OAuthApp resource that
     * was created for it. After this, the resolution chain falls back to
     * the platform default.
     * Edition scoping: hosted-only. UNIMPLEMENTED on the OSS server by
     * design, as one capability with getOrgOAuthApp and setOrgOAuthApp —
     * see the full scoping note on McpServerQueryController.getOrgOAuthApp,
     * the RPC clients probe.
     * Existing user OAuthGrants that were issued using the org's OAuthApp
     * will fail on next token refresh — those users will need to
     * re-authenticate using the platform default or a new org override.
     * &#64;internal
     * Authorization: Requires can_create_oauth_app permission on the organization.
     * Same gate as setOrgOAuthApp — org-admin authority for credential management.
     * Errors:
     * - NOT_FOUND: No override exists for this resource + org
     * </pre>
     */
    default void deleteOrgOAuthApp(ai.stigmer.agentic.mcpserver.v1.DeleteOrgOAuthAppInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.mcpserver.v1.DeleteOrgOAuthAppOutput> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getDeleteOrgOAuthAppMethod(), responseObserver);
    }
  }

  /**
   * Base class for the server implementation of the service McpServerCommandController.
   * <pre>
   * McpServerCommandController provides write operations for MCP server resources.
   * &#64;internal
   * Authorization model for writes:
   * - Platform-scoped: Only platform operators can create/modify
   * - Organization-scoped: Org admins can create/modify
   * - Identity-account-scoped: Only the owner can create/modify
   * Primary interface: The `apply` method provides Kubernetes-style idempotent
   * create-or-update semantics, which is the recommended approach for CLI usage.
   * </pre>
   */
  public static abstract class McpServerCommandControllerImplBase
      implements io.grpc.BindableService, AsyncService {

    @java.lang.Override public final io.grpc.ServerServiceDefinition bindService() {
      return McpServerCommandControllerGrpc.bindService(this);
    }
  }

  /**
   * A stub to allow clients to do asynchronous rpc calls to service McpServerCommandController.
   * <pre>
   * McpServerCommandController provides write operations for MCP server resources.
   * &#64;internal
   * Authorization model for writes:
   * - Platform-scoped: Only platform operators can create/modify
   * - Organization-scoped: Org admins can create/modify
   * - Identity-account-scoped: Only the owner can create/modify
   * Primary interface: The `apply` method provides Kubernetes-style idempotent
   * create-or-update semantics, which is the recommended approach for CLI usage.
   * </pre>
   */
  public static final class McpServerCommandControllerStub
      extends io.grpc.stub.AbstractAsyncStub<McpServerCommandControllerStub> {
    private McpServerCommandControllerStub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected McpServerCommandControllerStub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new McpServerCommandControllerStub(channel, callOptions);
    }

    /**
     * <pre>
     * Create or update an MCP server resource.
     * If the resource doesn't exist, creates it. If it exists, updates it.
     * The resource is identified by its (scope, org, slug) combination.
     * &#64;internal
     * The handler determines whether this is a create or update operation
     * and performs appropriate scope-aware authorization:
     * - Create: Requires permission to create in the target scope
     * - Update: Requires can_edit on the existing resource
     * </pre>
     */
    public void apply(ai.stigmer.agentic.mcpserver.v1.McpServer request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.mcpserver.v1.McpServer> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getApplyMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * Create an MCP server resource.
     * Returns an error if a resource with the same (scope, org, slug) already exists.
     * Use `apply` for idempotent create-or-update semantics.
     * &#64;internal
     * Authorization: Custom authorization in handler.
     * Requires permission to create MCP servers in the specified scope:
     * - Platform: Requires platform operator role
     * - Organization: Requires org admin role or can_create_mcp_server permission
     * - Identity Account: Automatically allowed for the authenticated user
     * </pre>
     */
    public void create(ai.stigmer.agentic.mcpserver.v1.McpServer request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.mcpserver.v1.McpServer> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getCreateMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * Update an existing MCP server resource.
     * &#64;internal
     * Authorization: Requires can_edit permission on the mcp_server resource.
     * Only the owner (based on scope) can update:
     * - Platform: Platform operators
     * - Organization: Org admins or resource owner
     * - Identity Account: The owner
     * </pre>
     */
    public void update(ai.stigmer.agentic.mcpserver.v1.McpServer request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.mcpserver.v1.McpServer> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getUpdateMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * Delete an MCP server resource.
     * Permanently removes the MCP server definition.
     * Agents referencing this server will need to be updated.
     * &#64;internal
     * Authorization: Requires can_delete permission on the mcp_server resource.
     * Only the owner can delete:
     * - Platform: Platform operators
     * - Organization: Org admins or resource owner
     * - Identity Account: The owner
     * </pre>
     */
    public void delete(ai.stigmer.commons.apiresource.ApiResourceDeleteInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.mcpserver.v1.McpServer> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getDeleteMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * Update the visibility of an existing MCP server.
     * Only modifies metadata.visibility, leaving spec, status, and other
     * metadata fields untouched.
     * &#64;internal
     * Authorization: Requires can_edit permission on the mcp_server resource.
     * </pre>
     */
    public void updateVisibility(ai.stigmer.commons.apiresource.UpdateVisibilityInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.mcpserver.v1.McpServer> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getUpdateVisibilityMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * Connect to an MCP server: discover its tools and classify approval policies.
     * Connects to the MCP server, enumerates tools and resource templates,
     * classifies tool approval policies via a lightweight LLM, and stores the
     * results in status.discovered_capabilities and status.tool_approvals.
     * Blocks until completion (up to ~30 seconds) and returns the updated McpServer.
     * &#64;internal
     * Typical flows:
     * - Web console: user clicks Connect, backend resolves env vars from the
     *   user's personal environment, starts a Temporal workflow on the runner
     *   (stigmer-runner).
     * - CLI: `stigmer discover mcp-server &lt;name&gt;` calls connect with runtime_env
     *   populated from local env vars, delegating discovery to the backend.
     * - Runner backfill: the runner calls connect on first use when
     *   status.discovered_capabilities is empty, passing runtime_env from the
     *   execution context (shared/connect-backfill.ts).
     * Errors:
     * - FAILED_PRECONDITION: Required credentials missing from personal environment
     * - DEADLINE_EXCEEDED: Discovery did not complete within the timeout
     * - NOT_FOUND: MCP server does not exist
     * Authorization: Requires can_connect permission on the mcp_server resource.
     * </pre>
     */
    public void connect(ai.stigmer.agentic.mcpserver.v1.ConnectInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.mcpserver.v1.McpServer> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getConnectMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * Start the OAuth authorization flow for an MCP server.
     * Performs setup (DCR registration or OAuthApp credential lookup, PKCE
     * generation) and returns an authorization URL for the frontend to
     * redirect the user to. The frontend calls completeOAuthConnect after
     * the user authorizes.
     * &#64;internal
     * Two auth modes determined by the MCP server's spec.auth block:
     * - No oauth_app_ref: MCP Authorization spec (DCR + PKCE). Backend
     *   discovers the authorization server, registers a client via DCR,
     *   and builds the auth URL automatically.
     * - oauth_app_ref set: Vendor OAuth. Backend loads the referenced
     *   OAuthApp for client credentials and endpoint URLs.
     * Errors:
     * - FAILED_PRECONDITION: MCP server has no auth block, or is stdio
     *   without oauth_app_ref (DCR requires HTTP transport)
     * - NOT_FOUND: MCP server or referenced OAuthApp does not exist
     * Authorization: Requires can_connect permission on the mcp_server resource.
     * </pre>
     */
    public void initiateOAuthConnect(ai.stigmer.agentic.mcpserver.v1.InitiateOAuthConnectInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.mcpserver.v1.InitiateOAuthConnectOutput> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getInitiateOAuthConnectMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * Complete the OAuth authorization flow by exchanging the authorization
     * code for tokens.
     * Called by the frontend after the user is redirected back from the
     * OAuth authorization server. Exchanges the code for tokens, stores
     * them in the user's personal environment, and creates an OAuthGrant
     * record for pre-flight expiry checks.
     * After success, the frontend should call connect() to trigger tool
     * discovery using the freshly acquired token.
     * &#64;internal
     * Errors:
     * - FAILED_PRECONDITION: State parameter is invalid, expired, or does
     *   not match the mcp_server_id
     * - UNAVAILABLE: Token exchange with the authorization server failed
     * - NOT_FOUND: No pending OAuth state found for the given state param
     * Authorization: Requires can_connect permission on the mcp_server resource.
     * </pre>
     */
    public void completeOAuthConnect(ai.stigmer.agentic.mcpserver.v1.CompleteOAuthConnectInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.mcpserver.v1.CompleteOAuthConnectOutput> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getCompleteOAuthConnectMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * Disconnect the authenticated user's OAuth connection for a resource.
     * Tears down the user's personal OAuth connection by deleting the
     * OAuthGrant and its associated managed environment (which holds the
     * access and refresh tokens). The MCP server definition is unchanged —
     * only the caller's credentials are removed.
     * Other users' connections to the same resource are unaffected.
     * Idempotent: returns disconnected=true when a grant was deleted,
     * disconnected=false when no grant existed. Never returns an error
     * for a missing grant.
     * &#64;internal
     * Authorization: Requires can_connect permission on the mcp_server resource.
     * Uses the same permission as connect/initiateOAuthConnect — if you can
     * establish a connection, you can tear it down.
     * </pre>
     */
    public void disconnectOAuth(ai.stigmer.agentic.mcpserver.v1.DisconnectOAuthInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.mcpserver.v1.DisconnectOAuthOutput> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getDisconnectOAuthMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * Create or update an org-level BYOA OAuth app override for a resource.
     * Allows an organization to use its own OAuth app credentials instead of
     * the platform default. The handler clones the platform OAuthApp template
     * (endpoint URLs, scopes) and applies the org-provided client credentials.
     * Idempotent: if an override already exists for this resource + org, the
     * existing OAuthApp is updated with the new credentials.
     * Edition scoping: hosted-only. UNIMPLEMENTED on the OSS server by
     * design, as one capability with getOrgOAuthApp and deleteOrgOAuthApp —
     * see the full scoping note on McpServerQueryController.getOrgOAuthApp,
     * the RPC clients probe.
     * &#64;internal
     * Authorization: Requires can_create_oauth_app permission on the organization.
     * This is an org-admin operation — setting credentials that affect all users
     * in the org who connect to this resource.
     * Errors:
     * - FAILED_PRECONDITION: Resource has no auth block or no oauth_app_ref
     *   (BYOA requires a platform template to clone from)
     * - NOT_FOUND: Resource does not exist
     * </pre>
     */
    public void setOrgOAuthApp(ai.stigmer.agentic.mcpserver.v1.SetOrgOAuthAppInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.mcpserver.v1.SetOrgOAuthAppOutput> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getSetOrgOAuthAppMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * Remove an org-level BYOA override for a resource.
     * Deletes the OAuthAppOverride binding and the OAuthApp resource that
     * was created for it. After this, the resolution chain falls back to
     * the platform default.
     * Edition scoping: hosted-only. UNIMPLEMENTED on the OSS server by
     * design, as one capability with getOrgOAuthApp and setOrgOAuthApp —
     * see the full scoping note on McpServerQueryController.getOrgOAuthApp,
     * the RPC clients probe.
     * Existing user OAuthGrants that were issued using the org's OAuthApp
     * will fail on next token refresh — those users will need to
     * re-authenticate using the platform default or a new org override.
     * &#64;internal
     * Authorization: Requires can_create_oauth_app permission on the organization.
     * Same gate as setOrgOAuthApp — org-admin authority for credential management.
     * Errors:
     * - NOT_FOUND: No override exists for this resource + org
     * </pre>
     */
    public void deleteOrgOAuthApp(ai.stigmer.agentic.mcpserver.v1.DeleteOrgOAuthAppInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.mcpserver.v1.DeleteOrgOAuthAppOutput> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getDeleteOrgOAuthAppMethod(), getCallOptions()), request, responseObserver);
    }
  }

  /**
   * A stub to allow clients to do synchronous rpc calls to service McpServerCommandController.
   * <pre>
   * McpServerCommandController provides write operations for MCP server resources.
   * &#64;internal
   * Authorization model for writes:
   * - Platform-scoped: Only platform operators can create/modify
   * - Organization-scoped: Org admins can create/modify
   * - Identity-account-scoped: Only the owner can create/modify
   * Primary interface: The `apply` method provides Kubernetes-style idempotent
   * create-or-update semantics, which is the recommended approach for CLI usage.
   * </pre>
   */
  public static final class McpServerCommandControllerBlockingV2Stub
      extends io.grpc.stub.AbstractBlockingStub<McpServerCommandControllerBlockingV2Stub> {
    private McpServerCommandControllerBlockingV2Stub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected McpServerCommandControllerBlockingV2Stub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new McpServerCommandControllerBlockingV2Stub(channel, callOptions);
    }

    /**
     * <pre>
     * Create or update an MCP server resource.
     * If the resource doesn't exist, creates it. If it exists, updates it.
     * The resource is identified by its (scope, org, slug) combination.
     * &#64;internal
     * The handler determines whether this is a create or update operation
     * and performs appropriate scope-aware authorization:
     * - Create: Requires permission to create in the target scope
     * - Update: Requires can_edit on the existing resource
     * </pre>
     */
    public ai.stigmer.agentic.mcpserver.v1.McpServer apply(ai.stigmer.agentic.mcpserver.v1.McpServer request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getApplyMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Create an MCP server resource.
     * Returns an error if a resource with the same (scope, org, slug) already exists.
     * Use `apply` for idempotent create-or-update semantics.
     * &#64;internal
     * Authorization: Custom authorization in handler.
     * Requires permission to create MCP servers in the specified scope:
     * - Platform: Requires platform operator role
     * - Organization: Requires org admin role or can_create_mcp_server permission
     * - Identity Account: Automatically allowed for the authenticated user
     * </pre>
     */
    public ai.stigmer.agentic.mcpserver.v1.McpServer create(ai.stigmer.agentic.mcpserver.v1.McpServer request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getCreateMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Update an existing MCP server resource.
     * &#64;internal
     * Authorization: Requires can_edit permission on the mcp_server resource.
     * Only the owner (based on scope) can update:
     * - Platform: Platform operators
     * - Organization: Org admins or resource owner
     * - Identity Account: The owner
     * </pre>
     */
    public ai.stigmer.agentic.mcpserver.v1.McpServer update(ai.stigmer.agentic.mcpserver.v1.McpServer request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getUpdateMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Delete an MCP server resource.
     * Permanently removes the MCP server definition.
     * Agents referencing this server will need to be updated.
     * &#64;internal
     * Authorization: Requires can_delete permission on the mcp_server resource.
     * Only the owner can delete:
     * - Platform: Platform operators
     * - Organization: Org admins or resource owner
     * - Identity Account: The owner
     * </pre>
     */
    public ai.stigmer.agentic.mcpserver.v1.McpServer delete(ai.stigmer.commons.apiresource.ApiResourceDeleteInput request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getDeleteMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Update the visibility of an existing MCP server.
     * Only modifies metadata.visibility, leaving spec, status, and other
     * metadata fields untouched.
     * &#64;internal
     * Authorization: Requires can_edit permission on the mcp_server resource.
     * </pre>
     */
    public ai.stigmer.agentic.mcpserver.v1.McpServer updateVisibility(ai.stigmer.commons.apiresource.UpdateVisibilityInput request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getUpdateVisibilityMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Connect to an MCP server: discover its tools and classify approval policies.
     * Connects to the MCP server, enumerates tools and resource templates,
     * classifies tool approval policies via a lightweight LLM, and stores the
     * results in status.discovered_capabilities and status.tool_approvals.
     * Blocks until completion (up to ~30 seconds) and returns the updated McpServer.
     * &#64;internal
     * Typical flows:
     * - Web console: user clicks Connect, backend resolves env vars from the
     *   user's personal environment, starts a Temporal workflow on the runner
     *   (stigmer-runner).
     * - CLI: `stigmer discover mcp-server &lt;name&gt;` calls connect with runtime_env
     *   populated from local env vars, delegating discovery to the backend.
     * - Runner backfill: the runner calls connect on first use when
     *   status.discovered_capabilities is empty, passing runtime_env from the
     *   execution context (shared/connect-backfill.ts).
     * Errors:
     * - FAILED_PRECONDITION: Required credentials missing from personal environment
     * - DEADLINE_EXCEEDED: Discovery did not complete within the timeout
     * - NOT_FOUND: MCP server does not exist
     * Authorization: Requires can_connect permission on the mcp_server resource.
     * </pre>
     */
    public ai.stigmer.agentic.mcpserver.v1.McpServer connect(ai.stigmer.agentic.mcpserver.v1.ConnectInput request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getConnectMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Start the OAuth authorization flow for an MCP server.
     * Performs setup (DCR registration or OAuthApp credential lookup, PKCE
     * generation) and returns an authorization URL for the frontend to
     * redirect the user to. The frontend calls completeOAuthConnect after
     * the user authorizes.
     * &#64;internal
     * Two auth modes determined by the MCP server's spec.auth block:
     * - No oauth_app_ref: MCP Authorization spec (DCR + PKCE). Backend
     *   discovers the authorization server, registers a client via DCR,
     *   and builds the auth URL automatically.
     * - oauth_app_ref set: Vendor OAuth. Backend loads the referenced
     *   OAuthApp for client credentials and endpoint URLs.
     * Errors:
     * - FAILED_PRECONDITION: MCP server has no auth block, or is stdio
     *   without oauth_app_ref (DCR requires HTTP transport)
     * - NOT_FOUND: MCP server or referenced OAuthApp does not exist
     * Authorization: Requires can_connect permission on the mcp_server resource.
     * </pre>
     */
    public ai.stigmer.agentic.mcpserver.v1.InitiateOAuthConnectOutput initiateOAuthConnect(ai.stigmer.agentic.mcpserver.v1.InitiateOAuthConnectInput request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getInitiateOAuthConnectMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Complete the OAuth authorization flow by exchanging the authorization
     * code for tokens.
     * Called by the frontend after the user is redirected back from the
     * OAuth authorization server. Exchanges the code for tokens, stores
     * them in the user's personal environment, and creates an OAuthGrant
     * record for pre-flight expiry checks.
     * After success, the frontend should call connect() to trigger tool
     * discovery using the freshly acquired token.
     * &#64;internal
     * Errors:
     * - FAILED_PRECONDITION: State parameter is invalid, expired, or does
     *   not match the mcp_server_id
     * - UNAVAILABLE: Token exchange with the authorization server failed
     * - NOT_FOUND: No pending OAuth state found for the given state param
     * Authorization: Requires can_connect permission on the mcp_server resource.
     * </pre>
     */
    public ai.stigmer.agentic.mcpserver.v1.CompleteOAuthConnectOutput completeOAuthConnect(ai.stigmer.agentic.mcpserver.v1.CompleteOAuthConnectInput request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getCompleteOAuthConnectMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Disconnect the authenticated user's OAuth connection for a resource.
     * Tears down the user's personal OAuth connection by deleting the
     * OAuthGrant and its associated managed environment (which holds the
     * access and refresh tokens). The MCP server definition is unchanged —
     * only the caller's credentials are removed.
     * Other users' connections to the same resource are unaffected.
     * Idempotent: returns disconnected=true when a grant was deleted,
     * disconnected=false when no grant existed. Never returns an error
     * for a missing grant.
     * &#64;internal
     * Authorization: Requires can_connect permission on the mcp_server resource.
     * Uses the same permission as connect/initiateOAuthConnect — if you can
     * establish a connection, you can tear it down.
     * </pre>
     */
    public ai.stigmer.agentic.mcpserver.v1.DisconnectOAuthOutput disconnectOAuth(ai.stigmer.agentic.mcpserver.v1.DisconnectOAuthInput request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getDisconnectOAuthMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Create or update an org-level BYOA OAuth app override for a resource.
     * Allows an organization to use its own OAuth app credentials instead of
     * the platform default. The handler clones the platform OAuthApp template
     * (endpoint URLs, scopes) and applies the org-provided client credentials.
     * Idempotent: if an override already exists for this resource + org, the
     * existing OAuthApp is updated with the new credentials.
     * Edition scoping: hosted-only. UNIMPLEMENTED on the OSS server by
     * design, as one capability with getOrgOAuthApp and deleteOrgOAuthApp —
     * see the full scoping note on McpServerQueryController.getOrgOAuthApp,
     * the RPC clients probe.
     * &#64;internal
     * Authorization: Requires can_create_oauth_app permission on the organization.
     * This is an org-admin operation — setting credentials that affect all users
     * in the org who connect to this resource.
     * Errors:
     * - FAILED_PRECONDITION: Resource has no auth block or no oauth_app_ref
     *   (BYOA requires a platform template to clone from)
     * - NOT_FOUND: Resource does not exist
     * </pre>
     */
    public ai.stigmer.agentic.mcpserver.v1.SetOrgOAuthAppOutput setOrgOAuthApp(ai.stigmer.agentic.mcpserver.v1.SetOrgOAuthAppInput request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getSetOrgOAuthAppMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Remove an org-level BYOA override for a resource.
     * Deletes the OAuthAppOverride binding and the OAuthApp resource that
     * was created for it. After this, the resolution chain falls back to
     * the platform default.
     * Edition scoping: hosted-only. UNIMPLEMENTED on the OSS server by
     * design, as one capability with getOrgOAuthApp and setOrgOAuthApp —
     * see the full scoping note on McpServerQueryController.getOrgOAuthApp,
     * the RPC clients probe.
     * Existing user OAuthGrants that were issued using the org's OAuthApp
     * will fail on next token refresh — those users will need to
     * re-authenticate using the platform default or a new org override.
     * &#64;internal
     * Authorization: Requires can_create_oauth_app permission on the organization.
     * Same gate as setOrgOAuthApp — org-admin authority for credential management.
     * Errors:
     * - NOT_FOUND: No override exists for this resource + org
     * </pre>
     */
    public ai.stigmer.agentic.mcpserver.v1.DeleteOrgOAuthAppOutput deleteOrgOAuthApp(ai.stigmer.agentic.mcpserver.v1.DeleteOrgOAuthAppInput request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getDeleteOrgOAuthAppMethod(), getCallOptions(), request);
    }
  }

  /**
   * A stub to allow clients to do limited synchronous rpc calls to service McpServerCommandController.
   * <pre>
   * McpServerCommandController provides write operations for MCP server resources.
   * &#64;internal
   * Authorization model for writes:
   * - Platform-scoped: Only platform operators can create/modify
   * - Organization-scoped: Org admins can create/modify
   * - Identity-account-scoped: Only the owner can create/modify
   * Primary interface: The `apply` method provides Kubernetes-style idempotent
   * create-or-update semantics, which is the recommended approach for CLI usage.
   * </pre>
   */
  public static final class McpServerCommandControllerBlockingStub
      extends io.grpc.stub.AbstractBlockingStub<McpServerCommandControllerBlockingStub> {
    private McpServerCommandControllerBlockingStub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected McpServerCommandControllerBlockingStub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new McpServerCommandControllerBlockingStub(channel, callOptions);
    }

    /**
     * <pre>
     * Create or update an MCP server resource.
     * If the resource doesn't exist, creates it. If it exists, updates it.
     * The resource is identified by its (scope, org, slug) combination.
     * &#64;internal
     * The handler determines whether this is a create or update operation
     * and performs appropriate scope-aware authorization:
     * - Create: Requires permission to create in the target scope
     * - Update: Requires can_edit on the existing resource
     * </pre>
     */
    public ai.stigmer.agentic.mcpserver.v1.McpServer apply(ai.stigmer.agentic.mcpserver.v1.McpServer request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getApplyMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Create an MCP server resource.
     * Returns an error if a resource with the same (scope, org, slug) already exists.
     * Use `apply` for idempotent create-or-update semantics.
     * &#64;internal
     * Authorization: Custom authorization in handler.
     * Requires permission to create MCP servers in the specified scope:
     * - Platform: Requires platform operator role
     * - Organization: Requires org admin role or can_create_mcp_server permission
     * - Identity Account: Automatically allowed for the authenticated user
     * </pre>
     */
    public ai.stigmer.agentic.mcpserver.v1.McpServer create(ai.stigmer.agentic.mcpserver.v1.McpServer request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getCreateMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Update an existing MCP server resource.
     * &#64;internal
     * Authorization: Requires can_edit permission on the mcp_server resource.
     * Only the owner (based on scope) can update:
     * - Platform: Platform operators
     * - Organization: Org admins or resource owner
     * - Identity Account: The owner
     * </pre>
     */
    public ai.stigmer.agentic.mcpserver.v1.McpServer update(ai.stigmer.agentic.mcpserver.v1.McpServer request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getUpdateMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Delete an MCP server resource.
     * Permanently removes the MCP server definition.
     * Agents referencing this server will need to be updated.
     * &#64;internal
     * Authorization: Requires can_delete permission on the mcp_server resource.
     * Only the owner can delete:
     * - Platform: Platform operators
     * - Organization: Org admins or resource owner
     * - Identity Account: The owner
     * </pre>
     */
    public ai.stigmer.agentic.mcpserver.v1.McpServer delete(ai.stigmer.commons.apiresource.ApiResourceDeleteInput request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getDeleteMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Update the visibility of an existing MCP server.
     * Only modifies metadata.visibility, leaving spec, status, and other
     * metadata fields untouched.
     * &#64;internal
     * Authorization: Requires can_edit permission on the mcp_server resource.
     * </pre>
     */
    public ai.stigmer.agentic.mcpserver.v1.McpServer updateVisibility(ai.stigmer.commons.apiresource.UpdateVisibilityInput request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getUpdateVisibilityMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Connect to an MCP server: discover its tools and classify approval policies.
     * Connects to the MCP server, enumerates tools and resource templates,
     * classifies tool approval policies via a lightweight LLM, and stores the
     * results in status.discovered_capabilities and status.tool_approvals.
     * Blocks until completion (up to ~30 seconds) and returns the updated McpServer.
     * &#64;internal
     * Typical flows:
     * - Web console: user clicks Connect, backend resolves env vars from the
     *   user's personal environment, starts a Temporal workflow on the runner
     *   (stigmer-runner).
     * - CLI: `stigmer discover mcp-server &lt;name&gt;` calls connect with runtime_env
     *   populated from local env vars, delegating discovery to the backend.
     * - Runner backfill: the runner calls connect on first use when
     *   status.discovered_capabilities is empty, passing runtime_env from the
     *   execution context (shared/connect-backfill.ts).
     * Errors:
     * - FAILED_PRECONDITION: Required credentials missing from personal environment
     * - DEADLINE_EXCEEDED: Discovery did not complete within the timeout
     * - NOT_FOUND: MCP server does not exist
     * Authorization: Requires can_connect permission on the mcp_server resource.
     * </pre>
     */
    public ai.stigmer.agentic.mcpserver.v1.McpServer connect(ai.stigmer.agentic.mcpserver.v1.ConnectInput request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getConnectMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Start the OAuth authorization flow for an MCP server.
     * Performs setup (DCR registration or OAuthApp credential lookup, PKCE
     * generation) and returns an authorization URL for the frontend to
     * redirect the user to. The frontend calls completeOAuthConnect after
     * the user authorizes.
     * &#64;internal
     * Two auth modes determined by the MCP server's spec.auth block:
     * - No oauth_app_ref: MCP Authorization spec (DCR + PKCE). Backend
     *   discovers the authorization server, registers a client via DCR,
     *   and builds the auth URL automatically.
     * - oauth_app_ref set: Vendor OAuth. Backend loads the referenced
     *   OAuthApp for client credentials and endpoint URLs.
     * Errors:
     * - FAILED_PRECONDITION: MCP server has no auth block, or is stdio
     *   without oauth_app_ref (DCR requires HTTP transport)
     * - NOT_FOUND: MCP server or referenced OAuthApp does not exist
     * Authorization: Requires can_connect permission on the mcp_server resource.
     * </pre>
     */
    public ai.stigmer.agentic.mcpserver.v1.InitiateOAuthConnectOutput initiateOAuthConnect(ai.stigmer.agentic.mcpserver.v1.InitiateOAuthConnectInput request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getInitiateOAuthConnectMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Complete the OAuth authorization flow by exchanging the authorization
     * code for tokens.
     * Called by the frontend after the user is redirected back from the
     * OAuth authorization server. Exchanges the code for tokens, stores
     * them in the user's personal environment, and creates an OAuthGrant
     * record for pre-flight expiry checks.
     * After success, the frontend should call connect() to trigger tool
     * discovery using the freshly acquired token.
     * &#64;internal
     * Errors:
     * - FAILED_PRECONDITION: State parameter is invalid, expired, or does
     *   not match the mcp_server_id
     * - UNAVAILABLE: Token exchange with the authorization server failed
     * - NOT_FOUND: No pending OAuth state found for the given state param
     * Authorization: Requires can_connect permission on the mcp_server resource.
     * </pre>
     */
    public ai.stigmer.agentic.mcpserver.v1.CompleteOAuthConnectOutput completeOAuthConnect(ai.stigmer.agentic.mcpserver.v1.CompleteOAuthConnectInput request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getCompleteOAuthConnectMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Disconnect the authenticated user's OAuth connection for a resource.
     * Tears down the user's personal OAuth connection by deleting the
     * OAuthGrant and its associated managed environment (which holds the
     * access and refresh tokens). The MCP server definition is unchanged —
     * only the caller's credentials are removed.
     * Other users' connections to the same resource are unaffected.
     * Idempotent: returns disconnected=true when a grant was deleted,
     * disconnected=false when no grant existed. Never returns an error
     * for a missing grant.
     * &#64;internal
     * Authorization: Requires can_connect permission on the mcp_server resource.
     * Uses the same permission as connect/initiateOAuthConnect — if you can
     * establish a connection, you can tear it down.
     * </pre>
     */
    public ai.stigmer.agentic.mcpserver.v1.DisconnectOAuthOutput disconnectOAuth(ai.stigmer.agentic.mcpserver.v1.DisconnectOAuthInput request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getDisconnectOAuthMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Create or update an org-level BYOA OAuth app override for a resource.
     * Allows an organization to use its own OAuth app credentials instead of
     * the platform default. The handler clones the platform OAuthApp template
     * (endpoint URLs, scopes) and applies the org-provided client credentials.
     * Idempotent: if an override already exists for this resource + org, the
     * existing OAuthApp is updated with the new credentials.
     * Edition scoping: hosted-only. UNIMPLEMENTED on the OSS server by
     * design, as one capability with getOrgOAuthApp and deleteOrgOAuthApp —
     * see the full scoping note on McpServerQueryController.getOrgOAuthApp,
     * the RPC clients probe.
     * &#64;internal
     * Authorization: Requires can_create_oauth_app permission on the organization.
     * This is an org-admin operation — setting credentials that affect all users
     * in the org who connect to this resource.
     * Errors:
     * - FAILED_PRECONDITION: Resource has no auth block or no oauth_app_ref
     *   (BYOA requires a platform template to clone from)
     * - NOT_FOUND: Resource does not exist
     * </pre>
     */
    public ai.stigmer.agentic.mcpserver.v1.SetOrgOAuthAppOutput setOrgOAuthApp(ai.stigmer.agentic.mcpserver.v1.SetOrgOAuthAppInput request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getSetOrgOAuthAppMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Remove an org-level BYOA override for a resource.
     * Deletes the OAuthAppOverride binding and the OAuthApp resource that
     * was created for it. After this, the resolution chain falls back to
     * the platform default.
     * Edition scoping: hosted-only. UNIMPLEMENTED on the OSS server by
     * design, as one capability with getOrgOAuthApp and setOrgOAuthApp —
     * see the full scoping note on McpServerQueryController.getOrgOAuthApp,
     * the RPC clients probe.
     * Existing user OAuthGrants that were issued using the org's OAuthApp
     * will fail on next token refresh — those users will need to
     * re-authenticate using the platform default or a new org override.
     * &#64;internal
     * Authorization: Requires can_create_oauth_app permission on the organization.
     * Same gate as setOrgOAuthApp — org-admin authority for credential management.
     * Errors:
     * - NOT_FOUND: No override exists for this resource + org
     * </pre>
     */
    public ai.stigmer.agentic.mcpserver.v1.DeleteOrgOAuthAppOutput deleteOrgOAuthApp(ai.stigmer.agentic.mcpserver.v1.DeleteOrgOAuthAppInput request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getDeleteOrgOAuthAppMethod(), getCallOptions(), request);
    }
  }

  /**
   * A stub to allow clients to do ListenableFuture-style rpc calls to service McpServerCommandController.
   * <pre>
   * McpServerCommandController provides write operations for MCP server resources.
   * &#64;internal
   * Authorization model for writes:
   * - Platform-scoped: Only platform operators can create/modify
   * - Organization-scoped: Org admins can create/modify
   * - Identity-account-scoped: Only the owner can create/modify
   * Primary interface: The `apply` method provides Kubernetes-style idempotent
   * create-or-update semantics, which is the recommended approach for CLI usage.
   * </pre>
   */
  public static final class McpServerCommandControllerFutureStub
      extends io.grpc.stub.AbstractFutureStub<McpServerCommandControllerFutureStub> {
    private McpServerCommandControllerFutureStub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected McpServerCommandControllerFutureStub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new McpServerCommandControllerFutureStub(channel, callOptions);
    }

    /**
     * <pre>
     * Create or update an MCP server resource.
     * If the resource doesn't exist, creates it. If it exists, updates it.
     * The resource is identified by its (scope, org, slug) combination.
     * &#64;internal
     * The handler determines whether this is a create or update operation
     * and performs appropriate scope-aware authorization:
     * - Create: Requires permission to create in the target scope
     * - Update: Requires can_edit on the existing resource
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.agentic.mcpserver.v1.McpServer> apply(
        ai.stigmer.agentic.mcpserver.v1.McpServer request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getApplyMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * Create an MCP server resource.
     * Returns an error if a resource with the same (scope, org, slug) already exists.
     * Use `apply` for idempotent create-or-update semantics.
     * &#64;internal
     * Authorization: Custom authorization in handler.
     * Requires permission to create MCP servers in the specified scope:
     * - Platform: Requires platform operator role
     * - Organization: Requires org admin role or can_create_mcp_server permission
     * - Identity Account: Automatically allowed for the authenticated user
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.agentic.mcpserver.v1.McpServer> create(
        ai.stigmer.agentic.mcpserver.v1.McpServer request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getCreateMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * Update an existing MCP server resource.
     * &#64;internal
     * Authorization: Requires can_edit permission on the mcp_server resource.
     * Only the owner (based on scope) can update:
     * - Platform: Platform operators
     * - Organization: Org admins or resource owner
     * - Identity Account: The owner
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.agentic.mcpserver.v1.McpServer> update(
        ai.stigmer.agentic.mcpserver.v1.McpServer request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getUpdateMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * Delete an MCP server resource.
     * Permanently removes the MCP server definition.
     * Agents referencing this server will need to be updated.
     * &#64;internal
     * Authorization: Requires can_delete permission on the mcp_server resource.
     * Only the owner can delete:
     * - Platform: Platform operators
     * - Organization: Org admins or resource owner
     * - Identity Account: The owner
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.agentic.mcpserver.v1.McpServer> delete(
        ai.stigmer.commons.apiresource.ApiResourceDeleteInput request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getDeleteMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * Update the visibility of an existing MCP server.
     * Only modifies metadata.visibility, leaving spec, status, and other
     * metadata fields untouched.
     * &#64;internal
     * Authorization: Requires can_edit permission on the mcp_server resource.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.agentic.mcpserver.v1.McpServer> updateVisibility(
        ai.stigmer.commons.apiresource.UpdateVisibilityInput request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getUpdateVisibilityMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * Connect to an MCP server: discover its tools and classify approval policies.
     * Connects to the MCP server, enumerates tools and resource templates,
     * classifies tool approval policies via a lightweight LLM, and stores the
     * results in status.discovered_capabilities and status.tool_approvals.
     * Blocks until completion (up to ~30 seconds) and returns the updated McpServer.
     * &#64;internal
     * Typical flows:
     * - Web console: user clicks Connect, backend resolves env vars from the
     *   user's personal environment, starts a Temporal workflow on the runner
     *   (stigmer-runner).
     * - CLI: `stigmer discover mcp-server &lt;name&gt;` calls connect with runtime_env
     *   populated from local env vars, delegating discovery to the backend.
     * - Runner backfill: the runner calls connect on first use when
     *   status.discovered_capabilities is empty, passing runtime_env from the
     *   execution context (shared/connect-backfill.ts).
     * Errors:
     * - FAILED_PRECONDITION: Required credentials missing from personal environment
     * - DEADLINE_EXCEEDED: Discovery did not complete within the timeout
     * - NOT_FOUND: MCP server does not exist
     * Authorization: Requires can_connect permission on the mcp_server resource.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.agentic.mcpserver.v1.McpServer> connect(
        ai.stigmer.agentic.mcpserver.v1.ConnectInput request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getConnectMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * Start the OAuth authorization flow for an MCP server.
     * Performs setup (DCR registration or OAuthApp credential lookup, PKCE
     * generation) and returns an authorization URL for the frontend to
     * redirect the user to. The frontend calls completeOAuthConnect after
     * the user authorizes.
     * &#64;internal
     * Two auth modes determined by the MCP server's spec.auth block:
     * - No oauth_app_ref: MCP Authorization spec (DCR + PKCE). Backend
     *   discovers the authorization server, registers a client via DCR,
     *   and builds the auth URL automatically.
     * - oauth_app_ref set: Vendor OAuth. Backend loads the referenced
     *   OAuthApp for client credentials and endpoint URLs.
     * Errors:
     * - FAILED_PRECONDITION: MCP server has no auth block, or is stdio
     *   without oauth_app_ref (DCR requires HTTP transport)
     * - NOT_FOUND: MCP server or referenced OAuthApp does not exist
     * Authorization: Requires can_connect permission on the mcp_server resource.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.agentic.mcpserver.v1.InitiateOAuthConnectOutput> initiateOAuthConnect(
        ai.stigmer.agentic.mcpserver.v1.InitiateOAuthConnectInput request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getInitiateOAuthConnectMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * Complete the OAuth authorization flow by exchanging the authorization
     * code for tokens.
     * Called by the frontend after the user is redirected back from the
     * OAuth authorization server. Exchanges the code for tokens, stores
     * them in the user's personal environment, and creates an OAuthGrant
     * record for pre-flight expiry checks.
     * After success, the frontend should call connect() to trigger tool
     * discovery using the freshly acquired token.
     * &#64;internal
     * Errors:
     * - FAILED_PRECONDITION: State parameter is invalid, expired, or does
     *   not match the mcp_server_id
     * - UNAVAILABLE: Token exchange with the authorization server failed
     * - NOT_FOUND: No pending OAuth state found for the given state param
     * Authorization: Requires can_connect permission on the mcp_server resource.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.agentic.mcpserver.v1.CompleteOAuthConnectOutput> completeOAuthConnect(
        ai.stigmer.agentic.mcpserver.v1.CompleteOAuthConnectInput request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getCompleteOAuthConnectMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * Disconnect the authenticated user's OAuth connection for a resource.
     * Tears down the user's personal OAuth connection by deleting the
     * OAuthGrant and its associated managed environment (which holds the
     * access and refresh tokens). The MCP server definition is unchanged —
     * only the caller's credentials are removed.
     * Other users' connections to the same resource are unaffected.
     * Idempotent: returns disconnected=true when a grant was deleted,
     * disconnected=false when no grant existed. Never returns an error
     * for a missing grant.
     * &#64;internal
     * Authorization: Requires can_connect permission on the mcp_server resource.
     * Uses the same permission as connect/initiateOAuthConnect — if you can
     * establish a connection, you can tear it down.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.agentic.mcpserver.v1.DisconnectOAuthOutput> disconnectOAuth(
        ai.stigmer.agentic.mcpserver.v1.DisconnectOAuthInput request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getDisconnectOAuthMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * Create or update an org-level BYOA OAuth app override for a resource.
     * Allows an organization to use its own OAuth app credentials instead of
     * the platform default. The handler clones the platform OAuthApp template
     * (endpoint URLs, scopes) and applies the org-provided client credentials.
     * Idempotent: if an override already exists for this resource + org, the
     * existing OAuthApp is updated with the new credentials.
     * Edition scoping: hosted-only. UNIMPLEMENTED on the OSS server by
     * design, as one capability with getOrgOAuthApp and deleteOrgOAuthApp —
     * see the full scoping note on McpServerQueryController.getOrgOAuthApp,
     * the RPC clients probe.
     * &#64;internal
     * Authorization: Requires can_create_oauth_app permission on the organization.
     * This is an org-admin operation — setting credentials that affect all users
     * in the org who connect to this resource.
     * Errors:
     * - FAILED_PRECONDITION: Resource has no auth block or no oauth_app_ref
     *   (BYOA requires a platform template to clone from)
     * - NOT_FOUND: Resource does not exist
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.agentic.mcpserver.v1.SetOrgOAuthAppOutput> setOrgOAuthApp(
        ai.stigmer.agentic.mcpserver.v1.SetOrgOAuthAppInput request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getSetOrgOAuthAppMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * Remove an org-level BYOA override for a resource.
     * Deletes the OAuthAppOverride binding and the OAuthApp resource that
     * was created for it. After this, the resolution chain falls back to
     * the platform default.
     * Edition scoping: hosted-only. UNIMPLEMENTED on the OSS server by
     * design, as one capability with getOrgOAuthApp and setOrgOAuthApp —
     * see the full scoping note on McpServerQueryController.getOrgOAuthApp,
     * the RPC clients probe.
     * Existing user OAuthGrants that were issued using the org's OAuthApp
     * will fail on next token refresh — those users will need to
     * re-authenticate using the platform default or a new org override.
     * &#64;internal
     * Authorization: Requires can_create_oauth_app permission on the organization.
     * Same gate as setOrgOAuthApp — org-admin authority for credential management.
     * Errors:
     * - NOT_FOUND: No override exists for this resource + org
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.agentic.mcpserver.v1.DeleteOrgOAuthAppOutput> deleteOrgOAuthApp(
        ai.stigmer.agentic.mcpserver.v1.DeleteOrgOAuthAppInput request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getDeleteOrgOAuthAppMethod(), getCallOptions()), request);
    }
  }

  private static final int METHODID_APPLY = 0;
  private static final int METHODID_CREATE = 1;
  private static final int METHODID_UPDATE = 2;
  private static final int METHODID_DELETE = 3;
  private static final int METHODID_UPDATE_VISIBILITY = 4;
  private static final int METHODID_CONNECT = 5;
  private static final int METHODID_INITIATE_OAUTH_CONNECT = 6;
  private static final int METHODID_COMPLETE_OAUTH_CONNECT = 7;
  private static final int METHODID_DISCONNECT_OAUTH = 8;
  private static final int METHODID_SET_ORG_OAUTH_APP = 9;
  private static final int METHODID_DELETE_ORG_OAUTH_APP = 10;

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
          serviceImpl.apply((ai.stigmer.agentic.mcpserver.v1.McpServer) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.agentic.mcpserver.v1.McpServer>) responseObserver);
          break;
        case METHODID_CREATE:
          serviceImpl.create((ai.stigmer.agentic.mcpserver.v1.McpServer) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.agentic.mcpserver.v1.McpServer>) responseObserver);
          break;
        case METHODID_UPDATE:
          serviceImpl.update((ai.stigmer.agentic.mcpserver.v1.McpServer) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.agentic.mcpserver.v1.McpServer>) responseObserver);
          break;
        case METHODID_DELETE:
          serviceImpl.delete((ai.stigmer.commons.apiresource.ApiResourceDeleteInput) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.agentic.mcpserver.v1.McpServer>) responseObserver);
          break;
        case METHODID_UPDATE_VISIBILITY:
          serviceImpl.updateVisibility((ai.stigmer.commons.apiresource.UpdateVisibilityInput) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.agentic.mcpserver.v1.McpServer>) responseObserver);
          break;
        case METHODID_CONNECT:
          serviceImpl.connect((ai.stigmer.agentic.mcpserver.v1.ConnectInput) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.agentic.mcpserver.v1.McpServer>) responseObserver);
          break;
        case METHODID_INITIATE_OAUTH_CONNECT:
          serviceImpl.initiateOAuthConnect((ai.stigmer.agentic.mcpserver.v1.InitiateOAuthConnectInput) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.agentic.mcpserver.v1.InitiateOAuthConnectOutput>) responseObserver);
          break;
        case METHODID_COMPLETE_OAUTH_CONNECT:
          serviceImpl.completeOAuthConnect((ai.stigmer.agentic.mcpserver.v1.CompleteOAuthConnectInput) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.agentic.mcpserver.v1.CompleteOAuthConnectOutput>) responseObserver);
          break;
        case METHODID_DISCONNECT_OAUTH:
          serviceImpl.disconnectOAuth((ai.stigmer.agentic.mcpserver.v1.DisconnectOAuthInput) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.agentic.mcpserver.v1.DisconnectOAuthOutput>) responseObserver);
          break;
        case METHODID_SET_ORG_OAUTH_APP:
          serviceImpl.setOrgOAuthApp((ai.stigmer.agentic.mcpserver.v1.SetOrgOAuthAppInput) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.agentic.mcpserver.v1.SetOrgOAuthAppOutput>) responseObserver);
          break;
        case METHODID_DELETE_ORG_OAUTH_APP:
          serviceImpl.deleteOrgOAuthApp((ai.stigmer.agentic.mcpserver.v1.DeleteOrgOAuthAppInput) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.agentic.mcpserver.v1.DeleteOrgOAuthAppOutput>) responseObserver);
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
              ai.stigmer.agentic.mcpserver.v1.McpServer,
              ai.stigmer.agentic.mcpserver.v1.McpServer>(
                service, METHODID_APPLY)))
        .addMethod(
          getCreateMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.agentic.mcpserver.v1.McpServer,
              ai.stigmer.agentic.mcpserver.v1.McpServer>(
                service, METHODID_CREATE)))
        .addMethod(
          getUpdateMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.agentic.mcpserver.v1.McpServer,
              ai.stigmer.agentic.mcpserver.v1.McpServer>(
                service, METHODID_UPDATE)))
        .addMethod(
          getDeleteMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.commons.apiresource.ApiResourceDeleteInput,
              ai.stigmer.agentic.mcpserver.v1.McpServer>(
                service, METHODID_DELETE)))
        .addMethod(
          getUpdateVisibilityMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.commons.apiresource.UpdateVisibilityInput,
              ai.stigmer.agentic.mcpserver.v1.McpServer>(
                service, METHODID_UPDATE_VISIBILITY)))
        .addMethod(
          getConnectMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.agentic.mcpserver.v1.ConnectInput,
              ai.stigmer.agentic.mcpserver.v1.McpServer>(
                service, METHODID_CONNECT)))
        .addMethod(
          getInitiateOAuthConnectMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.agentic.mcpserver.v1.InitiateOAuthConnectInput,
              ai.stigmer.agentic.mcpserver.v1.InitiateOAuthConnectOutput>(
                service, METHODID_INITIATE_OAUTH_CONNECT)))
        .addMethod(
          getCompleteOAuthConnectMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.agentic.mcpserver.v1.CompleteOAuthConnectInput,
              ai.stigmer.agentic.mcpserver.v1.CompleteOAuthConnectOutput>(
                service, METHODID_COMPLETE_OAUTH_CONNECT)))
        .addMethod(
          getDisconnectOAuthMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.agentic.mcpserver.v1.DisconnectOAuthInput,
              ai.stigmer.agentic.mcpserver.v1.DisconnectOAuthOutput>(
                service, METHODID_DISCONNECT_OAUTH)))
        .addMethod(
          getSetOrgOAuthAppMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.agentic.mcpserver.v1.SetOrgOAuthAppInput,
              ai.stigmer.agentic.mcpserver.v1.SetOrgOAuthAppOutput>(
                service, METHODID_SET_ORG_OAUTH_APP)))
        .addMethod(
          getDeleteOrgOAuthAppMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.agentic.mcpserver.v1.DeleteOrgOAuthAppInput,
              ai.stigmer.agentic.mcpserver.v1.DeleteOrgOAuthAppOutput>(
                service, METHODID_DELETE_ORG_OAUTH_APP)))
        .build();
  }

  private static abstract class McpServerCommandControllerBaseDescriptorSupplier
      implements io.grpc.protobuf.ProtoFileDescriptorSupplier, io.grpc.protobuf.ProtoServiceDescriptorSupplier {
    McpServerCommandControllerBaseDescriptorSupplier() {}

    @java.lang.Override
    public com.google.protobuf.Descriptors.FileDescriptor getFileDescriptor() {
      return ai.stigmer.agentic.mcpserver.v1.CommandProto.getDescriptor();
    }

    @java.lang.Override
    public com.google.protobuf.Descriptors.ServiceDescriptor getServiceDescriptor() {
      return getFileDescriptor().findServiceByName("McpServerCommandController");
    }
  }

  private static final class McpServerCommandControllerFileDescriptorSupplier
      extends McpServerCommandControllerBaseDescriptorSupplier {
    McpServerCommandControllerFileDescriptorSupplier() {}
  }

  private static final class McpServerCommandControllerMethodDescriptorSupplier
      extends McpServerCommandControllerBaseDescriptorSupplier
      implements io.grpc.protobuf.ProtoMethodDescriptorSupplier {
    private final java.lang.String methodName;

    McpServerCommandControllerMethodDescriptorSupplier(java.lang.String methodName) {
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
      synchronized (McpServerCommandControllerGrpc.class) {
        result = serviceDescriptor;
        if (result == null) {
          serviceDescriptor = result = io.grpc.ServiceDescriptor.newBuilder(SERVICE_NAME)
              .setSchemaDescriptor(new McpServerCommandControllerFileDescriptorSupplier())
              .addMethod(getApplyMethod())
              .addMethod(getCreateMethod())
              .addMethod(getUpdateMethod())
              .addMethod(getDeleteMethod())
              .addMethod(getUpdateVisibilityMethod())
              .addMethod(getConnectMethod())
              .addMethod(getInitiateOAuthConnectMethod())
              .addMethod(getCompleteOAuthConnectMethod())
              .addMethod(getDisconnectOAuthMethod())
              .addMethod(getSetOrgOAuthAppMethod())
              .addMethod(getDeleteOrgOAuthAppMethod())
              .build();
        }
      }
    }
    return result;
  }
}
