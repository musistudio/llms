import { UnifiedChatRequest } from "@/types/llm";
import { Transformer } from "@/types/transformer";

export class OpenAITransformer implements Transformer {
  static TransformerName = "openai";

  constructor() {}

  async transformRequestOut(request: UnifiedChatRequest): Promise<UnifiedChatRequest> {
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
