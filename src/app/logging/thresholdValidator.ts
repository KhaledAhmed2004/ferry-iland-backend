/**
 * Threshold Validator
 *
 * Purpose: Validate at runtime that threshold values are logical
 * Prevents future mismatches
 */

type ThresholdValidationResult = {
  isValid: boolean;
  errors: string[];
  warnings: string[];
}

type PerformanceThresholds = {
  memory: { healthy: number; moderate: number; high: number };
  cpu: { efficient: number; moderate: number; intensive: number };
  eventLoop: { excellent: number; good: number; delayed: number };
}

/**
 * Validate performance thresholds for logical consistency
 */
export function validatePerformanceThresholds(
  thresholds: PerformanceThresholds
): ThresholdValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  // ✅ Check 1: Memory thresholds are in ascending order
  if (thresholds.memory.healthy >= thresholds.memory.moderate) {
    errors.push(
      `Memory healthy (${thresholds.memory.healthy}) must be < moderate (${thresholds.memory.moderate})`
    );
  }

  if (thresholds.memory.moderate >= thresholds.memory.high) {
    errors.push(
      `Memory moderate (${thresholds.memory.moderate}) must be < high (${thresholds.memory.high})`
    );
  }

  // ✅ Check 2: Memory thresholds too low? (false positive risk)
  if (thresholds.memory.high < 50) {
    warnings.push(
      `⚠️  Memory high threshold (${thresholds.memory.high} MB) is too low! ` +
        `bcrypt operations typically use 40-50 MB. Recommended: >= 100 MB`
    );
  }

  // ✅ Check 3: CPU thresholds are in ascending order
  if (thresholds.cpu.efficient >= thresholds.cpu.moderate) {
    errors.push(
      `CPU efficient (${thresholds.cpu.efficient}%) must be < moderate (${thresholds.cpu.moderate}%)`
    );
  }

  if (thresholds.cpu.moderate >= thresholds.cpu.intensive) {
    errors.push(
      `CPU moderate (${thresholds.cpu.moderate}%) must be < intensive (${thresholds.cpu.intensive}%)`
    );
  }

  // ✅ Check 4: CPU threshold supports thread pool behavior
  if (thresholds.cpu.intensive < 100) {
    warnings.push(
      `⚠️  CPU intensive threshold (${thresholds.cpu.intensive}%) is too low! ` +
        `Thread pool operations can exceed 100%. Recommended: >= 150%`
    );
  }

  // ✅ Check 5: Ranges are sufficiently large
  const memoryRange = thresholds.memory.moderate - thresholds.memory.healthy;
  if (memoryRange < 20) {
    warnings.push(
      `⚠️  Memory healthy→moderate range (${memoryRange} MB) is too small. ` +
        `Recommended: at least 30-50 MB difference`
    );
  }

  // ✅ Check 6: Event loop thresholds ascending order
  if (thresholds.eventLoop.excellent >= thresholds.eventLoop.good) {
    errors.push(
      `Event loop excellent (${thresholds.eventLoop.excellent}ms) must be < good (${thresholds.eventLoop.good}ms)`
    );
  }

  if (thresholds.eventLoop.good >= thresholds.eventLoop.delayed) {
    errors.push(
      `Event loop good (${thresholds.eventLoop.good}ms) must be < delayed (${thresholds.eventLoop.delayed}ms)`
    );
  }

  return {
    isValid: errors.length === 0,
    errors,
    warnings,
  };
}

/**
 * Validate thresholds and warn/throw on startup
 */
export function validateAndWarnThresholds(thresholds: PerformanceThresholds): void {
  const result = validatePerformanceThresholds(thresholds);

  if (!result.isValid) {
    console.error('\n❌ THRESHOLD VALIDATION FAILED:');
    console.error('━'.repeat(60));
    result.errors.forEach(err => console.error(`   ${err}`));
    console.error('━'.repeat(60));
    throw new Error('Invalid performance thresholds configuration');
  }

  if (result.warnings.length > 0) {
    console.warn('\n⚠️  THRESHOLD WARNINGS:');
    console.warn('━'.repeat(60));
    result.warnings.forEach(warn => console.warn(`   ${warn}`));
    console.warn('━'.repeat(60));
    console.warn('   These thresholds may cause false positives. Consider adjusting.\n');
  }
}
