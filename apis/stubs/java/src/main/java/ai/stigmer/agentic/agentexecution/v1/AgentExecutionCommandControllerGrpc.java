package ai.stigmer.agentic.agentexecution.v1;

import static io.grpc.MethodDescriptor.generateFullMethodName;

/**
 * <pre>
 * AgentExecutionCommandController handles write operations for agent executions.
 * Follows the standard pattern: create, update, delete (no granular field updates).
 * </pre>
 */
@io.grpc.stub.annotations.GrpcGenerated
public final class AgentExecutionCommandControllerGrpc {

  private AgentExecutionCommandControllerGrpc() {}

  public static final java.lang.String SERVICE_NAME = "ai.stigmer.agentic.agentexecution.v1.AgentExecutionCommandController";

  // Static method descriptors that strictly reflect the proto.
  private static volatile io.grpc.MethodDescriptor<ai.stigmer.agentic.agentexecution.v1.AgentExecution,
      ai.stigmer.agentic.agentexecution.v1.AgentExecution> getCreateMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "create",
      requestType = ai.stigmer.agentic.agentexecution.v1.AgentExecution.class,
      responseType = ai.stigmer.agentic.agentexecution.v1.AgentExecution.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.agentic.agentexecution.v1.AgentExecution,
      ai.stigmer.agentic.agentexecution.v1.AgentExecution> getCreateMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.agentic.agentexecution.v1.AgentExecution, ai.stigmer.agentic.agentexecution.v1.AgentExecution> getCreateMethod;
    if ((getCreateMethod = AgentExecutionCommandControllerGrpc.getCreateMethod) == null) {
      synchronized (AgentExecutionCommandControllerGrpc.class) {
        if ((getCreateMethod = AgentExecutionCommandControllerGrpc.getCreateMethod) == null) {
          AgentExecutionCommandControllerGrpc.getCreateMethod = getCreateMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.agentic.agentexecution.v1.AgentExecution, ai.stigmer.agentic.agentexecution.v1.AgentExecution>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "create"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.agentexecution.v1.AgentExecution.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.agentexecution.v1.AgentExecution.getDefaultInstance()))
              .setSchemaDescriptor(new AgentExecutionCommandControllerMethodDescriptorSupplier("create"))
              .build();
        }
      }
    }
    return getCreateMethod;
  }

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.agentic.agentexecution.v1.AgentExecution,
      ai.stigmer.agentic.agentexecution.v1.AgentExecution> getUpdateMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "update",
      requestType = ai.stigmer.agentic.agentexecution.v1.AgentExecution.class,
      responseType = ai.stigmer.agentic.agentexecution.v1.AgentExecution.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.agentic.agentexecution.v1.AgentExecution,
      ai.stigmer.agentic.agentexecution.v1.AgentExecution> getUpdateMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.agentic.agentexecution.v1.AgentExecution, ai.stigmer.agentic.agentexecution.v1.AgentExecution> getUpdateMethod;
    if ((getUpdateMethod = AgentExecutionCommandControllerGrpc.getUpdateMethod) == null) {
      synchronized (AgentExecutionCommandControllerGrpc.class) {
        if ((getUpdateMethod = AgentExecutionCommandControllerGrpc.getUpdateMethod) == null) {
          AgentExecutionCommandControllerGrpc.getUpdateMethod = getUpdateMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.agentic.agentexecution.v1.AgentExecution, ai.stigmer.agentic.agentexecution.v1.AgentExecution>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "update"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.agentexecution.v1.AgentExecution.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.agentexecution.v1.AgentExecution.getDefaultInstance()))
              .setSchemaDescriptor(new AgentExecutionCommandControllerMethodDescriptorSupplier("update"))
              .build();
        }
      }
    }
    return getUpdateMethod;
  }

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.agentic.agentexecution.v1.AgentExecutionUpdateStatusInput,
      ai.stigmer.agentic.agentexecution.v1.UpdateStatusResponse> getUpdateStatusMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "updateStatus",
      requestType = ai.stigmer.agentic.agentexecution.v1.AgentExecutionUpdateStatusInput.class,
      responseType = ai.stigmer.agentic.agentexecution.v1.UpdateStatusResponse.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.agentic.agentexecution.v1.AgentExecutionUpdateStatusInput,
      ai.stigmer.agentic.agentexecution.v1.UpdateStatusResponse> getUpdateStatusMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.agentic.agentexecution.v1.AgentExecutionUpdateStatusInput, ai.stigmer.agentic.agentexecution.v1.UpdateStatusResponse> getUpdateStatusMethod;
    if ((getUpdateStatusMethod = AgentExecutionCommandControllerGrpc.getUpdateStatusMethod) == null) {
      synchronized (AgentExecutionCommandControllerGrpc.class) {
        if ((getUpdateStatusMethod = AgentExecutionCommandControllerGrpc.getUpdateStatusMethod) == null) {
          AgentExecutionCommandControllerGrpc.getUpdateStatusMethod = getUpdateStatusMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.agentic.agentexecution.v1.AgentExecutionUpdateStatusInput, ai.stigmer.agentic.agentexecution.v1.UpdateStatusResponse>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "updateStatus"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.agentexecution.v1.AgentExecutionUpdateStatusInput.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.agentexecution.v1.UpdateStatusResponse.getDefaultInstance()))
              .setSchemaDescriptor(new AgentExecutionCommandControllerMethodDescriptorSupplier("updateStatus"))
              .build();
        }
      }
    }
    return getUpdateStatusMethod;
  }

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.agentic.agentexecution.v1.UpdateUsageInput,
      ai.stigmer.agentic.agentexecution.v1.UpdateUsageResponse> getUpdateUsageMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "updateUsage",
      requestType = ai.stigmer.agentic.agentexecution.v1.UpdateUsageInput.class,
      responseType = ai.stigmer.agentic.agentexecution.v1.UpdateUsageResponse.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.agentic.agentexecution.v1.UpdateUsageInput,
      ai.stigmer.agentic.agentexecution.v1.UpdateUsageResponse> getUpdateUsageMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.agentic.agentexecution.v1.UpdateUsageInput, ai.stigmer.agentic.agentexecution.v1.UpdateUsageResponse> getUpdateUsageMethod;
    if ((getUpdateUsageMethod = AgentExecutionCommandControllerGrpc.getUpdateUsageMethod) == null) {
      synchronized (AgentExecutionCommandControllerGrpc.class) {
        if ((getUpdateUsageMethod = AgentExecutionCommandControllerGrpc.getUpdateUsageMethod) == null) {
          AgentExecutionCommandControllerGrpc.getUpdateUsageMethod = getUpdateUsageMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.agentic.agentexecution.v1.UpdateUsageInput, ai.stigmer.agentic.agentexecution.v1.UpdateUsageResponse>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "updateUsage"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.agentexecution.v1.UpdateUsageInput.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.agentexecution.v1.UpdateUsageResponse.getDefaultInstance()))
              .setSchemaDescriptor(new AgentExecutionCommandControllerMethodDescriptorSupplier("updateUsage"))
              .build();
        }
      }
    }
    return getUpdateUsageMethod;
  }

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.commons.apiresource.ApiResourceId,
      ai.stigmer.agentic.agentexecution.v1.AgentExecution> getDeleteMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "delete",
      requestType = ai.stigmer.commons.apiresource.ApiResourceId.class,
      responseType = ai.stigmer.agentic.agentexecution.v1.AgentExecution.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.commons.apiresource.ApiResourceId,
      ai.stigmer.agentic.agentexecution.v1.AgentExecution> getDeleteMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.commons.apiresource.ApiResourceId, ai.stigmer.agentic.agentexecution.v1.AgentExecution> getDeleteMethod;
    if ((getDeleteMethod = AgentExecutionCommandControllerGrpc.getDeleteMethod) == null) {
      synchronized (AgentExecutionCommandControllerGrpc.class) {
        if ((getDeleteMethod = AgentExecutionCommandControllerGrpc.getDeleteMethod) == null) {
          AgentExecutionCommandControllerGrpc.getDeleteMethod = getDeleteMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.commons.apiresource.ApiResourceId, ai.stigmer.agentic.agentexecution.v1.AgentExecution>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "delete"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.commons.apiresource.ApiResourceId.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.agentexecution.v1.AgentExecution.getDefaultInstance()))
              .setSchemaDescriptor(new AgentExecutionCommandControllerMethodDescriptorSupplier("delete"))
              .build();
        }
      }
    }
    return getDeleteMethod;
  }

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.agentic.agentexecution.v1.SubmitApprovalInput,
      ai.stigmer.agentic.agentexecution.v1.AgentExecution> getSubmitApprovalMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "submitApproval",
      requestType = ai.stigmer.agentic.agentexecution.v1.SubmitApprovalInput.class,
      responseType = ai.stigmer.agentic.agentexecution.v1.AgentExecution.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.agentic.agentexecution.v1.SubmitApprovalInput,
      ai.stigmer.agentic.agentexecution.v1.AgentExecution> getSubmitApprovalMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.agentic.agentexecution.v1.SubmitApprovalInput, ai.stigmer.agentic.agentexecution.v1.AgentExecution> getSubmitApprovalMethod;
    if ((getSubmitApprovalMethod = AgentExecutionCommandControllerGrpc.getSubmitApprovalMethod) == null) {
      synchronized (AgentExecutionCommandControllerGrpc.class) {
        if ((getSubmitApprovalMethod = AgentExecutionCommandControllerGrpc.getSubmitApprovalMethod) == null) {
          AgentExecutionCommandControllerGrpc.getSubmitApprovalMethod = getSubmitApprovalMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.agentic.agentexecution.v1.SubmitApprovalInput, ai.stigmer.agentic.agentexecution.v1.AgentExecution>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "submitApproval"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.agentexecution.v1.SubmitApprovalInput.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.agentexecution.v1.AgentExecution.getDefaultInstance()))
              .setSchemaDescriptor(new AgentExecutionCommandControllerMethodDescriptorSupplier("submitApproval"))
              .build();
        }
      }
    }
    return getSubmitApprovalMethod;
  }

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.agentic.agentexecution.v1.CancelAgentExecutionInput,
      ai.stigmer.agentic.agentexecution.v1.AgentExecution> getCancelMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "cancel",
      requestType = ai.stigmer.agentic.agentexecution.v1.CancelAgentExecutionInput.class,
      responseType = ai.stigmer.agentic.agentexecution.v1.AgentExecution.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.agentic.agentexecution.v1.CancelAgentExecutionInput,
      ai.stigmer.agentic.agentexecution.v1.AgentExecution> getCancelMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.agentic.agentexecution.v1.CancelAgentExecutionInput, ai.stigmer.agentic.agentexecution.v1.AgentExecution> getCancelMethod;
    if ((getCancelMethod = AgentExecutionCommandControllerGrpc.getCancelMethod) == null) {
      synchronized (AgentExecutionCommandControllerGrpc.class) {
        if ((getCancelMethod = AgentExecutionCommandControllerGrpc.getCancelMethod) == null) {
          AgentExecutionCommandControllerGrpc.getCancelMethod = getCancelMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.agentic.agentexecution.v1.CancelAgentExecutionInput, ai.stigmer.agentic.agentexecution.v1.AgentExecution>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "cancel"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.agentexecution.v1.CancelAgentExecutionInput.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.agentexecution.v1.AgentExecution.getDefaultInstance()))
              .setSchemaDescriptor(new AgentExecutionCommandControllerMethodDescriptorSupplier("cancel"))
              .build();
        }
      }
    }
    return getCancelMethod;
  }

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.agentic.agentexecution.v1.TerminateAgentExecutionInput,
      ai.stigmer.agentic.agentexecution.v1.AgentExecution> getTerminateMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "terminate",
      requestType = ai.stigmer.agentic.agentexecution.v1.TerminateAgentExecutionInput.class,
      responseType = ai.stigmer.agentic.agentexecution.v1.AgentExecution.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.agentic.agentexecution.v1.TerminateAgentExecutionInput,
      ai.stigmer.agentic.agentexecution.v1.AgentExecution> getTerminateMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.agentic.agentexecution.v1.TerminateAgentExecutionInput, ai.stigmer.agentic.agentexecution.v1.AgentExecution> getTerminateMethod;
    if ((getTerminateMethod = AgentExecutionCommandControllerGrpc.getTerminateMethod) == null) {
      synchronized (AgentExecutionCommandControllerGrpc.class) {
        if ((getTerminateMethod = AgentExecutionCommandControllerGrpc.getTerminateMethod) == null) {
          AgentExecutionCommandControllerGrpc.getTerminateMethod = getTerminateMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.agentic.agentexecution.v1.TerminateAgentExecutionInput, ai.stigmer.agentic.agentexecution.v1.AgentExecution>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "terminate"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.agentexecution.v1.TerminateAgentExecutionInput.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.agentexecution.v1.AgentExecution.getDefaultInstance()))
              .setSchemaDescriptor(new AgentExecutionCommandControllerMethodDescriptorSupplier("terminate"))
              .build();
        }
      }
    }
    return getTerminateMethod;
  }

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.agentic.agentexecution.v1.RecoverAgentExecutionInput,
      ai.stigmer.agentic.agentexecution.v1.AgentExecution> getRecoverMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "recover",
      requestType = ai.stigmer.agentic.agentexecution.v1.RecoverAgentExecutionInput.class,
      responseType = ai.stigmer.agentic.agentexecution.v1.AgentExecution.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.agentic.agentexecution.v1.RecoverAgentExecutionInput,
      ai.stigmer.agentic.agentexecution.v1.AgentExecution> getRecoverMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.agentic.agentexecution.v1.RecoverAgentExecutionInput, ai.stigmer.agentic.agentexecution.v1.AgentExecution> getRecoverMethod;
    if ((getRecoverMethod = AgentExecutionCommandControllerGrpc.getRecoverMethod) == null) {
      synchronized (AgentExecutionCommandControllerGrpc.class) {
        if ((getRecoverMethod = AgentExecutionCommandControllerGrpc.getRecoverMethod) == null) {
          AgentExecutionCommandControllerGrpc.getRecoverMethod = getRecoverMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.agentic.agentexecution.v1.RecoverAgentExecutionInput, ai.stigmer.agentic.agentexecution.v1.AgentExecution>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "recover"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.agentexecution.v1.RecoverAgentExecutionInput.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.agentexecution.v1.AgentExecution.getDefaultInstance()))
              .setSchemaDescriptor(new AgentExecutionCommandControllerMethodDescriptorSupplier("recover"))
              .build();
        }
      }
    }
    return getRecoverMethod;
  }

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.agentic.agentexecution.v1.PauseAgentExecutionInput,
      ai.stigmer.agentic.agentexecution.v1.AgentExecution> getPauseMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "pause",
      requestType = ai.stigmer.agentic.agentexecution.v1.PauseAgentExecutionInput.class,
      responseType = ai.stigmer.agentic.agentexecution.v1.AgentExecution.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.agentic.agentexecution.v1.PauseAgentExecutionInput,
      ai.stigmer.agentic.agentexecution.v1.AgentExecution> getPauseMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.agentic.agentexecution.v1.PauseAgentExecutionInput, ai.stigmer.agentic.agentexecution.v1.AgentExecution> getPauseMethod;
    if ((getPauseMethod = AgentExecutionCommandControllerGrpc.getPauseMethod) == null) {
      synchronized (AgentExecutionCommandControllerGrpc.class) {
        if ((getPauseMethod = AgentExecutionCommandControllerGrpc.getPauseMethod) == null) {
          AgentExecutionCommandControllerGrpc.getPauseMethod = getPauseMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.agentic.agentexecution.v1.PauseAgentExecutionInput, ai.stigmer.agentic.agentexecution.v1.AgentExecution>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "pause"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.agentexecution.v1.PauseAgentExecutionInput.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.agentexecution.v1.AgentExecution.getDefaultInstance()))
              .setSchemaDescriptor(new AgentExecutionCommandControllerMethodDescriptorSupplier("pause"))
              .build();
        }
      }
    }
    return getPauseMethod;
  }

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.agentic.agentexecution.v1.ResumeAgentExecutionInput,
      ai.stigmer.agentic.agentexecution.v1.AgentExecution> getResumeMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "resume",
      requestType = ai.stigmer.agentic.agentexecution.v1.ResumeAgentExecutionInput.class,
      responseType = ai.stigmer.agentic.agentexecution.v1.AgentExecution.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.agentic.agentexecution.v1.ResumeAgentExecutionInput,
      ai.stigmer.agentic.agentexecution.v1.AgentExecution> getResumeMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.agentic.agentexecution.v1.ResumeAgentExecutionInput, ai.stigmer.agentic.agentexecution.v1.AgentExecution> getResumeMethod;
    if ((getResumeMethod = AgentExecutionCommandControllerGrpc.getResumeMethod) == null) {
      synchronized (AgentExecutionCommandControllerGrpc.class) {
        if ((getResumeMethod = AgentExecutionCommandControllerGrpc.getResumeMethod) == null) {
          AgentExecutionCommandControllerGrpc.getResumeMethod = getResumeMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.agentic.agentexecution.v1.ResumeAgentExecutionInput, ai.stigmer.agentic.agentexecution.v1.AgentExecution>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "resume"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.agentexecution.v1.ResumeAgentExecutionInput.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.agentexecution.v1.AgentExecution.getDefaultInstance()))
              .setSchemaDescriptor(new AgentExecutionCommandControllerMethodDescriptorSupplier("resume"))
              .build();
        }
      }
    }
    return getResumeMethod;
  }

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.agentic.agentexecution.v1.UploadAttachmentRequest,
      ai.stigmer.agentic.agentexecution.v1.UploadAttachmentResponse> getUploadAttachmentMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "uploadAttachment",
      requestType = ai.stigmer.agentic.agentexecution.v1.UploadAttachmentRequest.class,
      responseType = ai.stigmer.agentic.agentexecution.v1.UploadAttachmentResponse.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.agentic.agentexecution.v1.UploadAttachmentRequest,
      ai.stigmer.agentic.agentexecution.v1.UploadAttachmentResponse> getUploadAttachmentMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.agentic.agentexecution.v1.UploadAttachmentRequest, ai.stigmer.agentic.agentexecution.v1.UploadAttachmentResponse> getUploadAttachmentMethod;
    if ((getUploadAttachmentMethod = AgentExecutionCommandControllerGrpc.getUploadAttachmentMethod) == null) {
      synchronized (AgentExecutionCommandControllerGrpc.class) {
        if ((getUploadAttachmentMethod = AgentExecutionCommandControllerGrpc.getUploadAttachmentMethod) == null) {
          AgentExecutionCommandControllerGrpc.getUploadAttachmentMethod = getUploadAttachmentMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.agentic.agentexecution.v1.UploadAttachmentRequest, ai.stigmer.agentic.agentexecution.v1.UploadAttachmentResponse>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "uploadAttachment"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.agentexecution.v1.UploadAttachmentRequest.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.agentexecution.v1.UploadAttachmentResponse.getDefaultInstance()))
              .setSchemaDescriptor(new AgentExecutionCommandControllerMethodDescriptorSupplier("uploadAttachment"))
              .build();
        }
      }
    }
    return getUploadAttachmentMethod;
  }

  /**
   * Creates a new async stub that supports all call types for the service
   */
  public static AgentExecutionCommandControllerStub newStub(io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<AgentExecutionCommandControllerStub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<AgentExecutionCommandControllerStub>() {
        @java.lang.Override
        public AgentExecutionCommandControllerStub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new AgentExecutionCommandControllerStub(channel, callOptions);
        }
      };
    return AgentExecutionCommandControllerStub.newStub(factory, channel);
  }

  /**
   * Creates a new blocking-style stub that supports all types of calls on the service
   */
  public static AgentExecutionCommandControllerBlockingV2Stub newBlockingV2Stub(
      io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<AgentExecutionCommandControllerBlockingV2Stub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<AgentExecutionCommandControllerBlockingV2Stub>() {
        @java.lang.Override
        public AgentExecutionCommandControllerBlockingV2Stub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new AgentExecutionCommandControllerBlockingV2Stub(channel, callOptions);
        }
      };
    return AgentExecutionCommandControllerBlockingV2Stub.newStub(factory, channel);
  }

  /**
   * Creates a new blocking-style stub that supports unary and streaming output calls on the service
   */
  public static AgentExecutionCommandControllerBlockingStub newBlockingStub(
      io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<AgentExecutionCommandControllerBlockingStub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<AgentExecutionCommandControllerBlockingStub>() {
        @java.lang.Override
        public AgentExecutionCommandControllerBlockingStub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new AgentExecutionCommandControllerBlockingStub(channel, callOptions);
        }
      };
    return AgentExecutionCommandControllerBlockingStub.newStub(factory, channel);
  }

  /**
   * Creates a new ListenableFuture-style stub that supports unary calls on the service
   */
  public static AgentExecutionCommandControllerFutureStub newFutureStub(
      io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<AgentExecutionCommandControllerFutureStub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<AgentExecutionCommandControllerFutureStub>() {
        @java.lang.Override
        public AgentExecutionCommandControllerFutureStub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new AgentExecutionCommandControllerFutureStub(channel, callOptions);
        }
      };
    return AgentExecutionCommandControllerFutureStub.newStub(factory, channel);
  }

  /**
   * <pre>
   * AgentExecutionCommandController handles write operations for agent executions.
   * Follows the standard pattern: create, update, delete (no granular field updates).
   * </pre>
   */
  public interface AsyncService {

    /**
     * <pre>
     * Create and trigger a new agent execution.
     * Session is optional — can be provided or auto-created from agent_id.
     * &#64;internal
     * Authorization is handled in handler:
     *   - If session_id provided: checks can_create_execution_in on session
     *   - If session_id NOT provided: checks can_create_execution_in on organization
     * </pre>
     */
    default void create(ai.stigmer.agentic.agentexecution.v1.AgentExecution request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.agentexecution.v1.AgentExecution> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getCreateMethod(), responseObserver);
    }

    /**
     * <pre>
     * Update an agent execution.
     * &#64;internal
     * Used by users to update execution configuration (spec fields).
     * No individual field updates - always provide complete state.
     * </pre>
     */
    default void update(ai.stigmer.agentic.agentexecution.v1.AgentExecution request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.agentexecution.v1.AgentExecution> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getUpdateMethod(), responseObserver);
    }

    /**
     * <pre>
     * Update an agent execution's status.
     * &#64;internal
     * Used by agent-runner to send progressive status updates (messages,
     * tool_calls, phase, etc.). The runner authenticates as the triggering user,
     * who owns the execution through the session ownership chain.
     * Optimized for frequent status updates and merges status fields with
     * existing state.
     * </pre>
     */
    default void updateStatus(ai.stigmer.agentic.agentexecution.v1.AgentExecutionUpdateStatusInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.agentexecution.v1.UpdateStatusResponse> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getUpdateStatusMethod(), responseObserver);
    }

    /**
     * <pre>
     * Record proxy-observed LLM usage for an agent execution.
     * &#64;internal
     * Called by the LLM/Cursor proxy after each streaming response completes.
     * The proxy extracts token counts from the provider's SSE stream and reports
     * them here. The handler computes provider cost server-side from the model
     * registry (never trusts caller-supplied cost), writes trusted usage to the
     * execution, and debits billing credits as a side effect.
     * ## Authorization
     * Operator-only. The proxy authenticates as the platform operator identity.
     * Regular users and runners cannot call this RPC.
     * ## Idempotency
     * Deduplicated by (execution_id, sequence). Safe to retry on transient failures.
     * ## Signal Delivery
     * This RPC does NOT return a billing signal. The proxy is a transparent byte
     * pipe and cannot act on STOP/WARNING. Billing signals are delivered to the
     * runner through the updateStatus response.
     * </pre>
     */
    default void updateUsage(ai.stigmer.agentic.agentexecution.v1.UpdateUsageInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.agentexecution.v1.UpdateUsageResponse> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getUpdateUsageMethod(), responseObserver);
    }

    /**
     * <pre>
     * Delete an agent execution by ID.
     * </pre>
     */
    default void delete(ai.stigmer.commons.apiresource.ApiResourceId request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.agentexecution.v1.AgentExecution> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getDeleteMethod(), responseObserver);
    }

    /**
     * <pre>
     * Submit an approval decision for a pending tool call.
     * ## Preconditions
     * - Execution must be in EXECUTION_WAITING_FOR_APPROVAL phase
     * - tool_call_id must match status.pending_approval.tool_call_id
     * - User must have can_edit permission on the execution
     * ## Behavior by Action
     * - APPROVE: Tool executes normally, execution resumes to IN_PROGRESS
     * - SKIP: Tool returns skip message to LLM, execution continues to IN_PROGRESS
     * - REJECT: Execution fails with rejection error, phase becomes FAILED
     * &#64;internal
     * ## State Transitions
     * On success:
     * - ToolCall.approval_action = submitted action
     * - ToolCall.approval_decided_at = current timestamp
     * - ToolCall.approved_by = authenticated user ID
     * - AgentExecutionStatus.pending_approval = cleared
     * - ExecutionPhase = EXECUTION_IN_PROGRESS (or EXECUTION_FAILED if REJECT)
     * ## Error Conditions
     * - NOT_FOUND: Execution doesn't exist
     * - FAILED_PRECONDITION: Execution not in WAITING_FOR_APPROVAL phase
     * - INVALID_ARGUMENT: tool_call_id doesn't match pending approval, or action is UNSPECIFIED
     * - PERMISSION_DENIED: User lacks can_edit permission
     * ## Idempotency
     * If the same approval is submitted twice (same execution, tool_call, action),
     * the second call is a no-op and returns the current state.
     * </pre>
     */
    default void submitApproval(ai.stigmer.agentic.agentexecution.v1.SubmitApprovalInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.agentexecution.v1.AgentExecution> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getSubmitApprovalMethod(), responseObserver);
    }

    /**
     * <pre>
     * Cancel a running agent execution gracefully.
     * Sends a cancellation signal to the agent execution. The agent can handle
     * the cancellation signal to save checkpoint and clean up before
     * transitioning to the CANCELLED phase.
     * &#64;internal
     * Temporal Equivalent: `temporal workflow cancel --workflow-id &lt;id&gt;`
     * ## Behavior
     * 1. Validates execution exists and is in a cancellable phase
     * 2. Sends cancellation signal to Temporal workflow
     * 3. Python activity receives cancellation and saves LangGraph checkpoint
     * 4. Execution transitions to EXECUTION_CANCELLED phase
     * 5. Returns updated AgentExecution with new phase
     * ## Preconditions
     * - Execution must be in EXECUTION_PENDING or EXECUTION_IN_PROGRESS phase
     * - Cannot cancel already-terminal executions (COMPLETED, FAILED, CANCELLED, TERMINATED)
     * ## State Transitions
     * - status.phase: PENDING/IN_PROGRESS → CANCELLED
     * - status.completed_at: Set to current timestamp
     * - LangGraph checkpoint: Preserved for potential future reference
     * ## Idempotency
     * Cancelling an already-cancelled execution succeeds as a no-op.
     * The call returns the current execution state without side effects.
     * ## Error Cases
     * - NOT_FOUND: Execution with given ID doesn't exist
     * - PERMISSION_DENIED: User lacks can_edit permission on the execution
     * - FAILED_PRECONDITION: Execution is in a terminal phase
     * - INVALID_ARGUMENT: ID is empty or malformed
     * &#64;since Agent Execution Lifecycle
     * </pre>
     */
    default void cancel(ai.stigmer.agentic.agentexecution.v1.CancelAgentExecutionInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.agentexecution.v1.AgentExecution> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getCancelMethod(), responseObserver);
    }

    /**
     * <pre>
     * Terminate an agent execution immediately.
     * Force-stops the agent execution without allowing cleanup. Unlike cancel,
     * the agent cannot respond to termination - it is stopped immediately.
     * Use this for stuck or unresponsive agents.
     * &#64;internal
     * Temporal Equivalent: `temporal workflow terminate --workflow-id &lt;id&gt;`
     * ## Behavior
     * 1. Validates execution exists and is in a terminable phase
     * 2. Force-kills workflow via Temporal (no signal sent to agent)
     * 3. Execution transitions to EXECUTION_TERMINATED phase immediately
     * 4. No cleanup callbacks or checkpoint saves occur
     * 5. Returns updated AgentExecution with TERMINATED phase
     * ## Preconditions
     * - Execution must be in EXECUTION_PENDING or EXECUTION_IN_PROGRESS phase
     * - Cannot terminate already-terminal executions
     * ## State Transitions
     * - status.phase: PENDING/IN_PROGRESS → TERMINATED
     * - status.completed_at: Set to current timestamp
     * - LangGraph checkpoint: May be incomplete (no graceful save)
     * ## Terminated vs Cancelled
     * | Aspect | cancel | terminate |
     * |--------|--------|-----------|
     * | Signal to agent | Yes (can handle) | No |
     * | Checkpoint saved | Yes (graceful) | No |
     * | Use case | Normal stop | Stuck agents |
     * | Can recover? | No | No |
     * ## Idempotency
     * Terminating an already-terminated execution succeeds as a no-op.
     * ## Error Cases
     * - NOT_FOUND: Execution with given ID doesn't exist
     * - PERMISSION_DENIED: User lacks can_edit permission on the execution
     * - FAILED_PRECONDITION: Execution is in a terminal phase
     * - INVALID_ARGUMENT: ID is empty or malformed
     * &#64;since Agent Execution Lifecycle
     * </pre>
     */
    default void terminate(ai.stigmer.agentic.agentexecution.v1.TerminateAgentExecutionInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.agentexecution.v1.AgentExecution> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getTerminateMethod(), responseObserver);
    }

    /**
     * <pre>
     * Recover a failed agent execution from the last checkpoint.
     * Resumes execution from the last checkpoint. Completed work is preserved -
     * successful tool calls are NOT re-executed.
     * &#64;internal
     * Temporal Equivalent: `temporal workflow reset --workflow-id &lt;id&gt; --type LastWorkflowTask`
     * Uses LangGraph checkpoint for state restoration.
     * ## Behavior
     * 1. Validates execution is in FAILED phase (recoverable)
     * 2. Uses Temporal ResetWorkflow to resume from last checkpoint
     * 3. Activity re-invoked with same thread_id
     * 4. LangGraph loads from checkpoint automatically
     * 5. Execution transitions from FAILED to IN_PROGRESS phase
     * 6. Agent continues from where it failed
     * ## Preconditions
     * - Execution must be in EXECUTION_FAILED phase
     * - TERMINATED executions cannot be recovered (incomplete checkpoint)
     * - CANCELLED executions cannot be recovered (intentional user action)
     * ## State Transitions
     * - status.phase: FAILED → IN_PROGRESS
     * - status.completed_at: Cleared
     * - status.error: Cleared
     * - Completed tool calls: Preserved (not re-executed)
     * ## Idempotency
     * If recovery already succeeded (execution is now IN_PROGRESS),
     * the call succeeds as a no-op.
     * ## Error Cases
     * - NOT_FOUND: Execution with given ID doesn't exist
     * - PERMISSION_DENIED: User lacks can_edit permission
     * - FAILED_PRECONDITION: Execution is not in FAILED phase
     * - INVALID_ARGUMENT: ID is empty or malformed
     * &#64;since Agent Execution Lifecycle
     * </pre>
     */
    default void recover(ai.stigmer.agentic.agentexecution.v1.RecoverAgentExecutionInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.agentexecution.v1.AgentExecution> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getRecoverMethod(), responseObserver);
    }

    /**
     * <pre>
     * Pause a running agent execution.
     * Temporarily stops the agent at its current checkpoint. Unlike cancel,
     * the execution is NOT terminal and can be resumed later from where it left off.
     * &#64;internal
     * ## Behavior
     * 1. Validates execution exists and is in a pausable phase
     * 2. Sends "pause" signal to Temporal workflow
     * 3. Workflow cancels running activity gracefully
     * 4. Python activity saves LangGraph checkpoint on cancellation
     * 5. Execution transitions to EXECUTION_PAUSED phase
     * 6. Workflow waits for resume signal (no resources consumed)
     * ## Preconditions
     * - Execution must be in EXECUTION_PENDING or EXECUTION_IN_PROGRESS phase
     * - Cannot pause already-terminal or already-paused executions
     * ## State Transitions
     * - status.phase: PENDING/IN_PROGRESS → PAUSED
     * - status.completed_at: NOT set (execution is not finished)
     * - LangGraph checkpoint: Saved via thread_id
     * ## Paused vs Cancelled
     * | Aspect | pause | cancel |
     * |--------|-------|--------|
     * | Terminal state? | No | Yes |
     * | Can resume? | Yes (via resume RPC) | No |
     * | Checkpoint saved? | Yes | Best-effort |
     * | Use case | Temporary stop | Permanent stop |
     * ## Idempotency
     * Pausing an already-paused execution succeeds as a no-op.
     * ## Error Cases
     * - NOT_FOUND: Execution with given ID doesn't exist
     * - PERMISSION_DENIED: User lacks can_edit permission
     * - FAILED_PRECONDITION: Execution is in a terminal phase
     * - INVALID_ARGUMENT: ID is empty or malformed
     * &#64;since Agent Execution Lifecycle
     * </pre>
     */
    default void pause(ai.stigmer.agentic.agentexecution.v1.PauseAgentExecutionInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.agentexecution.v1.AgentExecution> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getPauseMethod(), responseObserver);
    }

    /**
     * <pre>
     * Resume a paused agent execution.
     * Continues execution from the checkpoint where it was paused. The agent
     * re-invokes with the same thread_id, loading from LangGraph checkpoint
     * and continuing from where it left off.
     * &#64;internal
     * ## Behavior
     * 1. Validates execution is in EXECUTION_PAUSED phase
     * 2. Sends "resume" signal to Temporal workflow
     * 3. Workflow unblocks and re-invokes activity
     * 4. Activity loads from LangGraph checkpoint using thread_id
     * 5. Execution transitions back to EXECUTION_IN_PROGRESS phase
     * 6. Agent continues from exact pause point
     * ## Preconditions
     * - Execution must be in EXECUTION_PAUSED phase
     * - Cannot resume non-paused executions
     * ## State Transitions
     * - status.phase: PAUSED → IN_PROGRESS
     * - Activities: Re-invoked, load from checkpoint
     * - LangGraph state: Loaded from checkpoint via thread_id
     * ## Idempotency
     * Resuming an already-running execution succeeds as a no-op.
     * ## Error Cases
     * - NOT_FOUND: Execution with given ID doesn't exist
     * - PERMISSION_DENIED: User lacks can_edit permission
     * - FAILED_PRECONDITION: Execution is not in PAUSED phase
     * - INVALID_ARGUMENT: ID is empty or malformed
     * &#64;since Agent Execution Lifecycle
     * </pre>
     */
    default void resume(ai.stigmer.agentic.agentexecution.v1.ResumeAgentExecutionInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.agentexecution.v1.AgentExecution> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getResumeMethod(), responseObserver);
    }

    /**
     * <pre>
     * Upload a file attachment for use in an agent execution.
     * Pre-uploads files to artifact storage before creating an execution.
     * The returned storage_key can be used in Attachment.storage_key when
     * creating the execution.
     * &#64;internal
     * ## Authorization
     * This endpoint does not require authorization. The storage_key returned
     * acts as a capability token - knowing the key grants access to the content.
     * This simplifies the upload flow for CLI and other clients.
     * ## Storage Path
     * Files are stored at: attachments/{ulid}/{filename}
     * The ULID ensures unique paths and enables future cleanup policies.
     * ## Use Cases
     * - CLI uploading files (&gt;4MB) before agent execution
     * - Pre-uploading datasets for agent processing
     * - Uploading binary files that cannot be embedded inline in Attachment
     * ## Example Flow
     * 1. Client calls uploadAttachment with file content
     * 2. Server uploads to storage, returns storage_key
     * 3. Client creates AgentExecution with Attachment using storage_key
     * 4. Agent-runner downloads attachment content when execution starts
     * &#64;since Artifact Lifecycle (Attachments &amp; Artifacts)
     * </pre>
     */
    default void uploadAttachment(ai.stigmer.agentic.agentexecution.v1.UploadAttachmentRequest request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.agentexecution.v1.UploadAttachmentResponse> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getUploadAttachmentMethod(), responseObserver);
    }
  }

  /**
   * Base class for the server implementation of the service AgentExecutionCommandController.
   * <pre>
   * AgentExecutionCommandController handles write operations for agent executions.
   * Follows the standard pattern: create, update, delete (no granular field updates).
   * </pre>
   */
  public static abstract class AgentExecutionCommandControllerImplBase
      implements io.grpc.BindableService, AsyncService {

    @java.lang.Override public final io.grpc.ServerServiceDefinition bindService() {
      return AgentExecutionCommandControllerGrpc.bindService(this);
    }
  }

  /**
   * A stub to allow clients to do asynchronous rpc calls to service AgentExecutionCommandController.
   * <pre>
   * AgentExecutionCommandController handles write operations for agent executions.
   * Follows the standard pattern: create, update, delete (no granular field updates).
   * </pre>
   */
  public static final class AgentExecutionCommandControllerStub
      extends io.grpc.stub.AbstractAsyncStub<AgentExecutionCommandControllerStub> {
    private AgentExecutionCommandControllerStub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected AgentExecutionCommandControllerStub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new AgentExecutionCommandControllerStub(channel, callOptions);
    }

    /**
     * <pre>
     * Create and trigger a new agent execution.
     * Session is optional — can be provided or auto-created from agent_id.
     * &#64;internal
     * Authorization is handled in handler:
     *   - If session_id provided: checks can_create_execution_in on session
     *   - If session_id NOT provided: checks can_create_execution_in on organization
     * </pre>
     */
    public void create(ai.stigmer.agentic.agentexecution.v1.AgentExecution request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.agentexecution.v1.AgentExecution> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getCreateMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * Update an agent execution.
     * &#64;internal
     * Used by users to update execution configuration (spec fields).
     * No individual field updates - always provide complete state.
     * </pre>
     */
    public void update(ai.stigmer.agentic.agentexecution.v1.AgentExecution request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.agentexecution.v1.AgentExecution> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getUpdateMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * Update an agent execution's status.
     * &#64;internal
     * Used by agent-runner to send progressive status updates (messages,
     * tool_calls, phase, etc.). The runner authenticates as the triggering user,
     * who owns the execution through the session ownership chain.
     * Optimized for frequent status updates and merges status fields with
     * existing state.
     * </pre>
     */
    public void updateStatus(ai.stigmer.agentic.agentexecution.v1.AgentExecutionUpdateStatusInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.agentexecution.v1.UpdateStatusResponse> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getUpdateStatusMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * Record proxy-observed LLM usage for an agent execution.
     * &#64;internal
     * Called by the LLM/Cursor proxy after each streaming response completes.
     * The proxy extracts token counts from the provider's SSE stream and reports
     * them here. The handler computes provider cost server-side from the model
     * registry (never trusts caller-supplied cost), writes trusted usage to the
     * execution, and debits billing credits as a side effect.
     * ## Authorization
     * Operator-only. The proxy authenticates as the platform operator identity.
     * Regular users and runners cannot call this RPC.
     * ## Idempotency
     * Deduplicated by (execution_id, sequence). Safe to retry on transient failures.
     * ## Signal Delivery
     * This RPC does NOT return a billing signal. The proxy is a transparent byte
     * pipe and cannot act on STOP/WARNING. Billing signals are delivered to the
     * runner through the updateStatus response.
     * </pre>
     */
    public void updateUsage(ai.stigmer.agentic.agentexecution.v1.UpdateUsageInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.agentexecution.v1.UpdateUsageResponse> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getUpdateUsageMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * Delete an agent execution by ID.
     * </pre>
     */
    public void delete(ai.stigmer.commons.apiresource.ApiResourceId request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.agentexecution.v1.AgentExecution> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getDeleteMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * Submit an approval decision for a pending tool call.
     * ## Preconditions
     * - Execution must be in EXECUTION_WAITING_FOR_APPROVAL phase
     * - tool_call_id must match status.pending_approval.tool_call_id
     * - User must have can_edit permission on the execution
     * ## Behavior by Action
     * - APPROVE: Tool executes normally, execution resumes to IN_PROGRESS
     * - SKIP: Tool returns skip message to LLM, execution continues to IN_PROGRESS
     * - REJECT: Execution fails with rejection error, phase becomes FAILED
     * &#64;internal
     * ## State Transitions
     * On success:
     * - ToolCall.approval_action = submitted action
     * - ToolCall.approval_decided_at = current timestamp
     * - ToolCall.approved_by = authenticated user ID
     * - AgentExecutionStatus.pending_approval = cleared
     * - ExecutionPhase = EXECUTION_IN_PROGRESS (or EXECUTION_FAILED if REJECT)
     * ## Error Conditions
     * - NOT_FOUND: Execution doesn't exist
     * - FAILED_PRECONDITION: Execution not in WAITING_FOR_APPROVAL phase
     * - INVALID_ARGUMENT: tool_call_id doesn't match pending approval, or action is UNSPECIFIED
     * - PERMISSION_DENIED: User lacks can_edit permission
     * ## Idempotency
     * If the same approval is submitted twice (same execution, tool_call, action),
     * the second call is a no-op and returns the current state.
     * </pre>
     */
    public void submitApproval(ai.stigmer.agentic.agentexecution.v1.SubmitApprovalInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.agentexecution.v1.AgentExecution> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getSubmitApprovalMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * Cancel a running agent execution gracefully.
     * Sends a cancellation signal to the agent execution. The agent can handle
     * the cancellation signal to save checkpoint and clean up before
     * transitioning to the CANCELLED phase.
     * &#64;internal
     * Temporal Equivalent: `temporal workflow cancel --workflow-id &lt;id&gt;`
     * ## Behavior
     * 1. Validates execution exists and is in a cancellable phase
     * 2. Sends cancellation signal to Temporal workflow
     * 3. Python activity receives cancellation and saves LangGraph checkpoint
     * 4. Execution transitions to EXECUTION_CANCELLED phase
     * 5. Returns updated AgentExecution with new phase
     * ## Preconditions
     * - Execution must be in EXECUTION_PENDING or EXECUTION_IN_PROGRESS phase
     * - Cannot cancel already-terminal executions (COMPLETED, FAILED, CANCELLED, TERMINATED)
     * ## State Transitions
     * - status.phase: PENDING/IN_PROGRESS → CANCELLED
     * - status.completed_at: Set to current timestamp
     * - LangGraph checkpoint: Preserved for potential future reference
     * ## Idempotency
     * Cancelling an already-cancelled execution succeeds as a no-op.
     * The call returns the current execution state without side effects.
     * ## Error Cases
     * - NOT_FOUND: Execution with given ID doesn't exist
     * - PERMISSION_DENIED: User lacks can_edit permission on the execution
     * - FAILED_PRECONDITION: Execution is in a terminal phase
     * - INVALID_ARGUMENT: ID is empty or malformed
     * &#64;since Agent Execution Lifecycle
     * </pre>
     */
    public void cancel(ai.stigmer.agentic.agentexecution.v1.CancelAgentExecutionInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.agentexecution.v1.AgentExecution> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getCancelMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * Terminate an agent execution immediately.
     * Force-stops the agent execution without allowing cleanup. Unlike cancel,
     * the agent cannot respond to termination - it is stopped immediately.
     * Use this for stuck or unresponsive agents.
     * &#64;internal
     * Temporal Equivalent: `temporal workflow terminate --workflow-id &lt;id&gt;`
     * ## Behavior
     * 1. Validates execution exists and is in a terminable phase
     * 2. Force-kills workflow via Temporal (no signal sent to agent)
     * 3. Execution transitions to EXECUTION_TERMINATED phase immediately
     * 4. No cleanup callbacks or checkpoint saves occur
     * 5. Returns updated AgentExecution with TERMINATED phase
     * ## Preconditions
     * - Execution must be in EXECUTION_PENDING or EXECUTION_IN_PROGRESS phase
     * - Cannot terminate already-terminal executions
     * ## State Transitions
     * - status.phase: PENDING/IN_PROGRESS → TERMINATED
     * - status.completed_at: Set to current timestamp
     * - LangGraph checkpoint: May be incomplete (no graceful save)
     * ## Terminated vs Cancelled
     * | Aspect | cancel | terminate |
     * |--------|--------|-----------|
     * | Signal to agent | Yes (can handle) | No |
     * | Checkpoint saved | Yes (graceful) | No |
     * | Use case | Normal stop | Stuck agents |
     * | Can recover? | No | No |
     * ## Idempotency
     * Terminating an already-terminated execution succeeds as a no-op.
     * ## Error Cases
     * - NOT_FOUND: Execution with given ID doesn't exist
     * - PERMISSION_DENIED: User lacks can_edit permission on the execution
     * - FAILED_PRECONDITION: Execution is in a terminal phase
     * - INVALID_ARGUMENT: ID is empty or malformed
     * &#64;since Agent Execution Lifecycle
     * </pre>
     */
    public void terminate(ai.stigmer.agentic.agentexecution.v1.TerminateAgentExecutionInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.agentexecution.v1.AgentExecution> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getTerminateMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * Recover a failed agent execution from the last checkpoint.
     * Resumes execution from the last checkpoint. Completed work is preserved -
     * successful tool calls are NOT re-executed.
     * &#64;internal
     * Temporal Equivalent: `temporal workflow reset --workflow-id &lt;id&gt; --type LastWorkflowTask`
     * Uses LangGraph checkpoint for state restoration.
     * ## Behavior
     * 1. Validates execution is in FAILED phase (recoverable)
     * 2. Uses Temporal ResetWorkflow to resume from last checkpoint
     * 3. Activity re-invoked with same thread_id
     * 4. LangGraph loads from checkpoint automatically
     * 5. Execution transitions from FAILED to IN_PROGRESS phase
     * 6. Agent continues from where it failed
     * ## Preconditions
     * - Execution must be in EXECUTION_FAILED phase
     * - TERMINATED executions cannot be recovered (incomplete checkpoint)
     * - CANCELLED executions cannot be recovered (intentional user action)
     * ## State Transitions
     * - status.phase: FAILED → IN_PROGRESS
     * - status.completed_at: Cleared
     * - status.error: Cleared
     * - Completed tool calls: Preserved (not re-executed)
     * ## Idempotency
     * If recovery already succeeded (execution is now IN_PROGRESS),
     * the call succeeds as a no-op.
     * ## Error Cases
     * - NOT_FOUND: Execution with given ID doesn't exist
     * - PERMISSION_DENIED: User lacks can_edit permission
     * - FAILED_PRECONDITION: Execution is not in FAILED phase
     * - INVALID_ARGUMENT: ID is empty or malformed
     * &#64;since Agent Execution Lifecycle
     * </pre>
     */
    public void recover(ai.stigmer.agentic.agentexecution.v1.RecoverAgentExecutionInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.agentexecution.v1.AgentExecution> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getRecoverMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * Pause a running agent execution.
     * Temporarily stops the agent at its current checkpoint. Unlike cancel,
     * the execution is NOT terminal and can be resumed later from where it left off.
     * &#64;internal
     * ## Behavior
     * 1. Validates execution exists and is in a pausable phase
     * 2. Sends "pause" signal to Temporal workflow
     * 3. Workflow cancels running activity gracefully
     * 4. Python activity saves LangGraph checkpoint on cancellation
     * 5. Execution transitions to EXECUTION_PAUSED phase
     * 6. Workflow waits for resume signal (no resources consumed)
     * ## Preconditions
     * - Execution must be in EXECUTION_PENDING or EXECUTION_IN_PROGRESS phase
     * - Cannot pause already-terminal or already-paused executions
     * ## State Transitions
     * - status.phase: PENDING/IN_PROGRESS → PAUSED
     * - status.completed_at: NOT set (execution is not finished)
     * - LangGraph checkpoint: Saved via thread_id
     * ## Paused vs Cancelled
     * | Aspect | pause | cancel |
     * |--------|-------|--------|
     * | Terminal state? | No | Yes |
     * | Can resume? | Yes (via resume RPC) | No |
     * | Checkpoint saved? | Yes | Best-effort |
     * | Use case | Temporary stop | Permanent stop |
     * ## Idempotency
     * Pausing an already-paused execution succeeds as a no-op.
     * ## Error Cases
     * - NOT_FOUND: Execution with given ID doesn't exist
     * - PERMISSION_DENIED: User lacks can_edit permission
     * - FAILED_PRECONDITION: Execution is in a terminal phase
     * - INVALID_ARGUMENT: ID is empty or malformed
     * &#64;since Agent Execution Lifecycle
     * </pre>
     */
    public void pause(ai.stigmer.agentic.agentexecution.v1.PauseAgentExecutionInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.agentexecution.v1.AgentExecution> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getPauseMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * Resume a paused agent execution.
     * Continues execution from the checkpoint where it was paused. The agent
     * re-invokes with the same thread_id, loading from LangGraph checkpoint
     * and continuing from where it left off.
     * &#64;internal
     * ## Behavior
     * 1. Validates execution is in EXECUTION_PAUSED phase
     * 2. Sends "resume" signal to Temporal workflow
     * 3. Workflow unblocks and re-invokes activity
     * 4. Activity loads from LangGraph checkpoint using thread_id
     * 5. Execution transitions back to EXECUTION_IN_PROGRESS phase
     * 6. Agent continues from exact pause point
     * ## Preconditions
     * - Execution must be in EXECUTION_PAUSED phase
     * - Cannot resume non-paused executions
     * ## State Transitions
     * - status.phase: PAUSED → IN_PROGRESS
     * - Activities: Re-invoked, load from checkpoint
     * - LangGraph state: Loaded from checkpoint via thread_id
     * ## Idempotency
     * Resuming an already-running execution succeeds as a no-op.
     * ## Error Cases
     * - NOT_FOUND: Execution with given ID doesn't exist
     * - PERMISSION_DENIED: User lacks can_edit permission
     * - FAILED_PRECONDITION: Execution is not in PAUSED phase
     * - INVALID_ARGUMENT: ID is empty or malformed
     * &#64;since Agent Execution Lifecycle
     * </pre>
     */
    public void resume(ai.stigmer.agentic.agentexecution.v1.ResumeAgentExecutionInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.agentexecution.v1.AgentExecution> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getResumeMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * Upload a file attachment for use in an agent execution.
     * Pre-uploads files to artifact storage before creating an execution.
     * The returned storage_key can be used in Attachment.storage_key when
     * creating the execution.
     * &#64;internal
     * ## Authorization
     * This endpoint does not require authorization. The storage_key returned
     * acts as a capability token - knowing the key grants access to the content.
     * This simplifies the upload flow for CLI and other clients.
     * ## Storage Path
     * Files are stored at: attachments/{ulid}/{filename}
     * The ULID ensures unique paths and enables future cleanup policies.
     * ## Use Cases
     * - CLI uploading files (&gt;4MB) before agent execution
     * - Pre-uploading datasets for agent processing
     * - Uploading binary files that cannot be embedded inline in Attachment
     * ## Example Flow
     * 1. Client calls uploadAttachment with file content
     * 2. Server uploads to storage, returns storage_key
     * 3. Client creates AgentExecution with Attachment using storage_key
     * 4. Agent-runner downloads attachment content when execution starts
     * &#64;since Artifact Lifecycle (Attachments &amp; Artifacts)
     * </pre>
     */
    public void uploadAttachment(ai.stigmer.agentic.agentexecution.v1.UploadAttachmentRequest request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.agentexecution.v1.UploadAttachmentResponse> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getUploadAttachmentMethod(), getCallOptions()), request, responseObserver);
    }
  }

  /**
   * A stub to allow clients to do synchronous rpc calls to service AgentExecutionCommandController.
   * <pre>
   * AgentExecutionCommandController handles write operations for agent executions.
   * Follows the standard pattern: create, update, delete (no granular field updates).
   * </pre>
   */
  public static final class AgentExecutionCommandControllerBlockingV2Stub
      extends io.grpc.stub.AbstractBlockingStub<AgentExecutionCommandControllerBlockingV2Stub> {
    private AgentExecutionCommandControllerBlockingV2Stub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected AgentExecutionCommandControllerBlockingV2Stub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new AgentExecutionCommandControllerBlockingV2Stub(channel, callOptions);
    }

    /**
     * <pre>
     * Create and trigger a new agent execution.
     * Session is optional — can be provided or auto-created from agent_id.
     * &#64;internal
     * Authorization is handled in handler:
     *   - If session_id provided: checks can_create_execution_in on session
     *   - If session_id NOT provided: checks can_create_execution_in on organization
     * </pre>
     */
    public ai.stigmer.agentic.agentexecution.v1.AgentExecution create(ai.stigmer.agentic.agentexecution.v1.AgentExecution request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getCreateMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Update an agent execution.
     * &#64;internal
     * Used by users to update execution configuration (spec fields).
     * No individual field updates - always provide complete state.
     * </pre>
     */
    public ai.stigmer.agentic.agentexecution.v1.AgentExecution update(ai.stigmer.agentic.agentexecution.v1.AgentExecution request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getUpdateMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Update an agent execution's status.
     * &#64;internal
     * Used by agent-runner to send progressive status updates (messages,
     * tool_calls, phase, etc.). The runner authenticates as the triggering user,
     * who owns the execution through the session ownership chain.
     * Optimized for frequent status updates and merges status fields with
     * existing state.
     * </pre>
     */
    public ai.stigmer.agentic.agentexecution.v1.UpdateStatusResponse updateStatus(ai.stigmer.agentic.agentexecution.v1.AgentExecutionUpdateStatusInput request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getUpdateStatusMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Record proxy-observed LLM usage for an agent execution.
     * &#64;internal
     * Called by the LLM/Cursor proxy after each streaming response completes.
     * The proxy extracts token counts from the provider's SSE stream and reports
     * them here. The handler computes provider cost server-side from the model
     * registry (never trusts caller-supplied cost), writes trusted usage to the
     * execution, and debits billing credits as a side effect.
     * ## Authorization
     * Operator-only. The proxy authenticates as the platform operator identity.
     * Regular users and runners cannot call this RPC.
     * ## Idempotency
     * Deduplicated by (execution_id, sequence). Safe to retry on transient failures.
     * ## Signal Delivery
     * This RPC does NOT return a billing signal. The proxy is a transparent byte
     * pipe and cannot act on STOP/WARNING. Billing signals are delivered to the
     * runner through the updateStatus response.
     * </pre>
     */
    public ai.stigmer.agentic.agentexecution.v1.UpdateUsageResponse updateUsage(ai.stigmer.agentic.agentexecution.v1.UpdateUsageInput request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getUpdateUsageMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Delete an agent execution by ID.
     * </pre>
     */
    public ai.stigmer.agentic.agentexecution.v1.AgentExecution delete(ai.stigmer.commons.apiresource.ApiResourceId request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getDeleteMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Submit an approval decision for a pending tool call.
     * ## Preconditions
     * - Execution must be in EXECUTION_WAITING_FOR_APPROVAL phase
     * - tool_call_id must match status.pending_approval.tool_call_id
     * - User must have can_edit permission on the execution
     * ## Behavior by Action
     * - APPROVE: Tool executes normally, execution resumes to IN_PROGRESS
     * - SKIP: Tool returns skip message to LLM, execution continues to IN_PROGRESS
     * - REJECT: Execution fails with rejection error, phase becomes FAILED
     * &#64;internal
     * ## State Transitions
     * On success:
     * - ToolCall.approval_action = submitted action
     * - ToolCall.approval_decided_at = current timestamp
     * - ToolCall.approved_by = authenticated user ID
     * - AgentExecutionStatus.pending_approval = cleared
     * - ExecutionPhase = EXECUTION_IN_PROGRESS (or EXECUTION_FAILED if REJECT)
     * ## Error Conditions
     * - NOT_FOUND: Execution doesn't exist
     * - FAILED_PRECONDITION: Execution not in WAITING_FOR_APPROVAL phase
     * - INVALID_ARGUMENT: tool_call_id doesn't match pending approval, or action is UNSPECIFIED
     * - PERMISSION_DENIED: User lacks can_edit permission
     * ## Idempotency
     * If the same approval is submitted twice (same execution, tool_call, action),
     * the second call is a no-op and returns the current state.
     * </pre>
     */
    public ai.stigmer.agentic.agentexecution.v1.AgentExecution submitApproval(ai.stigmer.agentic.agentexecution.v1.SubmitApprovalInput request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getSubmitApprovalMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Cancel a running agent execution gracefully.
     * Sends a cancellation signal to the agent execution. The agent can handle
     * the cancellation signal to save checkpoint and clean up before
     * transitioning to the CANCELLED phase.
     * &#64;internal
     * Temporal Equivalent: `temporal workflow cancel --workflow-id &lt;id&gt;`
     * ## Behavior
     * 1. Validates execution exists and is in a cancellable phase
     * 2. Sends cancellation signal to Temporal workflow
     * 3. Python activity receives cancellation and saves LangGraph checkpoint
     * 4. Execution transitions to EXECUTION_CANCELLED phase
     * 5. Returns updated AgentExecution with new phase
     * ## Preconditions
     * - Execution must be in EXECUTION_PENDING or EXECUTION_IN_PROGRESS phase
     * - Cannot cancel already-terminal executions (COMPLETED, FAILED, CANCELLED, TERMINATED)
     * ## State Transitions
     * - status.phase: PENDING/IN_PROGRESS → CANCELLED
     * - status.completed_at: Set to current timestamp
     * - LangGraph checkpoint: Preserved for potential future reference
     * ## Idempotency
     * Cancelling an already-cancelled execution succeeds as a no-op.
     * The call returns the current execution state without side effects.
     * ## Error Cases
     * - NOT_FOUND: Execution with given ID doesn't exist
     * - PERMISSION_DENIED: User lacks can_edit permission on the execution
     * - FAILED_PRECONDITION: Execution is in a terminal phase
     * - INVALID_ARGUMENT: ID is empty or malformed
     * &#64;since Agent Execution Lifecycle
     * </pre>
     */
    public ai.stigmer.agentic.agentexecution.v1.AgentExecution cancel(ai.stigmer.agentic.agentexecution.v1.CancelAgentExecutionInput request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getCancelMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Terminate an agent execution immediately.
     * Force-stops the agent execution without allowing cleanup. Unlike cancel,
     * the agent cannot respond to termination - it is stopped immediately.
     * Use this for stuck or unresponsive agents.
     * &#64;internal
     * Temporal Equivalent: `temporal workflow terminate --workflow-id &lt;id&gt;`
     * ## Behavior
     * 1. Validates execution exists and is in a terminable phase
     * 2. Force-kills workflow via Temporal (no signal sent to agent)
     * 3. Execution transitions to EXECUTION_TERMINATED phase immediately
     * 4. No cleanup callbacks or checkpoint saves occur
     * 5. Returns updated AgentExecution with TERMINATED phase
     * ## Preconditions
     * - Execution must be in EXECUTION_PENDING or EXECUTION_IN_PROGRESS phase
     * - Cannot terminate already-terminal executions
     * ## State Transitions
     * - status.phase: PENDING/IN_PROGRESS → TERMINATED
     * - status.completed_at: Set to current timestamp
     * - LangGraph checkpoint: May be incomplete (no graceful save)
     * ## Terminated vs Cancelled
     * | Aspect | cancel | terminate |
     * |--------|--------|-----------|
     * | Signal to agent | Yes (can handle) | No |
     * | Checkpoint saved | Yes (graceful) | No |
     * | Use case | Normal stop | Stuck agents |
     * | Can recover? | No | No |
     * ## Idempotency
     * Terminating an already-terminated execution succeeds as a no-op.
     * ## Error Cases
     * - NOT_FOUND: Execution with given ID doesn't exist
     * - PERMISSION_DENIED: User lacks can_edit permission on the execution
     * - FAILED_PRECONDITION: Execution is in a terminal phase
     * - INVALID_ARGUMENT: ID is empty or malformed
     * &#64;since Agent Execution Lifecycle
     * </pre>
     */
    public ai.stigmer.agentic.agentexecution.v1.AgentExecution terminate(ai.stigmer.agentic.agentexecution.v1.TerminateAgentExecutionInput request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getTerminateMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Recover a failed agent execution from the last checkpoint.
     * Resumes execution from the last checkpoint. Completed work is preserved -
     * successful tool calls are NOT re-executed.
     * &#64;internal
     * Temporal Equivalent: `temporal workflow reset --workflow-id &lt;id&gt; --type LastWorkflowTask`
     * Uses LangGraph checkpoint for state restoration.
     * ## Behavior
     * 1. Validates execution is in FAILED phase (recoverable)
     * 2. Uses Temporal ResetWorkflow to resume from last checkpoint
     * 3. Activity re-invoked with same thread_id
     * 4. LangGraph loads from checkpoint automatically
     * 5. Execution transitions from FAILED to IN_PROGRESS phase
     * 6. Agent continues from where it failed
     * ## Preconditions
     * - Execution must be in EXECUTION_FAILED phase
     * - TERMINATED executions cannot be recovered (incomplete checkpoint)
     * - CANCELLED executions cannot be recovered (intentional user action)
     * ## State Transitions
     * - status.phase: FAILED → IN_PROGRESS
     * - status.completed_at: Cleared
     * - status.error: Cleared
     * - Completed tool calls: Preserved (not re-executed)
     * ## Idempotency
     * If recovery already succeeded (execution is now IN_PROGRESS),
     * the call succeeds as a no-op.
     * ## Error Cases
     * - NOT_FOUND: Execution with given ID doesn't exist
     * - PERMISSION_DENIED: User lacks can_edit permission
     * - FAILED_PRECONDITION: Execution is not in FAILED phase
     * - INVALID_ARGUMENT: ID is empty or malformed
     * &#64;since Agent Execution Lifecycle
     * </pre>
     */
    public ai.stigmer.agentic.agentexecution.v1.AgentExecution recover(ai.stigmer.agentic.agentexecution.v1.RecoverAgentExecutionInput request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getRecoverMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Pause a running agent execution.
     * Temporarily stops the agent at its current checkpoint. Unlike cancel,
     * the execution is NOT terminal and can be resumed later from where it left off.
     * &#64;internal
     * ## Behavior
     * 1. Validates execution exists and is in a pausable phase
     * 2. Sends "pause" signal to Temporal workflow
     * 3. Workflow cancels running activity gracefully
     * 4. Python activity saves LangGraph checkpoint on cancellation
     * 5. Execution transitions to EXECUTION_PAUSED phase
     * 6. Workflow waits for resume signal (no resources consumed)
     * ## Preconditions
     * - Execution must be in EXECUTION_PENDING or EXECUTION_IN_PROGRESS phase
     * - Cannot pause already-terminal or already-paused executions
     * ## State Transitions
     * - status.phase: PENDING/IN_PROGRESS → PAUSED
     * - status.completed_at: NOT set (execution is not finished)
     * - LangGraph checkpoint: Saved via thread_id
     * ## Paused vs Cancelled
     * | Aspect | pause | cancel |
     * |--------|-------|--------|
     * | Terminal state? | No | Yes |
     * | Can resume? | Yes (via resume RPC) | No |
     * | Checkpoint saved? | Yes | Best-effort |
     * | Use case | Temporary stop | Permanent stop |
     * ## Idempotency
     * Pausing an already-paused execution succeeds as a no-op.
     * ## Error Cases
     * - NOT_FOUND: Execution with given ID doesn't exist
     * - PERMISSION_DENIED: User lacks can_edit permission
     * - FAILED_PRECONDITION: Execution is in a terminal phase
     * - INVALID_ARGUMENT: ID is empty or malformed
     * &#64;since Agent Execution Lifecycle
     * </pre>
     */
    public ai.stigmer.agentic.agentexecution.v1.AgentExecution pause(ai.stigmer.agentic.agentexecution.v1.PauseAgentExecutionInput request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getPauseMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Resume a paused agent execution.
     * Continues execution from the checkpoint where it was paused. The agent
     * re-invokes with the same thread_id, loading from LangGraph checkpoint
     * and continuing from where it left off.
     * &#64;internal
     * ## Behavior
     * 1. Validates execution is in EXECUTION_PAUSED phase
     * 2. Sends "resume" signal to Temporal workflow
     * 3. Workflow unblocks and re-invokes activity
     * 4. Activity loads from LangGraph checkpoint using thread_id
     * 5. Execution transitions back to EXECUTION_IN_PROGRESS phase
     * 6. Agent continues from exact pause point
     * ## Preconditions
     * - Execution must be in EXECUTION_PAUSED phase
     * - Cannot resume non-paused executions
     * ## State Transitions
     * - status.phase: PAUSED → IN_PROGRESS
     * - Activities: Re-invoked, load from checkpoint
     * - LangGraph state: Loaded from checkpoint via thread_id
     * ## Idempotency
     * Resuming an already-running execution succeeds as a no-op.
     * ## Error Cases
     * - NOT_FOUND: Execution with given ID doesn't exist
     * - PERMISSION_DENIED: User lacks can_edit permission
     * - FAILED_PRECONDITION: Execution is not in PAUSED phase
     * - INVALID_ARGUMENT: ID is empty or malformed
     * &#64;since Agent Execution Lifecycle
     * </pre>
     */
    public ai.stigmer.agentic.agentexecution.v1.AgentExecution resume(ai.stigmer.agentic.agentexecution.v1.ResumeAgentExecutionInput request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getResumeMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Upload a file attachment for use in an agent execution.
     * Pre-uploads files to artifact storage before creating an execution.
     * The returned storage_key can be used in Attachment.storage_key when
     * creating the execution.
     * &#64;internal
     * ## Authorization
     * This endpoint does not require authorization. The storage_key returned
     * acts as a capability token - knowing the key grants access to the content.
     * This simplifies the upload flow for CLI and other clients.
     * ## Storage Path
     * Files are stored at: attachments/{ulid}/{filename}
     * The ULID ensures unique paths and enables future cleanup policies.
     * ## Use Cases
     * - CLI uploading files (&gt;4MB) before agent execution
     * - Pre-uploading datasets for agent processing
     * - Uploading binary files that cannot be embedded inline in Attachment
     * ## Example Flow
     * 1. Client calls uploadAttachment with file content
     * 2. Server uploads to storage, returns storage_key
     * 3. Client creates AgentExecution with Attachment using storage_key
     * 4. Agent-runner downloads attachment content when execution starts
     * &#64;since Artifact Lifecycle (Attachments &amp; Artifacts)
     * </pre>
     */
    public ai.stigmer.agentic.agentexecution.v1.UploadAttachmentResponse uploadAttachment(ai.stigmer.agentic.agentexecution.v1.UploadAttachmentRequest request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getUploadAttachmentMethod(), getCallOptions(), request);
    }
  }

  /**
   * A stub to allow clients to do limited synchronous rpc calls to service AgentExecutionCommandController.
   * <pre>
   * AgentExecutionCommandController handles write operations for agent executions.
   * Follows the standard pattern: create, update, delete (no granular field updates).
   * </pre>
   */
  public static final class AgentExecutionCommandControllerBlockingStub
      extends io.grpc.stub.AbstractBlockingStub<AgentExecutionCommandControllerBlockingStub> {
    private AgentExecutionCommandControllerBlockingStub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected AgentExecutionCommandControllerBlockingStub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new AgentExecutionCommandControllerBlockingStub(channel, callOptions);
    }

    /**
     * <pre>
     * Create and trigger a new agent execution.
     * Session is optional — can be provided or auto-created from agent_id.
     * &#64;internal
     * Authorization is handled in handler:
     *   - If session_id provided: checks can_create_execution_in on session
     *   - If session_id NOT provided: checks can_create_execution_in on organization
     * </pre>
     */
    public ai.stigmer.agentic.agentexecution.v1.AgentExecution create(ai.stigmer.agentic.agentexecution.v1.AgentExecution request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getCreateMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Update an agent execution.
     * &#64;internal
     * Used by users to update execution configuration (spec fields).
     * No individual field updates - always provide complete state.
     * </pre>
     */
    public ai.stigmer.agentic.agentexecution.v1.AgentExecution update(ai.stigmer.agentic.agentexecution.v1.AgentExecution request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getUpdateMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Update an agent execution's status.
     * &#64;internal
     * Used by agent-runner to send progressive status updates (messages,
     * tool_calls, phase, etc.). The runner authenticates as the triggering user,
     * who owns the execution through the session ownership chain.
     * Optimized for frequent status updates and merges status fields with
     * existing state.
     * </pre>
     */
    public ai.stigmer.agentic.agentexecution.v1.UpdateStatusResponse updateStatus(ai.stigmer.agentic.agentexecution.v1.AgentExecutionUpdateStatusInput request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getUpdateStatusMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Record proxy-observed LLM usage for an agent execution.
     * &#64;internal
     * Called by the LLM/Cursor proxy after each streaming response completes.
     * The proxy extracts token counts from the provider's SSE stream and reports
     * them here. The handler computes provider cost server-side from the model
     * registry (never trusts caller-supplied cost), writes trusted usage to the
     * execution, and debits billing credits as a side effect.
     * ## Authorization
     * Operator-only. The proxy authenticates as the platform operator identity.
     * Regular users and runners cannot call this RPC.
     * ## Idempotency
     * Deduplicated by (execution_id, sequence). Safe to retry on transient failures.
     * ## Signal Delivery
     * This RPC does NOT return a billing signal. The proxy is a transparent byte
     * pipe and cannot act on STOP/WARNING. Billing signals are delivered to the
     * runner through the updateStatus response.
     * </pre>
     */
    public ai.stigmer.agentic.agentexecution.v1.UpdateUsageResponse updateUsage(ai.stigmer.agentic.agentexecution.v1.UpdateUsageInput request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getUpdateUsageMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Delete an agent execution by ID.
     * </pre>
     */
    public ai.stigmer.agentic.agentexecution.v1.AgentExecution delete(ai.stigmer.commons.apiresource.ApiResourceId request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getDeleteMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Submit an approval decision for a pending tool call.
     * ## Preconditions
     * - Execution must be in EXECUTION_WAITING_FOR_APPROVAL phase
     * - tool_call_id must match status.pending_approval.tool_call_id
     * - User must have can_edit permission on the execution
     * ## Behavior by Action
     * - APPROVE: Tool executes normally, execution resumes to IN_PROGRESS
     * - SKIP: Tool returns skip message to LLM, execution continues to IN_PROGRESS
     * - REJECT: Execution fails with rejection error, phase becomes FAILED
     * &#64;internal
     * ## State Transitions
     * On success:
     * - ToolCall.approval_action = submitted action
     * - ToolCall.approval_decided_at = current timestamp
     * - ToolCall.approved_by = authenticated user ID
     * - AgentExecutionStatus.pending_approval = cleared
     * - ExecutionPhase = EXECUTION_IN_PROGRESS (or EXECUTION_FAILED if REJECT)
     * ## Error Conditions
     * - NOT_FOUND: Execution doesn't exist
     * - FAILED_PRECONDITION: Execution not in WAITING_FOR_APPROVAL phase
     * - INVALID_ARGUMENT: tool_call_id doesn't match pending approval, or action is UNSPECIFIED
     * - PERMISSION_DENIED: User lacks can_edit permission
     * ## Idempotency
     * If the same approval is submitted twice (same execution, tool_call, action),
     * the second call is a no-op and returns the current state.
     * </pre>
     */
    public ai.stigmer.agentic.agentexecution.v1.AgentExecution submitApproval(ai.stigmer.agentic.agentexecution.v1.SubmitApprovalInput request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getSubmitApprovalMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Cancel a running agent execution gracefully.
     * Sends a cancellation signal to the agent execution. The agent can handle
     * the cancellation signal to save checkpoint and clean up before
     * transitioning to the CANCELLED phase.
     * &#64;internal
     * Temporal Equivalent: `temporal workflow cancel --workflow-id &lt;id&gt;`
     * ## Behavior
     * 1. Validates execution exists and is in a cancellable phase
     * 2. Sends cancellation signal to Temporal workflow
     * 3. Python activity receives cancellation and saves LangGraph checkpoint
     * 4. Execution transitions to EXECUTION_CANCELLED phase
     * 5. Returns updated AgentExecution with new phase
     * ## Preconditions
     * - Execution must be in EXECUTION_PENDING or EXECUTION_IN_PROGRESS phase
     * - Cannot cancel already-terminal executions (COMPLETED, FAILED, CANCELLED, TERMINATED)
     * ## State Transitions
     * - status.phase: PENDING/IN_PROGRESS → CANCELLED
     * - status.completed_at: Set to current timestamp
     * - LangGraph checkpoint: Preserved for potential future reference
     * ## Idempotency
     * Cancelling an already-cancelled execution succeeds as a no-op.
     * The call returns the current execution state without side effects.
     * ## Error Cases
     * - NOT_FOUND: Execution with given ID doesn't exist
     * - PERMISSION_DENIED: User lacks can_edit permission on the execution
     * - FAILED_PRECONDITION: Execution is in a terminal phase
     * - INVALID_ARGUMENT: ID is empty or malformed
     * &#64;since Agent Execution Lifecycle
     * </pre>
     */
    public ai.stigmer.agentic.agentexecution.v1.AgentExecution cancel(ai.stigmer.agentic.agentexecution.v1.CancelAgentExecutionInput request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getCancelMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Terminate an agent execution immediately.
     * Force-stops the agent execution without allowing cleanup. Unlike cancel,
     * the agent cannot respond to termination - it is stopped immediately.
     * Use this for stuck or unresponsive agents.
     * &#64;internal
     * Temporal Equivalent: `temporal workflow terminate --workflow-id &lt;id&gt;`
     * ## Behavior
     * 1. Validates execution exists and is in a terminable phase
     * 2. Force-kills workflow via Temporal (no signal sent to agent)
     * 3. Execution transitions to EXECUTION_TERMINATED phase immediately
     * 4. No cleanup callbacks or checkpoint saves occur
     * 5. Returns updated AgentExecution with TERMINATED phase
     * ## Preconditions
     * - Execution must be in EXECUTION_PENDING or EXECUTION_IN_PROGRESS phase
     * - Cannot terminate already-terminal executions
     * ## State Transitions
     * - status.phase: PENDING/IN_PROGRESS → TERMINATED
     * - status.completed_at: Set to current timestamp
     * - LangGraph checkpoint: May be incomplete (no graceful save)
     * ## Terminated vs Cancelled
     * | Aspect | cancel | terminate |
     * |--------|--------|-----------|
     * | Signal to agent | Yes (can handle) | No |
     * | Checkpoint saved | Yes (graceful) | No |
     * | Use case | Normal stop | Stuck agents |
     * | Can recover? | No | No |
     * ## Idempotency
     * Terminating an already-terminated execution succeeds as a no-op.
     * ## Error Cases
     * - NOT_FOUND: Execution with given ID doesn't exist
     * - PERMISSION_DENIED: User lacks can_edit permission on the execution
     * - FAILED_PRECONDITION: Execution is in a terminal phase
     * - INVALID_ARGUMENT: ID is empty or malformed
     * &#64;since Agent Execution Lifecycle
     * </pre>
     */
    public ai.stigmer.agentic.agentexecution.v1.AgentExecution terminate(ai.stigmer.agentic.agentexecution.v1.TerminateAgentExecutionInput request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getTerminateMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Recover a failed agent execution from the last checkpoint.
     * Resumes execution from the last checkpoint. Completed work is preserved -
     * successful tool calls are NOT re-executed.
     * &#64;internal
     * Temporal Equivalent: `temporal workflow reset --workflow-id &lt;id&gt; --type LastWorkflowTask`
     * Uses LangGraph checkpoint for state restoration.
     * ## Behavior
     * 1. Validates execution is in FAILED phase (recoverable)
     * 2. Uses Temporal ResetWorkflow to resume from last checkpoint
     * 3. Activity re-invoked with same thread_id
     * 4. LangGraph loads from checkpoint automatically
     * 5. Execution transitions from FAILED to IN_PROGRESS phase
     * 6. Agent continues from where it failed
     * ## Preconditions
     * - Execution must be in EXECUTION_FAILED phase
     * - TERMINATED executions cannot be recovered (incomplete checkpoint)
     * - CANCELLED executions cannot be recovered (intentional user action)
     * ## State Transitions
     * - status.phase: FAILED → IN_PROGRESS
     * - status.completed_at: Cleared
     * - status.error: Cleared
     * - Completed tool calls: Preserved (not re-executed)
     * ## Idempotency
     * If recovery already succeeded (execution is now IN_PROGRESS),
     * the call succeeds as a no-op.
     * ## Error Cases
     * - NOT_FOUND: Execution with given ID doesn't exist
     * - PERMISSION_DENIED: User lacks can_edit permission
     * - FAILED_PRECONDITION: Execution is not in FAILED phase
     * - INVALID_ARGUMENT: ID is empty or malformed
     * &#64;since Agent Execution Lifecycle
     * </pre>
     */
    public ai.stigmer.agentic.agentexecution.v1.AgentExecution recover(ai.stigmer.agentic.agentexecution.v1.RecoverAgentExecutionInput request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getRecoverMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Pause a running agent execution.
     * Temporarily stops the agent at its current checkpoint. Unlike cancel,
     * the execution is NOT terminal and can be resumed later from where it left off.
     * &#64;internal
     * ## Behavior
     * 1. Validates execution exists and is in a pausable phase
     * 2. Sends "pause" signal to Temporal workflow
     * 3. Workflow cancels running activity gracefully
     * 4. Python activity saves LangGraph checkpoint on cancellation
     * 5. Execution transitions to EXECUTION_PAUSED phase
     * 6. Workflow waits for resume signal (no resources consumed)
     * ## Preconditions
     * - Execution must be in EXECUTION_PENDING or EXECUTION_IN_PROGRESS phase
     * - Cannot pause already-terminal or already-paused executions
     * ## State Transitions
     * - status.phase: PENDING/IN_PROGRESS → PAUSED
     * - status.completed_at: NOT set (execution is not finished)
     * - LangGraph checkpoint: Saved via thread_id
     * ## Paused vs Cancelled
     * | Aspect | pause | cancel |
     * |--------|-------|--------|
     * | Terminal state? | No | Yes |
     * | Can resume? | Yes (via resume RPC) | No |
     * | Checkpoint saved? | Yes | Best-effort |
     * | Use case | Temporary stop | Permanent stop |
     * ## Idempotency
     * Pausing an already-paused execution succeeds as a no-op.
     * ## Error Cases
     * - NOT_FOUND: Execution with given ID doesn't exist
     * - PERMISSION_DENIED: User lacks can_edit permission
     * - FAILED_PRECONDITION: Execution is in a terminal phase
     * - INVALID_ARGUMENT: ID is empty or malformed
     * &#64;since Agent Execution Lifecycle
     * </pre>
     */
    public ai.stigmer.agentic.agentexecution.v1.AgentExecution pause(ai.stigmer.agentic.agentexecution.v1.PauseAgentExecutionInput request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getPauseMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Resume a paused agent execution.
     * Continues execution from the checkpoint where it was paused. The agent
     * re-invokes with the same thread_id, loading from LangGraph checkpoint
     * and continuing from where it left off.
     * &#64;internal
     * ## Behavior
     * 1. Validates execution is in EXECUTION_PAUSED phase
     * 2. Sends "resume" signal to Temporal workflow
     * 3. Workflow unblocks and re-invokes activity
     * 4. Activity loads from LangGraph checkpoint using thread_id
     * 5. Execution transitions back to EXECUTION_IN_PROGRESS phase
     * 6. Agent continues from exact pause point
     * ## Preconditions
     * - Execution must be in EXECUTION_PAUSED phase
     * - Cannot resume non-paused executions
     * ## State Transitions
     * - status.phase: PAUSED → IN_PROGRESS
     * - Activities: Re-invoked, load from checkpoint
     * - LangGraph state: Loaded from checkpoint via thread_id
     * ## Idempotency
     * Resuming an already-running execution succeeds as a no-op.
     * ## Error Cases
     * - NOT_FOUND: Execution with given ID doesn't exist
     * - PERMISSION_DENIED: User lacks can_edit permission
     * - FAILED_PRECONDITION: Execution is not in PAUSED phase
     * - INVALID_ARGUMENT: ID is empty or malformed
     * &#64;since Agent Execution Lifecycle
     * </pre>
     */
    public ai.stigmer.agentic.agentexecution.v1.AgentExecution resume(ai.stigmer.agentic.agentexecution.v1.ResumeAgentExecutionInput request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getResumeMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Upload a file attachment for use in an agent execution.
     * Pre-uploads files to artifact storage before creating an execution.
     * The returned storage_key can be used in Attachment.storage_key when
     * creating the execution.
     * &#64;internal
     * ## Authorization
     * This endpoint does not require authorization. The storage_key returned
     * acts as a capability token - knowing the key grants access to the content.
     * This simplifies the upload flow for CLI and other clients.
     * ## Storage Path
     * Files are stored at: attachments/{ulid}/{filename}
     * The ULID ensures unique paths and enables future cleanup policies.
     * ## Use Cases
     * - CLI uploading files (&gt;4MB) before agent execution
     * - Pre-uploading datasets for agent processing
     * - Uploading binary files that cannot be embedded inline in Attachment
     * ## Example Flow
     * 1. Client calls uploadAttachment with file content
     * 2. Server uploads to storage, returns storage_key
     * 3. Client creates AgentExecution with Attachment using storage_key
     * 4. Agent-runner downloads attachment content when execution starts
     * &#64;since Artifact Lifecycle (Attachments &amp; Artifacts)
     * </pre>
     */
    public ai.stigmer.agentic.agentexecution.v1.UploadAttachmentResponse uploadAttachment(ai.stigmer.agentic.agentexecution.v1.UploadAttachmentRequest request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getUploadAttachmentMethod(), getCallOptions(), request);
    }
  }

  /**
   * A stub to allow clients to do ListenableFuture-style rpc calls to service AgentExecutionCommandController.
   * <pre>
   * AgentExecutionCommandController handles write operations for agent executions.
   * Follows the standard pattern: create, update, delete (no granular field updates).
   * </pre>
   */
  public static final class AgentExecutionCommandControllerFutureStub
      extends io.grpc.stub.AbstractFutureStub<AgentExecutionCommandControllerFutureStub> {
    private AgentExecutionCommandControllerFutureStub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected AgentExecutionCommandControllerFutureStub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new AgentExecutionCommandControllerFutureStub(channel, callOptions);
    }

    /**
     * <pre>
     * Create and trigger a new agent execution.
     * Session is optional — can be provided or auto-created from agent_id.
     * &#64;internal
     * Authorization is handled in handler:
     *   - If session_id provided: checks can_create_execution_in on session
     *   - If session_id NOT provided: checks can_create_execution_in on organization
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.agentic.agentexecution.v1.AgentExecution> create(
        ai.stigmer.agentic.agentexecution.v1.AgentExecution request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getCreateMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * Update an agent execution.
     * &#64;internal
     * Used by users to update execution configuration (spec fields).
     * No individual field updates - always provide complete state.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.agentic.agentexecution.v1.AgentExecution> update(
        ai.stigmer.agentic.agentexecution.v1.AgentExecution request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getUpdateMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * Update an agent execution's status.
     * &#64;internal
     * Used by agent-runner to send progressive status updates (messages,
     * tool_calls, phase, etc.). The runner authenticates as the triggering user,
     * who owns the execution through the session ownership chain.
     * Optimized for frequent status updates and merges status fields with
     * existing state.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.agentic.agentexecution.v1.UpdateStatusResponse> updateStatus(
        ai.stigmer.agentic.agentexecution.v1.AgentExecutionUpdateStatusInput request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getUpdateStatusMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * Record proxy-observed LLM usage for an agent execution.
     * &#64;internal
     * Called by the LLM/Cursor proxy after each streaming response completes.
     * The proxy extracts token counts from the provider's SSE stream and reports
     * them here. The handler computes provider cost server-side from the model
     * registry (never trusts caller-supplied cost), writes trusted usage to the
     * execution, and debits billing credits as a side effect.
     * ## Authorization
     * Operator-only. The proxy authenticates as the platform operator identity.
     * Regular users and runners cannot call this RPC.
     * ## Idempotency
     * Deduplicated by (execution_id, sequence). Safe to retry on transient failures.
     * ## Signal Delivery
     * This RPC does NOT return a billing signal. The proxy is a transparent byte
     * pipe and cannot act on STOP/WARNING. Billing signals are delivered to the
     * runner through the updateStatus response.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.agentic.agentexecution.v1.UpdateUsageResponse> updateUsage(
        ai.stigmer.agentic.agentexecution.v1.UpdateUsageInput request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getUpdateUsageMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * Delete an agent execution by ID.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.agentic.agentexecution.v1.AgentExecution> delete(
        ai.stigmer.commons.apiresource.ApiResourceId request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getDeleteMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * Submit an approval decision for a pending tool call.
     * ## Preconditions
     * - Execution must be in EXECUTION_WAITING_FOR_APPROVAL phase
     * - tool_call_id must match status.pending_approval.tool_call_id
     * - User must have can_edit permission on the execution
     * ## Behavior by Action
     * - APPROVE: Tool executes normally, execution resumes to IN_PROGRESS
     * - SKIP: Tool returns skip message to LLM, execution continues to IN_PROGRESS
     * - REJECT: Execution fails with rejection error, phase becomes FAILED
     * &#64;internal
     * ## State Transitions
     * On success:
     * - ToolCall.approval_action = submitted action
     * - ToolCall.approval_decided_at = current timestamp
     * - ToolCall.approved_by = authenticated user ID
     * - AgentExecutionStatus.pending_approval = cleared
     * - ExecutionPhase = EXECUTION_IN_PROGRESS (or EXECUTION_FAILED if REJECT)
     * ## Error Conditions
     * - NOT_FOUND: Execution doesn't exist
     * - FAILED_PRECONDITION: Execution not in WAITING_FOR_APPROVAL phase
     * - INVALID_ARGUMENT: tool_call_id doesn't match pending approval, or action is UNSPECIFIED
     * - PERMISSION_DENIED: User lacks can_edit permission
     * ## Idempotency
     * If the same approval is submitted twice (same execution, tool_call, action),
     * the second call is a no-op and returns the current state.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.agentic.agentexecution.v1.AgentExecution> submitApproval(
        ai.stigmer.agentic.agentexecution.v1.SubmitApprovalInput request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getSubmitApprovalMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * Cancel a running agent execution gracefully.
     * Sends a cancellation signal to the agent execution. The agent can handle
     * the cancellation signal to save checkpoint and clean up before
     * transitioning to the CANCELLED phase.
     * &#64;internal
     * Temporal Equivalent: `temporal workflow cancel --workflow-id &lt;id&gt;`
     * ## Behavior
     * 1. Validates execution exists and is in a cancellable phase
     * 2. Sends cancellation signal to Temporal workflow
     * 3. Python activity receives cancellation and saves LangGraph checkpoint
     * 4. Execution transitions to EXECUTION_CANCELLED phase
     * 5. Returns updated AgentExecution with new phase
     * ## Preconditions
     * - Execution must be in EXECUTION_PENDING or EXECUTION_IN_PROGRESS phase
     * - Cannot cancel already-terminal executions (COMPLETED, FAILED, CANCELLED, TERMINATED)
     * ## State Transitions
     * - status.phase: PENDING/IN_PROGRESS → CANCELLED
     * - status.completed_at: Set to current timestamp
     * - LangGraph checkpoint: Preserved for potential future reference
     * ## Idempotency
     * Cancelling an already-cancelled execution succeeds as a no-op.
     * The call returns the current execution state without side effects.
     * ## Error Cases
     * - NOT_FOUND: Execution with given ID doesn't exist
     * - PERMISSION_DENIED: User lacks can_edit permission on the execution
     * - FAILED_PRECONDITION: Execution is in a terminal phase
     * - INVALID_ARGUMENT: ID is empty or malformed
     * &#64;since Agent Execution Lifecycle
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.agentic.agentexecution.v1.AgentExecution> cancel(
        ai.stigmer.agentic.agentexecution.v1.CancelAgentExecutionInput request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getCancelMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * Terminate an agent execution immediately.
     * Force-stops the agent execution without allowing cleanup. Unlike cancel,
     * the agent cannot respond to termination - it is stopped immediately.
     * Use this for stuck or unresponsive agents.
     * &#64;internal
     * Temporal Equivalent: `temporal workflow terminate --workflow-id &lt;id&gt;`
     * ## Behavior
     * 1. Validates execution exists and is in a terminable phase
     * 2. Force-kills workflow via Temporal (no signal sent to agent)
     * 3. Execution transitions to EXECUTION_TERMINATED phase immediately
     * 4. No cleanup callbacks or checkpoint saves occur
     * 5. Returns updated AgentExecution with TERMINATED phase
     * ## Preconditions
     * - Execution must be in EXECUTION_PENDING or EXECUTION_IN_PROGRESS phase
     * - Cannot terminate already-terminal executions
     * ## State Transitions
     * - status.phase: PENDING/IN_PROGRESS → TERMINATED
     * - status.completed_at: Set to current timestamp
     * - LangGraph checkpoint: May be incomplete (no graceful save)
     * ## Terminated vs Cancelled
     * | Aspect | cancel | terminate |
     * |--------|--------|-----------|
     * | Signal to agent | Yes (can handle) | No |
     * | Checkpoint saved | Yes (graceful) | No |
     * | Use case | Normal stop | Stuck agents |
     * | Can recover? | No | No |
     * ## Idempotency
     * Terminating an already-terminated execution succeeds as a no-op.
     * ## Error Cases
     * - NOT_FOUND: Execution with given ID doesn't exist
     * - PERMISSION_DENIED: User lacks can_edit permission on the execution
     * - FAILED_PRECONDITION: Execution is in a terminal phase
     * - INVALID_ARGUMENT: ID is empty or malformed
     * &#64;since Agent Execution Lifecycle
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.agentic.agentexecution.v1.AgentExecution> terminate(
        ai.stigmer.agentic.agentexecution.v1.TerminateAgentExecutionInput request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getTerminateMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * Recover a failed agent execution from the last checkpoint.
     * Resumes execution from the last checkpoint. Completed work is preserved -
     * successful tool calls are NOT re-executed.
     * &#64;internal
     * Temporal Equivalent: `temporal workflow reset --workflow-id &lt;id&gt; --type LastWorkflowTask`
     * Uses LangGraph checkpoint for state restoration.
     * ## Behavior
     * 1. Validates execution is in FAILED phase (recoverable)
     * 2. Uses Temporal ResetWorkflow to resume from last checkpoint
     * 3. Activity re-invoked with same thread_id
     * 4. LangGraph loads from checkpoint automatically
     * 5. Execution transitions from FAILED to IN_PROGRESS phase
     * 6. Agent continues from where it failed
     * ## Preconditions
     * - Execution must be in EXECUTION_FAILED phase
     * - TERMINATED executions cannot be recovered (incomplete checkpoint)
     * - CANCELLED executions cannot be recovered (intentional user action)
     * ## State Transitions
     * - status.phase: FAILED → IN_PROGRESS
     * - status.completed_at: Cleared
     * - status.error: Cleared
     * - Completed tool calls: Preserved (not re-executed)
     * ## Idempotency
     * If recovery already succeeded (execution is now IN_PROGRESS),
     * the call succeeds as a no-op.
     * ## Error Cases
     * - NOT_FOUND: Execution with given ID doesn't exist
     * - PERMISSION_DENIED: User lacks can_edit permission
     * - FAILED_PRECONDITION: Execution is not in FAILED phase
     * - INVALID_ARGUMENT: ID is empty or malformed
     * &#64;since Agent Execution Lifecycle
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.agentic.agentexecution.v1.AgentExecution> recover(
        ai.stigmer.agentic.agentexecution.v1.RecoverAgentExecutionInput request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getRecoverMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * Pause a running agent execution.
     * Temporarily stops the agent at its current checkpoint. Unlike cancel,
     * the execution is NOT terminal and can be resumed later from where it left off.
     * &#64;internal
     * ## Behavior
     * 1. Validates execution exists and is in a pausable phase
     * 2. Sends "pause" signal to Temporal workflow
     * 3. Workflow cancels running activity gracefully
     * 4. Python activity saves LangGraph checkpoint on cancellation
     * 5. Execution transitions to EXECUTION_PAUSED phase
     * 6. Workflow waits for resume signal (no resources consumed)
     * ## Preconditions
     * - Execution must be in EXECUTION_PENDING or EXECUTION_IN_PROGRESS phase
     * - Cannot pause already-terminal or already-paused executions
     * ## State Transitions
     * - status.phase: PENDING/IN_PROGRESS → PAUSED
     * - status.completed_at: NOT set (execution is not finished)
     * - LangGraph checkpoint: Saved via thread_id
     * ## Paused vs Cancelled
     * | Aspect | pause | cancel |
     * |--------|-------|--------|
     * | Terminal state? | No | Yes |
     * | Can resume? | Yes (via resume RPC) | No |
     * | Checkpoint saved? | Yes | Best-effort |
     * | Use case | Temporary stop | Permanent stop |
     * ## Idempotency
     * Pausing an already-paused execution succeeds as a no-op.
     * ## Error Cases
     * - NOT_FOUND: Execution with given ID doesn't exist
     * - PERMISSION_DENIED: User lacks can_edit permission
     * - FAILED_PRECONDITION: Execution is in a terminal phase
     * - INVALID_ARGUMENT: ID is empty or malformed
     * &#64;since Agent Execution Lifecycle
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.agentic.agentexecution.v1.AgentExecution> pause(
        ai.stigmer.agentic.agentexecution.v1.PauseAgentExecutionInput request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getPauseMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * Resume a paused agent execution.
     * Continues execution from the checkpoint where it was paused. The agent
     * re-invokes with the same thread_id, loading from LangGraph checkpoint
     * and continuing from where it left off.
     * &#64;internal
     * ## Behavior
     * 1. Validates execution is in EXECUTION_PAUSED phase
     * 2. Sends "resume" signal to Temporal workflow
     * 3. Workflow unblocks and re-invokes activity
     * 4. Activity loads from LangGraph checkpoint using thread_id
     * 5. Execution transitions back to EXECUTION_IN_PROGRESS phase
     * 6. Agent continues from exact pause point
     * ## Preconditions
     * - Execution must be in EXECUTION_PAUSED phase
     * - Cannot resume non-paused executions
     * ## State Transitions
     * - status.phase: PAUSED → IN_PROGRESS
     * - Activities: Re-invoked, load from checkpoint
     * - LangGraph state: Loaded from checkpoint via thread_id
     * ## Idempotency
     * Resuming an already-running execution succeeds as a no-op.
     * ## Error Cases
     * - NOT_FOUND: Execution with given ID doesn't exist
     * - PERMISSION_DENIED: User lacks can_edit permission
     * - FAILED_PRECONDITION: Execution is not in PAUSED phase
     * - INVALID_ARGUMENT: ID is empty or malformed
     * &#64;since Agent Execution Lifecycle
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.agentic.agentexecution.v1.AgentExecution> resume(
        ai.stigmer.agentic.agentexecution.v1.ResumeAgentExecutionInput request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getResumeMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * Upload a file attachment for use in an agent execution.
     * Pre-uploads files to artifact storage before creating an execution.
     * The returned storage_key can be used in Attachment.storage_key when
     * creating the execution.
     * &#64;internal
     * ## Authorization
     * This endpoint does not require authorization. The storage_key returned
     * acts as a capability token - knowing the key grants access to the content.
     * This simplifies the upload flow for CLI and other clients.
     * ## Storage Path
     * Files are stored at: attachments/{ulid}/{filename}
     * The ULID ensures unique paths and enables future cleanup policies.
     * ## Use Cases
     * - CLI uploading files (&gt;4MB) before agent execution
     * - Pre-uploading datasets for agent processing
     * - Uploading binary files that cannot be embedded inline in Attachment
     * ## Example Flow
     * 1. Client calls uploadAttachment with file content
     * 2. Server uploads to storage, returns storage_key
     * 3. Client creates AgentExecution with Attachment using storage_key
     * 4. Agent-runner downloads attachment content when execution starts
     * &#64;since Artifact Lifecycle (Attachments &amp; Artifacts)
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.agentic.agentexecution.v1.UploadAttachmentResponse> uploadAttachment(
        ai.stigmer.agentic.agentexecution.v1.UploadAttachmentRequest request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getUploadAttachmentMethod(), getCallOptions()), request);
    }
  }

  private static final int METHODID_CREATE = 0;
  private static final int METHODID_UPDATE = 1;
  private static final int METHODID_UPDATE_STATUS = 2;
  private static final int METHODID_UPDATE_USAGE = 3;
  private static final int METHODID_DELETE = 4;
  private static final int METHODID_SUBMIT_APPROVAL = 5;
  private static final int METHODID_CANCEL = 6;
  private static final int METHODID_TERMINATE = 7;
  private static final int METHODID_RECOVER = 8;
  private static final int METHODID_PAUSE = 9;
  private static final int METHODID_RESUME = 10;
  private static final int METHODID_UPLOAD_ATTACHMENT = 11;

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
          serviceImpl.create((ai.stigmer.agentic.agentexecution.v1.AgentExecution) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.agentic.agentexecution.v1.AgentExecution>) responseObserver);
          break;
        case METHODID_UPDATE:
          serviceImpl.update((ai.stigmer.agentic.agentexecution.v1.AgentExecution) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.agentic.agentexecution.v1.AgentExecution>) responseObserver);
          break;
        case METHODID_UPDATE_STATUS:
          serviceImpl.updateStatus((ai.stigmer.agentic.agentexecution.v1.AgentExecutionUpdateStatusInput) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.agentic.agentexecution.v1.UpdateStatusResponse>) responseObserver);
          break;
        case METHODID_UPDATE_USAGE:
          serviceImpl.updateUsage((ai.stigmer.agentic.agentexecution.v1.UpdateUsageInput) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.agentic.agentexecution.v1.UpdateUsageResponse>) responseObserver);
          break;
        case METHODID_DELETE:
          serviceImpl.delete((ai.stigmer.commons.apiresource.ApiResourceId) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.agentic.agentexecution.v1.AgentExecution>) responseObserver);
          break;
        case METHODID_SUBMIT_APPROVAL:
          serviceImpl.submitApproval((ai.stigmer.agentic.agentexecution.v1.SubmitApprovalInput) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.agentic.agentexecution.v1.AgentExecution>) responseObserver);
          break;
        case METHODID_CANCEL:
          serviceImpl.cancel((ai.stigmer.agentic.agentexecution.v1.CancelAgentExecutionInput) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.agentic.agentexecution.v1.AgentExecution>) responseObserver);
          break;
        case METHODID_TERMINATE:
          serviceImpl.terminate((ai.stigmer.agentic.agentexecution.v1.TerminateAgentExecutionInput) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.agentic.agentexecution.v1.AgentExecution>) responseObserver);
          break;
        case METHODID_RECOVER:
          serviceImpl.recover((ai.stigmer.agentic.agentexecution.v1.RecoverAgentExecutionInput) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.agentic.agentexecution.v1.AgentExecution>) responseObserver);
          break;
        case METHODID_PAUSE:
          serviceImpl.pause((ai.stigmer.agentic.agentexecution.v1.PauseAgentExecutionInput) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.agentic.agentexecution.v1.AgentExecution>) responseObserver);
          break;
        case METHODID_RESUME:
          serviceImpl.resume((ai.stigmer.agentic.agentexecution.v1.ResumeAgentExecutionInput) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.agentic.agentexecution.v1.AgentExecution>) responseObserver);
          break;
        case METHODID_UPLOAD_ATTACHMENT:
          serviceImpl.uploadAttachment((ai.stigmer.agentic.agentexecution.v1.UploadAttachmentRequest) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.agentic.agentexecution.v1.UploadAttachmentResponse>) responseObserver);
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
              ai.stigmer.agentic.agentexecution.v1.AgentExecution,
              ai.stigmer.agentic.agentexecution.v1.AgentExecution>(
                service, METHODID_CREATE)))
        .addMethod(
          getUpdateMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.agentic.agentexecution.v1.AgentExecution,
              ai.stigmer.agentic.agentexecution.v1.AgentExecution>(
                service, METHODID_UPDATE)))
        .addMethod(
          getUpdateStatusMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.agentic.agentexecution.v1.AgentExecutionUpdateStatusInput,
              ai.stigmer.agentic.agentexecution.v1.UpdateStatusResponse>(
                service, METHODID_UPDATE_STATUS)))
        .addMethod(
          getUpdateUsageMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.agentic.agentexecution.v1.UpdateUsageInput,
              ai.stigmer.agentic.agentexecution.v1.UpdateUsageResponse>(
                service, METHODID_UPDATE_USAGE)))
        .addMethod(
          getDeleteMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.commons.apiresource.ApiResourceId,
              ai.stigmer.agentic.agentexecution.v1.AgentExecution>(
                service, METHODID_DELETE)))
        .addMethod(
          getSubmitApprovalMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.agentic.agentexecution.v1.SubmitApprovalInput,
              ai.stigmer.agentic.agentexecution.v1.AgentExecution>(
                service, METHODID_SUBMIT_APPROVAL)))
        .addMethod(
          getCancelMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.agentic.agentexecution.v1.CancelAgentExecutionInput,
              ai.stigmer.agentic.agentexecution.v1.AgentExecution>(
                service, METHODID_CANCEL)))
        .addMethod(
          getTerminateMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.agentic.agentexecution.v1.TerminateAgentExecutionInput,
              ai.stigmer.agentic.agentexecution.v1.AgentExecution>(
                service, METHODID_TERMINATE)))
        .addMethod(
          getRecoverMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.agentic.agentexecution.v1.RecoverAgentExecutionInput,
              ai.stigmer.agentic.agentexecution.v1.AgentExecution>(
                service, METHODID_RECOVER)))
        .addMethod(
          getPauseMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.agentic.agentexecution.v1.PauseAgentExecutionInput,
              ai.stigmer.agentic.agentexecution.v1.AgentExecution>(
                service, METHODID_PAUSE)))
        .addMethod(
          getResumeMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.agentic.agentexecution.v1.ResumeAgentExecutionInput,
              ai.stigmer.agentic.agentexecution.v1.AgentExecution>(
                service, METHODID_RESUME)))
        .addMethod(
          getUploadAttachmentMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.agentic.agentexecution.v1.UploadAttachmentRequest,
              ai.stigmer.agentic.agentexecution.v1.UploadAttachmentResponse>(
                service, METHODID_UPLOAD_ATTACHMENT)))
        .build();
  }

  private static abstract class AgentExecutionCommandControllerBaseDescriptorSupplier
      implements io.grpc.protobuf.ProtoFileDescriptorSupplier, io.grpc.protobuf.ProtoServiceDescriptorSupplier {
    AgentExecutionCommandControllerBaseDescriptorSupplier() {}

    @java.lang.Override
    public com.google.protobuf.Descriptors.FileDescriptor getFileDescriptor() {
      return ai.stigmer.agentic.agentexecution.v1.CommandProto.getDescriptor();
    }

    @java.lang.Override
    public com.google.protobuf.Descriptors.ServiceDescriptor getServiceDescriptor() {
      return getFileDescriptor().findServiceByName("AgentExecutionCommandController");
    }
  }

  private static final class AgentExecutionCommandControllerFileDescriptorSupplier
      extends AgentExecutionCommandControllerBaseDescriptorSupplier {
    AgentExecutionCommandControllerFileDescriptorSupplier() {}
  }

  private static final class AgentExecutionCommandControllerMethodDescriptorSupplier
      extends AgentExecutionCommandControllerBaseDescriptorSupplier
      implements io.grpc.protobuf.ProtoMethodDescriptorSupplier {
    private final java.lang.String methodName;

    AgentExecutionCommandControllerMethodDescriptorSupplier(java.lang.String methodName) {
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
      synchronized (AgentExecutionCommandControllerGrpc.class) {
        result = serviceDescriptor;
        if (result == null) {
          serviceDescriptor = result = io.grpc.ServiceDescriptor.newBuilder(SERVICE_NAME)
              .setSchemaDescriptor(new AgentExecutionCommandControllerFileDescriptorSupplier())
              .addMethod(getCreateMethod())
              .addMethod(getUpdateMethod())
              .addMethod(getUpdateStatusMethod())
              .addMethod(getUpdateUsageMethod())
              .addMethod(getDeleteMethod())
              .addMethod(getSubmitApprovalMethod())
              .addMethod(getCancelMethod())
              .addMethod(getTerminateMethod())
              .addMethod(getRecoverMethod())
              .addMethod(getPauseMethod())
              .addMethod(getResumeMethod())
              .addMethod(getUploadAttachmentMethod())
              .build();
        }
      }
    }
    return result;
  }
}
