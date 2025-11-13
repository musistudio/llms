# KimiTransformer

## Overview

`KimiTransformer` is a model-aware transformer that encapsulates all Kimi / Kimi-K2 behavior behind the unified LLM server interface. It is designed so that **Kimi works correctly with sane defaults** for any provider that exposes Kimi models via an OpenAI-compatible `/v1/chat/completions` endpoint.

Goals:

- Provide a drop-in, OpenAI-compatible experience for Kimi/K2 chat and tool calling
- Encode Kimi-K2 tool-calling and ID rules inside a single transformer
- Avoid global state or cross-request coupling
- Keep configuration simple: adding `"Kimi"` to the transformer chain for Kimi models is enough for correctness

## Default Options

The following defaults are applied inside `KimiTransformer` (see `src/transformer/kimi.transformer.ts:65-85`):

| Option                  | Default       | Effect |
|-------------------------|--------------|--------|
| `toolChoiceDefault`     | `"auto"`     | Use `"auto"` when tools exist and `tool_choice` is unset |
| `acceptRoleTool`        | `true`       | Require `role: "tool"` messages to include `tool_call_id` and `content` |
| `enforceFinishReasonLoop` | `true`    | When tool calls are present (and processing is enabled), enforce `finish_reason: "tool_calls"` |
| `manualToolParsing`     | `false`      | K2 marker parsing is opt-in only |
| `emitToolCallsInJson`   | `false`      | Reserved / no-op in current implementation |
| `assembleToolDeltas`    | `false`      | Streaming tool-call delta assembly is opt-in |
| `idNormalization`       | `false`      | Do not force-renormalize valid IDs by default |
| `repairOnMismatch`      | `true`       | Repair invalid/misaligned IDs into the K2 format when detected |
| `idPrefix`              | `"functions"` | Prefix for normalized/repaired IDs |
| `counterScope`          | `"conversation"` | Compute next index from entire message history |

These defaults are chosen so that a standard Kimi-K2 setup works correctly without additional configuration.

## Default Usage (Recommended)

For Kimi models (for example `moonshotai/Kimi-K2-Instruct`, `moonshotai/Kimi-K2-Thinking`) served by any OpenAI-compatible provider, the recommended configuration is to attach the `Kimi` transformer to those models:

```json
{
  "name": "openrouter",
  "api_base_url": "https://openrouter.ai/api",
  "api_key": "your-openrouter-key",
  "models": ["moonshotai/Kimi-K2-Instruct"],
  "transformer": {
    "use": ["Kimi"]
  }
}

{
  "name": "siliconflow",
  "api_base_url": "https://api.siliconflow.cn/v1",
  "api_key": "your-siliconflow-key",
  "models": ["moonshotai/Kimi-K2-Instruct"],
  "transformer": {
    "use": ["Kimi"]
  }
}
```

Key points:

- No additional transformers (such as `TooluseTransformer`, `ReasoningTransformer`, `ForceReasoningTransformer`, `StreamOptionsTransformer`, etc.) are required for Kimi correctness.
- The built-in defaults are chosen so that a standard Kimi-K2 deployment works without extra flags.

## What It Does

`KimiTransformer` implements the standard transformer interface and focuses solely on Kimi-specific behavior.

### Request Handling

- Ensures OpenAI-style compatibility for `chat.completions`-like usage.
- If tools are provided and `tool_choice` is not set, applies a configurable default (`toolChoiceDefault`, default `"auto"`).
- Validates tool messages when `acceptRoleTool` is enabled (default `true`):
  - `role: "tool"` messages must include `tool_call_id` and `content`.

These rules align with Kimi-K2 expectations for the tool-calling loop while remaining non-intrusive for normal usage.

### Response Handling (Non-Streaming)

For non-streaming responses, `KimiTransformer`:

- By default, passes through Kimi's OpenAI-compatible responses unchanged.
- Optionally performs **manual parsing** of K2-style marker formats when `manualToolParsing: true` (advanced):
  - Parses sequences wrapped with:
    - `<|tool_calls_section_begin|>` / `<|tool_calls_section_end|>`
    - `<|tool_call_begin|>` / `<|tool_call_end|>`
    - `<|tool_call_argument_begin|>`
  - Extracts tool call IDs and arguments into structured `tool_calls` entries.
  - Parsed tool calls are passed through the same ID repair/normalization logic as native `tool_calls`.
- Optionally normalizes or repairs tool-call IDs for multi-turn stability when `idNormalization` or `repairOnMismatch` are enabled.

All of this logic is scoped to Kimi and implemented inside `KimiTransformer`.

### Streaming Tool Calls

Kimi-K2 can emit tool call deltas in streaming mode. `KimiTransformer` supports two behaviors and treats both `text/event-stream` and `application/x-ndjson` responses as streaming (see `isStreamingResponse`).

- **Default (`assembleToolDeltas: false`)**: pass through streaming chunks as-is.
- **Advanced (`assembleToolDeltas: true`)**:
  - Accumulates partial `delta.tool_calls` by index.
  - Reassembles them into complete tool call objects.
  - Emits a final synthesized chunk containing the consolidated `tool_calls` and `finish_reason: "tool_calls"` **in addition to** forwarding the original chunks. This keeps compatibility with existing OpenAI-style clients while providing a normalized summary.

This mirrors Kimi-K2's recommended client patterns, but runs inside the transformer so callers can keep their client logic simple.

### ID Normalization and Repair

Kimi-K2 expects tool-call IDs in the form:

```text
functions.{func_name}:{idx}
```

To prevent crashes in multi-turn tool calling, `KimiTransformer` can:

- Scan prior messages and existing tool calls to find the next available index.
- **By default** (`repairOnMismatch: true`, `idNormalization: false`), repair invalid or non-conforming IDs into the required format without touching valid IDs.
- When `idNormalization: true` is enabled, force-normalize all tool call IDs (including valid ones) into the canonical K2 format.

This behavior is Kimi-specific and helps align with the official K2 guidance without affecting other providers.

## How It Works (Design Principles)

### 1. Encapsulation

- All Kimi-specific behavior lives inside `KimiTransformer` (`src/transformer/kimi.transformer.ts`).
- No global mutable state is used.
- Streaming state (such as tool call buffers) is maintained per response/stream, avoiding cross-request contamination.

### 2. Kimi-Only Default Chain (Recommended)

- The intended default for Kimi is:

  ```json
  "transformer": { "use": ["Kimi"] }
  ```

- Generic transformers are **not** required for correctness and are not part of the default chain.

### 3. Optional Composition (Advanced Only)

Advanced users may compose additional transformers with `Kimi` if and only if:

- They do not change Kimi semantics.
- They do not conflict with K2 tool-calling requirements (IDs, marker formats, finish reasons, etc.).

Example (use with caution):

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

Incompatible transformers that rewrite tool messages, IDs, or streaming structures may break K2 behavior and are not recommended.

## Why This Transformer Exists

Kimi-K2 introduces several quirks and requirements around tool calling and IDs. Naively treating it as a generic OpenAI-compatible endpoint can lead to:

- Incorrect or unstable tool-call IDs across turns
- Crashes when marker-based tool calls (`<|tool_call_*|>`) are returned
- Extra complexity pushed into each client implementation

`KimiTransformer` centralizes these concerns so that:

- Server operators configure a single transformer instead of custom client logic.
- Clients can use familiar OpenAI-style `tools` / `tool_calls` loops.
- Advanced behaviors (manual marker parsing, streaming assembly, ID repair) are available when needed, without affecting simple setups.

The result is a clear, Kimi-specific integration that aligns with the rest of the transformer architecture while respecting Kimi-K2's semantics.