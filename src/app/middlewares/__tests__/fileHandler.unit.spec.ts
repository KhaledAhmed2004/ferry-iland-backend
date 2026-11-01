import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Request, Response, NextFunction } from 'express';
import { StatusCodes } from 'http-status-codes';
import { fileHandler, deleteFile } from '../fileHandler';
import ApiError from '../../../errors/ApiError';

// Hoist mock functions for vitest
const { mockS3Send, mockCloudinaryDestroy } = vi.hoisted(() => ({
  mockS3Send: vi.fn().mockResolvedValue({}),
  mockCloudinaryDestroy: vi.fn().mockResolvedValue({ result: 'ok' }),
}));

// Mock Multer to pass control to the upload callback
vi.mock('multer', () => {
  const multerMock: any = vi.fn(() => ({
    any: vi.fn(() => (req: any, res: any, cb: any) => {
      cb(null);
    }),
  }));
  multerMock.memoryStorage = vi.fn();
  multerMock.diskStorage = vi.fn();

  class MockMulterError extends Error {
    code: string;
    field?: string;
    constructor(code: string, field?: string) {
      super(code);
      this.code = code;
      this.field = field;
    }
  }

  return {
    default: multerMock,
    MulterError: MockMulterError,
  };
});

vi.mock('@aws-sdk/client-s3', () => {
  return {
    S3Client: vi.fn().mockImplementation(function () {
      return { send: mockS3Send };
    }),
    PutObjectCommand: vi.fn().mockImplementation(function (args) {
      return args;
    }),
    DeleteObjectCommand: vi.fn().mockImplementation(function (args) {
      return args;
    }),
  };
});

vi.mock('cloudinary', () => {
  return {
    default: {
      v2: {
        config: vi.fn(),
        uploader: {
          upload_stream: vi.fn((_opts, cb) => ({
            end: vi.fn(_buf => {
              cb(null, {
                secure_url:
                  'https://res.cloudinary.com/test/image/upload/v1/sample.webp',
              });
            }),
          })),
          destroy: mockCloudinaryDestroy,
        },
      },
    },
  };
});

// Mock sharp image processor
vi.mock('sharp', () => {
  return {
    default: vi.fn(() => ({
      resize: vi.fn().mockReturnThis(),
      png: vi.fn().mockReturnThis(),
      webp: vi.fn().mockReturnThis(),
      jpeg: vi.fn().mockReturnThis(),
      toBuffer: vi
        .fn()
        .mockResolvedValue(
          Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
        ),
      toFile: vi.fn().mockResolvedValue({}),
    })),
  };
});

