import { setServiceLabel, setControllerLabel } from './requestContext';
import { trace, SpanStatusCode } from '@opentelemetry/api';
import { readdirSync, statSync } from 'fs';
import { join } from 'path';
import { LoadOrderValidator } from './loadOrderValidator';
import colors from 'colors';
import config from '../../config';
import { sanitize, safeSerialize, truncate, exceedsSize } from './captureUtils';
import { shouldCapture } from './captureConfig';

// Validate load order
LoadOrderValidator.validate('AUTO_LABEL', [], 'autoLabelBootstrap.ts');
// Register this module as loaded
LoadOrderValidator.markLoaded('AUTO_LABEL', 'autoLabelBootstrap.ts');

const wrapService = (serviceName: string, obj: Record<string, any>) => {
  Object.keys(obj).forEach(key => {
    const original = obj[key];
    if (typeof original === 'function') {
      obj[key] = (...args: any[]) => {
        const label = `${serviceName}.${key}`;
        try { setServiceLabel(label); } catch {}
        const tracer = trace.getTracer('app');
        return tracer.startActiveSpan(`Service: ${label}`, async span => {
          const startTime = Date.now();

          try {
            // 🆕 NEW: Capture arguments
            if (config.tracing?.capture?.enabled && shouldCapture(label)) {
              try {
                const sanitized = sanitize(args, {
                  maskPII: config.tracing.capture.maskPII,
                });
                const truncated = truncate(sanitized, {
                  maxDepth: config.tracing.capture.maxDepth,
                  maxArrayItems: config.tracing.capture.maxArrayItems,
                  maxStringLength: config.tracing.capture.maxStringLength,
                });
                const serialized = safeSerialize(truncated);

                if (!exceedsSize(serialized, config.tracing.capture.maxSizeKB)) {
                  span.setAttribute('function.args', serialized);
                  span.setAttribute('function.args.count', args.length);
                }
              } catch {
                // Silent failure - doesn't affect existing functionality
              }
            }

            // Execute original function
            const out = original(...args);
            if (out && typeof (out as any).then === 'function') {
              const result = await out;

              // 🆕 NEW: Capture return value
              if (config.tracing?.capture?.enabled && shouldCapture(label, Date.now() - startTime)) {
                try {
                  const sanitized = sanitize(result, {
                    maskPII: config.tracing.capture.maskPII,
                  });
                  const truncated = truncate(sanitized, {
                    maxDepth: config.tracing.capture.maxDepth,
                    maxArrayItems: config.tracing.capture.maxArrayItems,
                    maxStringLength: config.tracing.capture.maxStringLength,
                  });
                  const serialized = safeSerialize(truncated);

                  if (!exceedsSize(serialized, config.tracing.capture.maxSizeKB)) {
                    span.setAttribute('function.result', serialized);
                    span.setAttribute('function.result.type', typeof result);
                    if (Array.isArray(result)) {
                      span.setAttribute('function.result.length', result.length);
                    }
                  }
                } catch {
                  // Silent failure
                }
              }

              return result;
            }
            return out;
          } catch (err) {
            span.recordException(err as any);
            span.setStatus({ code: SpanStatusCode.ERROR, message: (err as Error)?.message });
            throw err;
          } finally {
            span.end();
          }
        });
      };
    }
  });
};

const wrapController = (controllerName: string, obj: Record<string, any>) => {
  Object.keys(obj).forEach(key => {
    const original = obj[key];
    if (typeof original === 'function') {
      obj[key] = (...args: any[]) => {
        const label = `${controllerName}.${key}`;
        try { setControllerLabel(label); } catch {}
        const tracer = trace.getTracer('app');
        return tracer.startActiveSpan(`Controller: ${label}`, async span => {
          const startTime = Date.now();

          try {
            // 🆕 NEW: Capture arguments
            if (config.tracing?.capture?.enabled && shouldCapture(label)) {
              try {
                const sanitized = sanitize(args, {
                  maskPII: config.tracing.capture.maskPII,
                });
                const truncated = truncate(sanitized, {
                  maxDepth: config.tracing.capture.maxDepth,
                  maxArrayItems: config.tracing.capture.maxArrayItems,
                  maxStringLength: config.tracing.capture.maxStringLength,
                });
                const serialized = safeSerialize(truncated);

                if (!exceedsSize(serialized, config.tracing.capture.maxSizeKB)) {
                  span.setAttribute('function.args', serialized);
                  span.setAttribute('function.args.count', args.length);
                }
              } catch {
                // Silent failure
              }
            }

            // Execute original function
            const out = original(...args);
            if (out && typeof (out as any).then === 'function') {
              const result = await out;

              // 🆕 NEW: Capture return value
              if (config.tracing?.capture?.enabled && shouldCapture(label, Date.now() - startTime)) {
                try {
                  const sanitized = sanitize(result, {
                    maskPII: config.tracing.capture.maskPII,
                  });
                  const truncated = truncate(sanitized, {
                    maxDepth: config.tracing.capture.maxDepth,
                    maxArrayItems: config.tracing.capture.maxArrayItems,
                    maxStringLength: config.tracing.capture.maxStringLength,
                  });
                  const serialized = safeSerialize(truncated);

                  if (!exceedsSize(serialized, config.tracing.capture.maxSizeKB)) {
                    span.setAttribute('function.result', serialized);
                    span.setAttribute('function.result.type', typeof result);
                    if (Array.isArray(result)) {
                      span.setAttribute('function.result.length', result.length);
                    }
                  }
                } catch {
                  // Silent failure
                }
              }

              return result;
            }
            return out;
          } catch (err) {
            span.recordException(err as any);
            span.setStatus({ code: SpanStatusCode.ERROR, message: (err as Error)?.message });
            throw err;
          } finally {
            span.end();
          }
        });
      };
    }
  });
};

