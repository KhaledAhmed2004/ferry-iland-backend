/**
 * Performance Metrics Utilities
 *
 * Provides utilities for capturing and formatting memory, CPU, and event loop metrics.
 * Used for performance monitoring and health status tracking in the logging system.
 *
 * Features:
 * - Memory snapshot capture (heap, RSS, external)
 * - CPU usage tracking (user, system time)
 * - Event loop lag measurement
 * - Health status calculation with thresholds
 * - Progress bar generation for visual display
 * - Color-coded status formatting
 */

import colors from 'colors';

// ============================================================================
// TYPES & INTERFACES
// ============================================================================

export type MemorySnapshot = {
  rss: number; // Resident Set Size (total memory)
  heapTotal: number; // Total heap allocated
  heapUsed: number; // Heap actually used
  external: number; // C++ objects memory
  arrayBuffers: number; // ArrayBuffers memory
  timestamp: number; // When snapshot was taken
}

export type CPUMetrics = {
  user: number; // Microseconds in user-mode CPU
  system: number; // Microseconds in kernel/system CPU
  timestamp: number; // When metrics were captured
}

export type EventLoopMetrics = {
  samples: number[]; // Array of lag measurements in ms
  avgLag: number; // Average lag across samples
  peakLag: number; // Maximum lag detected
  sampleCount: number; // Number of samples taken
}

export type PerformanceMetrics = {
  memory: {
    start: MemorySnapshot;
    end: MemorySnapshot;
    growthMB: number;
    growthPercent: number;
  };
  cpu: {
    start: CPUMetrics;
    end: CPUMetrics;
    totalMs: number;
    userMs: number;
    systemMs: number;
  };
  eventLoop: EventLoopMetrics;
}

// Health status types
export type MemoryHealth = 'Healthy' | 'Moderate' | 'High' | 'Critical';
export type CPUHealth = 'Efficient' | 'Moderate' | 'Intensive' | 'Overloaded';
export type EventLoopHealth = 'Excellent' | 'Good' | 'Delayed' | 'Blocked';

export type HealthThresholds = {
  memory: {
    healthy: number; // MB
    moderate: number;
    high: number;
  };
  cpu: {
    efficient: number; // %
    moderate: number;
    intensive: number;
  };
  eventLoop: {
    excellent: number; // ms
    good: number;
    delayed: number;
  };
}

// ============================================================================
// CAPTURE FUNCTIONS
// ============================================================================

/**
 * Capture current memory usage snapshot
 */
export function captureMemorySnapshot(): MemorySnapshot {
  const mem = process.memoryUsage();
  return {
    rss: mem.rss,
    heapTotal: mem.heapTotal,
    heapUsed: mem.heapUsed,
    external: mem.external,
    arrayBuffers: mem.arrayBuffers,
    timestamp: Date.now(),
  };
}

/**
 * Capture current CPU usage
 */
export function captureCPUUsage(): CPUMetrics {
  const cpu = process.cpuUsage();
  return {
    user: cpu.user,
    system: cpu.system,
    timestamp: Date.now(),
  };
}

/**
 * Measure event loop lag (async, non-blocking)
 * Returns delay in milliseconds
 */
export async function measureEventLoopLag(): Promise<number> {
  const start = Date.now();
  return new Promise<number>((resolve) => {
    setImmediate(() => {
      const lag = Date.now() - start;
      resolve(lag);
    });
  });
}

// ============================================================================
// CALCULATION FUNCTIONS
// ============================================================================

/**
 * Calculate memory growth between two snapshots
 * Returns growth in MB
 */
export function calculateMemoryGrowth(
  start: MemorySnapshot,
  end: MemorySnapshot
): number {
  const growthBytes = end.heapUsed - start.heapUsed;
  return Math.round((growthBytes / 1024 / 1024) * 10) / 10; // MB with 1 decimal
}

/**
 * Calculate memory growth percentage
 */
