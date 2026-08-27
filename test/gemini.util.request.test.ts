import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildRequestBody } from "../src/utils/gemini.util.ts";
import type { UnifiedChatRequest } from "../src/types/llm.ts";

describe("buildRequestBody Gemini functionCall mapping", () => {
  it("omits functionCall.id when converting tool_calls that include an id, while keeping name and args", () => {
    const request: UnifiedChatRequest = {
      model: "gemini-3-pro-preview",
      messages: [
        {
          role: "user",
          content: "weather?",
        },
        {
          role: "assistant",
          content: null,
          tool_calls: [
            {
              id: "call_openai_or_anthropic_123",
              type: "function",
              function: {
                name: "get_weather",
                arguments: JSON.stringify({ city: "Shanghai" }),
              },
            },
          ],
        },
      ],
    };

    const body = buildRequestBody(request);
    const modelTurn = body.contents.find((content: { role: string }) => content.role === "model");
    assert.ok(modelTurn, "expected a model turn");

    const functionCall = modelTurn.parts.find(
      (part: { functionCall?: unknown }) => part.functionCall
    )?.functionCall;
    assert.ok(functionCall, "expected a functionCall part");
    assert.equal(functionCall.name, "get_weather");
    assert.deepEqual(functionCall.args, { city: "Shanghai" });
    assert.equal(
      Object.prototype.hasOwnProperty.call(functionCall, "id"),
      false,
      "Gemini FunctionCall must not include id"
    );
  });
});