describe('FileHandler Middleware (BDD Test Suite)', () => {
  let req: Partial<Request>;
  let res: Partial<Response>;

  // Helper to execute Express middleware and await next()
  const runMiddleware = (
    middleware: (
      req: Request,
      res: Response,
      next: NextFunction,
    ) => void | Promise<void>,
    reqObj: Partial<Request>,
    resObj: Partial<Response> = {},
  ): Promise<ApiError | Error | undefined> => {
    return new Promise(resolve => {
      const nextFn: NextFunction = (err?: unknown) => {
        resolve(err as ApiError | Error | undefined);
      };
      middleware(reqObj as Request, resObj as Response, nextFn);
    });
  };

  // Helper buffers
  const validPngBuffer = Buffer.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  ]);
  const validPdfBuffer = Buffer.from('%PDF-1.4 test content');
  const spoofedFakeBuffer = Buffer.from('Plain text disguised as an image');

  beforeEach(() => {
    process.env.AWS_S3_BUCKET = 'test-s3-bucket';
    process.env.AWS_REGION = 'us-east-1';
    process.env.BASE_URL = 'http://localhost:5000';

    req = {
      headers: {},
      protocol: 'http',
      get: vi.fn().mockReturnValue('localhost:5000'),
      body: {},
      files: [],
    };
    res = {};
    vi.clearAllMocks();
  });

  // ==========================================
  // 1. CONTENT SIGNATURE & FORMAT VALIDATION
  // ==========================================
  describe('Feature: Multi-Layer Content Validation', () => {
    describe('Given a valid PNG image file', () => {
      it('Then it should pass signature verification and optimize the image', async () => {
        const mockFile: Express.Multer.File = {
          fieldname: 'avatar',
          originalname: 'profile.png',
          encoding: '7bit',
          mimetype: 'image/png',
          buffer: validPngBuffer,
          size: validPngBuffer.length,
          stream: null as any,
          destination: '',
          filename: '',
          path: '',
        };

        req.files = [mockFile];
        const middleware = fileHandler({
          storageMode: 'memory',
          cloudProvider: 's3',
        });

        const error = await runMiddleware(middleware, req, res);

        expect(error).toBeUndefined();
        expect(req.body.avatar).toBeDefined();
        expect(typeof req.body.avatar).toBe('string');
        expect(req.body.avatar).toContain('https://test-s3-bucket.s3');
      });
    });

    describe('Given a file with spoofed MIME type (text content with image/png MIME)', () => {
      it('Then it should reject the upload with 400 Bad Request due to magic-byte mismatch', async () => {
        const spoofedFile: Express.Multer.File = {
          fieldname: 'avatar',
          originalname: 'malicious.png',
          encoding: '7bit',
          mimetype: 'image/png',
          buffer: spoofedFakeBuffer,
          size: spoofedFakeBuffer.length,
          stream: null as any,
          destination: '',
          filename: '',
          path: '',
        };

        req.files = [spoofedFile];
        const middleware = fileHandler({ storageMode: 'memory' });

        const err = await runMiddleware(middleware, req, res);

        expect(err).toBeInstanceOf(ApiError);
        expect((err as ApiError).statusCode).toBe(StatusCodes.BAD_REQUEST);
        expect(err?.message).toContain('Signature verification failed');
      });
    });

    describe('Given a valid PDF document', () => {
      it('Then it should pass signature check and bypass Sharp image processing', async () => {
        const mockPdfFile: Express.Multer.File = {
          fieldname: 'document',
          originalname: 'license.pdf',
          encoding: '7bit',
          mimetype: 'application/pdf',
          buffer: validPdfBuffer,
          size: validPdfBuffer.length,
          stream: null as any,
          destination: '',
          filename: '',
          path: '',
        };

        req.files = [mockPdfFile];
        const middleware = fileHandler({
          storageMode: 'memory',
          cloudProvider: 's3',
        });

        const error = await runMiddleware(middleware, req, res);

        expect(error).toBeUndefined();
        expect(req.body.document).toBeDefined();
        expect(req.body.document).toContain('documents/');
      });
    });
  });

  // ==========================================
  // 2. PATH TRAVERSAL & FILENAME SECURITY
  // ==========================================
  describe('Feature: Filename Sanitization & Path Traversal Immunity', () => {
    describe('Given a client provides a malicious traversal path in originalname', () => {
      it('Then the server must generate a secure, randomized storageKey without the traversal path', async () => {
        const maliciousFile: Express.Multer.File = {
          fieldname: 'avatar',
          originalname: '../../../../etc/passwd.png',
          encoding: '7bit',
          mimetype: 'image/png',
          buffer: validPngBuffer,
          size: validPngBuffer.length,
          stream: null as any,
          destination: '',
          filename: '',
          path: '',
        };

        req.files = [maliciousFile];
        const middleware = fileHandler({
          storageMode: 'memory',
          cloudProvider: 's3',
        });

        const error = await runMiddleware(middleware, req, res);

        expect(error).toBeUndefined();
        expect(req.body.avatar).not.toContain('..');
        expect(req.body.avatar).not.toContain('etc/passwd');
        expect(req.body.avatar).toMatch(/images\/[0-9a-f-]{36}\.png/);
      });
    });
  });

  // ==========================================
  // 3. FIELD POLICY & QUOTA ENFORCEMENT
  // ==========================================
  describe('Feature: Field Policy Enforcement', () => {
    describe('Given a request with an unallowed file field name', () => {
      it('Then it should reject with 400 Bad Request naming the expected fields', async () => {
        const mockFile: Express.Multer.File = {
          fieldname: 'unauthorizedField',
          originalname: 'sample.png',
          encoding: '7bit',
          mimetype: 'image/png',
          buffer: validPngBuffer,
          size: validPngBuffer.length,
          stream: null as any,
          destination: '',
          filename: '',
          path: '',
        };

        req.files = [mockFile];
        const middleware = fileHandler({
          enforceAllowedFields: ['profileImage', 'drivingLicense'],
          storageMode: 'memory',
        });

        const err = await runMiddleware(middleware, req, res);

        expect(err).toBeInstanceOf(ApiError);
        expect((err as ApiError).statusCode).toBe(StatusCodes.BAD_REQUEST);
        expect(err?.message).toContain(
          "Expected field name 'profileImage', 'drivingLicense' but got 'unauthorizedField'",
        );
      });
    });

    describe('Given a field exceeding the configured perFieldMaxCount', () => {
      it('Then it should reject with 400 Bad Request for exceeding file limit', async () => {
        const file1: Express.Multer.File = {
          fieldname: 'avatar',
          originalname: '1.png',
          encoding: '7bit',
          mimetype: 'image/png',
          buffer: validPngBuffer,
          size: validPngBuffer.length,
          stream: null as any,
          destination: '',
          filename: '',
          path: '',
        };
        const file2: Express.Multer.File = {
          fieldname: 'avatar',
          originalname: '2.png',
          encoding: '7bit',
          mimetype: 'image/png',
          buffer: validPngBuffer,
          size: validPngBuffer.length,
          stream: null as any,
          destination: '',
          filename: '',
          path: '',
        };

        req.files = [file1, file2];
        const middleware = fileHandler({
          enforceAllowedFields: ['avatar'],
          perFieldMaxCount: { avatar: 1 },
          storageMode: 'memory',
        });

        const err = await runMiddleware(middleware, req, res);

        expect(err).toBeInstanceOf(ApiError);
        expect((err as ApiError).statusCode).toBe(StatusCodes.BAD_REQUEST);
        expect(err?.message).toContain("Too many files for field 'avatar'");
      });
    });

    describe('Given array/bracket-notated fields (e.g. vehicles[0].image)', () => {
      it('Then it should match the base field rule and process without error', async () => {
        const arrayFieldFile: Express.Multer.File = {
          fieldname: 'vehicles[0].vehicleImage',
          originalname: 'car.png',
          encoding: '7bit',
          mimetype: 'image/png',
          buffer: validPngBuffer,
          size: validPngBuffer.length,
          stream: null as any,
          destination: '',
          filename: '',
          path: '',
        };

        req.files = [arrayFieldFile];
        const middleware = fileHandler({
          enforceAllowedFields: ['vehicleImage'],
          storageMode: 'memory',
        });

        const error = await runMiddleware(middleware, req, res);

        expect(error).toBeUndefined();
        expect(req.body['vehicles[0].vehicleImage']).toBeDefined();
      });
    });
  });

  // ==========================================
  // 4. REQUEST DATA NORMALIZATION
  // ==========================================
  describe('Feature: JSON Data Normalization', () => {
    describe('Given multipart form-data containing a stringified JSON in req.body.data', () => {
      it('Then it should parse it into a JavaScript object in req.body', async () => {
        req.body = {
          data: JSON.stringify({
            name: 'John Doe',
            email: 'john@example.com',
            age: 30,
          }),
        };

        const middleware = fileHandler({ storageMode: 'memory' });
        const error = await runMiddleware(middleware, req, res);

        expect(error).toBeUndefined();
        expect(req.body.name).toBe('John Doe');
        expect(req.body.email).toBe('john@example.com');
        expect(req.body.age).toBe(30);
      });
    });

    describe('Given malformed JSON in req.body.data', () => {
      it('Then it should throw 400 Bad Request for invalid JSON', async () => {
        req.body = { data: '{ invalid_json: ' };

        const middleware = fileHandler({ storageMode: 'memory' });
        const err = await runMiddleware(middleware, req, res);

        expect(err).toBeInstanceOf(ApiError);
        expect((err as ApiError).statusCode).toBe(StatusCodes.BAD_REQUEST);
        expect(err?.message).toContain('Invalid JSON format in "data" field');
      });
    });
  });

  // ==========================================
  // 5. STORAGE DELETION & RETRIEVAL
  // ==========================================
  describe('Feature: File Deletion Utility (deleteFile)', () => {
    describe('Given a canonical storageKey', () => {
      it('Then it should dispatch delete to the provider with the clean storageKey', async () => {
        await deleteFile('images/sample-uuid.webp', { provider: 's3' });

        expect(mockS3Send).toHaveBeenCalledTimes(1);
        const callArg = mockS3Send.mock.calls[0][0];
        expect(callArg.Key).toBe('images/sample-uuid.webp');
      });
    });

    describe('Given a legacy full S3 URL', () => {
      it('Then it should safely extract the storageKey and delete', async () => {
        const legacyUrl =
          'https://test-s3-bucket.s3.us-east-1.amazonaws.com/images/old-photo.jpg';

        await deleteFile(legacyUrl, { provider: 's3' });

        expect(mockS3Send).toHaveBeenCalledTimes(1);
        const callArg = mockS3Send.mock.calls[0][0];
        expect(callArg.Key).toBe('images/old-photo.jpg');
      });
    });

    describe('Given a Cloudflare R2 or Custom Domain URL', () => {
      it('Then it should safely extract the storageKey using the custom domain and delete', async () => {
        const r2Url = 'https://pub-r2.example.com/images/document.pdf';
        await deleteFile(r2Url, { provider: 's3' });

        expect(mockS3Send).toHaveBeenCalledTimes(1);
        const callArg = mockS3Send.mock.calls[0][0];
        expect(callArg.Key).toBe('images/document.pdf');
      });
    });

    describe('Given an empty target string', () => {
      it('Then it should return cleanly without making any network calls', async () => {
        await deleteFile('');
        expect(mockS3Send).not.toHaveBeenCalled();
      });
    });
  });
});

