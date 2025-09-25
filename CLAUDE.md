# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a universal LLM API transformation server that acts as middleware to standardize requests and responses between different LLM providers (Anthropic, Gemini, Deepseek, etc.). It uses a modular transformer system to handle provider-specific API formats.

## Key Architecture Components

1. **Transformers**: Each provider has a dedicated transformer class that implements:
   - `transformRequestIn`: Converts the provider's request format to a unified format
   - `transformResponseIn`: Converts the provider's response format to a unified format
   - `transformRequestOut`: Converts the unified request format to the provider's format
   - `transformResponseOut`: Converts the unified response format back to the provider's format
   - `endPoint`: Specifies the API endpoint for the provider

2. **Unified Formats**: Requests and responses are standardized using `UnifiedChatRequest` and `UnifiedChatResponse` types.

3. **Streaming Support**: Handles real-time streaming responses for providers, converting chunked data into a standardized format.

4. **Service Layer Architecture**:
   - `ConfigService`: Manages environment variables and config.json
   - `LLMService`: Core LLM request/response processing
   - `ProviderService`: Provider-specific configurations and endpoints
   - `TransformerService`: Orchestrates transformer chains and execution

## Common Development Commands

- **Install dependencies**: `pnpm install` or `npm install`
- **Development mode**: `npm run dev` (Uses nodemon + tsx for hot-reloading)
- **Build**: `npm run build` (Outputs to dist/cjs and dist/esm)
- **Build with watch**: `npm run build:watch` (Continuous build during development)
- **Lint**: `npm run lint` (Runs ESLint on src directory)
- **Start server (CJS)**: `npm start` or `node dist/cjs/server.cjs`
- **Start server (ESM)**: `npm run start:esm` or `node dist/esm/server.mjs`

## Project Structure

- `src/server.ts`: Main Fastify server entry point with CORS and error handling
- `src/transformer/`: Provider-specific transformer implementations
  - Contains 16+ transformers including Anthropic, Gemini, OpenAI variants, and utility transformers
- `src/services/`: Core services (config, llm, provider, transformer)
- `src/types/`: TypeScript type definitions for LLM APIs and transformers
- `src/utils/`: Utility functions for conversion, tool parsing, and provider-specific helpers
- `src/api/`: API routes and middleware
- `scripts/build.ts`: Custom esbuild configuration for dual CJS/ESM output

## Path Aliases

- `@` is mapped to the `src` directory, use `import xxx from '@/xxx'`

## Build System

The project uses esbuild for building, with separate CJS and ESM outputs. The build script is located at `scripts/build.ts` and supports:
- Dual format builds (CommonJS and ESM)
- External dependencies to reduce bundle size
- Watch mode for development
- Source maps and minification

## Environment Configuration

- Supports both `.env` files and `config.json`
- Configuration handled by `src/services/config.ts`
- Environment variables can be used for API keys and server settings

## Code Style Guidelines

- Strict TypeScript mode with 2-space indentation
- Prefer `@/` alias for imports
- Follow conventional commit messages (feat:, fix:, docs:, etc.)
- Node.js 18+ target with ES2022 features

## Adding New Transformers

1. Create a new transformer file in `src/transformer/`
2. Implement the `Transformer` interface with required methods:
   - Optional: `transformRequestIn`, `transformResponseIn`, `transformRequestOut`, `transformResponseOut`
   - Required: `endPoint` property
   - Optional: `auth` method for authentication
3. Export the transformer in `src/transformer/index.ts`
4. The transformer will be automatically registered at startup

## Available Transformers

The system includes transformers for:
- **LLM Providers**: Anthropic, Gemini, Vertex (Gemini/Claude), Deepseek, OpenAI, OpenRouter, Groq, Cerebras
- **Utility Transformers**: Tool enhancement, token limits, streaming options, reasoning content, sampling parameters

## GPT-5 Support

This server has **complete support for GPT-5 and o3 models** through OpenAI's Chat Completions API:

### ✅ Implementation Details
- **OpenAI Chat Completions API**: Uses standard `/v1/chat/completions` endpoint
- **Automatic Model Mapping**: OpenAI automatically serves GPT-5 for all model requests (GPT-4o, GPT-4, etc. all resolve to GPT-5)
- **Parameter Transformation**: Automatic conversion of `max_tokens` → `max_completion_tokens` for GPT-5 models
- **Tool Format Conversion**: OpenAI transformer converts Anthropic tool format to OpenAI function format
- **Reasoning Token Support**: GPT-5 reasoning tokens are generated and counted in usage statistics

