import { UnifiedChatRequest, UnifiedMessage } from "../types/llm";
import { Content, ContentListUnion, Part, ToolListUnion } from "@google/genai";

export function cleanupParameters(obj: any, keyName?: string): void {
  if (!obj || typeof obj !== "object") {
    return;
  }

  if (Array.isArray(obj)) {
    obj.forEach((item) => {
      cleanupParameters(item);
    });
    return;
  }

  const validFields = new Set([
    "type",
    "format",
    "title",
    "description",
    "nullable",
    "enum",
    "maxItems",
    "minItems",
    "properties",
    "required",
    "minProperties",
    "maxProperties",
    "minLength",
    "maxLength",
    "pattern",
    "example",
    "anyOf",
    "propertyOrdering",
    "default",
    "items",
    "minimum",
    "maximum",
  ]);

  if (keyName !== "properties") {
    Object.keys(obj).forEach((key) => {
      if (!validFields.has(key)) {
        delete obj[key];
      }
    });
  }

  if (obj.enum && obj.type !== "string") {
    delete obj.enum;
  }

  if (
    obj.type === "string" &&
    obj.format &&
    !["enum", "date-time"].includes(obj.format)
  ) {
    delete obj.format;
  }

  Object.keys(obj).forEach((key) => {
    cleanupParameters(obj[key], key);
  });
}

// Type enum equivalent in JavaScript
const Type = {
  TYPE_UNSPECIFIED: "TYPE_UNSPECIFIED",
  STRING: "STRING",
  NUMBER: "NUMBER",
  INTEGER: "INTEGER",
  BOOLEAN: "BOOLEAN",
  ARRAY: "ARRAY",
  OBJECT: "OBJECT",
  NULL: "NULL",
};

/**
 * Transform the type field from an array of types to an array of anyOf fields.
 * @param {string[]} typeList - List of types
 * @param {Object} resultingSchema - The schema object to modify
 */
function flattenTypeArrayToAnyOf(typeList: Array<string>, resultingSchema: any): void {
  if (typeList.includes("null")) {
    resultingSchema["nullable"] = true;
  }
  const listWithoutNull = typeList.filter((type) => type !== "null");

  if (listWithoutNull.length === 1) {
    const upperCaseType = listWithoutNull[0].toUpperCase();
    resultingSchema["type"] = Object.values(Type).includes(upperCaseType)
      ? upperCaseType
      : Type.TYPE_UNSPECIFIED;
  } else {
    resultingSchema["anyOf"] = [];
    for (const i of listWithoutNull) {
      const upperCaseType = i.toUpperCase();
      resultingSchema["anyOf"].push({
        type: Object.values(Type).includes(upperCaseType)
          ? upperCaseType
          : Type.TYPE_UNSPECIFIED,
      });
    }
  }
}

/**
 * Process a JSON schema to make it compatible with the GenAI API
 * @param {Object} _jsonSchema - The JSON schema to process
 * @returns {Object} - The processed schema
 */
