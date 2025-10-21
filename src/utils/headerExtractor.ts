/**
 * Header 提取和过滤工具
 * 用于从请求 headers 中提取允许转发到 LLM Provider 的 headers
 */

// 默认允许转发的 headers（白名单）
const DEFAULT_FORWARD_HEADERS = [
  'x-request-id',
  'x-trace-id',
  'x-correlation-id',
  'user-agent',
  'x-forwarded-for',
  'x-real-ip',
  'accept-language',
];

// 禁止转发的 headers（黑名单）
const BLOCKED_HEADERS = [
  'host',
  'content-length',
  'connection',
  'transfer-encoding',
  'authorization',  // 由 provider 自己设置
  'x-api-key',      // 由 provider 自己设置
];

/**
 * 从请求 headers 中提取允许转发的 headers
 * @param headers - 原始请求 headers
 * @param customAllowList - 自定义白名单（可选，优先级高于默认）
 * @returns 过滤后的 headers 对象
 */
export function extractForwardableHeaders(
  headers: Record<string, string | string[] | undefined>,
  customAllowList?: string[]
): Record<string, string> {
  const forwarded: Record<string, string> = {};
  const allowList = customAllowList || DEFAULT_FORWARD_HEADERS;

  allowList.forEach((name) => {
    const lowerName = name.toLowerCase();
    
    // 检查是否在黑名单中
    if (BLOCKED_HEADERS.includes(lowerName)) {
      return;
    }

    const value = headers[lowerName];
    if (value) {
      // 处理数组形式的 header
      forwarded[name] = Array.isArray(value) ? value[0] : value;
    }
  });

  return forwarded;
}

/**
 * 从配置中获取自定义转发列表
 * @param config - 配置对象
 * @returns 自定义 header 列表或 undefined
 */
export function getForwardHeadersFromConfig(config?: any): string[] | undefined {
  if (config?.FORWARD_HEADERS) {
    return Array.isArray(config.FORWARD_HEADERS)
      ? config.FORWARD_HEADERS
      : config.FORWARD_HEADERS.split(',').map((h: string) => h.trim());
  }

  return undefined;
}
