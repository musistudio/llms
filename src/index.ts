// =============================================================================
// @musistudio/llms - Library Entry Point
// =============================================================================

// =============================================================================
// Types - Essential for consumers to use the transformers correctly
// =============================================================================
export type {
  // Core transformer interface
  Transformer,
  TransformerContext,
  TransformerOptions,
  TransformerConstructor,
} from "./types/transformer";

export type {
  // Unified request/response types (the "lingua franca" of the library)
  UnifiedChatRequest,
  UnifiedChatResponse,
  UnifiedMessage,
  UnifiedTool,

  // Content types
  MessageContent,
  TextContent,
  ImageContent,

  // Provider configuration
  LLMProvider,
  ConfigProvider,

  // Streaming types
  StreamChunk,
  AnthropicStreamEvent,
  OpenAIStreamChunk,

  // Additional useful types
  Annotation,
  UrlCitation,
  ThinkLevel,
  ModelRoute,
  RequestRouteInfo,
  ConversionOptions,
  OpenAIChatRequest,
  AnthropicChatRequest,
} from "./types/llm";

// =============================================================================
// Transformers - Named exports for tree-shaking
// =============================================================================

// Core provider transformers
export { OpenAITransformer } from "./transformer/openai.transformer";
export { AnthropicTransformer } from "./transformer/anthropic.transformer";
export { GeminiTransformer } from "./transformer/gemini.transformer";

// Vertex AI variants
export { VertexGeminiTransformer } from "./transformer/vertex-gemini.transformer";
export { VertexClaudeTransformer } from "./transformer/vertex-claude.transformer";
export { VertexOpenaiTransformer } from "./transformer/vertex-openai.transformer";

// Provider-specific transformers
export { DeepseekTransformer } from "./transformer/deepseek.transformer";
export { GroqTransformer } from "./transformer/groq.transformer";
export { CerebrasTransformer } from "./transformer/cerebras.transformer";
export { OpenrouterTransformer } from "./transformer/openrouter.transformer";
export { VercelTransformer } from "./transformer/vercel.transformer";

// OpenAI Responses API
export { OpenAIResponsesTransformer } from "./transformer/openai.responses.transformer";

// Utility/middleware transformers
export { MaxTokenTransformer } from "./transformer/maxtoken.transformer";
export { MaxCompletionTokens } from "./transformer/maxcompletiontokens.transformer";
export { SamplingTransformer } from "./transformer/sampling.transformer";
export { StreamOptionsTransformer } from "./transformer/streamoptions.transformer";
export { ReasoningTransformer } from "./transformer/reasoning.transformer";
export { ForceReasoningTransformer } from "./transformer/forcereasoning.transformer";
export { TooluseTransformer } from "./transformer/tooluse.transformer";
export { EnhanceToolTransformer } from "./transformer/enhancetool.transformer";
export { CleancacheTransformer } from "./transformer/cleancache.transformer";
export { CustomParamsTransformer } from "./transformer/customparams.transformer";
export { ExtraThinkTagTransformer } from "./transformer/extrathinktag.transformer";

// =============================================================================
// Default export - All transformers as an object (for dynamic access)
// =============================================================================
export { default as Transformers } from "./transformer/index";