function processJsonSchema(_jsonSchema: any): any {
  const genAISchema = {};
  const schemaFieldNames = ["items"];
  const listSchemaFieldNames = ["anyOf"];
  const dictSchemaFieldNames = ["properties"];

  if (_jsonSchema["type"] && _jsonSchema["anyOf"]) {
    throw new Error("type and anyOf cannot be both populated.");
  }

  /*
  This is to handle the nullable array or object. The _jsonSchema will
  be in the format of {anyOf: [{type: 'null'}, {type: 'object'}]}. The
  logic is to check if anyOf has 2 elements and one of the element is null,
  if so, the anyOf field is unnecessary, so we need to get rid of the anyOf
  field and make the schema nullable. Then use the other element as the new
  _jsonSchema for processing. This is because the backend doesn't have a null
  type.
  */
  const incomingAnyOf = _jsonSchema["anyOf"];
  if (
    incomingAnyOf != null &&
    Array.isArray(incomingAnyOf) &&
    incomingAnyOf.length == 2
  ) {
    if (incomingAnyOf[0] && incomingAnyOf[0]["type"] === "null") {
      genAISchema["nullable"] = true;
      _jsonSchema = incomingAnyOf[1];
    } else if (incomingAnyOf[1] && incomingAnyOf[1]["type"] === "null") {
      genAISchema["nullable"] = true;
      _jsonSchema = incomingAnyOf[0];
    }
  }

  if (_jsonSchema["type"] && Array.isArray(_jsonSchema["type"])) {
    flattenTypeArrayToAnyOf(_jsonSchema["type"], genAISchema);
  }

  for (const [fieldName, fieldValue] of Object.entries(_jsonSchema)) {
    // Skip if the fieldValue is undefined or null.
    if (fieldValue == null) {
      continue;
    }

    if (fieldName == "type") {
      if (fieldValue === "null") {
        throw new Error(
          "type: null can not be the only possible type for the field."
        );
      }
      if (Array.isArray(fieldValue)) {
        // we have already handled the type field with array of types in the
        // beginning of this function.
        continue;
      }
      const upperCaseValue = fieldValue.toUpperCase();
      genAISchema["type"] = Object.values(Type).includes(upperCaseValue)
        ? upperCaseValue
        : Type.TYPE_UNSPECIFIED;
    } else if (schemaFieldNames.includes(fieldName)) {
      genAISchema[fieldName] = processJsonSchema(fieldValue);
    } else if (listSchemaFieldNames.includes(fieldName)) {
      const listSchemaFieldValue = [];
      for (const item of fieldValue) {
        if (item["type"] == "null") {
          genAISchema["nullable"] = true;
          continue;
        }
        listSchemaFieldValue.push(processJsonSchema(item));
      }
      genAISchema[fieldName] = listSchemaFieldValue;
    } else if (dictSchemaFieldNames.includes(fieldName)) {
      const dictSchemaFieldValue = {};
      for (const [key, value] of Object.entries(fieldValue)) {
        dictSchemaFieldValue[key] = processJsonSchema(value);
      }
      genAISchema[fieldName] = dictSchemaFieldValue;
    } else {
      // additionalProperties is not included in JSONSchema, skipping it.
      if (fieldName === "additionalProperties") {
        continue;
      }
      genAISchema[fieldName] = fieldValue;
    }
  }
  return genAISchema;
}

/**
 * Transform a tool object
 * @param {Object} tool - The tool object to transform
 * @returns {Object} - The transformed tool object
 */
export function tTool(tool: any): any {
  if (tool.functionDeclarations) {
    for (const functionDeclaration of tool.functionDeclarations) {
      if (functionDeclaration.parameters) {
        if (!Object.keys(functionDeclaration.parameters).includes("$schema")) {
          functionDeclaration.parameters = processJsonSchema(
            functionDeclaration.parameters
          );
        } else {
          if (!functionDeclaration.parametersJsonSchema) {
            functionDeclaration.parametersJsonSchema =
              functionDeclaration.parameters;
            delete functionDeclaration.parameters;
          }
        }
      }
      if (functionDeclaration.response) {
        if (!Object.keys(functionDeclaration.response).includes("$schema")) {
          functionDeclaration.response = processJsonSchema(
            functionDeclaration.response
          );
        } else {
          if (!functionDeclaration.responseJsonSchema) {
            functionDeclaration.responseJsonSchema =
              functionDeclaration.response;
            delete functionDeclaration.response;
          }
        }
      }
    }
  }
  return tool;
}

export function buildRequestBody(
  request: UnifiedChatRequest
): Record<string, any> {
  const tools = [];
  const functionDeclarations = request.tools
    ?.filter((tool) => tool.function.name !== "web_search")
    ?.map((tool) => {
      return {
        name: tool.function.name,
        description: tool.function.description,
        parametersJsonSchema: tool.function.parameters,
      };
    });
  if (functionDeclarations?.length) {
    tools.push(
      tTool({
        functionDeclarations,
      })
    );
  }
  const webSearch = request.tools?.find(
    (tool) => tool.function.name === "web_search"
  );
  if (webSearch) {
    tools.push({
      googleSearch: {},
    });
  }

  const contents = request.messages.map((message: UnifiedMessage) => {
    let role: "user" | "model";
    if (message.role === "assistant") {
      role = "model";
    } else if (["user", "system", "tool"].includes(message.role)) {
      role = "user";
    } else {
      role = "user"; // Default to user if role is not recognized
    }
    const parts = [];
    if (typeof message.content === "string") {
      parts.push({
        text: message.content,
      });
    } else if (Array.isArray(message.content)) {
      parts.push(
        ...message.content.map((content) => {
          if (content.type === "text") {
            return {
              text: content.text || "",
            };
          }
          if (content.type === "image_url") {
            if (content.image_url.url.startsWith("http")) {
              return {
                file_data: {
                  mime_type: content.media_type,
                  file_uri: content.image_url.url,
                },
              };
            } else {
              return {
                inlineData: {
                  mime_type: content.media_type,
                  data: content.image_url.url,
                },
              };
            }
          }
        })
      );
    }

    if (Array.isArray(message.tool_calls)) {
      parts.push(
        ...message.tool_calls.map((toolCall) => {
          return {
            functionCall: {
              id:
                toolCall.id ||
                `tool_${Math.random().toString(36).substring(2, 15)}`,
              name: toolCall.function.name,
              args: JSON.parse(toolCall.function.arguments || "{}"),
            },
          };
        })
      );
    }
    return {
      role,
      parts,
    };
  });

  const body = {
    contents,
    tools: tools.length ? tools : undefined,
  };

  if (request.tool_choice) {
    const toolConfig = {
      functionCallingConfig: {},
    };
    if (request.tool_choice === "auto") {
      toolConfig.functionCallingConfig.mode = "auto";
    } else if (request.tool_choice === "none") {
      toolConfig.functionCallingConfig.mode = "none";
    } else if (request.tool_choice === "required") {
      toolConfig.functionCallingConfig.mode = "any";
    } else if (request.tool_choice?.function?.name) {
      toolConfig.functionCallingConfig.mode = "any";
      toolConfig.functionCallingConfig.allowedFunctionNames = [
        request.tool_choice?.function?.name,
      ];
    }
    body.toolConfig = toolConfig;
  }

  return body;
}

