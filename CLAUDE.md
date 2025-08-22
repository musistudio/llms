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

## Logging & Debugging

### LLMS Package Logging Strategy

**Primary Logger: Fastify Pino Logger**
- Uses industry-standard Pino logger integrated with Fastify
- Available as `this.logger` in transformer instances (injected by TransformerService)
- Configured in `src/server.ts` with PinoLoggerOptions
- Default: enabled with structured JSON logging

**Logger Usage in Transformers:**
```typescript
// Transformers receive logger injection from TransformerService
if (this.logger) {
  this.logger.info({ requestData }, 'Processing request');
  this.logger.error({ error }, 'Transformation failed');
}
```

**Emergency/Debug Logging:**
- File-based logging to `/tmp/` for critical debugging
- Console.log statements in `src/utils/request.ts` for HTTP egress debugging
- Use sparingly and clean up after debugging sessions

**CCR (Claude Code Router) Logging Strategy**

**Primary Logger: Custom File Logger**
- Location: `~/.claude-code-router/claude-code-router.log`
- Implemented in `src/utils/log.ts`
- Configurable via config.json: `{"LOG": true, "LOG_LEVEL": "debug"}`
- Default: LOG=false (disabled by default)

**CCR Logger Usage:**
```typescript
import { log } from './utils/log';
log('Message', { data }, 'additional info');
```

**To Enable CCR Logging:**
1. Edit `~/.claude-code-router/config.json`:
   ```json
   {"LOG": true, "LOG_LEVEL": "debug"}
   ```
2. Restart CCR: `ccr restart`
3. Monitor logs: `tail -f ~/.claude-code-router/claude-code-router.log`

**When to Use Each Logging Method:**

1. **LLMS Fastify Logger** - Production code, transformer operations, service events
2. **LLMS File Debug Logs** - Temporary debugging, HTTP request/response analysis
3. **CCR File Logger** - Router operations, request routing decisions, service lifecycle
4. **Console.log** - Only for development, remove before commit

**Debugging GPT-5 Issues:**
- Check LLMS transformer logs for parameter transformations
- Check CCR logs for routing decisions and model selection
- Use temporary file logging in `/tmp/` for detailed request/response inspection

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

## Local Development with yalc

For local development and testing changes in dependent projects (like CCR - Claude Code Router), use yalc instead of npm pack/install to avoid npm cache corruption. Note: The CCR proxy service auto-launches when you run `ccr code`.

### Setup yalc (one-time)
```bash
npm install -g yalc
```

### Development Workflow

**Automated Script (Recommended):**
```bash
# In llms-dev: Use convenience script for rapid iteration
./dev-workflow.sh   # Builds, publishes to yalc, and pushes to all linked projects
```

**Manual Steps:**
```bash
# In llms-dev: Publish to yalc
yalc publish

# In ccr-dev: Link from yalc  
yalc add @musistudio/llms
npm run build

# After making changes in llms-dev: Push updates
yalc push  # Automatically updates all linked projects
```

**Convenience Scripts:**
- `./dev-workflow.sh` (LLMS): Complete build → yalc publish → push workflow
- `./build-and-test.sh` (CCR): Build CCR with updated LLMS package and show status

### Benefits over npm pack/install
- **No npm cache issues**: Direct symlinks avoid cache corruption
- **Instant updates**: `yalc push` immediately updates linked projects
- **No abandoned processes**: No risk of stuck npm dev servers causing cache locks
- **Clean workflow**: No need for cache clearing or process killing

### Troubleshooting npm cache corruption
If you encounter `ENOTEMPTY` errors when clearing npm cache:
1. Check for stuck npm processes: `ps aux | grep npm`
2. Kill abandoned dev servers: `kill <PID>`  
3. Clear cache: `npm cache clean --force`
4. Switch to yalc to prevent future issues

## Available Transformers

The system includes transformers for:
- **LLM Providers**: Anthropic, Gemini, Vertex (Gemini/Claude), Deepseek, OpenAI, OpenRouter, Groq, Cerebras
- **Utility Transformers**: Tool enhancement, token limits, streaming options, reasoning content, sampling parameters

## Reasoning Transformer

The Reasoning Transformer (`src/transformer/reasoning.transformer.ts`) handles GPT-5 reasoning parameter conversion and inline token processing when used with Claude Code Router (CCR).

### **Key Functions:**

1. **Parameter Conversion**: Converts various reasoning formats to OpenAI's `reasoning_effort` parameter
   - `thinking: {type: "enabled"}` → `reasoning_effort: "medium"`
   - `reasoning: {max_tokens: X}` → `reasoning_effort` based on token budget mapping
   - `reasoning: {effort: "high"}` → `reasoning_effort: "high"`

