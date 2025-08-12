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