export function transformRequestOut(
  request: Record<string, any>
): UnifiedChatRequest {
  const contents: ContentListUnion = request.contents;
  const tools: ToolListUnion = request.tools;
  const model: string = request.model;
  const max_tokens: number | undefined = request.max_tokens;
  const temperature: number | undefined = request.temperature;
  const stream: boolean | undefined = request.stream;
  const tool_choice: "auto" | "none" | string | undefined = request.tool_choice;

  const unifiedChatRequest: UnifiedChatRequest = {
    messages: [],
    model,
    max_tokens,
    temperature,
    stream,
    tool_choice,
  };

  if (Array.isArray(contents)) {
    contents.forEach((content) => {
      if (typeof content === "string") {
        unifiedChatRequest.messages.push({
          role: "user",
          content,
        });
      } else if (typeof (content as Part).text === "string") {
        unifiedChatRequest.messages.push({
          role: "user",
          content: (content as Part).text || null,
        });
      } else if ((content as Content).role === "user") {
        unifiedChatRequest.messages.push({
          role: "user",
          content:
            (content as Content)?.parts?.map((part: Part) => ({
              type: "text",
              text: part.text || "",
            })) || [],
        });
      } else if ((content as Content).role === "model") {
        unifiedChatRequest.messages.push({
          role: "assistant",
          content:
            (content as Content)?.parts?.map((part: Part) => ({
              type: "text",
              text: part.text || "",
            })) || [],
        });
      }
    });
  }

  if (Array.isArray(tools)) {
    unifiedChatRequest.tools = [];
    tools.forEach((tool) => {
      if (Array.isArray(tool.functionDeclarations)) {
        tool.functionDeclarations.forEach((tool) => {
          unifiedChatRequest.tools!.push({
            type: "function",
            function: {
              name: tool.name,
              description: tool.description,
              parameters: tool.parameters,
            },
          });
        });
      }
    });
  }

  return unifiedChatRequest;
}