### 🔧 Technical Architecture
- **Transformer Chain**: `AnthropicRequest → UnifiedRequest → OpenAIRequest → OpenAI API`
- **Response Flow**: `OpenAI Response → UnifiedResponse → AnthropicResponse`
- **Parameter Mapping**: GPT-5 models (`gpt-5`, `gpt-5-mini`, `o3`, `o3-mini`, etc.) automatically use `max_completion_tokens`
- **Reasoning Extraction**: The `reasoning` transformer can extract reasoning content from `reasoning_content` field

### ⚡ API Performance Comparison

**Chat Completions API (Current Implementation):**
- ✅ **Faster for single interactions** - Lower latency per request
- ✅ **Simpler protocol** - Minimal overhead, stateless design
- ✅ **Industry standard** - OpenAI commits to supporting "indefinitely"
- ✅ **Works with proxy layers** - Compatible with transformation middleware

**Responses API (Alternative):**
- ⚡ **Better for complex workflows** - Server-managed state, fewer round trips
- ⚡ **Multi-tool orchestration** - Model handles tools internally
- ❌ **Benefits lost through proxy** - State management and multi-step advantages negated by our transformation layer
- ❌ **Additional complexity** - More transformation logic required

### 📊 Production Status
GPT-5 integration is **production ready** with the following caveats:
- Uses industry-standard Chat Completions API
- Reasoning tokens generated but may not be displayed (depending on transformer configuration)
- All tool formats properly converted
- Compatible with Claude Code Router for seamless integration

### 🔄 Configuration Example
```json
{
  "name": "openai",
  "api_base_url": "https://api.openai.com/v1/chat/completions",
  "api_key": "$OPENAI_API_KEY", 
  "models": ["gpt-5", "gpt-5-mini", "o3", "o3-mini"],
  "transformer": {
    "use": ["openai", "reasoning"]
  }
}
```

## Local Package Development & Caching Issues

When developing this package locally and using it in consuming projects (like Claude Code Router), you may encounter persistent caching issues where changes don't reflect despite rebuilding and reinstalling. This is a common npm issue in 2025.

### Common Symptoms
- Code changes don't appear in consuming project
- Old transformers/features still show up in API endpoints
- Package appears to install but uses stale code
- Multiple reinstall attempts fail to update

### Root Causes
1. **NPM package cache** - stores downloaded packages
2. **Module resolution cache** - Node.js caches module lookups  
3. **Build tool caches** - bundlers cache compiled code
4. **Lock file constraints** - package-lock.json pins versions

### Complete Solution (Nuclear Option)
```bash
# In the consuming project (ccr-dev)
rm -rf node_modules
rm -f package-lock.json
npm cache clean --force
npm cache verify
npm install file:../llms-dev/musistudio-llms-1.0.22.tgz --force
npm run build
```

### Development Workflow Best Practices

**In llms-dev (this package):**
```bash
# 1. Make your changes
# 2. Build and package
npm run build
rm -f musistudio-llms-*.tgz  # Remove old packages
npm pack
```

**In consuming project (ccr-dev):**
```bash
# 3. Stop all running services first
ccr stop

# 4. Force clean update
rm -rf node_modules/@musistudio
npm uninstall @musistudio/llms
npm install file:../llms-dev/musistudio-llms-1.0.22.tgz --force
npm run build

# 5. Restart services
ccr start
```

### Advanced Troubleshooting

**Verify package contents:**
```bash
tar -tzf musistudio-llms-1.0.22.tgz | grep -E "(transformer|index)"
```

**Check module resolution:**
```bash
node -e "console.log(require.resolve('@musistudio/llms'))"
```

**Important Notes:**
- In 2025, `npm update` often fails - use `npm install package@latest` or `--force` flag
- Always stop running services before updating local packages
- Build caches (esbuild/webpack) can persist stale code - clear `dist/` directories
- Use `npm ci` in CI/CD environments for reproducible builds

### Why This Happens
NPM's caching system is designed for performance with published packages, but local file: dependencies can create edge cases where caches aren't properly invalidated when the source files change.