2. **Inline Token Processing** (when used with CCR):
   - **Prefix Tokens**: `Quick:`, `Deep:`, `Explain:`, `Brief:`
   - **Colon Tokens**: `:quick`, `:deep`, `:explain`, `:brief`
   - **Token Stripping**: Removes tokens from prompt content before API calls
   - **Parameter Mapping**: Maps tokens to appropriate `reasoning_effort` and `verbosity` values

### **Token to Parameter Mapping:**

| Token | Reasoning Effort | Verbosity | Thinking Budget |
|-------|------------------|-----------|-----------------|
| `Quick:`/`:quick` | low | low | 500 tokens |
| `Deep:`/`:deep` | high | medium | 2000 tokens |
| `Explain:`/`:explain` | medium | high | 1000 tokens |
| `Brief:`/`:brief` | medium | low | 1000 tokens |

### **Usage in Transformer Chains:**

The reasoning transformer should be placed **before** provider-specific transformers:
```json
{
  "transformer": {
    "use": ["reasoning", "openai"]
  }
}
```

This ensures reasoning parameters are processed before OpenAI-specific transformations.

## GPT-5 Support

This server has **complete support for GPT-5 and o3 models** through OpenAI's Chat Completions API:

### ✅ Implementation Details
- **OpenAI Chat Completions API**: Uses standard `/v1/chat/completions` endpoint
- **Automatic Model Mapping**: OpenAI automatically serves GPT-5 for all model requests (GPT-4o, GPT-4, etc. all resolve to GPT-5)

### 🔧 GPT-5 API Quirks & Critical Fixes

**Parameter Compatibility Issues:**
1. **max_tokens → max_completion_tokens**: GPT-5 requires `max_completion_tokens` instead of legacy `max_tokens`
2. **Temperature Restrictions**: GPT-5 only supports `temperature: 1` (default), rejects other values
3. **Reasoning Format**: Only accepts `reasoning_effort: "minimal|low|medium|high"`, rejects object formats
4. **Verbosity Validation**: Strictly validates `verbosity: "low|medium|high"`, rejects invalid values
5. **Tool Schema Cleaning**: Rejects JSON schema metadata (`$schema`, `additionalProperties`) in tool parameters

**API Response Differences:**
- **Reasoning Tokens**: GPT-5 includes significant `reasoning_tokens` in usage (often 2000+ vs 500 for o3/o4-mini)  
- **Reasoning Content**: Available inline during streaming via `reasoning_content` field
- **Model ID**: Returns `gpt-5-2025-08-07` instead of requested model names
- **Error Sensitivity**: Stricter validation than earlier 2025 models (o3, o4-mini)

**Working Solutions Implemented:**
- OpenAI transformer auto-converts `max_tokens` → `max_completion_tokens`
- Reasoning transformer handles all parameter format conversions
- Tool format cleaner removes problematic JSON schema fields
- Parameter validation ensures API compliance with latest requirements

**Evolution from Earlier 2025 Models:**
- **vs o3/o4-mini**: GPT-5 uses unified architecture vs specialized reasoning focus
- **Parameter Changes**: New `reasoning_effort` format vs o3's reasoning approach
- **Tool Integration**: GPT-5 supports agentic tool use vs o3's limited tool capabilities  
- **Performance**: 50-80% fewer tokens for same quality vs o3, 6x fewer hallucinations
- **Timeout Behavior**: Reasoning responses can take longer due to enhanced thinking depth
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

### 🔧 GPT-5 API Quirks & Fixes

Our implementation handles all major OpenAI API quirks and parameter differences for GPT-5 models:

#### 1. **Parameter Mapping** ✅
- **Issue**: GPT-5 uses `max_completion_tokens` instead of `max_tokens`
- **Solution**: OpenAI transformer automatically converts for GPT-5/o3 models
- **Location**: `src/transformer/openai.transformer.ts:20-23`

#### 2. **Reasoning Parameter Format** ✅  
- **Issue**: GPT-5 expects `reasoning_effort: "minimal|low|medium|high"` (string), not `reasoning: {effort: "...", enabled: true}` (object)
- **Solution**: OpenAI transformer converts reasoning objects to reasoning_effort strings and removes invalid reasoning objects
- **Location**: `src/transformer/openai.transformer.ts:31-42`

#### 3. **Temperature Restriction** ✅
- **Issue**: GPT-5 only supports temperature value of 1 (default)
- **Solution**: OpenAI transformer removes non-default temperature values for GPT-5 models
- **Location**: `src/transformer/openai.transformer.ts:25-28`

#### 4. **Custom Tools Plaintext Support** ✅
- **Issue**: GPT-5 supports `type: "custom"` tools for plaintext payloads instead of JSON
- **Solution**: OpenAI transformer preserves custom tool types while converting standard tools
- **Location**: `src/transformer/openai.transformer.ts:49-57`

#### 5. **Reasoning Tokens in Response** ✅
- **Issue**: GPT-5 includes `reasoning_tokens` in `completion_tokens_details` that significantly increase token usage
- **Solution**: OpenAI transformer preserves reasoning token information in responses
- **Location**: `src/transformer/openai.transformer.ts:84-92`

