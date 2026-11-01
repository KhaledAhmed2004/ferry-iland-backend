import { StatusCodes } from 'http-status-codes';
import ApiError from './ApiError';

/**
 * NestJS-style Typed HTTP Exceptions for Express.js.
 * All exceptions inherit from ApiError to ensure 100% backward compatibility
 * with existing globalErrorHandler and response envelope contracts.
 */

export class BadRequestException extends ApiError {
  constructor(message = 'Bad Request', data?: Record<string, unknown>) {
    super(StatusCodes.BAD_REQUEST, message, '', data);
    this.name = 'BadRequestException';
  }
}

export class UnauthorizedException extends ApiError {
  constructor(message = 'Unauthorized', data?: Record<string, unknown>) {
    super(StatusCodes.UNAUTHORIZED, message, '', data);
    this.name = 'UnauthorizedException';
  }
}

export class ForbiddenException extends ApiError {
  constructor(message = 'Forbidden', data?: Record<string, unknown>) {
    super(StatusCodes.FORBIDDEN, message, '', data);
    this.name = 'ForbiddenException';
  }
}

export class NotFoundException extends ApiError {
  constructor(message = 'Resource not found', data?: Record<string, unknown>) {
    super(StatusCodes.NOT_FOUND, message, '', data);
    this.name = 'NotFoundException';
  }
}

export class MethodNotAllowedException extends ApiError {
  constructor(message = 'Method Not Allowed', data?: Record<string, unknown>) {
    super(StatusCodes.METHOD_NOT_ALLOWED, message, '', data);
    this.name = 'MethodNotAllowedException';
  }
}

export class NotAcceptableException extends ApiError {
  constructor(message = 'Not Acceptable', data?: Record<string, unknown>) {
    super(StatusCodes.NOT_ACCEPTABLE, message, '', data);
    this.name = 'NotAcceptableException';
  }
}

export class RequestTimeoutException extends ApiError {
  constructor(message = 'Request Timeout', data?: Record<string, unknown>) {
    super(StatusCodes.REQUEST_TIMEOUT, message, '', data);
    this.name = 'RequestTimeoutException';
  }
}

export class ConflictException extends ApiError {
  constructor(message = 'Conflict', data?: Record<string, unknown>) {
    super(StatusCodes.CONFLICT, message, '', data);
    this.name = 'ConflictException';
  }
}

export class GoneException extends ApiError {
  constructor(message = 'Gone', data?: Record<string, unknown>) {
    super(StatusCodes.GONE, message, '', data);
    this.name = 'GoneException';
  }
}

export class PayloadTooLargeException extends ApiError {
  constructor(message = 'Payload Too Large', data?: Record<string, unknown>) {
    super(StatusCodes.REQUEST_TOO_LONG, message, '', data);
    this.name = 'PayloadTooLargeException';
  }
}

export class UnsupportedMediaTypeException extends ApiError {
  constructor(message = 'Unsupported Media Type', data?: Record<string, unknown>) {
    super(StatusCodes.UNSUPPORTED_MEDIA_TYPE, message, '', data);
    this.name = 'UnsupportedMediaTypeException';
  }
}

export class UnprocessableEntityException extends ApiError {
  constructor(message = 'Unprocessable Entity', data?: Record<string, unknown>) {
    super(StatusCodes.UNPROCESSABLE_ENTITY, message, '', data);
    this.name = 'UnprocessableEntityException';
  }
}

export class InternalServerErrorException extends ApiError {
  constructor(message = 'Internal Server Error', data?: Record<string, unknown>) {
    super(StatusCodes.INTERNAL_SERVER_ERROR, message, '', data);
    this.name = 'InternalServerErrorException';
  }
}

export class NotImplementedException extends ApiError {
  constructor(message = 'Not Implemented', data?: Record<string, unknown>) {
    super(StatusCodes.NOT_IMPLEMENTED, message, '', data);
    this.name = 'NotImplementedException';
  }
}

export class BadGatewayException extends ApiError {
  constructor(message = 'Bad Gateway', data?: Record<string, unknown>) {
    super(StatusCodes.BAD_GATEWAY, message, '', data);
    this.name = 'BadGatewayException';
  }
}

export class ServiceUnavailableException extends ApiError {
  constructor(message = 'Service Unavailable', data?: Record<string, unknown>) {
    super(StatusCodes.SERVICE_UNAVAILABLE, message, '', data);
    this.name = 'ServiceUnavailableException';
  }
}

export class GatewayTimeoutException extends ApiError {
  constructor(message = 'Gateway Timeout', data?: Record<string, unknown>) {
    super(StatusCodes.GATEWAY_TIMEOUT, message, '', data);
    this.name = 'GatewayTimeoutException';
  }
}
