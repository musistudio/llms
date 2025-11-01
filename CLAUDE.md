# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 常用命令
- 安装依赖：`npm install`（或 `pnpm install`）
- 本地开发：`npm run dev`（nodemon + tsx 热重载 `src/server.ts`）
- 构建产物：`npm run build`（调用 `scripts/build.ts`，输出至 `dist/cjs` 与 `dist/esm`）
- 增量构建：`npm run build:watch`
- 代码检查：`npm run lint`
- 运行编译后的服务：`npm start`（CJS） / `npm run start:esm`
- 测试脚本尚未配置；若需要测试，请查看 `devDependencies` 中的 mocha/chai/sinon 并按需自定义命令

## 核心架构概览
- Fastify 服务器（`src/server.ts`）负责初始化日志、CORS、错误处理，并在启动时挂载 API、服务层以及 transformer 列表
- `ConfigService` 读取 JSON5（默认 `config.json`）、可选 `.env`、以及初始配置，提供统一的配置访问入口
- `TransformerService` 自动注册内置 transformer（`src/transformer` 下的实现），并支持从配置动态加载额外 transformer；区分有/无 endpoint 的 transformer 以自动挂载路由
- `ProviderService` 管理 LLM 提供方：注册、更新、删除、模型路由解析，以及基于配置文件的动态 provider 注入
- `LLMService` 仅作 ProviderService 的薄封装，对外提供 provider/model 查询能力
- `src/api/routes.ts` 注册健康检查、provider CRUD、以及所有 transformer endpoint；结合 `utils/request.ts` 发送统一的 HTTP 调用并适配流式响应
- 工具方法集中在 `src/utils/`（消息内容转换、Gemini/Vertex 特性处理、思维链裁剪、工具参数解析等），供 transformer 在请求/响应阶段复用

## 请求到响应的执行流程
1. 客户端请求进入 Fastify，`preHandler` 中的模型拆分逻辑将 `model` 字段解析成 `provider`+`model`
2. `ProviderService.resolveModelRoute` 确认目标提供方及模型，`TransformerService` 找到匹配的 transformer
3. 在 `handleTransformerEndpoint` 中依次执行：
   - `transformRequestOut`（统一请求 → 提供方格式）
   - provider 级别 transformer 链及模型级别 transformer 链（`transformRequestIn`）
   - 若配置透传（bypass），则跳过上述链并保留原始请求/头信息
4. 使用 `sendUnifiedRequest` 调用目标提供方，自动补齐认证（Bearer API Key），支持代理（`ConfigService.getHttpsProxy`）并兼容流式响应
5. 响应阶段按相反顺序执行 transformer 链（`transformResponseOut` → `transformResponseIn`），最终返回统一 JSON 或 SSE 流

## 配置与扩展要点
- 默认从项目根目录的 `config.json` 读取 JSON5 配置，可通过 `ConfigService` 构造参数覆盖路径或禁用 JSON/ENV
- 配置中的 `providers` 数组支持声明自定义 provider（名称、base URL、API Key、模型、transformer 链），启动时自动注册
- 配置中的 `transformers` 数组允许按需加载外部 transformer 模块，需导出具名类并在实例上提供 `name`
- 内置 transformer 通过静态属性 `TransformerName` 或实例 `name` 注册；部分 transformer 提供 `endPoint` 用于自动创建 POST 路径

## 构建与部署
- `scripts/build.ts` 基于 esbuild 打包，生成压缩、带 sourcemap 的 Node18 目标，分别输出 CJS 与 ESM 版本
- 线上运行时可直接 `node dist/cjs/server.cjs` 或 `node dist/esm/server.mjs`
- `@` 前缀在 `tsconfig.json` 中映射到 `src/`，请保持引用路径一致

## 其他提示
- 全局请求日志与错误处理位于 `src/server.ts` 与 `src/api/middleware.ts`，流式请求会追加 `text/event-stream` 头
- `node_modules` 中已包含 Fastify、Anthropic SDK、OpenAI SDK、Google GenAI、jsonrepair 等依赖，transformer 可充分复用这些工具
- 若需要扩展 streaming 或 reasoning 功能，可参考 `StreamOptionsTransformer`、`ReasoningTransformer` 等实现模式