export function calculateMemoryGrowthPercent(
  start: MemorySnapshot,
  end: MemorySnapshot
): number {
  if (start.heapUsed === 0) return 0;
  const growth = ((end.heapUsed - start.heapUsed) / start.heapUsed) * 100;
  return Math.round(growth * 10) / 10; // 1 decimal
}

/**
 * Calculate CPU time spent between two measurements
 * Returns object with user, system, and total time in milliseconds
 */
export function calculateCPUTime(
  start: CPUMetrics,
  end: CPUMetrics
): { userMs: number; systemMs: number; totalMs: number } {
  const userMicros = end.user - start.user;
  const systemMicros = end.system - start.system;

  return {
    userMs: Math.round(userMicros / 1000), // Convert to ms
    systemMs: Math.round(systemMicros / 1000),
    totalMs: Math.round((userMicros + systemMicros) / 1000),
  };
}

/**
 * Calculate CPU overhead percentage relative to request duration
 */
export function calculateCPUOverhead(
  cpuTimeMs: number,
  requestDurationMs: number
): number {
  if (requestDurationMs === 0) return 0;
  const overhead = (cpuTimeMs / requestDurationMs) * 100;
  return Math.round(overhead * 10) / 10; // 1 decimal
}

/**
 * Calculate event loop metrics from samples
 */
export function calculateEventLoopMetrics(samples: number[]): EventLoopMetrics {
  if (samples.length === 0) {
    return {
      samples: [],
      avgLag: 0,
      peakLag: 0,
      sampleCount: 0,
    };
  }

  const avgLag = samples.reduce((sum, lag) => sum + lag, 0) / samples.length;
  const peakLag = Math.max(...samples);

  return {
    samples,
    avgLag: Math.round(avgLag * 10) / 10, // 1 decimal
    peakLag: Math.round(peakLag * 10) / 10,
    sampleCount: samples.length,
  };
}

// ============================================================================
// HEALTH STATUS CALCULATORS
// ============================================================================

/**
 * Get memory health status based on growth
 */
export function getMemoryHealth(
  growthMB: number,
  thresholds: HealthThresholds['memory']
): MemoryHealth {
  if (growthMB < thresholds.healthy) return 'Healthy';
  if (growthMB < thresholds.moderate) return 'Moderate';
  if (growthMB < thresholds.high) return 'High';
  return 'Critical';
}

/**
 * Get CPU health status based on overhead percentage
 */
export function getCPUHealth(
  overheadPercent: number,
  thresholds: HealthThresholds['cpu']
): CPUHealth {
  if (overheadPercent < thresholds.efficient) return 'Efficient';
  if (overheadPercent < thresholds.moderate) return 'Moderate';
  if (overheadPercent < thresholds.intensive) return 'Intensive';
  return 'Overloaded';
}

/**
 * Get event loop health status based on average lag
 */
export function getEventLoopHealth(
  avgLagMs: number,
  thresholds: HealthThresholds['eventLoop']
): EventLoopHealth {
  if (avgLagMs < thresholds.excellent) return 'Excellent';
  if (avgLagMs < thresholds.good) return 'Good';
  if (avgLagMs < thresholds.delayed) return 'Delayed';
  return 'Blocked';
}

// ============================================================================
// VISUAL FORMATTING
// ============================================================================

/**
 * Format bytes to human-readable string (KB, MB, GB)
 */
export function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';

  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));

  const value = bytes / Math.pow(k, i);
  const rounded = Math.round(value * 10) / 10; // 1 decimal

  return `${rounded} ${sizes[i]}`;
}

/**
 * Generate progress bar visualization
 * @param value - Current value
 * @param max - Maximum value (100% point)
 * @param width - Total width of bar in characters (default: 10)
 * @returns String like "████░░░░░░"
 */
export function formatProgressBar(
  value: number,
  max: number,
  width: number = 10
): string {
  if (max === 0) return '░'.repeat(width);

  const percent = Math.min(100, Math.max(0, (value / max) * 100));
  const filled = Math.round((percent / 100) * width);
  const empty = width - filled;

  return '█'.repeat(filled) + '░'.repeat(empty);
}

/**
 * Get color function based on health status
 */
