/**
 * Environment Variable Resolution Utility
 * 
 * Safely resolves environment variable placeholders in configuration strings
 * following industry best practices for secret management.
 */

export interface EnvResolverOptions {
  /**
   * Whether to resolve environment variables (default: true)
   * Set to false to preserve literal strings for edge cases
   */
  resolveEnvVariables?: boolean;
  
  /**
   * Whether to throw errors for unresolved variables (default: true)
   * Set to false to preserve original string if env var is missing
   */
  throwOnMissing?: boolean;
}

/**
 * Resolves environment variable placeholders in a string
 * 
 * Supports formats:
 * - $VAR_NAME 
 * - ${VAR_NAME}
 * 
 * Only resolves strings that match exactly these patterns to avoid
 * accidentally resolving valid API keys that happen to contain '$'
 * 
 * @param value - The string that may contain environment variable references
 * @param options - Resolution options
 * @returns Resolved string with environment variables substituted
 * @throws Error if environment variable is missing and throwOnMissing is true
 */
export function resolveEnvVars(
  value: string, 
  options: EnvResolverOptions = {}
): string {
  const { resolveEnvVariables = true, throwOnMissing = true } = options;
  
  // If resolution is disabled, return original value
  if (!resolveEnvVariables) {
    return value;
  }
  
  // Only resolve strings that exactly match env var patterns
  // This prevents accidentally resolving valid API keys that contain '$'
  const exactPattern = /^\$\{?([A-Z0-9_]+)\}?$/;
  const match = value.match(exactPattern);
  
  if (!match) {
    // Not an environment variable reference, return as-is
    return value;
  }
  
  const varName = match[1];
  const resolved = process.env[varName];
  
  if (!resolved) {
    if (throwOnMissing) {
      throw new Error(
        `Environment variable '${varName}' is not set. ` +
        `Please set ${varName} in your environment or .env file.`
      );
    }
    // Return original value if variable is missing and throwOnMissing is false
    return value;
  }
  
  return resolved;
}

/**
 * Safely resolves multiple environment variables in an object
 * 
 * @param obj - Object with string values that may contain env var references
 * @param options - Resolution options
 * @returns New object with resolved values
 */
export function resolveEnvVarsInObject<T extends Record<string, any>>(
  obj: T,
  options: EnvResolverOptions = {}
): T {
  const result = { ...obj };
  
  for (const [key, value] of Object.entries(result)) {
    if (typeof value === 'string') {
      try {
        result[key] = resolveEnvVars(value, options);
      } catch (error) {
        // Re-throw with context about which field failed
        throw new Error(`Failed to resolve environment variable in field '${key}': ${(error as Error).message}`);
      }
    }
  }
  
  return result;
}

/**
 * Redacts sensitive values for logging
 * Replaces all but the first 4 and last 4 characters with asterisks
 */
export function redactApiKey(apiKey: string): string {
  if (!apiKey || apiKey.length <= 8) {
    return '***';
  }
  
  const start = apiKey.slice(0, 4);
  const end = apiKey.slice(-4);
  const middle = '*'.repeat(Math.max(0, apiKey.length - 8));
  
  return `${start}${middle}${end}`;
}