export async function transformResponseOut(
  response: Response,
  providerName: string,
  logger?: any
): Promise<Response> {
  if (response.headers.get("Content-Type")?.includes("application/json")) {
    const jsonResponse: any = await response.json();
    const tool_calls =
      jsonResponse.candidates[0].content?.parts
        ?.filter((part: Part) => part.functionCall)
        ?.map((part: Part) => ({
          id:
            part.functionCall?.id ||
            `tool_${Math.random().toString(36).substring(2, 15)}`,
          type: "function",
          function: {
            name: part.functionCall?.name,
            arguments: JSON.stringify(part.functionCall?.args || {}),
          },
        })) || [];
    const res = {
      id: jsonResponse.responseId,
      choices: [
        {
          finish_reason:
            (
              jsonResponse.candidates[0].finishReason as string
            )?.toLowerCase() || null,
          index: 0,
          message: {
            content:
              jsonResponse.candidates[0].content?.parts
                ?.filter((part: Part) => part.text)
                ?.map((part: Part) => part.text)
                ?.join("\n") || "",
            role: "assistant",
            tool_calls: tool_calls.length > 0 ? tool_calls : undefined,
          },
        },
      ],
      created: parseInt(new Date().getTime() / 1000 + "", 10),
      model: jsonResponse.modelVersion,
      object: "chat.completion",
      usage: {
        completion_tokens: jsonResponse.usageMetadata.candidatesTokenCount,
        prompt_tokens: jsonResponse.usageMetadata.promptTokenCount,
        cached_content_token_count:
          jsonResponse.usageMetadata.cachedContentTokenCount || null,
        total_tokens: jsonResponse.usageMetadata.totalTokenCount,
      },
    };
    return new Response(JSON.stringify(res), {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    });
  } else if (response.headers.get("Content-Type")?.includes("stream")) {
    if (!response.body) {
      return response;
    }

    const decoder = new TextDecoder();
    const encoder = new TextEncoder();

    const processLine = (
      line: string,
      controller: ReadableStreamDefaultController
    ) => {
      if (line.startsWith("data: ")) {
        const chunkStr = line.slice(6).trim();
        if (chunkStr) {
          logger?.debug({ chunkStr }, `${providerName} chunk:`);
          try {
            const chunk = JSON.parse(chunkStr);

            // Check if chunk has valid structure
            if (!chunk.candidates || !chunk.candidates[0]) {
              log(`Invalid chunk structure:`, chunkStr);
              return;
            }

            const candidate = chunk.candidates[0];
            const parts = candidate.content?.parts || [];

            const tool_calls = parts
              .filter((part: Part) => part.functionCall)
              .map((part: Part) => ({
                id:
                  part.functionCall?.id ||
                  `tool_${Math.random().toString(36).substring(2, 15)}`,
                type: "function",
                function: {
                  name: part.functionCall?.name,
                  arguments: JSON.stringify(part.functionCall?.args || {}),
                },
              }));

            const textContent = parts
              .filter((part: Part) => part.text)
              .map((part: Part) => part.text)
              .join("\n");

            const res = {
              choices: [
                {
                  delta: {
                    role: "assistant",
                    content: textContent || "",
                    tool_calls: tool_calls.length > 0 ? tool_calls : undefined,
                  },
                  finish_reason: candidate.finishReason?.toLowerCase() || null,
                  index: candidate.index || (tool_calls.length > 0 ? 1 : 0),
                  logprobs: null,
                },
              ],
              created: parseInt(new Date().getTime() / 1000 + "", 10),
              id: chunk.responseId || "",
              model: chunk.modelVersion || "",
              object: "chat.completion.chunk",
              system_fingerprint: "fp_a49d71b8a1",
              usage: {
                completion_tokens:
                  chunk.usageMetadata?.candidatesTokenCount || 0,
                prompt_tokens: chunk.usageMetadata?.promptTokenCount || 0,
                cached_content_token_count:
                  chunk.usageMetadata?.cachedContentTokenCount || null,
                total_tokens: chunk.usageMetadata?.totalTokenCount || 0,
              },
            };
            if (candidate?.groundingMetadata?.groundingChunks?.length) {
              res.choices[0].delta.annotations =
                candidate.groundingMetadata.groundingChunks.map(
                  (groundingChunk, index) => {
                    const support =
                      candidate?.groundingMetadata?.groundingSupports?.filter(
                        (item) => item.groundingChunkIndices?.includes(index)
                      );
                    return {
                      type: "url_citation",
                      url_citation: {
                        url: groundingChunk?.web?.uri || "",
                        title: groundingChunk?.web?.title || "",
                        content: support?.[0]?.segment?.text || "",
                        start_index: support?.[0]?.segment?.startIndex || 0,
                        end_index: support?.[0]?.segment?.endIndex || 0,
                      },
                    };
                  }
                );
            }
            controller.enqueue(
              encoder.encode(`data: ${JSON.stringify(res)}\n\n`)
            );
          } catch (error: any) {
            logger?.error(
              `Error parsing ${providerName} stream chunk`,
              chunkStr,
              error.message
            );
          }
        }
      }
    };

    const stream = new ReadableStream({
      async start(controller) {
        const reader = response.body!.getReader();
        let buffer = "";
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) {
              if (buffer) {
                processLine(buffer, controller);
              }
              break;
            }

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split("\n");

            buffer = lines.pop() || "";

            for (const line of lines) {
              processLine(line, controller);
            }
          }
        } catch (error) {
          controller.error(error);
        } finally {
          controller.close();
        }
      },
    });

    return new Response(stream, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    });
  }
  return response;
}
