/**
 * Load Order Validator
 *
 * Ensures critical modules are loaded in the correct order.
 * This prevents subtle bugs caused by importing modules before their dependencies.
 *
 * Critical Load Order:
 * 1. mongooseMetrics - MUST load before any Mongoose models compile
 * 2. autoLabelBootstrap - MUST load before controllers/services are imported
 * 3. opentelemetry - Should load early for instrumentation
 * 4. Third-party patches (bcrypt, JWT, Stripe) - Before their usage
 * 5. Routes - Load AFTER all patches and auto-labeling
 */

type LoadStage =
  | 'MONGOOSE_METRICS'
  | 'AUTO_LABEL'
  | 'OPENTELEMETRY'
  | 'PATCHES'
  | 'ROUTES'
  | 'MODELS';

class LoadOrderValidator {
  private static loadedStages = new Set<LoadStage>();
  private static errors: string[] = [];

  /**
   * Register that a stage has been loaded
   */
  static markLoaded(stage: LoadStage, modulePath: string): void {
    this.loadedStages.add(stage);

    // Log in development for visibility
    if (process.env.NODE_ENV === 'development') {
      console.log(`✓ Load Stage [${stage}]: ${modulePath}`);
    }
  }

  /**
   * Validate that required stages were loaded before this stage
   */
  static validate(
    currentStage: LoadStage,
    requiredStages: LoadStage[],
    currentModulePath: string
  ): void {
    const missing = requiredStages.filter(stage => !this.loadedStages.has(stage));

    if (missing.length > 0) {
      const error = [
        `\n❌ LOAD ORDER VIOLATION in ${currentModulePath}`,
        `   Current stage: ${currentStage}`,
        `   Missing required stages: ${missing.join(', ')}`,
        `\n   Correct order should be:`,
        `   1. MONGOOSE_METRICS (mongooseMetrics.ts)`,
        `   2. AUTO_LABEL (autoLabelBootstrap.ts)`,
        `   3. OPENTELEMETRY (opentelemetry.ts)`,
        `   4. PATCHES (patchBcrypt.ts, patchJWT.ts, patchStripe.ts)`,
        `   5. ROUTES (routes/index.ts)`,
        `   6. MODELS (after mongooseMetrics)`,
        `\n   See CLAUDE.md for detailed explanation.`,
      ].join('\n');

      this.errors.push(error);
      console.error(error);

      // Fail fast in production to prevent subtle bugs
      if (process.env.NODE_ENV === 'production') {
        console.error('\n🚨 Application startup aborted due to load order violation.');
        process.exit(1);
      } else {
        // In development, warn but continue (for easier debugging)
        console.warn('\n⚠️  Continuing in development mode, but this WILL fail in production!');
      }
    }
  }

  /**
   * Get all validation errors
   */
  static getErrors(): string[] {
    return this.errors;
  }

  /**
   * Check if a stage has been loaded
   */
  static isLoaded(stage: LoadStage): boolean {
    return this.loadedStages.has(stage);
  }

  /**
   * Get all loaded stages (for debugging)
   */
  static getLoadedStages(): LoadStage[] {
    return Array.from(this.loadedStages);
  }

  /**
   * Print load order summary
   */
  static printSummary(): void {
    if (process.env.NODE_ENV === 'development') {
      console.log('\n📦 Load Order Summary:');
      console.log('   Loaded stages:', this.getLoadedStages().join(' → '));

      if (this.errors.length > 0) {
        console.log(`\n   ⚠️  ${this.errors.length} validation error(s) detected`);
      } else {
        console.log('   ✅ All stages loaded in correct order');
      }
    }
  }
}

export { LoadOrderValidator, LoadStage };
