# NestJS-Style Typed HTTP Exceptions Implementation Plan

> **Goal:** Introduce first-class, NestJS-style typed exception classes (`NotFoundException`, `BadRequestException`, `UnauthorizedException`, `ForbiddenException`, `ConflictException`, etc.) extending `ApiError` so controllers and services can throw semantic errors cleanly without hardcoding HTTP status codes.

**Architecture:** 
- All custom HTTP exceptions inherit from the base `ApiError` class.
- Since `globalErrorHandler.ts` already checks `error instanceof ApiError`, zero modifications are required in the global error handler—it automatically recognizes all subclasses with 100% backward compatibility.
- Central barrel export via `src/errors/index.ts` for clean, one-line imports across the app.

**Tech Stack:** TypeScript, Express.js, `http-status-codes`, Vitest.

---

## Proposed Tasks Breakdown

### Task 1: Create Typed HTTP Exceptions (`src/errors/HttpExceptions.ts`)
**Files:**
- Create: `src/errors/HttpExceptions.ts`

**Specification:**
Create standard NestJS-aligned semantic exception classes:
- `BadRequestException` (400)
- `UnauthorizedException` (401)
- `ForbiddenException` (403)
- `NotFoundException` (404)
- `ConflictException` (409)
- `GoneException` (410)
- `UnprocessableEntityException` (422)
- `InternalServerException` (500)
- `NotImplementedException` (501)
- `BadGatewayException` (502)
- `ServiceUnavailableException` (503)

Each class will accept:
```typescript
constructor(message = '<Default Meaningful Message>', data?: Record<string, unknown>)
```
And delegate to `super(statusCode, message, '', data)`.

---

### Task 2: Create Central Barrel Export (`src/errors/index.ts`)
**Files:**
- Create: `src/errors/index.ts`

**Specification:**
Export all exception classes and error handlers cleanly:
```typescript
export * from './HttpExceptions';
export { default as ApiError } from './ApiError';
export { default as handleZodError } from './handleZodError';
export { default as handleValidationError } from './handleValidationError';
export { default as handleCastError } from './handleCastError';
```

---

### Task 3: Unit Testing Suite for Exceptions (`src/errors/__tests__/HttpExceptions.unit.spec.ts`)
**Files:**
- Create: `src/errors/__tests__/HttpExceptions.unit.spec.ts`

**Test Cases:**
1. Verifies each exception is an `instanceof ApiError` and `instanceof Error`.
2. Verifies correct default status codes (e.g. 404 for `NotFoundException`, 401 for `UnauthorizedException`).
3. Verifies default message vs custom message override.
4. Verifies optional `data` payload attachment.
5. Verifies integration with `globalErrorHandler` ensures status code, message, and `data` are serialized as expected.

---

### Task 4: Pilot Refactoring on a Service Module
**Files:**
- Example Target: `src/app/modules/user/user.service.ts` (or `src/app/modules/session/session.service.ts`)

**Before:**
```typescript
throw new ApiError(StatusCodes.NOT_FOUND, 'User not found');
throw new ApiError(StatusCodes.BAD_REQUEST, 'Incorrect password');
throw new ApiError(StatusCodes.CONFLICT, 'Email already in use');
```

**After:**
```typescript
throw new NotFoundException('User not found');
throw new BadRequestException('Incorrect password');
throw new ConflictException('Email already in use');
```

---

### Task 5: Verification & Full Regression Testing
**Commands:**
- `npx vitest run src/errors/__tests__/HttpExceptions.unit.spec.ts`
- `npx tsc --noEmit`
- `npx vitest run` (ensure all 9+ test suites remain 100% green)
