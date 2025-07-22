import {
  FastifyInstance,
  FastifyPluginAsync,
  FastifyRequest,
  FastifyReply,
} from "fastify";
import {
  UnifiedChatRequest,
  RegisterProviderRequest,
  LLMProvider,
} from "@/types/llm";
import { sendUnifiedRequest } from "@/utils/request";
import { createApiError } from "./middleware";
import { log } from "../utils/log";


export const registerApiRoutes: FastifyPluginAsync = async (
  fastify: FastifyInstance
) => {
  // Health and info endpoints
  fastify.get("/", async (request, reply) => {
    return { message: "LLMs API", version: "1.0.0" };
  });

  fastify.get("/health", async (request, reply) => {
    return { status: "ok", timestamp: new Date().toISOString() };
  });

  const transformersWithEndpoint =
    fastify._server!.transformerService.getTransformersWithEndpoint();

  fastify.decorate('requestLLM', async (providerAndModel: string, body: any, config: any = {}) => {
    const [providerName, modelName] = providerAndModel.split(',');
    const provider = fastify._server!.providerService.getProvider(providerName);
    if (!provider) {
      throw createApiError(
        `Provider '${providerName}' not found`,
        404,
        "provider_not_found"
      );
    }
    log('use transformers:', provider.transformer?.use)
    if (provider.transformer?.use?.length) {
      for (const transformer of provider.transformer.use) {
        if (
          !transformer ||
          typeof transformer.transformRequestIn !== "function"
        ) {
          continue;
        }
        const transformIn = await transformer.transformRequestIn(
          body,
          provider
        );
        if (transformIn.body) {
          body = transformIn.body;
          config = { ...config, ...transformIn.config };
        } else {
          body = transformIn;
        }
      }
    }
    if (provider.transformer?.[modelName]?.use?.length) {
      for (const transformer of provider.transformer?.[modelName]?.use) {
        if (
          !transformer ||
          typeof transformer.transformRequestIn !== "function"
        ) {
          continue;
        }
        body = await transformer.transformRequestIn(
          body,
          provider
        );
      }
    }
    const url = config.url || new URL(provider.baseUrl);
    const response = await sendUnifiedRequest(url, body, {
      httpsProxy: fastify._server!.configService.getHttpsProxy(),
      ...config,
      headers: {
        Authorization: `Bearer ${provider.apiKey}`,
        ...(config?.headers || {}),
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      log(`Error response from ${url}: ${errorText}`);
      throw createApiError(
        `Error from provider: ${errorText}`,
        response.status,
        "provider_response_error"
      );
    }
    let finalResponse = response;
    if (provider.transformer?.use?.length) {
      for (const transformer of provider.transformer.use) {
        if (
          !transformer ||
          typeof transformer.transformResponseOut !== "function"
        ) {
          continue;
        }
        finalResponse = await transformer.transformResponseOut(
          finalResponse
        );
      }
    }
    if (provider.transformer?.[modelName]?.use?.length) {
      for (const transformer of provider.transformer[modelName].use) {
        if (
          !transformer ||
          typeof transformer.transformResponseOut !== "function"
        ) {
          continue;
        }
        finalResponse = await transformer.transformResponseOut(
          finalResponse
        );
      }
    }
    return finalResponse
  })

  for (const { name, transformer } of transformersWithEndpoint) {
    if (transformer.endPoint) {
      fastify.post(
        transformer.endPoint,
        async (req: FastifyRequest, reply: FastifyReply) => {
          let body = req.body;
          let config = {}
          if (typeof transformer.transformRequestOut === 'function') {
            const transformOut = await transformer.transformRequestOut(
              body as UnifiedChatRequest
            );
            if (transformOut.body) {
              body = transformOut.body;
              config = transformOut.config || {};
            } else {
              body = transformOut;
            }
          }


          let finalResponse = await fastify.requestLLM(`${req.provider},${body.model}`, body, config);
          if (transformer.transformResponseIn) {
            finalResponse = await transformer.transformResponseIn(
              finalResponse
            );
          }
          if (!finalResponse.ok) {
            reply.code(finalResponse.status);
          }
          const isStream = req.body?.stream === true;
          if (isStream) {
            reply.header("Content-Type", "text/event-stream");
            reply.header("Cache-Control", "no-cache");
            reply.header("Connection", "keep-alive");
            return reply.send(finalResponse.body);
          } else {
            return finalResponse.json();
          }
        }
      );
    }
  }

  fastify.post(
    "/providers",
    {
      schema: {
        body: {
          type: "object",
          properties: {
            id: { type: "string" },
            name: { type: "string" },
            type: { type: "string", enum: ["openai", "anthropic"] },
            baseUrl: { type: "string" },
            apiKey: { type: "string" },
            models: { type: "array", items: { type: "string" } },
          },
          required: ["id", "name", "type", "baseUrl", "apiKey", "models"],
        },
      },
    },
    async (
      request: FastifyRequest<{ Body: RegisterProviderRequest }>,
      reply: FastifyReply
    ) => {
      // Validation
      const { name, type, baseUrl, apiKey, models } = request.body;

      if (!name?.trim()) {
        throw createApiError(
          "Provider name is required",
          400,
          "invalid_request"
        );
      }

      if (!baseUrl || !isValidUrl(baseUrl)) {
        throw createApiError(
          "Valid base URL is required",
          400,
          "invalid_request"
        );
      }

      if (!apiKey?.trim()) {
        throw createApiError("API key is required", 400, "invalid_request");
      }

      if (!models || !Array.isArray(models) || models.length === 0) {
        throw createApiError(
          "At least one model is required",
          400,
          "invalid_request"
        );
      }

      // Check if provider already exists
      if (fastify._server!.providerService.getProvider(id)) {
        throw createApiError(
          `Provider with ID '${id}' already exists`,
          400,
          "provider_exists"
        );
      }

      const provider = fastify._server!.providerService.registerProvider(
        request.body
      );
      return provider;
    }
  );

  fastify.get("/providers", async (request, reply) => {
    return fastify._server!.providerService.getProviders();
  });

  fastify.get(
    "/providers/:id",
    {
      schema: {
        params: {
          type: "object",
          properties: { id: { type: "string" } },
          required: ["id"],
        },
      },
    },
    async (request: FastifyRequest<{ Params: { id: string } }>, reply) => {
      const provider = fastify._server!.providerService.getProvider(
        request.params.id
      );
      if (!provider) {
        return reply.code(404).send({ error: "Provider not found" });
      }
      return provider;
    }
  );

  fastify.put(
    "/providers/:id",
    {
      schema: {
        params: {
          type: "object",
          properties: { id: { type: "string" } },
          required: ["id"],
        },
        body: {
          type: "object",
          properties: {
            name: { type: "string" },
            type: { type: "string", enum: ["openai", "anthropic"] },
            baseUrl: { type: "string" },
            apiKey: { type: "string" },
            models: { type: "array", items: { type: "string" } },
            enabled: { type: "boolean" },
          },
        },
      },
    },
    async (
      request: FastifyRequest<{
        Params: { id: string };
        Body: Partial<LLMProvider>;
      }>,
      reply
    ) => {
      const provider = fastify._server!.providerService.updateProvider(
        request.params.id,
        request.body
      );
      if (!provider) {
        return reply.code(404).send({ error: "Provider not found" });
      }
      return provider;
    }
  );

  fastify.delete(
    "/providers/:id",
    {
      schema: {
        params: {
          type: "object",
          properties: { id: { type: "string" } },
          required: ["id"],
        },
      },
    },
    async (request: FastifyRequest<{ Params: { id: string } }>, reply) => {
      const success = fastify._server!.providerService.deleteProvider(
        request.params.id
      );
      if (!success) {
        return reply.code(404).send({ error: "Provider not found" });
      }
      return { message: "Provider deleted successfully" };
    }
  );

  fastify.patch(
    "/providers/:id/toggle",
    {
      schema: {
        params: {
          type: "object",
          properties: { id: { type: "string" } },
          required: ["id"],
        },
        body: {
          type: "object",
          properties: { enabled: { type: "boolean" } },
          required: ["enabled"],
        },
      },
    },
    async (
      request: FastifyRequest<{
        Params: { id: string };
        Body: { enabled: boolean };
      }>,
      reply
    ) => {
      const success = fastify._server!.providerService.toggleProvider(
        request.params.id,
        request.body.enabled
      );
      if (!success) {
        return reply.code(404).send({ error: "Provider not found" });
      }
      return {
        message: `Provider ${request.body.enabled ? "enabled" : "disabled"
          } successfully`,
      };
    }
  );
};

// Helper function
function isValidUrl(url: string): boolean {
  try {
    new URL(url);
    return true;
  } catch {
    return false;
  }
}
