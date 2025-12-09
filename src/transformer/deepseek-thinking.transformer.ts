import { UnifiedChatRequest } from "../types/llm";
import { Transformer, TransformerContext } from "../types/transformer";

/**
 * DeepSeek Thinking Transformer
 * 
 * Handles DeepSeek v3.2 API requirements for reasoning_content field in assistant messages.
 * 
 * DeepSeek v3.2 requires:
 * 1. All assistant messages must have reasoning_content field (can be empty string)
 * 2. reasoning_content must be preserved from API responses for multi-turn conversations
 * 
 * See: https://api-docs.deepseek.com/guides/thinking_mode#tool-calls
 */
export class DeepseekThinkingTransformer implements Transformer {
  name = "deepseek-thinking";
  logger?: any;

  async transformRequestIn(
    request: UnifiedChatRequest,
    provider: any,
    context: TransformerContext
  ): Promise<UnifiedChatRequest> {
    this.logger?.info(`[DeepseekThinkingTransformer] Processing request for model: ${context.model}`);
    this.logger?.info(`[DeepseekThinkingTransformer] Provider model: ${provider?.model}`);

    // Only apply to deepseek-reasoner model
    const isReasonerModel = context.model === "deepseek-reasoner" ||
                           provider?.model === "deepseek-reasoner";

    this.logger?.info(`[DeepseekThinkingTransformer] Is reasoner model: ${isReasonerModel}`);

    if (!isReasonerModel) {
      this.logger?.info('[DeepseekThinkingTransformer] Skipping - not a reasoner model');
      return request;
    }

    // Ensure all assistant messages have reasoning_content field
    if (request.messages && Array.isArray(request.messages)) {
      const assistantMessagesBefore = request.messages.filter((m: any) => m.role === "assistant").length;
      this.logger?.info(`[DeepseekThinkingTransformer] Found ${assistantMessagesBefore} assistant messages`);

      request.messages = request.messages.map((msg: any) => {
        if (msg.role === "assistant") {
          // Add empty reasoning_content if missing
          if (msg.reasoning_content === undefined || msg.reasoning_content === null) {
            this.logger?.info('[DeepseekThinkingTransformer] Adding reasoning_content to assistant message');
            return {
              ...msg,
              reasoning_content: ""
            };
          } else {
            this.logger?.info('[DeepseekThinkingTransformer] Assistant message already has reasoning_content');
          }
        }
        return msg;
      });
    }

    this.logger?.info('[DeepseekThinkingTransformer] Request transformed successfully');
    return request;
  }

  async transformResponseOut(
    response: Response,
    context: TransformerContext
  ): Promise<Response> {
    // Only apply to deepseek-reasoner model
    const isReasonerModel = context.model === "deepseek-reasoner";
    
    if (!isReasonerModel) {
      return response;
    }

    // Handle non-streaming response
    if (response.headers.get("Content-Type")?.includes("application/json")) {
      const jsonResponse = await response.json();
      
      // Ensure reasoning_content exists in response for history preservation
      if (jsonResponse.choices?.[0]?.message) {
        if (!jsonResponse.choices[0].message.reasoning_content) {
          jsonResponse.choices[0].message.reasoning_content = "";
        }
      }
      
      return new Response(JSON.stringify(jsonResponse), {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
      });
    }
    
    // Streaming responses are handled by the deepseek transformer
    return response;
  }
}