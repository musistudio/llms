# LLMs

> A universal LLM API transformation server, initially developed for the [claude-code-router](https://github.com/musistudio/claude-code-router).

## How it works

The LLM API transformation server acts as a middleware to standardize requests and responses between different LLM providers (Anthropic, Gemini, Deepseek, etc.). It uses a modular transformer system to handle provider-specific API formats.

### Key Components

1. **Transformers**: Each provider (e.g., Anthropic, Gemini) has a dedicated transformer class that implements:

   - `transformRequestIn`: Converts the provider's request format to a unified format.
   - `transformResponseIn`: Converts the provider's response format to a unified format.
   - `transformRequestOut`: Converts the unified request format to the provider's format.
   - `transformResponseOut`: Converts the unified response format back to the provider's format.
   - `endPoint`: Specifies the API endpoint for the provider (e.g., "/v1/messages" for Anthropic).

2. **Unified Formats**:

   - Requests and responses are standardized using `UnifiedChatRequest` and `UnifiedChatResponse` types.

3. **Streaming Support**:
   - Handles real-time streaming responses for providers like Anthropic, converting chunked data into a standardized format.

### Data Flow

1. **Request**:

   - Incoming provider-specific requests are transformed into the unified format.
   - The unified request is processed by the server.

2. **Response**:
   - The server's unified response is transformed back into the provider's format.
   - Streaming responses are handled with chunked data conversion.

### Example Transformers

- **Anthropic**: Converts between OpenAI-style and Anthropic-style message formats.
- **Gemini**: Adjusts tool definitions and parameter formats for Gemini compatibility.
- **Deepseek**: Enforces token limits and handles reasoning content in streams.
- **Kimi**: Handles Kimi-K2 tool-calling requirements with OpenAI compatibility.

### Provider Configuration Example

To configure a Kimi provider, register it with the following structure:

```json
{
  "name": "kimi",
  "api_base_url": "https://api.moonshot.cn",
  "api_key": "your-api-key-here",
  "models": ["moonshot-v1-8k", "moonshot-v1-32k", "moonshot-v1-128k"],
  "transformer": {
    "use": ["Kimi"]
  }
}
```

For Kimi providers/models, the default configuration uses only the `Kimi` transformer:
- `"transformer": { "use": ["Kimi"] }`
- No additional transformers (like `TooluseTransformer`, `ReasoningTransformer`, etc.) are required for Kimi correctness.

## Kimi-Only Default Chain Design Principle

For **Kimi provider/models**, the default configuration uses **only the `Kimi` transformer**:

- `"transformer": { "use": ["Kimi"] }`
- **No additional transformers required** for Kimi correctness:
  - ❌ Do NOT require `TooluseTransformer`
  - ❌ Do NOT require `ReasoningTransformer` 
  - ❌ Do NOT require `ForceReasoningTransformer`
  - ❌ Do NOT require `StreamOptionsTransformer`
  - ❌ Do NOT require any other transformer for Kimi functionality

### Advanced Composition (Optional)

Advanced users may compose generic transformers with Kimi **only when**:
- They do not change Kimi semantics
- They do not conflict with K2 tool-calling requirements

**Example of advanced composition** (use with caution):
```json
{
  "name": "kimi",
  "api_base_url": "https://api.moonshot.cn", 
  "api_key": "your-api-key-here",
  "models": ["moonshot-v1-8k"],
  "transformer": {
    "use": ["Kimi", "CustomTransformer"]
  }
}
```

## Kimi-Specific Configuration Options

The `KimiTransformer` supports several configuration options for advanced use cases:

### Basic Configuration (Recommended)
```json
{
  "name": "kimi",
  "api_base_url": "https://api.moonshot.cn",
  "api_key": "your-api-key-here", 
  "models": ["moonshot-v1-8k"],
  "transformer": {
    "use": ["Kimi"]
  }
}
```

### Advanced Configuration Options

#### Tool Calling Behavior
- `toolChoiceDefault`: Default tool choice when tools are present (`"auto"`, `"none"`, `"required"`)
- `acceptRoleTool`: Validate tool messages have `tool_call_id` and `content` (default: `true`)
- `enforceFinishReasonLoop`: Ensure `finish_reason = "tool_calls"` when tool calls exist (default: `true`)

#### Streaming Configuration  
- `assembleToolDeltas`: Assemble streaming tool call deltas into complete calls (default: `false`)
  - `false`: Pass through SSE events unchanged
  - `true`: Buffer and assemble tool call fragments, emit final complete event

#### Manual Tool Parsing (K2-Style Markers)
- `manualToolParsing`: Parse tool calls from content markers instead of native `tool_calls` (default: `false`)
- `emitToolCallsInJson`: Strip markers from content, put tool calls in `tool_calls` field (default: `false`)
- `toolTokens`: Custom marker tokens for manual parsing:
  ```json
  {
    "toolTokens": {
      "sectionBegin": "<|tool_calls_section_begin|>",
      "sectionEnd": "<|tool_calls_section_end|>", 
      "callBegin": "<|tool_call_begin|>",
      "callEnd": "<|tool_call_end|>",
      "argBegin": "<|tool_call_argument_begin|>"
    }
  }
  ```

#### ID Management
- `idNormalization`: Rewrite all tool call IDs with monotonic counter (default: `false`)
- `idPrefix`: Prefix for normalized IDs (default: `"functions"`)
- `repairOnMismatch`: Fix invalid ID formats while preserving valid ones (default: `true`)

### When to Use Each Feature

**Manual Parsing** (`manualToolParsing: true`):
- Use when Kimi returns tool calls as text markers instead of native `tool_calls`
- Required for K2-style tool calling format
- Enable `emitToolCallsInJson: true` to extract structured tool calls

**Delta Assembly** (`assembleToolDeltas: true`):
- Use when streaming responses have fragmented tool calls
- Buffers partial tool call data and emits complete tool calls
- Only applies to SSE streaming responses

**ID Normalization** (`idNormalization: true`):
- Use when tool call IDs need to follow strict format: `{prefix}.{name}:{index}`
- Ensures consistent ID format across multi-turn conversations
- Use `repairOnMismatch: true` for more lenient ID handling

### Example: Full Kimi Configuration
```json
{
  "name": "kimi",
  "api_base_url": "https://api.moonshot.cn",
  "api_key": "your-api-key-here",
  "models": ["moonshot-v1-8k"],
  "transformer": {
    "use": [{
      "Kimi": {
        "toolChoiceDefault": "auto",
        "manualToolParsing": false,
        "assembleToolDeltas": true,
        "idNormalization": true,
        "idPrefix": "functions",
        "repairOnMismatch": true
      }
    }]
  }
}
```

## Run this repo

- **Install dependencies:**
  ```sh
  npm install
  # or pnpm install
  ```
- **Development:**
  ```sh
  npm run dev
  # Uses nodemon + tsx for hot-reloading src/server.ts
  ```
- **Build:**
  ```sh
  npm run build
  # Outputs to dist/cjs and dist/esm
  ```
- **Test:**
  ```sh
  npm test
  # See CLAUDE.md for details
  ```
- **Path alias:**
  - `@` is mapped to the `src` directory, use `import xxx from '@/xxx'`.
- **Environment variables:**
  - Supports `.env` and `config.json`, see `src/services/config.ts`.

---

## Working with this repo

[👉 Contributing Guide](./CONTRIBUTING.md)
