import ora, { Ora } from 'ora';
import colors from 'colors';

/**
 * Spinner helper that works in both TTY and CI/CD environments
 * In CI/CD (non-TTY), falls back to simple console logging
 */

type SpinnerOptions = {
  text: string;
  color?: 'cyan' | 'green' | 'yellow' | 'red' | 'blue' | 'magenta';
}

type TimingThresholds = {
  fast: number; // ms
  moderate: number; // ms
}

const DEFAULT_THRESHOLDS: TimingThresholds = {
  fast: 100,
  moderate: 500,
};

class SpinnerHelper {
  private spinner: Ora | null = null;
  private startTime: number = 0;
  private isTTY: boolean;

  constructor() {
    // Check if we're in a TTY environment (interactive terminal)
    // Disable in CI/CD environments
    this.isTTY = process.stdout.isTTY === true && !process.env.CI;
  }

  /**
   * Start a new spinner
   */
  start(options: SpinnerOptions): this {
    this.startTime = Date.now();

    if (this.isTTY) {
      this.spinner = ora({
        text: options.text,
        color: options.color || 'cyan',
      }).start();
    } else {
      // In CI/CD, just log the text
      console.log(`⠹ ${options.text}`);
    }

    return this;
  }

  /**
   * Mark spinner as successful with timing
   */
  succeed(text?: string, showTiming: boolean = true): this {
    const elapsed = Date.now() - this.startTime;
    const timingText = showTiming ? this.getTimingText(elapsed) : '';
    const finalText = text
      ? showTiming
        ? `${text} ${timingText}`
        : text
      : undefined;

    if (this.isTTY && this.spinner) {
      this.spinner.succeed(finalText);
    } else {
      console.log(`✔ ${finalText || 'Done'}`);
    }

    this.reset();
    return this;
  }

  /**
   * Mark spinner as failed
   */
  fail(text?: string): this {
    const elapsed = Date.now() - this.startTime;
    const finalText = text ? `${text} (${elapsed}ms)` : undefined;

    if (this.isTTY && this.spinner) {
      this.spinner.fail(finalText);
    } else {
      console.log(`✖ ${finalText || 'Failed'}`);
    }

    this.reset();
    return this;
  }

  /**
   * Show info message
   */
  info(text: string): this {
    if (this.isTTY && this.spinner) {
      this.spinner.info(text);
    } else {
      console.log(`ℹ ${text}`);
    }

    this.reset();
    return this;
  }

  /**
   * Show warning message
   */
  warn(text: string): this {
    if (this.isTTY && this.spinner) {
      this.spinner.warn(text);
    } else {
      console.log(`⚠ ${text}`);
    }

    this.reset();
    return this;
  }

  /**
   * Update spinner text (only works in TTY mode)
   */
  updateText(text: string): this {
    if (this.isTTY && this.spinner) {
      this.spinner.text = text;
    }

    return this;
  }

  /**
   * Stop spinner without success/fail
   */
  stop(): this {
    if (this.isTTY && this.spinner) {
      this.spinner.stop();
    }

    this.reset();
    return this;
  }

  /**
   * Get timing text with color coding based on performance
   */
  private getTimingText(
    elapsed: number,
    thresholds: TimingThresholds = DEFAULT_THRESHOLDS
  ): string {
    const timingMs = `(${elapsed}ms)`;

    if (!this.isTTY) {
      // No colors in CI/CD
      return timingMs;
    }

    // Color-code based on performance
    if (elapsed < thresholds.fast) {
      // Fast - green
      return colors.green(timingMs);
    } else if (elapsed < thresholds.moderate) {
      // Moderate - yellow
      return colors.yellow(timingMs);
    } else {
      // Slow - red with warning
      return colors.red(timingMs) + ' ' + colors.yellow('⚠️ Slow');
    }
  }

  /**
   * Reset spinner state
   */
  private reset(): void {
    this.spinner = null;
    this.startTime = 0;
  }

  /**
   * Check if running in TTY mode
   */
  public isInteractive(): boolean {
    return this.isTTY;
  }
}

/**
 * Create a new spinner instance
 */
export function createSpinner(options: SpinnerOptions): SpinnerHelper {
  const spinner = new SpinnerHelper();
  spinner.start(options);
  return spinner;
}

/**
 * Create a spinner helper without starting it
 */
export function getSpinnerHelper(): SpinnerHelper {
  return new SpinnerHelper();
}

export default SpinnerHelper;