/**
 * Converts filename to PascalCase service/controller name
 * Examples:
 *   auth.service.ts → AuthService
 *   stripe-connect.service.ts → StripeConnectService
 */
const fileNameToExportName = (fileName: string, suffix: 'Service' | 'Controller'): string => {
  const baseName = fileName.replace(new RegExp(`\\.${suffix.toLowerCase()}\\.(ts|js)$`), '');
  const pascalCase = baseName
    .split(/[-_]/)
    .map(part => part.charAt(0).toUpperCase() + part.slice(1))
    .join('');
  return pascalCase + suffix;
};

/**
 * Auto-discover and wrap all services and controllers
 * Scans src/app/modules/* for *.service.ts/js and *.controller.ts/js files
 */
const autoDiscoverAndWrap = (): void => {
  const modulesPath = join(__dirname, '../modules');

  // 🔍 ALWAYS log the path we are scanning to help debug server-side issues
  console.log(colors.cyan(`[AUTO-LABEL] Scanning modules in: ${modulesPath}`));

  let discoveredServices = 0;
  let discoveredControllers = 0;
  const failedFiles: string[] = [];

  try {
    // Check if modules directory exists
    try {
      if (!statSync(modulesPath).isDirectory()) {
        throw new Error('Not a directory');
      }
    } catch (err) {
      console.error(`\n❌ Auto-discovery failed: Modules directory not found at ${modulesPath}`);
      process.exit(1);
    }

    // Get all module directories
    const moduleDirs = readdirSync(modulesPath).filter(item => {
      const itemPath = join(modulesPath, item);
      try {
        return statSync(itemPath).isDirectory();
      } catch {
        return false;
      }
    });

    if (moduleDirs.length === 0) {
      console.warn(colors.yellow(`[AUTO-LABEL] Warning: No module subdirectories found in ${modulesPath}`));
    }

    // Process each module directory
    for (const moduleDir of moduleDirs) {
      const modulePath = join(modulesPath, moduleDir);

      let files: string[];
      try {
        files = readdirSync(modulePath);
      } catch (error) {
        continue; // Skip if can't read directory
      }

      // Auto-discover services (*.service.ts or *.service.js)
      const serviceFiles = files.filter(f => f.endsWith('.service.ts') || f.endsWith('.service.js'));

      for (const serviceFile of serviceFiles) {
        const servicePath = join(modulePath, serviceFile);

        try {
          // Clear require cache for hot reload support
          delete require.cache[require.resolve(servicePath)];

          // Dynamic runtime import (require needed for synchronous loading)
          // Note: We use require() here instead of ES6 import because:
          // 1. We need synchronous loading (await import() would complicate initialization)
          // 2. We need runtime path resolution (file paths are dynamic)
          // 3. We need cache control (delete require.cache for hot reload)
          // eslint-disable-next-line @typescript-eslint/no-var-requires
          const serviceModule = require(servicePath);

          // Try to find the exported service object
          const expectedName = fileNameToExportName(serviceFile, 'Service');
          let serviceObj = serviceModule[expectedName] || serviceModule.default;

          // Fallback: try to find any export with 'Service' in the name
          if (!serviceObj) {
            const keys = Object.keys(serviceModule);
            const serviceKey = keys.find(k => k.includes('Service') && typeof serviceModule[k] === 'object');
            serviceObj = serviceModule[serviceKey || ''];
          }

          // Wrap if valid object found
          if (serviceObj && typeof serviceObj === 'object') {
            wrapService(expectedName, serviceObj);
            discoveredServices++;
          }
        } catch (error) {
          // Graceful error handling for auto-save scenarios
          if (error instanceof SyntaxError) {
            // Silently skip incomplete files during auto-save
            // Will be re-imported on next save when code is complete
          } else if ((error as any).code === 'MODULE_NOT_FOUND') {
            failedFiles.push(`${serviceFile} (dependency missing)`);
          } else {
            failedFiles.push(`${serviceFile} (${(error as Error).message})`);
          }
        }
      }

      // Auto-discover controllers (*.controller.ts or *.controller.js)
      const controllerFiles = files.filter(f => f.endsWith('.controller.ts') || f.endsWith('.controller.js'));

      for (const controllerFile of controllerFiles) {
        const controllerPath = join(modulePath, controllerFile);

        try {
          // Clear require cache for hot reload support
          delete require.cache[require.resolve(controllerPath)];

          // Dynamic runtime import (same rationale as services above)
          // eslint-disable-next-line @typescript-eslint/no-var-requires
          const controllerModule = require(controllerPath);

          // Try to find the exported controller object
          const expectedName = fileNameToExportName(controllerFile, 'Controller');
          let controllerObj = controllerModule[expectedName] || controllerModule.default;

          // Fallback: try to find any export with 'Controller' in the name
          if (!controllerObj) {
            const keys = Object.keys(controllerModule);
            const controllerKey = keys.find(k => k.includes('Controller') && typeof controllerModule[k] === 'object');
            controllerObj = controllerModule[controllerKey || ''];
          }

          // Wrap if valid object found
          if (controllerObj && typeof controllerObj === 'object') {
            wrapController(expectedName, controllerObj);
            discoveredControllers++;
          }
        } catch (error) {
          // Graceful error handling for auto-save scenarios
          if (error instanceof SyntaxError) {
            // Silently skip incomplete files during auto-save
            // Will be re-imported on next save when code is complete
          } else if ((error as any).code === 'MODULE_NOT_FOUND') {
            failedFiles.push(`${controllerFile} (dependency missing)`);
          } else {
            failedFiles.push(`${controllerFile} (${(error as Error).message})`);
          }
        }
      }
    }

    // Log summary with beautiful box
    const totalModules = discoveredServices + discoveredControllers;
    console.log('\n' + colors.cyan.bold('╔═══════════════════════════════════════════════════════════╗'));
    console.log(colors.cyan.bold('║') + colors.cyan.bold('              🎉 AUTO-LABELING COMPLETE                 ') + colors.cyan.bold('║'));
    console.log(colors.cyan.bold('╠═══════════════════════════════════════════════════════════╣'));
    console.log(colors.cyan.bold('║') + `  Services Wrapped       │ ${colors.green.bold(discoveredServices.toString()).padEnd(34)}` + colors.cyan.bold('║'));
    console.log(colors.cyan.bold('║') + `  Controllers Wrapped    │ ${colors.green.bold(discoveredControllers.toString()).padEnd(34)}` + colors.cyan.bold('║'));
    console.log(colors.cyan.bold('║') + `  Total Modules          │ ${colors.green.bold(totalModules.toString()).padEnd(34)}` + colors.cyan.bold('║'));
    console.log(colors.cyan.bold('╚═══════════════════════════════════════════════════════════╝\n'));

    // Show warnings for failed files (only real errors, not syntax errors)
    if (failedFiles.length > 0) {
      console.log(colors.yellow.bold('╔═══════════════════════════════════════════════════════════╗'));
      console.log(colors.yellow.bold('║') + colors.yellow.bold('              ⚠️  FAILED TO LOAD                         ') + colors.yellow.bold('║'));
      console.log(colors.yellow.bold('╠═══════════════════════════════════════════════════════════╣'));
      failedFiles.forEach(file => {
        const truncated = file.length > 57 ? file.substring(0, 54) + '...' : file;
        console.log(colors.yellow.bold('║') + colors.gray(`  • ${truncated.padEnd(57)}`) + colors.yellow.bold('║'));
      });
      console.log(colors.yellow.bold('╚═══════════════════════════════════════════════════════════╝\n'));
    }

    // Validation: Fail startup if no modules discovered
    if (discoveredServices === 0 && discoveredControllers === 0) {
      console.error(colors.red.bold('\n❌ AUTO-DISCOVERY FAILED: No services or controllers found!'));
      console.error(colors.yellow(`   Searched in: ${modulesPath}`));
      console.error(colors.gray('   Expected structure: modules/{{moduleName}}/{{moduleName}}.service.[ts|js]'));
      console.error(colors.gray('   Hint: Ensure your files are named correctly and exported as objects.'));
      process.exit(1);
    }

  } catch (error) {
    console.error('\n❌ Auto-discovery error:', error);
    process.exit(1);
  }
};

// Execute auto-discovery immediately (skip in test environment)
if (process.env.NODE_ENV !== 'test') {
  autoDiscoverAndWrap();
}