#### 6. **Tool Format Conversion** ✅
- **Issue**: Anthropic vs OpenAI tool formats differ  
- **Solution**: OpenAI transformer converts Anthropic `input_schema` to OpenAI `parameters`
- **Location**: `src/transformer/openai.transformer.ts:46-69`

#### 7. **Model Detection for Parameter Mapping** ✅
- **Issue**: Only specific models require new parameter formats
- **Solution**: OpenAI transformer detects GPT-5/o3 models: `['gpt-5', 'gpt-5-mini', 'gpt-5-nano', 'o3', 'o3-mini', 'o3-pro', 'o4-mini']`
- **Location**: `src/transformer/openai.transformer.ts:12-15`

### 📝 Key Documentation Insights
- **Token Usage**: GPT-5 models include significant reasoning tokens (can be 1000+ tokens vs 300 for GPT-4)
- **API Preference**: OpenAI recommends Responses API over Chat Completions for GPT-5, but we use Chat Completions for Claude Code compatibility
- **Breaking Changes**: GPT-5 introduced multiple parameter changes that make prior functions incompatible
- **Performance**: GPT-5 has 50% fewer tool calling errors and can chain dozens of tool calls reliably

### ⚠️ Known Issues & Fixes

**GPT-5 Reasoning Parameter Bug (Resolved):**
- **Issue**: Anthropic transformer creates invalid `reasoning = {effort: X, enabled: Y}` object
- **OpenAI Requirement**: Only accepts `reasoning_effort = "minimal|low|medium|high"` string  
- **Fix Applied**: Remove faulty thinking→reasoning conversion from Anthropic transformer
- **Location**: `/src/transformer/anthropic.transformer.ts:159-165`

**Architecture Separation:**
- **LLMS**: Handles all provider-specific transformations
- **CCR**: Handles routing decisions only
- **No Overlap**: CCR should never do provider transformations

### ✅ Production Readiness
GPT-5 integration is **production ready** for use with Claude Code Router. The reasoning parameter issue has been identified and resolved through proper transformer separation.

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

## Unified Logging Strategy

This project uses **Fastify Pino** for structured production logging. Here's the complete logging strategy for both LLMS and CCR projects:

### 🏗️ LLMS Project Logging (This Package)

**Primary: Fastify Pino Logger**
```typescript
// In transformers: this.logger is available
this.logger.info({ 
  transformerName: "openai", 
  requestId: req.id,
  data: relevantData 
}, "Human-readable message");

this.logger.error({ error: err, context: additionalContext }, "Error description");
this.logger.debug({ details: debugInfo }, "Debug information");
```

**Configuration:**
- Default: enabled with structured JSON logging
- Access via `this.logger` in transformer classes
- Configured in main server setup
- Supports log levels: trace, debug, info, warn, error, fatal

### 🏗️ CCR Project Logging (Consumer)

**Primary: Custom File Logger**
- File-based logging to `~/.claude-code-router/claude-code-router.log`
- Controlled by config.json: `{"LOG": true, "LOG_LEVEL": "debug"}`
- Rotates logs automatically
- Used for request/response debugging and service monitoring

### 🛠️ Development & Debug Logging

**Emergency Debugging (Temporary Use Only):**
- Use temporary file logging in `/tmp/` for detailed request/response inspection
- Console.log works but output captured by CCR service (not visible in terminal)
- Clean up all debug logging before committing code

**Example Emergency Debug Pattern:**
```typescript
// TEMPORARY - Remove before commit
const fs = require('fs');
fs.appendFileSync('/tmp/debug-transformer.log', 
  `[${new Date().toISOString()}] ${JSON.stringify(data, null, 2)}\n`);
```

### 📊 Best Practices

**Production Code:**
1. **Use Fastify logger** (`this.logger`) in all transformer classes
2. **Structured logging** with relevant context objects
3. **Appropriate log levels** (info for normal operations, error for failures, debug for diagnostics)
4. **No console.log** in production code

**Development:**
1. **File logging to /tmp/** for temporary debugging
2. **Clean up all debug code** before committing
3. **Use git status** to verify no debug files left behind

**Cross-Project Communication:**
- LLMS logs don't automatically appear in CCR logs (by design)
- Each service maintains independent logging for modularity
- Use correlation IDs for tracing requests across services

### 🔍 Verified Working Mechanisms

✅ **Fastify Pino Logger**: Available in transformers via `this.logger`  
✅ **CCR File Logger**: Writes to `~/.claude-code-router/claude-code-router.log`  
✅ **Emergency File Logging**: Temporary debugging to `/tmp/` files  
✅ **Console.log**: Works but captured by CCR service (use for testing only)

This unified approach provides structured production logging while maintaining flexibility for development debugging.