package ai.stigmer.agentic.workflowexecution.v1;

import static io.grpc.MethodDescriptor.generateFullMethodName;

/**
 * <pre>
 * WorkflowExecutionCommandController handles write operations (Create, Update, Delete) for WorkflowExecution resources.
 * This service follows the Command-Query Separation (CQS) pattern:
 * - CommandController: Write operations (create, update, delete)
 * - QueryController: Read operations (get, list, search)
 * Authorization:
 * All RPCs use custom authorization logic implemented in middleware.
 * Custom authorization is needed because:
 * - create: Must verify user has "execute" permission on the referenced WorkflowInstance
 * - update: Only the workflow runner (system) can update execution status, not users
 * Service Options:
 * - api_resource_kind: workflow_execution - Links this service to the WorkflowExecution resource
 * </pre>
 */
@io.grpc.stub.annotations.GrpcGenerated
public final class WorkflowExecutionCommandControllerGrpc {

  private WorkflowExecutionCommandControllerGrpc() {}

  public static final java.lang.String SERVICE_NAME = "ai.stigmer.agentic.workflowexecution.v1.WorkflowExecutionCommandController";

  // Static method descriptors that strictly reflect the proto.
  private static volatile io.grpc.MethodDescriptor<ai.stigmer.agentic.workflowexecution.v1.WorkflowExecution,
      ai.stigmer.agentic.workflowexecution.v1.WorkflowExecution> getCreateMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "create",
      requestType = ai.stigmer.agentic.workflowexecution.v1.WorkflowExecution.class,
      responseType = ai.stigmer.agentic.workflowexecution.v1.WorkflowExecution.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.agentic.workflowexecution.v1.WorkflowExecution,
      ai.stigmer.agentic.workflowexecution.v1.WorkflowExecution> getCreateMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.agentic.workflowexecution.v1.WorkflowExecution, ai.stigmer.agentic.workflowexecution.v1.WorkflowExecution> getCreateMethod;
    if ((getCreateMethod = WorkflowExecutionCommandControllerGrpc.getCreateMethod) == null) {
      synchronized (WorkflowExecutionCommandControllerGrpc.class) {
        if ((getCreateMethod = WorkflowExecutionCommandControllerGrpc.getCreateMethod) == null) {
          WorkflowExecutionCommandControllerGrpc.getCreateMethod = getCreateMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.agentic.workflowexecution.v1.WorkflowExecution, ai.stigmer.agentic.workflowexecution.v1.WorkflowExecution>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "create"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.workflowexecution.v1.WorkflowExecution.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.workflowexecution.v1.WorkflowExecution.getDefaultInstance()))
              .setSchemaDescriptor(new WorkflowExecutionCommandControllerMethodDescriptorSupplier("create"))
              .build();
        }
      }
    }
    return getCreateMethod;
  }

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.agentic.workflowexecution.v1.WorkflowExecution,
      ai.stigmer.agentic.workflowexecution.v1.WorkflowExecution> getUpdateMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "update",
      requestType = ai.stigmer.agentic.workflowexecution.v1.WorkflowExecution.class,
      responseType = ai.stigmer.agentic.workflowexecution.v1.WorkflowExecution.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.agentic.workflowexecution.v1.WorkflowExecution,
      ai.stigmer.agentic.workflowexecution.v1.WorkflowExecution> getUpdateMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.agentic.workflowexecution.v1.WorkflowExecution, ai.stigmer.agentic.workflowexecution.v1.WorkflowExecution> getUpdateMethod;
    if ((getUpdateMethod = WorkflowExecutionCommandControllerGrpc.getUpdateMethod) == null) {
      synchronized (WorkflowExecutionCommandControllerGrpc.class) {
        if ((getUpdateMethod = WorkflowExecutionCommandControllerGrpc.getUpdateMethod) == null) {
          WorkflowExecutionCommandControllerGrpc.getUpdateMethod = getUpdateMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.agentic.workflowexecution.v1.WorkflowExecution, ai.stigmer.agentic.workflowexecution.v1.WorkflowExecution>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "update"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.workflowexecution.v1.WorkflowExecution.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.workflowexecution.v1.WorkflowExecution.getDefaultInstance()))
              .setSchemaDescriptor(new WorkflowExecutionCommandControllerMethodDescriptorSupplier("update"))
              .build();
        }
      }
    }
    return getUpdateMethod;
  }

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.agentic.workflowexecution.v1.WorkflowExecutionUpdateStatusInput,
      ai.stigmer.agentic.workflowexecution.v1.WorkflowExecution> getUpdateStatusMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "updateStatus",
      requestType = ai.stigmer.agentic.workflowexecution.v1.WorkflowExecutionUpdateStatusInput.class,
      responseType = ai.stigmer.agentic.workflowexecution.v1.WorkflowExecution.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.agentic.workflowexecution.v1.WorkflowExecutionUpdateStatusInput,
      ai.stigmer.agentic.workflowexecution.v1.WorkflowExecution> getUpdateStatusMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.agentic.workflowexecution.v1.WorkflowExecutionUpdateStatusInput, ai.stigmer.agentic.workflowexecution.v1.WorkflowExecution> getUpdateStatusMethod;
    if ((getUpdateStatusMethod = WorkflowExecutionCommandControllerGrpc.getUpdateStatusMethod) == null) {
      synchronized (WorkflowExecutionCommandControllerGrpc.class) {
        if ((getUpdateStatusMethod = WorkflowExecutionCommandControllerGrpc.getUpdateStatusMethod) == null) {
          WorkflowExecutionCommandControllerGrpc.getUpdateStatusMethod = getUpdateStatusMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.agentic.workflowexecution.v1.WorkflowExecutionUpdateStatusInput, ai.stigmer.agentic.workflowexecution.v1.WorkflowExecution>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "updateStatus"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.workflowexecution.v1.WorkflowExecutionUpdateStatusInput.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.workflowexecution.v1.WorkflowExecution.getDefaultInstance()))
              .setSchemaDescriptor(new WorkflowExecutionCommandControllerMethodDescriptorSupplier("updateStatus"))
              .build();
        }
      }
    }
    return getUpdateStatusMethod;
  }

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.agentic.workflowexecution.v1.SubmitWorkflowApprovalInput,
      ai.stigmer.agentic.workflowexecution.v1.WorkflowExecution> getSubmitApprovalMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "submitApproval",
      requestType = ai.stigmer.agentic.workflowexecution.v1.SubmitWorkflowApprovalInput.class,
      responseType = ai.stigmer.agentic.workflowexecution.v1.WorkflowExecution.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.agentic.workflowexecution.v1.SubmitWorkflowApprovalInput,
      ai.stigmer.agentic.workflowexecution.v1.WorkflowExecution> getSubmitApprovalMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.agentic.workflowexecution.v1.SubmitWorkflowApprovalInput, ai.stigmer.agentic.workflowexecution.v1.WorkflowExecution> getSubmitApprovalMethod;
    if ((getSubmitApprovalMethod = WorkflowExecutionCommandControllerGrpc.getSubmitApprovalMethod) == null) {
      synchronized (WorkflowExecutionCommandControllerGrpc.class) {
        if ((getSubmitApprovalMethod = WorkflowExecutionCommandControllerGrpc.getSubmitApprovalMethod) == null) {
          WorkflowExecutionCommandControllerGrpc.getSubmitApprovalMethod = getSubmitApprovalMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.agentic.workflowexecution.v1.SubmitWorkflowApprovalInput, ai.stigmer.agentic.workflowexecution.v1.WorkflowExecution>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "submitApproval"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.workflowexecution.v1.SubmitWorkflowApprovalInput.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.workflowexecution.v1.WorkflowExecution.getDefaultInstance()))
              .setSchemaDescriptor(new WorkflowExecutionCommandControllerMethodDescriptorSupplier("submitApproval"))
              .build();
        }
      }
    }
    return getSubmitApprovalMethod;
  }

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.agentic.workflowexecution.v1.SubmitWorkflowFileDecisionInput,
      ai.stigmer.agentic.workflowexecution.v1.WorkflowExecution> getSubmitFileDecisionMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "submitFileDecision",
      requestType = ai.stigmer.agentic.workflowexecution.v1.SubmitWorkflowFileDecisionInput.class,
      responseType = ai.stigmer.agentic.workflowexecution.v1.WorkflowExecution.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.agentic.workflowexecution.v1.SubmitWorkflowFileDecisionInput,
      ai.stigmer.agentic.workflowexecution.v1.WorkflowExecution> getSubmitFileDecisionMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.agentic.workflowexecution.v1.SubmitWorkflowFileDecisionInput, ai.stigmer.agentic.workflowexecution.v1.WorkflowExecution> getSubmitFileDecisionMethod;
    if ((getSubmitFileDecisionMethod = WorkflowExecutionCommandControllerGrpc.getSubmitFileDecisionMethod) == null) {
      synchronized (WorkflowExecutionCommandControllerGrpc.class) {
        if ((getSubmitFileDecisionMethod = WorkflowExecutionCommandControllerGrpc.getSubmitFileDecisionMethod) == null) {
          WorkflowExecutionCommandControllerGrpc.getSubmitFileDecisionMethod = getSubmitFileDecisionMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.agentic.workflowexecution.v1.SubmitWorkflowFileDecisionInput, ai.stigmer.agentic.workflowexecution.v1.WorkflowExecution>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "submitFileDecision"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.workflowexecution.v1.SubmitWorkflowFileDecisionInput.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.workflowexecution.v1.WorkflowExecution.getDefaultInstance()))
              .setSchemaDescriptor(new WorkflowExecutionCommandControllerMethodDescriptorSupplier("submitFileDecision"))
              .build();
        }
      }
    }
    return getSubmitFileDecisionMethod;
  }

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.agentic.workflowexecution.v1.SubmitWorkflowTaskApprovalInput,
      ai.stigmer.agentic.workflowexecution.v1.WorkflowExecution> getSubmitWorkflowTaskApprovalMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "submitWorkflowTaskApproval",
      requestType = ai.stigmer.agentic.workflowexecution.v1.SubmitWorkflowTaskApprovalInput.class,
      responseType = ai.stigmer.agentic.workflowexecution.v1.WorkflowExecution.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.agentic.workflowexecution.v1.SubmitWorkflowTaskApprovalInput,
      ai.stigmer.agentic.workflowexecution.v1.WorkflowExecution> getSubmitWorkflowTaskApprovalMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.agentic.workflowexecution.v1.SubmitWorkflowTaskApprovalInput, ai.stigmer.agentic.workflowexecution.v1.WorkflowExecution> getSubmitWorkflowTaskApprovalMethod;
    if ((getSubmitWorkflowTaskApprovalMethod = WorkflowExecutionCommandControllerGrpc.getSubmitWorkflowTaskApprovalMethod) == null) {
      synchronized (WorkflowExecutionCommandControllerGrpc.class) {
        if ((getSubmitWorkflowTaskApprovalMethod = WorkflowExecutionCommandControllerGrpc.getSubmitWorkflowTaskApprovalMethod) == null) {
          WorkflowExecutionCommandControllerGrpc.getSubmitWorkflowTaskApprovalMethod = getSubmitWorkflowTaskApprovalMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.agentic.workflowexecution.v1.SubmitWorkflowTaskApprovalInput, ai.stigmer.agentic.workflowexecution.v1.WorkflowExecution>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "submitWorkflowTaskApproval"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.workflowexecution.v1.SubmitWorkflowTaskApprovalInput.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.workflowexecution.v1.WorkflowExecution.getDefaultInstance()))
              .setSchemaDescriptor(new WorkflowExecutionCommandControllerMethodDescriptorSupplier("submitWorkflowTaskApproval"))
              .build();
        }
      }
    }
    return getSubmitWorkflowTaskApprovalMethod;
  }

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.commons.apiresource.ApiResourceId,
      ai.stigmer.agentic.workflowexecution.v1.WorkflowExecution> getDeleteMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "delete",
      requestType = ai.stigmer.commons.apiresource.ApiResourceId.class,
      responseType = ai.stigmer.agentic.workflowexecution.v1.WorkflowExecution.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.commons.apiresource.ApiResourceId,
      ai.stigmer.agentic.workflowexecution.v1.WorkflowExecution> getDeleteMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.commons.apiresource.ApiResourceId, ai.stigmer.agentic.workflowexecution.v1.WorkflowExecution> getDeleteMethod;
    if ((getDeleteMethod = WorkflowExecutionCommandControllerGrpc.getDeleteMethod) == null) {
      synchronized (WorkflowExecutionCommandControllerGrpc.class) {
        if ((getDeleteMethod = WorkflowExecutionCommandControllerGrpc.getDeleteMethod) == null) {
          WorkflowExecutionCommandControllerGrpc.getDeleteMethod = getDeleteMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.commons.apiresource.ApiResourceId, ai.stigmer.agentic.workflowexecution.v1.WorkflowExecution>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "delete"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.commons.apiresource.ApiResourceId.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.workflowexecution.v1.WorkflowExecution.getDefaultInstance()))
              .setSchemaDescriptor(new WorkflowExecutionCommandControllerMethodDescriptorSupplier("delete"))
              .build();
        }
      }
    }
    return getDeleteMethod;
  }

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.agentic.workflowexecution.v1.SendSignalInput,
      ai.stigmer.agentic.workflowexecution.v1.WorkflowExecution> getSendSignalMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "sendSignal",
      requestType = ai.stigmer.agentic.workflowexecution.v1.SendSignalInput.class,
      responseType = ai.stigmer.agentic.workflowexecution.v1.WorkflowExecution.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.agentic.workflowexecution.v1.SendSignalInput,
      ai.stigmer.agentic.workflowexecution.v1.WorkflowExecution> getSendSignalMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.agentic.workflowexecution.v1.SendSignalInput, ai.stigmer.agentic.workflowexecution.v1.WorkflowExecution> getSendSignalMethod;
    if ((getSendSignalMethod = WorkflowExecutionCommandControllerGrpc.getSendSignalMethod) == null) {
      synchronized (WorkflowExecutionCommandControllerGrpc.class) {
        if ((getSendSignalMethod = WorkflowExecutionCommandControllerGrpc.getSendSignalMethod) == null) {
          WorkflowExecutionCommandControllerGrpc.getSendSignalMethod = getSendSignalMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.agentic.workflowexecution.v1.SendSignalInput, ai.stigmer.agentic.workflowexecution.v1.WorkflowExecution>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "sendSignal"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.workflowexecution.v1.SendSignalInput.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.workflowexecution.v1.WorkflowExecution.getDefaultInstance()))
              .setSchemaDescriptor(new WorkflowExecutionCommandControllerMethodDescriptorSupplier("sendSignal"))
              .build();
        }
      }
    }
    return getSendSignalMethod;
  }

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.agentic.workflowexecution.v1.CancelWorkflowExecutionInput,
      ai.stigmer.agentic.workflowexecution.v1.WorkflowExecution> getCancelMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "cancel",
      requestType = ai.stigmer.agentic.workflowexecution.v1.CancelWorkflowExecutionInput.class,
      responseType = ai.stigmer.agentic.workflowexecution.v1.WorkflowExecution.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.agentic.workflowexecution.v1.CancelWorkflowExecutionInput,
      ai.stigmer.agentic.workflowexecution.v1.WorkflowExecution> getCancelMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.agentic.workflowexecution.v1.CancelWorkflowExecutionInput, ai.stigmer.agentic.workflowexecution.v1.WorkflowExecution> getCancelMethod;
    if ((getCancelMethod = WorkflowExecutionCommandControllerGrpc.getCancelMethod) == null) {
      synchronized (WorkflowExecutionCommandControllerGrpc.class) {
        if ((getCancelMethod = WorkflowExecutionCommandControllerGrpc.getCancelMethod) == null) {
          WorkflowExecutionCommandControllerGrpc.getCancelMethod = getCancelMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.agentic.workflowexecution.v1.CancelWorkflowExecutionInput, ai.stigmer.agentic.workflowexecution.v1.WorkflowExecution>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "cancel"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.workflowexecution.v1.CancelWorkflowExecutionInput.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.workflowexecution.v1.WorkflowExecution.getDefaultInstance()))
              .setSchemaDescriptor(new WorkflowExecutionCommandControllerMethodDescriptorSupplier("cancel"))
              .build();
        }
      }
    }
    return getCancelMethod;
  }

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.agentic.workflowexecution.v1.TerminateWorkflowExecutionInput,
      ai.stigmer.agentic.workflowexecution.v1.WorkflowExecution> getTerminateMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "terminate",
      requestType = ai.stigmer.agentic.workflowexecution.v1.TerminateWorkflowExecutionInput.class,
      responseType = ai.stigmer.agentic.workflowexecution.v1.WorkflowExecution.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.agentic.workflowexecution.v1.TerminateWorkflowExecutionInput,
      ai.stigmer.agentic.workflowexecution.v1.WorkflowExecution> getTerminateMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.agentic.workflowexecution.v1.TerminateWorkflowExecutionInput, ai.stigmer.agentic.workflowexecution.v1.WorkflowExecution> getTerminateMethod;
    if ((getTerminateMethod = WorkflowExecutionCommandControllerGrpc.getTerminateMethod) == null) {
      synchronized (WorkflowExecutionCommandControllerGrpc.class) {
        if ((getTerminateMethod = WorkflowExecutionCommandControllerGrpc.getTerminateMethod) == null) {
          WorkflowExecutionCommandControllerGrpc.getTerminateMethod = getTerminateMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.agentic.workflowexecution.v1.TerminateWorkflowExecutionInput, ai.stigmer.agentic.workflowexecution.v1.WorkflowExecution>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "terminate"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.workflowexecution.v1.TerminateWorkflowExecutionInput.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.workflowexecution.v1.WorkflowExecution.getDefaultInstance()))
              .setSchemaDescriptor(new WorkflowExecutionCommandControllerMethodDescriptorSupplier("terminate"))
              .build();
        }
      }
    }
    return getTerminateMethod;
  }

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.agentic.workflowexecution.v1.RecoverWorkflowExecutionInput,
      ai.stigmer.agentic.workflowexecution.v1.WorkflowExecution> getRecoverMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "recover",
      requestType = ai.stigmer.agentic.workflowexecution.v1.RecoverWorkflowExecutionInput.class,
      responseType = ai.stigmer.agentic.workflowexecution.v1.WorkflowExecution.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.agentic.workflowexecution.v1.RecoverWorkflowExecutionInput,
      ai.stigmer.agentic.workflowexecution.v1.WorkflowExecution> getRecoverMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.agentic.workflowexecution.v1.RecoverWorkflowExecutionInput, ai.stigmer.agentic.workflowexecution.v1.WorkflowExecution> getRecoverMethod;
    if ((getRecoverMethod = WorkflowExecutionCommandControllerGrpc.getRecoverMethod) == null) {
      synchronized (WorkflowExecutionCommandControllerGrpc.class) {
        if ((getRecoverMethod = WorkflowExecutionCommandControllerGrpc.getRecoverMethod) == null) {
          WorkflowExecutionCommandControllerGrpc.getRecoverMethod = getRecoverMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.agentic.workflowexecution.v1.RecoverWorkflowExecutionInput, ai.stigmer.agentic.workflowexecution.v1.WorkflowExecution>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "recover"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.workflowexecution.v1.RecoverWorkflowExecutionInput.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.workflowexecution.v1.WorkflowExecution.getDefaultInstance()))
              .setSchemaDescriptor(new WorkflowExecutionCommandControllerMethodDescriptorSupplier("recover"))
              .build();
        }
      }
    }
    return getRecoverMethod;
  }

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.agentic.workflowexecution.v1.PauseWorkflowExecutionInput,
      ai.stigmer.agentic.workflowexecution.v1.WorkflowExecution> getPauseMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "pause",
      requestType = ai.stigmer.agentic.workflowexecution.v1.PauseWorkflowExecutionInput.class,
      responseType = ai.stigmer.agentic.workflowexecution.v1.WorkflowExecution.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.agentic.workflowexecution.v1.PauseWorkflowExecutionInput,
      ai.stigmer.agentic.workflowexecution.v1.WorkflowExecution> getPauseMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.agentic.workflowexecution.v1.PauseWorkflowExecutionInput, ai.stigmer.agentic.workflowexecution.v1.WorkflowExecution> getPauseMethod;
    if ((getPauseMethod = WorkflowExecutionCommandControllerGrpc.getPauseMethod) == null) {
      synchronized (WorkflowExecutionCommandControllerGrpc.class) {
        if ((getPauseMethod = WorkflowExecutionCommandControllerGrpc.getPauseMethod) == null) {
          WorkflowExecutionCommandControllerGrpc.getPauseMethod = getPauseMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.agentic.workflowexecution.v1.PauseWorkflowExecutionInput, ai.stigmer.agentic.workflowexecution.v1.WorkflowExecution>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "pause"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.workflowexecution.v1.PauseWorkflowExecutionInput.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.workflowexecution.v1.WorkflowExecution.getDefaultInstance()))
              .setSchemaDescriptor(new WorkflowExecutionCommandControllerMethodDescriptorSupplier("pause"))
              .build();
        }
      }
    }
    return getPauseMethod;
  }

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.agentic.workflowexecution.v1.ResumeWorkflowExecutionInput,
      ai.stigmer.agentic.workflowexecution.v1.WorkflowExecution> getResumeMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "resume",
      requestType = ai.stigmer.agentic.workflowexecution.v1.ResumeWorkflowExecutionInput.class,
      responseType = ai.stigmer.agentic.workflowexecution.v1.WorkflowExecution.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.agentic.workflowexecution.v1.ResumeWorkflowExecutionInput,
      ai.stigmer.agentic.workflowexecution.v1.WorkflowExecution> getResumeMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.agentic.workflowexecution.v1.ResumeWorkflowExecutionInput, ai.stigmer.agentic.workflowexecution.v1.WorkflowExecution> getResumeMethod;
    if ((getResumeMethod = WorkflowExecutionCommandControllerGrpc.getResumeMethod) == null) {
      synchronized (WorkflowExecutionCommandControllerGrpc.class) {
        if ((getResumeMethod = WorkflowExecutionCommandControllerGrpc.getResumeMethod) == null) {
          WorkflowExecutionCommandControllerGrpc.getResumeMethod = getResumeMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.agentic.workflowexecution.v1.ResumeWorkflowExecutionInput, ai.stigmer.agentic.workflowexecution.v1.WorkflowExecution>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "resume"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.workflowexecution.v1.ResumeWorkflowExecutionInput.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.workflowexecution.v1.WorkflowExecution.getDefaultInstance()))
              .setSchemaDescriptor(new WorkflowExecutionCommandControllerMethodDescriptorSupplier("resume"))
              .build();
        }
      }
    }
    return getResumeMethod;
  }

  /**
   * Creates a new async stub that supports all call types for the service
   */
  public static WorkflowExecutionCommandControllerStub newStub(io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<WorkflowExecutionCommandControllerStub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<WorkflowExecutionCommandControllerStub>() {
        @java.lang.Override
        public WorkflowExecutionCommandControllerStub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new WorkflowExecutionCommandControllerStub(channel, callOptions);
        }
      };
    return WorkflowExecutionCommandControllerStub.newStub(factory, channel);
  }

  /**
   * Creates a new blocking-style stub that supports all types of calls on the service
   */
  public static WorkflowExecutionCommandControllerBlockingV2Stub newBlockingV2Stub(
      io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<WorkflowExecutionCommandControllerBlockingV2Stub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<WorkflowExecutionCommandControllerBlockingV2Stub>() {
        @java.lang.Override
        public WorkflowExecutionCommandControllerBlockingV2Stub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new WorkflowExecutionCommandControllerBlockingV2Stub(channel, callOptions);
        }
      };
    return WorkflowExecutionCommandControllerBlockingV2Stub.newStub(factory, channel);
  }

  /**
   * Creates a new blocking-style stub that supports unary and streaming output calls on the service
   */
  public static WorkflowExecutionCommandControllerBlockingStub newBlockingStub(
      io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<WorkflowExecutionCommandControllerBlockingStub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<WorkflowExecutionCommandControllerBlockingStub>() {
        @java.lang.Override
        public WorkflowExecutionCommandControllerBlockingStub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new WorkflowExecutionCommandControllerBlockingStub(channel, callOptions);
        }
      };
    return WorkflowExecutionCommandControllerBlockingStub.newStub(factory, channel);
  }

  /**
   * Creates a new ListenableFuture-style stub that supports unary calls on the service
   */
  public static WorkflowExecutionCommandControllerFutureStub newFutureStub(
      io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<WorkflowExecutionCommandControllerFutureStub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<WorkflowExecutionCommandControllerFutureStub>() {
        @java.lang.Override
        public WorkflowExecutionCommandControllerFutureStub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new WorkflowExecutionCommandControllerFutureStub(channel, callOptions);
        }
      };
    return WorkflowExecutionCommandControllerFutureStub.newStub(factory, channel);
  }

  /**
   * <pre>
   * WorkflowExecutionCommandController handles write operations (Create, Update, Delete) for WorkflowExecution resources.
   * This service follows the Command-Query Separation (CQS) pattern:
   * - CommandController: Write operations (create, update, delete)
   * - QueryController: Read operations (get, list, search)
   * Authorization:
   * All RPCs use custom authorization logic implemented in middleware.
   * Custom authorization is needed because:
   * - create: Must verify user has "execute" permission on the referenced WorkflowInstance
   * - update: Only the workflow runner (system) can update execution status, not users
   * Service Options:
   * - api_resource_kind: workflow_execution - Links this service to the WorkflowExecution resource
   * </pre>
   */
  public interface AsyncService {

    /**
     * <pre>
     * Create and trigger a new workflow execution.
     * This RPC creates a WorkflowExecution resource and immediately triggers it for execution.
     * The workflow execution engine picks up the execution and begins processing tasks.
     * </pre>
     */
    default void create(ai.stigmer.agentic.workflowexecution.v1.WorkflowExecution request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.workflowexecution.v1.WorkflowExecution> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getCreateMethod(), responseObserver);
    }

    /**
     * <pre>
     * Update an existing workflow execution with full state.
     * </pre>
     */
    default void update(ai.stigmer.agentic.workflowexecution.v1.WorkflowExecution request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.workflowexecution.v1.WorkflowExecution> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getUpdateMethod(), responseObserver);
    }

    /**
     * <pre>
     * Update execution status during workflow execution.
     * </pre>
     */
    default void updateStatus(ai.stigmer.agentic.workflowexecution.v1.WorkflowExecutionUpdateStatusInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.workflowexecution.v1.WorkflowExecution> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getUpdateStatusMethod(), responseObserver);
    }

    /**
     * <pre>
     * Submit an approval decision for a child agent's tool execution.
     * This RPC forwards the approval decision to the child AgentExecution that
     * is waiting for approval. The child is identified by the child_agent_execution_id
     * in status.pending_approval.
     * When a workflow invokes an agent that requires tool approval, the approval
     * request surfaces at the workflow level via status.pending_approval. Users can
     * submit their decision through this RPC, which forwards it to the child agent.
     * </pre>
     */
    default void submitApproval(ai.stigmer.agentic.workflowexecution.v1.SubmitWorkflowApprovalInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.workflowexecution.v1.WorkflowExecution> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getSubmitApprovalMethod(), responseObserver);
    }

    /**
     * <pre>
     * Submit a keep/discard decision for a child agent's file review.
     * Forwards the decision to the child AgentExecution whose file-review gate is
     * surfaced on this workflow via status.pending_file_reviews. This is the
     * file-review sibling of submitApproval: submitApproval forwards a tool-call
     * approval, submitFileDecision forwards a FileChangeSet keep/discard.
     * </pre>
     */
    default void submitFileDecision(ai.stigmer.agentic.workflowexecution.v1.SubmitWorkflowFileDecisionInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.workflowexecution.v1.WorkflowExecution> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getSubmitFileDecisionMethod(), responseObserver);
    }

    /**
     * <pre>
     * Submit a human reviewer's decision for a workflow-level human_input task.
     * Resolves a human_input approval gate by sending the reviewer's outcome
     * (and optional form data) to the waiting workflow task via Temporal signal.
     * </pre>
     */
    default void submitWorkflowTaskApproval(ai.stigmer.agentic.workflowexecution.v1.SubmitWorkflowTaskApprovalInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.workflowexecution.v1.WorkflowExecution> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getSubmitWorkflowTaskApprovalMethod(), responseObserver);
    }

    /**
     * <pre>
     * Delete a workflow execution.
     * </pre>
     */
    default void delete(ai.stigmer.commons.apiresource.ApiResourceId request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.workflowexecution.v1.WorkflowExecution> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getDeleteMethod(), responseObserver);
    }

    /**
     * <pre>
     * Send a signal to a running workflow execution.
     * Delivers a signal to a workflow execution, typically to unblock a LISTEN task.
     * Delivery is race-proof: the signal is guaranteed to arrive even if sent
     * before the workflow is fully started.
     * </pre>
     */
    default void sendSignal(ai.stigmer.agentic.workflowexecution.v1.SendSignalInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.workflowexecution.v1.WorkflowExecution> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getSendSignalMethod(), responseObserver);
    }

    /**
     * <pre>
     * Cancel a running workflow execution gracefully.
     * Sends a cancellation signal to the workflow. The workflow code can handle
     * the cancellation signal to perform cleanup (e.g., compensation logic,
     * resource cleanup, notifications) before transitioning to the CANCELLED phase.
     * </pre>
     */
    default void cancel(ai.stigmer.agentic.workflowexecution.v1.CancelWorkflowExecutionInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.workflowexecution.v1.WorkflowExecution> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getCancelMethod(), responseObserver);
    }

    /**
     * <pre>
     * Terminate a workflow execution immediately.
     * Force-stops the workflow without allowing cleanup. Unlike cancel,
     * the workflow code cannot respond to termination - it is stopped immediately.
     * Use this for stuck or unresponsive workflows that don't respond to cancellation.
     * </pre>
     */
    default void terminate(ai.stigmer.agentic.workflowexecution.v1.TerminateWorkflowExecutionInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.workflowexecution.v1.WorkflowExecution> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getTerminateMethod(), responseObserver);
    }

    /**
     * <pre>
     * Recover a failed workflow execution.
     * Terminates the existing (possibly stuck) Temporal orchestrator and child
     * workflows, recreates the ExecutionContext with freshly resolved environment
     * variables, and starts a new Temporal workflow with recovery mode enabled.
     * The workflow engine reads completed task outputs from the persisted event
     * log, skips those tasks, and resumes execution from the first incomplete or
     * failed task — preserving all previously completed work.
     * </pre>
     */
    default void recover(ai.stigmer.agentic.workflowexecution.v1.RecoverWorkflowExecutionInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.workflowexecution.v1.WorkflowExecution> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getRecoverMethod(), responseObserver);
    }

    /**
     * <pre>
     * Pause a running workflow execution.
     * Temporarily stops the workflow at its current checkpoint. Unlike cancel,
     * the execution is NOT terminal and can be resumed later from where it left off.
     * The workflow gracefully checkpoints and exits, preserving all progress.
     * </pre>
     */
    default void pause(ai.stigmer.agentic.workflowexecution.v1.PauseWorkflowExecutionInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.workflowexecution.v1.WorkflowExecution> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getPauseMethod(), responseObserver);
    }

    /**
     * <pre>
     * Resume a paused workflow execution.
     * Continues execution from the checkpoint where it was paused. The workflow
     * re-invokes activities with the same thread_id, which loads from checkpoint
     * and continues from where it left off.
     * </pre>
     */
    default void resume(ai.stigmer.agentic.workflowexecution.v1.ResumeWorkflowExecutionInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.workflowexecution.v1.WorkflowExecution> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getResumeMethod(), responseObserver);
    }
  }

  /**
   * Base class for the server implementation of the service WorkflowExecutionCommandController.
   * <pre>
   * WorkflowExecutionCommandController handles write operations (Create, Update, Delete) for WorkflowExecution resources.
   * This service follows the Command-Query Separation (CQS) pattern:
   * - CommandController: Write operations (create, update, delete)
   * - QueryController: Read operations (get, list, search)
   * Authorization:
   * All RPCs use custom authorization logic implemented in middleware.
   * Custom authorization is needed because:
   * - create: Must verify user has "execute" permission on the referenced WorkflowInstance
   * - update: Only the workflow runner (system) can update execution status, not users
   * Service Options:
   * - api_resource_kind: workflow_execution - Links this service to the WorkflowExecution resource
   * </pre>
   */
  public static abstract class WorkflowExecutionCommandControllerImplBase
      implements io.grpc.BindableService, AsyncService {

    @java.lang.Override public final io.grpc.ServerServiceDefinition bindService() {
      return WorkflowExecutionCommandControllerGrpc.bindService(this);
    }
  }

  /**
   * A stub to allow clients to do asynchronous rpc calls to service WorkflowExecutionCommandController.
   * <pre>
   * WorkflowExecutionCommandController handles write operations (Create, Update, Delete) for WorkflowExecution resources.
   * This service follows the Command-Query Separation (CQS) pattern:
   * - CommandController: Write operations (create, update, delete)
   * - QueryController: Read operations (get, list, search)
   * Authorization:
   * All RPCs use custom authorization logic implemented in middleware.
   * Custom authorization is needed because:
   * - create: Must verify user has "execute" permission on the referenced WorkflowInstance
   * - update: Only the workflow runner (system) can update execution status, not users
   * Service Options:
   * - api_resource_kind: workflow_execution - Links this service to the WorkflowExecution resource
   * </pre>
   */
  public static final class WorkflowExecutionCommandControllerStub
      extends io.grpc.stub.AbstractAsyncStub<WorkflowExecutionCommandControllerStub> {
    private WorkflowExecutionCommandControllerStub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected WorkflowExecutionCommandControllerStub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new WorkflowExecutionCommandControllerStub(channel, callOptions);
    }

    /**
     * <pre>
     * Create and trigger a new workflow execution.
     * This RPC creates a WorkflowExecution resource and immediately triggers it for execution.
     * The workflow execution engine picks up the execution and begins processing tasks.
     * </pre>
     */
    public void create(ai.stigmer.agentic.workflowexecution.v1.WorkflowExecution request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.workflowexecution.v1.WorkflowExecution> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getCreateMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * Update an existing workflow execution with full state.
     * </pre>
     */
    public void update(ai.stigmer.agentic.workflowexecution.v1.WorkflowExecution request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.workflowexecution.v1.WorkflowExecution> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getUpdateMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * Update execution status during workflow execution.
     * </pre>
     */
    public void updateStatus(ai.stigmer.agentic.workflowexecution.v1.WorkflowExecutionUpdateStatusInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.workflowexecution.v1.WorkflowExecution> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getUpdateStatusMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * Submit an approval decision for a child agent's tool execution.
     * This RPC forwards the approval decision to the child AgentExecution that
     * is waiting for approval. The child is identified by the child_agent_execution_id
     * in status.pending_approval.
     * When a workflow invokes an agent that requires tool approval, the approval
     * request surfaces at the workflow level via status.pending_approval. Users can
     * submit their decision through this RPC, which forwards it to the child agent.
     * </pre>
     */
    public void submitApproval(ai.stigmer.agentic.workflowexecution.v1.SubmitWorkflowApprovalInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.workflowexecution.v1.WorkflowExecution> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getSubmitApprovalMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * Submit a keep/discard decision for a child agent's file review.
     * Forwards the decision to the child AgentExecution whose file-review gate is
     * surfaced on this workflow via status.pending_file_reviews. This is the
     * file-review sibling of submitApproval: submitApproval forwards a tool-call
     * approval, submitFileDecision forwards a FileChangeSet keep/discard.
     * </pre>
     */
    public void submitFileDecision(ai.stigmer.agentic.workflowexecution.v1.SubmitWorkflowFileDecisionInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.workflowexecution.v1.WorkflowExecution> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getSubmitFileDecisionMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * Submit a human reviewer's decision for a workflow-level human_input task.
     * Resolves a human_input approval gate by sending the reviewer's outcome
     * (and optional form data) to the waiting workflow task via Temporal signal.
     * </pre>
     */
    public void submitWorkflowTaskApproval(ai.stigmer.agentic.workflowexecution.v1.SubmitWorkflowTaskApprovalInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.workflowexecution.v1.WorkflowExecution> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getSubmitWorkflowTaskApprovalMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * Delete a workflow execution.
     * </pre>
     */
    public void delete(ai.stigmer.commons.apiresource.ApiResourceId request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.workflowexecution.v1.WorkflowExecution> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getDeleteMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * Send a signal to a running workflow execution.
     * Delivers a signal to a workflow execution, typically to unblock a LISTEN task.
     * Delivery is race-proof: the signal is guaranteed to arrive even if sent
     * before the workflow is fully started.
     * </pre>
     */
    public void sendSignal(ai.stigmer.agentic.workflowexecution.v1.SendSignalInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.workflowexecution.v1.WorkflowExecution> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getSendSignalMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * Cancel a running workflow execution gracefully.
     * Sends a cancellation signal to the workflow. The workflow code can handle
     * the cancellation signal to perform cleanup (e.g., compensation logic,
     * resource cleanup, notifications) before transitioning to the CANCELLED phase.
     * </pre>
     */
    public void cancel(ai.stigmer.agentic.workflowexecution.v1.CancelWorkflowExecutionInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.workflowexecution.v1.WorkflowExecution> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getCancelMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * Terminate a workflow execution immediately.
     * Force-stops the workflow without allowing cleanup. Unlike cancel,
     * the workflow code cannot respond to termination - it is stopped immediately.
     * Use this for stuck or unresponsive workflows that don't respond to cancellation.
     * </pre>
     */
    public void terminate(ai.stigmer.agentic.workflowexecution.v1.TerminateWorkflowExecutionInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.workflowexecution.v1.WorkflowExecution> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getTerminateMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * Recover a failed workflow execution.
     * Terminates the existing (possibly stuck) Temporal orchestrator and child
     * workflows, recreates the ExecutionContext with freshly resolved environment
     * variables, and starts a new Temporal workflow with recovery mode enabled.
     * The workflow engine reads completed task outputs from the persisted event
     * log, skips those tasks, and resumes execution from the first incomplete or
     * failed task — preserving all previously completed work.
     * </pre>
     */
    public void recover(ai.stigmer.agentic.workflowexecution.v1.RecoverWorkflowExecutionInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.workflowexecution.v1.WorkflowExecution> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getRecoverMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * Pause a running workflow execution.
     * Temporarily stops the workflow at its current checkpoint. Unlike cancel,
     * the execution is NOT terminal and can be resumed later from where it left off.
     * The workflow gracefully checkpoints and exits, preserving all progress.
     * </pre>
     */
    public void pause(ai.stigmer.agentic.workflowexecution.v1.PauseWorkflowExecutionInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.workflowexecution.v1.WorkflowExecution> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getPauseMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * Resume a paused workflow execution.
     * Continues execution from the checkpoint where it was paused. The workflow
     * re-invokes activities with the same thread_id, which loads from checkpoint
     * and continues from where it left off.
     * </pre>
     */
    public void resume(ai.stigmer.agentic.workflowexecution.v1.ResumeWorkflowExecutionInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.workflowexecution.v1.WorkflowExecution> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getResumeMethod(), getCallOptions()), request, responseObserver);
    }
  }

  /**
   * A stub to allow clients to do synchronous rpc calls to service WorkflowExecutionCommandController.
   * <pre>
   * WorkflowExecutionCommandController handles write operations (Create, Update, Delete) for WorkflowExecution resources.
   * This service follows the Command-Query Separation (CQS) pattern:
   * - CommandController: Write operations (create, update, delete)
   * - QueryController: Read operations (get, list, search)
   * Authorization:
   * All RPCs use custom authorization logic implemented in middleware.
   * Custom authorization is needed because:
   * - create: Must verify user has "execute" permission on the referenced WorkflowInstance
   * - update: Only the workflow runner (system) can update execution status, not users
   * Service Options:
   * - api_resource_kind: workflow_execution - Links this service to the WorkflowExecution resource
   * </pre>
   */
  public static final class WorkflowExecutionCommandControllerBlockingV2Stub
      extends io.grpc.stub.AbstractBlockingStub<WorkflowExecutionCommandControllerBlockingV2Stub> {
    private WorkflowExecutionCommandControllerBlockingV2Stub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected WorkflowExecutionCommandControllerBlockingV2Stub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new WorkflowExecutionCommandControllerBlockingV2Stub(channel, callOptions);
    }

    /**
     * <pre>
     * Create and trigger a new workflow execution.
     * This RPC creates a WorkflowExecution resource and immediately triggers it for execution.
     * The workflow execution engine picks up the execution and begins processing tasks.
     * </pre>
     */
    public ai.stigmer.agentic.workflowexecution.v1.WorkflowExecution create(ai.stigmer.agentic.workflowexecution.v1.WorkflowExecution request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getCreateMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Update an existing workflow execution with full state.
     * </pre>
     */
    public ai.stigmer.agentic.workflowexecution.v1.WorkflowExecution update(ai.stigmer.agentic.workflowexecution.v1.WorkflowExecution request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getUpdateMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Update execution status during workflow execution.
     * </pre>
     */
    public ai.stigmer.agentic.workflowexecution.v1.WorkflowExecution updateStatus(ai.stigmer.agentic.workflowexecution.v1.WorkflowExecutionUpdateStatusInput request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getUpdateStatusMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Submit an approval decision for a child agent's tool execution.
     * This RPC forwards the approval decision to the child AgentExecution that
     * is waiting for approval. The child is identified by the child_agent_execution_id
     * in status.pending_approval.
     * When a workflow invokes an agent that requires tool approval, the approval
     * request surfaces at the workflow level via status.pending_approval. Users can
     * submit their decision through this RPC, which forwards it to the child agent.
     * </pre>
     */
    public ai.stigmer.agentic.workflowexecution.v1.WorkflowExecution submitApproval(ai.stigmer.agentic.workflowexecution.v1.SubmitWorkflowApprovalInput request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getSubmitApprovalMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Submit a keep/discard decision for a child agent's file review.
     * Forwards the decision to the child AgentExecution whose file-review gate is
     * surfaced on this workflow via status.pending_file_reviews. This is the
     * file-review sibling of submitApproval: submitApproval forwards a tool-call
     * approval, submitFileDecision forwards a FileChangeSet keep/discard.
     * </pre>
     */
    public ai.stigmer.agentic.workflowexecution.v1.WorkflowExecution submitFileDecision(ai.stigmer.agentic.workflowexecution.v1.SubmitWorkflowFileDecisionInput request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getSubmitFileDecisionMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Submit a human reviewer's decision for a workflow-level human_input task.
     * Resolves a human_input approval gate by sending the reviewer's outcome
     * (and optional form data) to the waiting workflow task via Temporal signal.
     * </pre>
     */
    public ai.stigmer.agentic.workflowexecution.v1.WorkflowExecution submitWorkflowTaskApproval(ai.stigmer.agentic.workflowexecution.v1.SubmitWorkflowTaskApprovalInput request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getSubmitWorkflowTaskApprovalMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Delete a workflow execution.
     * </pre>
     */
    public ai.stigmer.agentic.workflowexecution.v1.WorkflowExecution delete(ai.stigmer.commons.apiresource.ApiResourceId request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getDeleteMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Send a signal to a running workflow execution.
     * Delivers a signal to a workflow execution, typically to unblock a LISTEN task.
     * Delivery is race-proof: the signal is guaranteed to arrive even if sent
     * before the workflow is fully started.
     * </pre>
     */
    public ai.stigmer.agentic.workflowexecution.v1.WorkflowExecution sendSignal(ai.stigmer.agentic.workflowexecution.v1.SendSignalInput request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getSendSignalMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Cancel a running workflow execution gracefully.
     * Sends a cancellation signal to the workflow. The workflow code can handle
     * the cancellation signal to perform cleanup (e.g., compensation logic,
     * resource cleanup, notifications) before transitioning to the CANCELLED phase.
     * </pre>
     */
    public ai.stigmer.agentic.workflowexecution.v1.WorkflowExecution cancel(ai.stigmer.agentic.workflowexecution.v1.CancelWorkflowExecutionInput request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getCancelMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Terminate a workflow execution immediately.
     * Force-stops the workflow without allowing cleanup. Unlike cancel,
     * the workflow code cannot respond to termination - it is stopped immediately.
     * Use this for stuck or unresponsive workflows that don't respond to cancellation.
     * </pre>
     */
    public ai.stigmer.agentic.workflowexecution.v1.WorkflowExecution terminate(ai.stigmer.agentic.workflowexecution.v1.TerminateWorkflowExecutionInput request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getTerminateMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Recover a failed workflow execution.
     * Terminates the existing (possibly stuck) Temporal orchestrator and child
     * workflows, recreates the ExecutionContext with freshly resolved environment
     * variables, and starts a new Temporal workflow with recovery mode enabled.
     * The workflow engine reads completed task outputs from the persisted event
     * log, skips those tasks, and resumes execution from the first incomplete or
     * failed task — preserving all previously completed work.
     * </pre>
     */
    public ai.stigmer.agentic.workflowexecution.v1.WorkflowExecution recover(ai.stigmer.agentic.workflowexecution.v1.RecoverWorkflowExecutionInput request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getRecoverMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Pause a running workflow execution.
     * Temporarily stops the workflow at its current checkpoint. Unlike cancel,
     * the execution is NOT terminal and can be resumed later from where it left off.
     * The workflow gracefully checkpoints and exits, preserving all progress.
     * </pre>
     */
    public ai.stigmer.agentic.workflowexecution.v1.WorkflowExecution pause(ai.stigmer.agentic.workflowexecution.v1.PauseWorkflowExecutionInput request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getPauseMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Resume a paused workflow execution.
     * Continues execution from the checkpoint where it was paused. The workflow
     * re-invokes activities with the same thread_id, which loads from checkpoint
     * and continues from where it left off.
     * </pre>
     */
    public ai.stigmer.agentic.workflowexecution.v1.WorkflowExecution resume(ai.stigmer.agentic.workflowexecution.v1.ResumeWorkflowExecutionInput request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getResumeMethod(), getCallOptions(), request);
    }
  }

  /**
   * A stub to allow clients to do limited synchronous rpc calls to service WorkflowExecutionCommandController.
   * <pre>
   * WorkflowExecutionCommandController handles write operations (Create, Update, Delete) for WorkflowExecution resources.
   * This service follows the Command-Query Separation (CQS) pattern:
   * - CommandController: Write operations (create, update, delete)
   * - QueryController: Read operations (get, list, search)
   * Authorization:
   * All RPCs use custom authorization logic implemented in middleware.
   * Custom authorization is needed because:
   * - create: Must verify user has "execute" permission on the referenced WorkflowInstance
   * - update: Only the workflow runner (system) can update execution status, not users
   * Service Options:
   * - api_resource_kind: workflow_execution - Links this service to the WorkflowExecution resource
   * </pre>
   */
  public static final class WorkflowExecutionCommandControllerBlockingStub
      extends io.grpc.stub.AbstractBlockingStub<WorkflowExecutionCommandControllerBlockingStub> {
    private WorkflowExecutionCommandControllerBlockingStub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected WorkflowExecutionCommandControllerBlockingStub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new WorkflowExecutionCommandControllerBlockingStub(channel, callOptions);
    }

    /**
     * <pre>
     * Create and trigger a new workflow execution.
     * This RPC creates a WorkflowExecution resource and immediately triggers it for execution.
     * The workflow execution engine picks up the execution and begins processing tasks.
     * </pre>
     */
    public ai.stigmer.agentic.workflowexecution.v1.WorkflowExecution create(ai.stigmer.agentic.workflowexecution.v1.WorkflowExecution request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getCreateMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Update an existing workflow execution with full state.
     * </pre>
     */
    public ai.stigmer.agentic.workflowexecution.v1.WorkflowExecution update(ai.stigmer.agentic.workflowexecution.v1.WorkflowExecution request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getUpdateMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Update execution status during workflow execution.
     * </pre>
     */
    public ai.stigmer.agentic.workflowexecution.v1.WorkflowExecution updateStatus(ai.stigmer.agentic.workflowexecution.v1.WorkflowExecutionUpdateStatusInput request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getUpdateStatusMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Submit an approval decision for a child agent's tool execution.
     * This RPC forwards the approval decision to the child AgentExecution that
     * is waiting for approval. The child is identified by the child_agent_execution_id
     * in status.pending_approval.
     * When a workflow invokes an agent that requires tool approval, the approval
     * request surfaces at the workflow level via status.pending_approval. Users can
     * submit their decision through this RPC, which forwards it to the child agent.
     * </pre>
     */
    public ai.stigmer.agentic.workflowexecution.v1.WorkflowExecution submitApproval(ai.stigmer.agentic.workflowexecution.v1.SubmitWorkflowApprovalInput request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getSubmitApprovalMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Submit a keep/discard decision for a child agent's file review.
     * Forwards the decision to the child AgentExecution whose file-review gate is
     * surfaced on this workflow via status.pending_file_reviews. This is the
     * file-review sibling of submitApproval: submitApproval forwards a tool-call
     * approval, submitFileDecision forwards a FileChangeSet keep/discard.
     * </pre>
     */
    public ai.stigmer.agentic.workflowexecution.v1.WorkflowExecution submitFileDecision(ai.stigmer.agentic.workflowexecution.v1.SubmitWorkflowFileDecisionInput request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getSubmitFileDecisionMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Submit a human reviewer's decision for a workflow-level human_input task.
     * Resolves a human_input approval gate by sending the reviewer's outcome
     * (and optional form data) to the waiting workflow task via Temporal signal.
     * </pre>
     */
    public ai.stigmer.agentic.workflowexecution.v1.WorkflowExecution submitWorkflowTaskApproval(ai.stigmer.agentic.workflowexecution.v1.SubmitWorkflowTaskApprovalInput request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getSubmitWorkflowTaskApprovalMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Delete a workflow execution.
     * </pre>
     */
    public ai.stigmer.agentic.workflowexecution.v1.WorkflowExecution delete(ai.stigmer.commons.apiresource.ApiResourceId request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getDeleteMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Send a signal to a running workflow execution.
     * Delivers a signal to a workflow execution, typically to unblock a LISTEN task.
     * Delivery is race-proof: the signal is guaranteed to arrive even if sent
     * before the workflow is fully started.
     * </pre>
     */
    public ai.stigmer.agentic.workflowexecution.v1.WorkflowExecution sendSignal(ai.stigmer.agentic.workflowexecution.v1.SendSignalInput request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getSendSignalMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Cancel a running workflow execution gracefully.
     * Sends a cancellation signal to the workflow. The workflow code can handle
     * the cancellation signal to perform cleanup (e.g., compensation logic,
     * resource cleanup, notifications) before transitioning to the CANCELLED phase.
     * </pre>
     */
    public ai.stigmer.agentic.workflowexecution.v1.WorkflowExecution cancel(ai.stigmer.agentic.workflowexecution.v1.CancelWorkflowExecutionInput request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getCancelMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Terminate a workflow execution immediately.
     * Force-stops the workflow without allowing cleanup. Unlike cancel,
     * the workflow code cannot respond to termination - it is stopped immediately.
     * Use this for stuck or unresponsive workflows that don't respond to cancellation.
     * </pre>
     */
    public ai.stigmer.agentic.workflowexecution.v1.WorkflowExecution terminate(ai.stigmer.agentic.workflowexecution.v1.TerminateWorkflowExecutionInput request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getTerminateMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Recover a failed workflow execution.
     * Terminates the existing (possibly stuck) Temporal orchestrator and child
     * workflows, recreates the ExecutionContext with freshly resolved environment
     * variables, and starts a new Temporal workflow with recovery mode enabled.
     * The workflow engine reads completed task outputs from the persisted event
     * log, skips those tasks, and resumes execution from the first incomplete or
     * failed task — preserving all previously completed work.
     * </pre>
     */
    public ai.stigmer.agentic.workflowexecution.v1.WorkflowExecution recover(ai.stigmer.agentic.workflowexecution.v1.RecoverWorkflowExecutionInput request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getRecoverMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Pause a running workflow execution.
     * Temporarily stops the workflow at its current checkpoint. Unlike cancel,
     * the execution is NOT terminal and can be resumed later from where it left off.
     * The workflow gracefully checkpoints and exits, preserving all progress.
     * </pre>
     */
    public ai.stigmer.agentic.workflowexecution.v1.WorkflowExecution pause(ai.stigmer.agentic.workflowexecution.v1.PauseWorkflowExecutionInput request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getPauseMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Resume a paused workflow execution.
     * Continues execution from the checkpoint where it was paused. The workflow
     * re-invokes activities with the same thread_id, which loads from checkpoint
     * and continues from where it left off.
     * </pre>
     */
    public ai.stigmer.agentic.workflowexecution.v1.WorkflowExecution resume(ai.stigmer.agentic.workflowexecution.v1.ResumeWorkflowExecutionInput request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getResumeMethod(), getCallOptions(), request);
    }
  }

  /**
   * A stub to allow clients to do ListenableFuture-style rpc calls to service WorkflowExecutionCommandController.
   * <pre>
   * WorkflowExecutionCommandController handles write operations (Create, Update, Delete) for WorkflowExecution resources.
   * This service follows the Command-Query Separation (CQS) pattern:
   * - CommandController: Write operations (create, update, delete)
   * - QueryController: Read operations (get, list, search)
   * Authorization:
   * All RPCs use custom authorization logic implemented in middleware.
   * Custom authorization is needed because:
   * - create: Must verify user has "execute" permission on the referenced WorkflowInstance
   * - update: Only the workflow runner (system) can update execution status, not users
   * Service Options:
   * - api_resource_kind: workflow_execution - Links this service to the WorkflowExecution resource
   * </pre>
   */
  public static final class WorkflowExecutionCommandControllerFutureStub
      extends io.grpc.stub.AbstractFutureStub<WorkflowExecutionCommandControllerFutureStub> {
    private WorkflowExecutionCommandControllerFutureStub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected WorkflowExecutionCommandControllerFutureStub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new WorkflowExecutionCommandControllerFutureStub(channel, callOptions);
    }

    /**
     * <pre>
     * Create and trigger a new workflow execution.
     * This RPC creates a WorkflowExecution resource and immediately triggers it for execution.
     * The workflow execution engine picks up the execution and begins processing tasks.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.agentic.workflowexecution.v1.WorkflowExecution> create(
        ai.stigmer.agentic.workflowexecution.v1.WorkflowExecution request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getCreateMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * Update an existing workflow execution with full state.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.agentic.workflowexecution.v1.WorkflowExecution> update(
        ai.stigmer.agentic.workflowexecution.v1.WorkflowExecution request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getUpdateMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * Update execution status during workflow execution.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.agentic.workflowexecution.v1.WorkflowExecution> updateStatus(
        ai.stigmer.agentic.workflowexecution.v1.WorkflowExecutionUpdateStatusInput request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getUpdateStatusMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * Submit an approval decision for a child agent's tool execution.
     * This RPC forwards the approval decision to the child AgentExecution that
     * is waiting for approval. The child is identified by the child_agent_execution_id
     * in status.pending_approval.
     * When a workflow invokes an agent that requires tool approval, the approval
     * request surfaces at the workflow level via status.pending_approval. Users can
     * submit their decision through this RPC, which forwards it to the child agent.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.agentic.workflowexecution.v1.WorkflowExecution> submitApproval(
        ai.stigmer.agentic.workflowexecution.v1.SubmitWorkflowApprovalInput request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getSubmitApprovalMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * Submit a keep/discard decision for a child agent's file review.
     * Forwards the decision to the child AgentExecution whose file-review gate is
     * surfaced on this workflow via status.pending_file_reviews. This is the
     * file-review sibling of submitApproval: submitApproval forwards a tool-call
     * approval, submitFileDecision forwards a FileChangeSet keep/discard.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.agentic.workflowexecution.v1.WorkflowExecution> submitFileDecision(
        ai.stigmer.agentic.workflowexecution.v1.SubmitWorkflowFileDecisionInput request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getSubmitFileDecisionMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * Submit a human reviewer's decision for a workflow-level human_input task.
     * Resolves a human_input approval gate by sending the reviewer's outcome
     * (and optional form data) to the waiting workflow task via Temporal signal.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.agentic.workflowexecution.v1.WorkflowExecution> submitWorkflowTaskApproval(
        ai.stigmer.agentic.workflowexecution.v1.SubmitWorkflowTaskApprovalInput request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getSubmitWorkflowTaskApprovalMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * Delete a workflow execution.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.agentic.workflowexecution.v1.WorkflowExecution> delete(
        ai.stigmer.commons.apiresource.ApiResourceId request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getDeleteMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * Send a signal to a running workflow execution.
     * Delivers a signal to a workflow execution, typically to unblock a LISTEN task.
     * Delivery is race-proof: the signal is guaranteed to arrive even if sent
     * before the workflow is fully started.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.agentic.workflowexecution.v1.WorkflowExecution> sendSignal(
        ai.stigmer.agentic.workflowexecution.v1.SendSignalInput request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getSendSignalMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * Cancel a running workflow execution gracefully.
     * Sends a cancellation signal to the workflow. The workflow code can handle
     * the cancellation signal to perform cleanup (e.g., compensation logic,
     * resource cleanup, notifications) before transitioning to the CANCELLED phase.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.agentic.workflowexecution.v1.WorkflowExecution> cancel(
        ai.stigmer.agentic.workflowexecution.v1.CancelWorkflowExecutionInput request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getCancelMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * Terminate a workflow execution immediately.
     * Force-stops the workflow without allowing cleanup. Unlike cancel,
     * the workflow code cannot respond to termination - it is stopped immediately.
     * Use this for stuck or unresponsive workflows that don't respond to cancellation.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.agentic.workflowexecution.v1.WorkflowExecution> terminate(
        ai.stigmer.agentic.workflowexecution.v1.TerminateWorkflowExecutionInput request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getTerminateMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * Recover a failed workflow execution.
     * Terminates the existing (possibly stuck) Temporal orchestrator and child
     * workflows, recreates the ExecutionContext with freshly resolved environment
     * variables, and starts a new Temporal workflow with recovery mode enabled.
     * The workflow engine reads completed task outputs from the persisted event
     * log, skips those tasks, and resumes execution from the first incomplete or
     * failed task — preserving all previously completed work.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.agentic.workflowexecution.v1.WorkflowExecution> recover(
        ai.stigmer.agentic.workflowexecution.v1.RecoverWorkflowExecutionInput request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getRecoverMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * Pause a running workflow execution.
     * Temporarily stops the workflow at its current checkpoint. Unlike cancel,
     * the execution is NOT terminal and can be resumed later from where it left off.
     * The workflow gracefully checkpoints and exits, preserving all progress.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.agentic.workflowexecution.v1.WorkflowExecution> pause(
        ai.stigmer.agentic.workflowexecution.v1.PauseWorkflowExecutionInput request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getPauseMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * Resume a paused workflow execution.
     * Continues execution from the checkpoint where it was paused. The workflow
     * re-invokes activities with the same thread_id, which loads from checkpoint
     * and continues from where it left off.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.agentic.workflowexecution.v1.WorkflowExecution> resume(
        ai.stigmer.agentic.workflowexecution.v1.ResumeWorkflowExecutionInput request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getResumeMethod(), getCallOptions()), request);
    }
  }

  private static final int METHODID_CREATE = 0;
  private static final int METHODID_UPDATE = 1;
  private static final int METHODID_UPDATE_STATUS = 2;
  private static final int METHODID_SUBMIT_APPROVAL = 3;
  private static final int METHODID_SUBMIT_FILE_DECISION = 4;
  private static final int METHODID_SUBMIT_WORKFLOW_TASK_APPROVAL = 5;
  private static final int METHODID_DELETE = 6;
  private static final int METHODID_SEND_SIGNAL = 7;
  private static final int METHODID_CANCEL = 8;
  private static final int METHODID_TERMINATE = 9;
  private static final int METHODID_RECOVER = 10;
  private static final int METHODID_PAUSE = 11;
  private static final int METHODID_RESUME = 12;

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
          serviceImpl.create((ai.stigmer.agentic.workflowexecution.v1.WorkflowExecution) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.agentic.workflowexecution.v1.WorkflowExecution>) responseObserver);
          break;
        case METHODID_UPDATE:
          serviceImpl.update((ai.stigmer.agentic.workflowexecution.v1.WorkflowExecution) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.agentic.workflowexecution.v1.WorkflowExecution>) responseObserver);
          break;
        case METHODID_UPDATE_STATUS:
          serviceImpl.updateStatus((ai.stigmer.agentic.workflowexecution.v1.WorkflowExecutionUpdateStatusInput) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.agentic.workflowexecution.v1.WorkflowExecution>) responseObserver);
          break;
        case METHODID_SUBMIT_APPROVAL:
          serviceImpl.submitApproval((ai.stigmer.agentic.workflowexecution.v1.SubmitWorkflowApprovalInput) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.agentic.workflowexecution.v1.WorkflowExecution>) responseObserver);
          break;
        case METHODID_SUBMIT_FILE_DECISION:
          serviceImpl.submitFileDecision((ai.stigmer.agentic.workflowexecution.v1.SubmitWorkflowFileDecisionInput) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.agentic.workflowexecution.v1.WorkflowExecution>) responseObserver);
          break;
        case METHODID_SUBMIT_WORKFLOW_TASK_APPROVAL:
          serviceImpl.submitWorkflowTaskApproval((ai.stigmer.agentic.workflowexecution.v1.SubmitWorkflowTaskApprovalInput) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.agentic.workflowexecution.v1.WorkflowExecution>) responseObserver);
          break;
        case METHODID_DELETE:
          serviceImpl.delete((ai.stigmer.commons.apiresource.ApiResourceId) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.agentic.workflowexecution.v1.WorkflowExecution>) responseObserver);
          break;
        case METHODID_SEND_SIGNAL:
          serviceImpl.sendSignal((ai.stigmer.agentic.workflowexecution.v1.SendSignalInput) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.agentic.workflowexecution.v1.WorkflowExecution>) responseObserver);
          break;
        case METHODID_CANCEL:
          serviceImpl.cancel((ai.stigmer.agentic.workflowexecution.v1.CancelWorkflowExecutionInput) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.agentic.workflowexecution.v1.WorkflowExecution>) responseObserver);
          break;
        case METHODID_TERMINATE:
          serviceImpl.terminate((ai.stigmer.agentic.workflowexecution.v1.TerminateWorkflowExecutionInput) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.agentic.workflowexecution.v1.WorkflowExecution>) responseObserver);
          break;
        case METHODID_RECOVER:
          serviceImpl.recover((ai.stigmer.agentic.workflowexecution.v1.RecoverWorkflowExecutionInput) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.agentic.workflowexecution.v1.WorkflowExecution>) responseObserver);
          break;
        case METHODID_PAUSE:
          serviceImpl.pause((ai.stigmer.agentic.workflowexecution.v1.PauseWorkflowExecutionInput) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.agentic.workflowexecution.v1.WorkflowExecution>) responseObserver);
          break;
        case METHODID_RESUME:
          serviceImpl.resume((ai.stigmer.agentic.workflowexecution.v1.ResumeWorkflowExecutionInput) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.agentic.workflowexecution.v1.WorkflowExecution>) responseObserver);
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
              ai.stigmer.agentic.workflowexecution.v1.WorkflowExecution,
              ai.stigmer.agentic.workflowexecution.v1.WorkflowExecution>(
                service, METHODID_CREATE)))
        .addMethod(
          getUpdateMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.agentic.workflowexecution.v1.WorkflowExecution,
              ai.stigmer.agentic.workflowexecution.v1.WorkflowExecution>(
                service, METHODID_UPDATE)))
        .addMethod(
          getUpdateStatusMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.agentic.workflowexecution.v1.WorkflowExecutionUpdateStatusInput,
              ai.stigmer.agentic.workflowexecution.v1.WorkflowExecution>(
                service, METHODID_UPDATE_STATUS)))
        .addMethod(
          getSubmitApprovalMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.agentic.workflowexecution.v1.SubmitWorkflowApprovalInput,
              ai.stigmer.agentic.workflowexecution.v1.WorkflowExecution>(
                service, METHODID_SUBMIT_APPROVAL)))
        .addMethod(
          getSubmitFileDecisionMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.agentic.workflowexecution.v1.SubmitWorkflowFileDecisionInput,
              ai.stigmer.agentic.workflowexecution.v1.WorkflowExecution>(
                service, METHODID_SUBMIT_FILE_DECISION)))
        .addMethod(
          getSubmitWorkflowTaskApprovalMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.agentic.workflowexecution.v1.SubmitWorkflowTaskApprovalInput,
              ai.stigmer.agentic.workflowexecution.v1.WorkflowExecution>(
                service, METHODID_SUBMIT_WORKFLOW_TASK_APPROVAL)))
        .addMethod(
          getDeleteMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.commons.apiresource.ApiResourceId,
              ai.stigmer.agentic.workflowexecution.v1.WorkflowExecution>(
                service, METHODID_DELETE)))
        .addMethod(
          getSendSignalMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.agentic.workflowexecution.v1.SendSignalInput,
              ai.stigmer.agentic.workflowexecution.v1.WorkflowExecution>(
                service, METHODID_SEND_SIGNAL)))
        .addMethod(
          getCancelMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.agentic.workflowexecution.v1.CancelWorkflowExecutionInput,
              ai.stigmer.agentic.workflowexecution.v1.WorkflowExecution>(
                service, METHODID_CANCEL)))
        .addMethod(
          getTerminateMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.agentic.workflowexecution.v1.TerminateWorkflowExecutionInput,
              ai.stigmer.agentic.workflowexecution.v1.WorkflowExecution>(
                service, METHODID_TERMINATE)))
        .addMethod(
          getRecoverMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.agentic.workflowexecution.v1.RecoverWorkflowExecutionInput,
              ai.stigmer.agentic.workflowexecution.v1.WorkflowExecution>(
                service, METHODID_RECOVER)))
        .addMethod(
          getPauseMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.agentic.workflowexecution.v1.PauseWorkflowExecutionInput,
              ai.stigmer.agentic.workflowexecution.v1.WorkflowExecution>(
                service, METHODID_PAUSE)))
        .addMethod(
          getResumeMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.agentic.workflowexecution.v1.ResumeWorkflowExecutionInput,
              ai.stigmer.agentic.workflowexecution.v1.WorkflowExecution>(
                service, METHODID_RESUME)))
        .build();
  }

  private static abstract class WorkflowExecutionCommandControllerBaseDescriptorSupplier
      implements io.grpc.protobuf.ProtoFileDescriptorSupplier, io.grpc.protobuf.ProtoServiceDescriptorSupplier {
    WorkflowExecutionCommandControllerBaseDescriptorSupplier() {}

    @java.lang.Override
    public com.google.protobuf.Descriptors.FileDescriptor getFileDescriptor() {
      return ai.stigmer.agentic.workflowexecution.v1.CommandProto.getDescriptor();
    }

    @java.lang.Override
    public com.google.protobuf.Descriptors.ServiceDescriptor getServiceDescriptor() {
      return getFileDescriptor().findServiceByName("WorkflowExecutionCommandController");
    }
  }

  private static final class WorkflowExecutionCommandControllerFileDescriptorSupplier
      extends WorkflowExecutionCommandControllerBaseDescriptorSupplier {
    WorkflowExecutionCommandControllerFileDescriptorSupplier() {}
  }

  private static final class WorkflowExecutionCommandControllerMethodDescriptorSupplier
      extends WorkflowExecutionCommandControllerBaseDescriptorSupplier
      implements io.grpc.protobuf.ProtoMethodDescriptorSupplier {
    private final java.lang.String methodName;

    WorkflowExecutionCommandControllerMethodDescriptorSupplier(java.lang.String methodName) {
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
      synchronized (WorkflowExecutionCommandControllerGrpc.class) {
        result = serviceDescriptor;
        if (result == null) {
          serviceDescriptor = result = io.grpc.ServiceDescriptor.newBuilder(SERVICE_NAME)
              .setSchemaDescriptor(new WorkflowExecutionCommandControllerFileDescriptorSupplier())
              .addMethod(getCreateMethod())
              .addMethod(getUpdateMethod())
              .addMethod(getUpdateStatusMethod())
              .addMethod(getSubmitApprovalMethod())
              .addMethod(getSubmitFileDecisionMethod())
              .addMethod(getSubmitWorkflowTaskApprovalMethod())
              .addMethod(getDeleteMethod())
              .addMethod(getSendSignalMethod())
              .addMethod(getCancelMethod())
              .addMethod(getTerminateMethod())
              .addMethod(getRecoverMethod())
              .addMethod(getPauseMethod())
              .addMethod(getResumeMethod())
              .build();
        }
      }
    }
    return result;
  }
}
