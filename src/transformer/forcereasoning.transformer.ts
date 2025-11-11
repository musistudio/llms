import { UnifiedChatRequest } from "../types/llm";
import { Transformer } from "../types/transformer";

export class ForceReasoningTransformer implements Transformer {
  name = "forcereasoning";

  async transformRequestIn(
    request: UnifiedChatRequest
  ): Promise<UnifiedChatRequest> {
    const systemMessage = request.messages.find(
      (item) => item.role === "system"
    );
    if (Array.isArray(systemMessage?.content)) {
      systemMessage.content.push({
        type: "text",
        text: "You are an expert reasoning model. \nAlways think step by step before answering. Even if the problem seems simple, always write down your reasoning process explicitly. \nNever skip your chain of thought. \nUse the following output format:\n<reasoning_content>(Write your full detailed thinking here.)</reasoning_content>\n\nWrite your final conclusion here.",
      });
    }
    const lastMessage = request.messages[request.messages.length - 1];
    if (lastMessage.role === "user" && Array.isArray(lastMessage.content)) {
      lastMessage.content.push({
        type: "text",
        text: "You are an expert reasoning model. \nAlways think step by step before answering. Even if the problem seems simple, always write down your reasoning process explicitly. \nNever skip your chain of thought. \nUse the following output format:\n<reasoning_content>(Write your full detailed thinking here.)</reasoning_content>\n\nWrite your final conclusion here.",
      });
    }
    if (lastMessage.role === "tool") {
      request.messages.push({
        role: "user",
        content: [
          {
            type: "text",
            text: "You are an expert reasoning model. \nAlways think step by step before answering. Even if the problem seems simple, always write down your reasoning process explicitly. \nNever skip your chain of thought. \nUse the following output format:\n<reasoning_content>(Write your full detailed thinking here.)</reasoning_content>\n\nWrite your final conclusion here.",
          },
        ],
      });
    }
    return request;
  }
}
