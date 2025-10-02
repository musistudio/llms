import { UnifiedChatRequest } from "@/types/llm";
import { Transformer } from "@/types/transformer";

export class OpenAITransformer implements Transformer {
  static TransformerName = "openai";
  name = "openai";

  constructor() {}

  // Helper method to normalize image content
  private normalizeImageContent(content: any): any {
    // Handle Anthropic 'image' type conversion
    if (content.type === 'image' && content.source) {
      const url = content.source.type === 'base64' 
        ? `data:${content.source.media_type};base64,${content.source.data}`
        : content.source.url;
      
      return {
        type: 'image_url',
        image_url: {
          url: url,
          detail: 'high'
        }
      };
    }
    
    // Handle image_url type with extra fields
    if (content.type === 'image_url') {
      const normalized = {
        type: 'image_url',
        image_url: {
          url: content.image_url?.url || content.url,
          detail: content.image_url?.detail || 'high'
        }
      };
      
      // Remove all extra fields - only keep type and image_url
      return normalized;
    }
    
    return content;
  }

  // Helper method to normalize tool messages
  private normalizeToolMessages(messages: any[]): any[] {
    const normalized: any[] = [];
    let lastToolCallId: string | null = null;
    
    for (const msg of messages) {
      // Track tool call IDs from assistant messages
      if (msg.role === 'assistant' && msg.content && Array.isArray(msg.content)) {
        for (const part of msg.content) {
          if (part.type === 'tool_use' && part.id) {
            lastToolCallId = part.id;
          }
        }
        normalized.push(msg);
        continue;
      }
      
      // Handle messages with content arrays
      if (msg.content && Array.isArray(msg.content)) {
        const hasToolResult = msg.content.some((c: any) => 
          c.type === 'tool_result' || c.type === 'server_tool_use'
        );
        
        if (hasToolResult) {
          // Extract tool results and create separate tool messages
          for (const part of msg.content) {
            if (part.type === 'tool_result') {
              normalized.push({
                role: 'tool',
                tool_call_id: part.tool_use_id,
                content: typeof part.content === 'string' 
                  ? part.content 
                  : JSON.stringify(part.content)
              });
            } else if (part.type === 'server_tool_use') {
              // Use the last tool call ID from assistant message
              normalized.push({
                role: 'tool',
                tool_call_id: lastToolCallId || part.id.replace('srvtoolu_', 'call_'),
                content: JSON.stringify(part.result || {})
              });
            }
          }
          
          // Filter out tool results from the original message
          const nonToolContent = msg.content.filter((c: any) => 
            c.type !== 'tool_result' && c.type !== 'server_tool_use'
          );
          
          if (nonToolContent.length > 0) {
            normalized.push({
              ...msg,
              content: nonToolContent
            });
          }
        } else {
          normalized.push(msg);
        }
      } else {
        normalized.push(msg);
      }
    }
    
    return normalized;
  }

  async transformRequestOut(request: UnifiedChatRequest): Promise<UnifiedChatRequest> {
    // Fix A: Normalize image content in messages
    if (request.messages) {
      request.messages = request.messages.map(msg => {
        if (msg.content && Array.isArray(msg.content)) {
          msg.content = msg.content.map(part => {
            if (part.type === 'image_url' || part.type === 'image') {
              return this.normalizeImageContent(part);
            }
            return part;
          });
        }
        return msg;
      });
    }

    // Fix B: Convert tool result messages to proper format
    if (request.messages) {
      request.messages = this.normalizeToolMessages(request.messages);
    }

    // Convert Anthropic tool format to OpenAI format
    if (request.tools) {
      request.tools = request.tools.map((tool: any) => ({
        type: "function",
        function: {
          name: tool.name,
          description: tool.description,
          parameters: tool.input_schema
        }
      }));
    }

    return request;
  }

  get endPoint(): string {
    return "/chat/completions";
  }
}
