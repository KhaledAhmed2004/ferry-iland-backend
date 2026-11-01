/**
 * Capture Configuration
 *
 * Configuration for function argument and return value capture.
 * Loads settings from environment variables and provides utility
 * functions for determining when to capture data.
 */

import config from '../../config';

export type CaptureConfig = {
  enabled: boolean;
  args: boolean;
  returns: boolean;
  maxDepth: number;
  maxArrayItems: number;
  maxStringLength: number;
  maxSizeKB: number;
  maskPII: boolean;
}

// Functions that should NEVER have args captured (too sensitive)
const EXCLUDED_FUNCTIONS = new Set([
  'AuthService.hashPassword',
  'AuthService.comparePassword',
  'AuthService.verifyPassword',
  'FileService.uploadLarge',
  'PaymentService.processCard',
  'PaymentService.handleCardPayment',
]);

/**
 * Get capture configuration from environment/config
 */
export function getCaptureConfig(): CaptureConfig {
  const tracingConfig = config.tracing?.capture;

  return {
    enabled: tracingConfig?.enabled !== false,
    args: tracingConfig?.args !== false,
    returns: tracingConfig?.returns !== false,
    maxDepth: tracingConfig?.maxDepth || 5,
    maxArrayItems: tracingConfig?.maxArrayItems || 10,
    maxStringLength: tracingConfig?.maxStringLength || 500,
    maxSizeKB: tracingConfig?.maxSizeKB || 5,
    maskPII: tracingConfig?.maskPII !== false,
  };
}

/**
 * Determine if we should capture args/returns for this function
 *
 * @param label - Function label (e.g., "AuthService.login")
 * @param duration - Optional duration in ms (for conditional capture)
 * @returns true if should capture, false otherwise
 */
export function shouldCapture(label: string, duration?: number): boolean {
  const captureConfig = getCaptureConfig();

  // Check if capture is globally enabled
  if (!captureConfig.enabled) {
    return false;
  }

  // Check if function is in exclusion list
  if (EXCLUDED_FUNCTIONS.has(label)) {
    return false;
  }

  // If duration provided, can add conditional logic
  // For example: only capture slow requests
  // if (duration && duration < 300) {
  //   return false; // Only capture slow requests (>300ms)
  // }

  return true;
}

/**
 * Check if a specific field name is sensitive
 */
export function isSensitiveField(fieldName: string): boolean {
  const lowerName = fieldName.toLowerCase();

  const sensitivePatterns = [
    'password',
    'token',
    'secret',
    'key',
    'apikey',
    'jwt',
    'auth',
    'credential',
  ];

  return sensitivePatterns.some(pattern => lowerName.includes(pattern));
}

// Export config as default
export const captureConfig = getCaptureConfig();
