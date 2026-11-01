import { ZodError } from 'zod';
import { IErrorMessage } from '../types/errors.types';
import { closest } from 'fastest-levenshtein';

// Clean the path (always returns string)
const cleanPath = (pathArray: (string | number)[]): string =>
  pathArray.join('.').replace(/^body\./, '');

const handleZodError = (
  error: any,
): { statusCode: number; message: string; errorMessages: IErrorMessage[] } => {
  const allErrorMessages: IErrorMessage[] = [];
  const missingFields: string[] = [];
  const coveredFields: string[] = [];

  // Collect expected fields for suggestions
  const expectedFields: string[] = Array.from(
    new Set(
      (error.issues || error.errors || [])
        .flatMap((issue: any) => {
          if (issue.code === 'invalid_type' && issue.path && issue.path.length > 0) {
            const field = issue.path[issue.path.length - 1];
            return field ? [String(field)] : [];
          }
          return [];
        })
        .filter(Boolean),
    ),
  );

  // Single pass over all Zod issues
  (error.issues || error.errors || []).forEach((issue: any) => {
    switch (issue.code) {
      case 'unrecognized_keys': {
        const unrec = issue as any;
        (unrec.keys || []).forEach((key: any) => {
          const cleanKey = key.replace(/^body\./, '');
          const suggestion = closest(cleanKey, expectedFields);
          if (suggestion) coveredFields.push(suggestion);
          allErrorMessages.push({
            path: cleanKey,
            message: suggestion
              ? `We don't recognize '${cleanKey}'. Did you mean '${suggestion}'?`
              : `We don't recognize '${cleanKey}'.`,
          });
        });
        break;
      }

      case 'invalid_type': {
        const invalid = issue as any;
        const path = cleanPath(invalid.path);

        const received =
          invalid.received ??
          (typeof invalid.message === 'string' &&
          invalid.message.includes('received undefined')
            ? 'undefined'
            : (invalid.message?.match(/received\s+([a-zA-Z0-9_]+)/)?.[1] ?? undefined));

        if (received === 'undefined') {
          // Missing field
          missingFields.push(path);
        } else {
          // Type mismatch
          allErrorMessages.push({
            path,
            message: `Expected ${invalid.expected} for '${path}', but received ${received || 'invalid value'}.`,
          });
        }
        break;
      }

      default:
        allErrorMessages.push({
          path: cleanPath(issue.path) || 'unknown',
          message: issue.message,
        });
        break;
    }
  });

  // Add missing fields that are not covered by typo suggestions
  missingFields.forEach(field => {
    if (!coveredFields.includes(field)) {
      allErrorMessages.push({
        path: field,
        message: `Missing required field '${field}'.`,
      });
    }
  });

  return {
    statusCode: 400,
    message: 'Validation Error',
    errorMessages: allErrorMessages,
  };
};

export default handleZodError;