export function getHealthColor(
  status: MemoryHealth | CPUHealth | EventLoopHealth
): any {
  switch (status) {
    case 'Healthy':
    case 'Efficient':
    case 'Excellent':
      return (colors.green as any).bold;

    case 'Moderate':
    case 'Good':
      return (colors.yellow as any).bold;

    case 'High':
    case 'Intensive':
    case 'Delayed':
      return (colors.magenta as any).bold; // Orange-ish

    case 'Critical':
    case 'Overloaded':
    case 'Blocked':
      return (colors.red as any).bold;

    default:
      return colors.white;
  }
}

/**
 * Get emoji indicator for health status
 */
export function getHealthEmoji(
  status: MemoryHealth | CPUHealth | EventLoopHealth
): string {
  switch (status) {
    case 'Healthy':
    case 'Efficient':
    case 'Excellent':
      return '✅';

    case 'Moderate':
    case 'Good':
      return '⚠️';

    case 'High':
    case 'Intensive':
    case 'Delayed':
      return '🟠';

    case 'Critical':
    case 'Overloaded':
    case 'Blocked':
      return '🔴';

    default:
      return '';
  }
}

/**
 * Get health status description/recommendation
 */
export function getHealthDescription(
  status: MemoryHealth | CPUHealth | EventLoopHealth,
  type: 'memory' | 'cpu' | 'eventLoop'
): string {
  if (type === 'memory') {
    switch (status) {
      case 'Healthy':
        return 'Normal memory usage';
      case 'Moderate':
        return 'Expected for complex operations';
      case 'High':
        return 'High allocation - monitor if persistent';
      case 'Critical':
        return 'Very high allocation - check for leaks if sustained across requests';
    }
  }

  if (type === 'cpu') {
    switch (status) {
      case 'Efficient':
        return 'Low CPU consumption';
      case 'Moderate':
        return 'Normal CPU usage (may use thread pool)';
      case 'Intensive':
        return 'CPU-intensive operation (crypto/compression/bcrypt)';
      case 'Overloaded':
        return 'Very high CPU - expected for crypto ops, investigate if sustained';
    }
  }

  if (type === 'eventLoop') {
    switch (status) {
      case 'Excellent':
        return 'Event loop healthy';
      case 'Good':
        return 'Some delay detected';
      case 'Delayed':
        return 'Event loop under pressure';
      case 'Blocked':
        return 'Event loop seriously delayed!';
    }
  }

  return '';
}

/**
 * Get overall health status from all metrics
 */
export function getOverallHealth(
  memoryStatus: MemoryHealth,
  cpuStatus: CPUHealth,
  eventLoopStatus: EventLoopHealth
): {
  status: string;
  emoji: string;
  message: string;
} {
  // Priority: Critical > High/Overloaded/Blocked > Moderate/Good > Healthy/Efficient/Excellent

  if (
    memoryStatus === 'Critical' ||
    cpuStatus === 'Overloaded' ||
    eventLoopStatus === 'Blocked'
  ) {
    return {
      status: 'Critical',
      emoji: '🔴',
      message: 'Immediate attention required!',
    };
  }

  if (
    memoryStatus === 'High' ||
    cpuStatus === 'Intensive' ||
    eventLoopStatus === 'Delayed'
  ) {
    return {
      status: 'Warning',
      emoji: '🟠',
      message: 'Performance issues detected',
    };
  }

  if (
    memoryStatus === 'Moderate' ||
    cpuStatus === 'Moderate' ||
    eventLoopStatus === 'Good'
  ) {
    let message = 'Monitor ';
    const issues = [];
    if (memoryStatus === 'Moderate') issues.push('memory usage');
    if (cpuStatus === 'Moderate') issues.push('CPU usage');
    if (eventLoopStatus === 'Good') issues.push('event loop');
    message += issues.join(' and ');

    return {
      status: 'Moderate',
      emoji: '⚠️',
      message,
    };
  }

  return {
    status: 'Excellent',
    emoji: '✅',
    message: 'All metrics healthy',
  };
}
