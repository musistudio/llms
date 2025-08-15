import { UnifiedChatRequest, UnifiedMessage } from "@/types/llm";
import { Transformer, TransformerOptions } from "../types/transformer";

/**
 * ToolUseRouter 转换器
 * 当检测到工具调用时，将请求路由到指定的支持工具的模型
 * 类似于 webSearch 路由机制
 */
export class ToolUseRouterTransformer implements Transformer {
  name = "tooluse-router";
  
  private toolUseModel: string;
  private logger?: any;
  
  constructor(private readonly options?: TransformerOptions) {
    this.toolUseModel = options?.toolUseModel || "";
  }

  async transformRequestIn(
    request: UnifiedChatRequest
  ): Promise<UnifiedChatRequest> {
    // 检查是否有工具定义
    const hasTools = request.tools && request.tools.length > 0;
    
    // 检查历史消息中是否有工具调用或工具结果
    const hasToolUsage = request.messages.some(message => 
      message.tool_calls?.length > 0 || 
      message.role === "tool" ||
      (Array.isArray(message.content) && message.content.some((content: any) => 
        content.type === "tool_use" || content.type === "tool_result"
      ))
    );

    // 如果检测到工具使用且配置了工具模型，添加路由标记
    if ((hasTools || hasToolUsage) && this.toolUseModel) {
      // 在 system 消息中添加路由标记，类似现有的 CCR-SUBAGENT-MODEL 机制
      const routingInstruction = `<CCR-TOOLUSE-ROUTER>${this.toolUseModel}</CCR-TOOLUSE-ROUTER>`;
      
      // 查找现有的 system 消息
      const systemMessageIndex = request.messages.findIndex(msg => msg.role === "system");
      
      if (systemMessageIndex !== -1) {
        // 如果已有 system 消息，添加到其中
        const systemMessage = request.messages[systemMessageIndex];
        if (typeof systemMessage.content === "string") {
          systemMessage.content += `\n\n${routingInstruction}`;
        } else if (Array.isArray(systemMessage.content)) {
          systemMessage.content.push({
            type: "text",
            text: routingInstruction
          });
        }
      } else {
        // 如果没有 system 消息，创建一个新的
        request.messages.unshift({
          role: "system",
          content: routingInstruction
        });
      }

      this.logger?.debug(`Tool use detected, routing to model: ${this.toolUseModel}`);
    } else if (hasTools || hasToolUsage) {
      // 如果有工具但没有配置工具模型，记录提示信息，让全局路由处理
      this.logger?.debug("Tool use detected but no specific toolUseModel configured. Will use global toolUse routing if available.");
    }

    return request;
  }

  /**
   * 清理工具调用相关内容的辅助方法
   * 用于不支持工具的模型
   */
  private cleanToolsFromRequest(request: UnifiedChatRequest): UnifiedChatRequest {
    // 移除工具定义
    delete request.tools;
    delete request.tool_choice;

    // 清理消息中的工具调用内容
    request.messages = request.messages.map(message => {
      if (message.role === "tool") {
        // 将工具结果转换为普通的 assistant 消息
        return {
          role: "assistant",
          content: `Tool result: ${message.content}`
        };
      }

      if (message.tool_calls && message.tool_calls.length > 0) {
        // 将工具调用转换为文本描述
        const toolCallsText = message.tool_calls.map(call => 
          `Tool call: ${call.function.name}(${call.function.arguments})`
        ).join("\n");
        
        return {
          ...message,
          content: message.content ? `${message.content}\n\n${toolCallsText}` : toolCallsText,
          tool_calls: undefined
        };
      }

      // 清理消息内容中的工具相关项
      if (Array.isArray(message.content)) {
        const cleanedContent = message.content
          .filter((content: any) => 
            content.type !== "tool_use" && content.type !== "tool_result"
          )
          .map((content: any) => {
            // 如果是工具使用，转换为文本描述
            if (content.type === "tool_use") {
              return {
                type: "text",
                text: `Tool call: ${content.name}(${JSON.stringify(content.input)})`
              };
            }
            // 如果是工具结果，转换为文本描述  
            if (content.type === "tool_result") {
              return {
                type: "text",
                text: `Tool result: ${content.content}`
              };
            }
            return content;
          });

        if (cleanedContent.length === 0) {
          return {
            ...message,
            content: "[Tool interaction - content not displayable in text mode]"
          };
        }

        return {
          ...message,
          content: cleanedContent.length === 1 && cleanedContent[0].type === "text" 
            ? cleanedContent[0].text 
            : cleanedContent
        };
      }

      return message;
    }).filter(message => 
      // 过滤掉空的或纯工具相关的消息
      message.content && 
      message.content !== "" && 
      message.content !== "[Tool interaction - content not displayable in text mode]"
    );

    return request;
  }
}
