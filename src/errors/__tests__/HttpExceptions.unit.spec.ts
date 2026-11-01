import { describe, it, expect, vi } from 'vitest';
import { StatusCodes } from 'http-status-codes';
import { Request, Response } from 'express';
import {
  BadRequestException,
  UnauthorizedException,
  ForbiddenException,
  NotFoundException,
  MethodNotAllowedException,
  NotAcceptableException,
  RequestTimeoutException,
  ConflictException,
  GoneException,
  PayloadTooLargeException,
  UnsupportedMediaTypeException,
  UnprocessableEntityException,
  InternalServerErrorException,
  NotImplementedException,
  BadGatewayException,
  ServiceUnavailableException,
  GatewayTimeoutException,
  ApiError,
} from '../index';
import globalErrorHandler from '../../app/middlewares/globalErrorHandler';

describe('NestJS-Style Typed HTTP Exceptions Suite', () => {
  describe('Inheritance, Status Codes & Default Messages', () => {
    const testCases = [
      {
        Class: BadRequestException,
        name: 'BadRequestException',
        expectedStatus: StatusCodes.BAD_REQUEST,
        expectedDefaultMsg: 'Bad Request',
      },
      {
        Class: UnauthorizedException,
        name: 'UnauthorizedException',
        expectedStatus: StatusCodes.UNAUTHORIZED,
        expectedDefaultMsg: 'Unauthorized',
      },
      {
        Class: ForbiddenException,
        name: 'ForbiddenException',
        expectedStatus: StatusCodes.FORBIDDEN,
        expectedDefaultMsg: 'Forbidden',
      },
      {
        Class: NotFoundException,
        name: 'NotFoundException',
        expectedStatus: StatusCodes.NOT_FOUND,
        expectedDefaultMsg: 'Resource not found',
      },
      {
        Class: MethodNotAllowedException,
        name: 'MethodNotAllowedException',
        expectedStatus: StatusCodes.METHOD_NOT_ALLOWED,
        expectedDefaultMsg: 'Method Not Allowed',
      },
      {
        Class: NotAcceptableException,
        name: 'NotAcceptableException',
        expectedStatus: StatusCodes.NOT_ACCEPTABLE,
        expectedDefaultMsg: 'Not Acceptable',
      },
      {
        Class: RequestTimeoutException,
        name: 'RequestTimeoutException',
        expectedStatus: StatusCodes.REQUEST_TIMEOUT,
        expectedDefaultMsg: 'Request Timeout',
      },
      {
        Class: ConflictException,
        name: 'ConflictException',
        expectedStatus: StatusCodes.CONFLICT,
        expectedDefaultMsg: 'Conflict',
      },
      {
        Class: GoneException,
        name: 'GoneException',
        expectedStatus: StatusCodes.GONE,
        expectedDefaultMsg: 'Gone',
      },
      {
        Class: PayloadTooLargeException,
        name: 'PayloadTooLargeException',
        expectedStatus: StatusCodes.REQUEST_TOO_LONG,
        expectedDefaultMsg: 'Payload Too Large',
      },
      {
        Class: UnsupportedMediaTypeException,
        name: 'UnsupportedMediaTypeException',
        expectedStatus: StatusCodes.UNSUPPORTED_MEDIA_TYPE,
        expectedDefaultMsg: 'Unsupported Media Type',
      },
      {
        Class: UnprocessableEntityException,
        name: 'UnprocessableEntityException',
        expectedStatus: StatusCodes.UNPROCESSABLE_ENTITY,
        expectedDefaultMsg: 'Unprocessable Entity',
      },
      {
        Class: InternalServerErrorException,
        name: 'InternalServerErrorException',
        expectedStatus: StatusCodes.INTERNAL_SERVER_ERROR,
        expectedDefaultMsg: 'Internal Server Error',
      },
      {
        Class: NotImplementedException,
        name: 'NotImplementedException',
        expectedStatus: StatusCodes.NOT_IMPLEMENTED,
        expectedDefaultMsg: 'Not Implemented',
      },
      {
        Class: BadGatewayException,
        name: 'BadGatewayException',
        expectedStatus: StatusCodes.BAD_GATEWAY,
        expectedDefaultMsg: 'Bad Gateway',
      },
      {
        Class: ServiceUnavailableException,
        name: 'ServiceUnavailableException',
        expectedStatus: StatusCodes.SERVICE_UNAVAILABLE,
        expectedDefaultMsg: 'Service Unavailable',
      },
      {
        Class: GatewayTimeoutException,
        name: 'GatewayTimeoutException',
        expectedStatus: StatusCodes.GATEWAY_TIMEOUT,
        expectedDefaultMsg: 'Gateway Timeout',
      },
    ];

    testCases.forEach(({ Class, name, expectedStatus, expectedDefaultMsg }) => {
      it(`instantiates ${name} with correct status code, default message, and prototype chain`, () => {
        const exception = new Class();

        expect(exception).toBeInstanceOf(Error);
        expect(exception).toBeInstanceOf(ApiError);
        expect(exception).toBeInstanceOf(Class);
        expect(exception.statusCode).toBe(expectedStatus);
        expect(exception.message).toBe(expectedDefaultMsg);
        expect(exception.name).toBe(name);
      });

      it(`instantiates ${name} with custom message and data payload`, () => {
        const customMsg = `Custom message for ${name}`;
        const payload = { field: 'test_field', attempt: 1 };
        const exception = new Class(customMsg, payload);

        expect(exception.message).toBe(customMsg);
        expect(exception.statusCode).toBe(expectedStatus);
        expect(exception.data).toEqual(payload);
      });
    });
  });

  describe('Integration with globalErrorHandler', () => {
    it('seamlessly formats NotFoundException through globalErrorHandler', () => {
      const jsonMock = vi.fn();
      const statusMock = vi.fn().mockReturnValue({ json: jsonMock });
      const req: Partial<Request> = { originalUrl: '/api/v1/users/42', method: 'GET' };
      const res: Partial<Response> = {
        headersSent: false,
        status: statusMock,
        json: jsonMock,
        locals: {},
      };
      const next = vi.fn();

      const exception = new NotFoundException('User profile not found', { userId: '42' });
      globalErrorHandler(exception, req as Request, res as Response, next);

      expect(statusMock).toHaveBeenCalledWith(StatusCodes.NOT_FOUND);
      expect(jsonMock).toHaveBeenCalledWith({
        success: false,
        message: 'User profile not found',
        errorMessages: [],
        data: { userId: '42' },
        stack: undefined,
      });
    });

    it('seamlessly formats InternalServerErrorException through globalErrorHandler', () => {
      const jsonMock = vi.fn();
      const statusMock = vi.fn().mockReturnValue({ json: jsonMock });
      const req: Partial<Request> = { originalUrl: '/api/v1/system/sync', method: 'POST' };
      const res: Partial<Response> = {
        headersSent: false,
        status: statusMock,
        json: jsonMock,
        locals: {},
      };
      const next = vi.fn();

      const exception = new InternalServerErrorException('Database replica sync failed');
      globalErrorHandler(exception, req as Request, res as Response, next);

      expect(statusMock).toHaveBeenCalledWith(StatusCodes.INTERNAL_SERVER_ERROR);
      expect(jsonMock).toHaveBeenCalledWith({
        success: false,
        message: 'Database replica sync failed',
        errorMessages: [],
        stack: undefined,
      });
    });
  });
});
