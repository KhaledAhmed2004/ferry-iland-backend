import { Request, Response, NextFunction } from 'express';
import multer, { FileFilterCallback } from 'multer';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import sharp from 'sharp';
import { StatusCodes } from 'http-status-codes';
import ApiError from '../../errors/ApiError';
import {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
} from '@aws-sdk/client-s3';
import cloudinary from 'cloudinary';
import config from '../../config';

export type IFolderName = 'images' | 'media' | 'documents';
export type StorageProviderName = 's3' | 'cloudinary' | 'local';

export type UploadResult = {
  storageKey: string;
  provider: StorageProviderName;
  mimeType: string;
  size: number;
  url?: string;
  checksum?: string;
  originalName?: string;
};

export type FileHandlerOptions = {
  storageMode?: 'local' | 'memory';
  cloudProvider?: 's3' | 'cloudinary';
  maxFileSizeMB?: number;
  baseUrl?: string;
  maxFilesTotal?: number;
  enforceAllowedFields?: string[];
  perFieldMaxCount?: Record<string, number>;
  imageMaxWidth?: number;
};

export type DeleteFileOptions = {
  provider?: StorageProviderName;
};

export type StorageProvider = {
  upload: (
    fileBuffer: Buffer,
    storageKey: string,
    targetFolder: IFolderName,
    mimeType: string,
  ) => Promise<string>;
  delete: (storageKey: string) => Promise<void>;
};

type FieldRuleDefinition = string | { name: string; maxCount?: number };

const ALLOWED_MIME_TYPES_BY_FOLDER: Record<IFolderName, string[]> = {
  images: ['image/jpeg', 'image/png', 'image/jpg', 'image/webp'],
  media: [
    'video/mp4',
    'video/webm',
    'audio/mpeg',
    'audio/ogg',
    'audio/wav',
    'audio/webm',
    'audio/mp4',
  ],
  documents: ['application/pdf'],
};

const DEFAULT_CATEGORY_SIZE_LIMITS_MB: Record<IFolderName, number> = {
  images: 10,
  documents: 25,
  media: 50,
};

const ALLOWED_EXTENSIONS_BY_FOLDER: Record<IFolderName, string[]> = {
  images: ['.jpg', '.jpeg', '.png', '.webp'],
  documents: ['.pdf'],
  media: ['.mp4', '.webm', '.mp3', '.ogg', '.wav'],
};

const PNG_MAGIC_BYTES = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const WEBM_MAGIC_BYTES = [0x1a, 0x45, 0xdf, 0xa3];

const isValidPngSignature = (fileBuffer: Buffer): boolean => {
  if (fileBuffer.length < PNG_MAGIC_BYTES.length) {
    return false;
  }
  return PNG_MAGIC_BYTES.every(
    (expectedByte, byteIndex) => fileBuffer[byteIndex] === expectedByte,
  );
};

const isValidJpegSignature = (fileBuffer: Buffer): boolean => {
  return (
    fileBuffer.length >= 3 &&
    fileBuffer[0] === 0xff &&
    fileBuffer[1] === 0xd8 &&
    fileBuffer[2] === 0xff
  );
};

const isValidWebpSignature = (fileBuffer: Buffer): boolean => {
  if (fileBuffer.length < 12) {
    return false;
  }
  const riffContainerIdentifier = fileBuffer.toString('ascii', 0, 4);
  const webpFormatIdentifier = fileBuffer.toString('ascii', 8, 12);
  return riffContainerIdentifier === 'RIFF' && webpFormatIdentifier === 'WEBP';
};

const isValidPdfSignature = (fileBuffer: Buffer): boolean => {
  if (fileBuffer.length < 5) {
    return false;
  }
  return fileBuffer.toString('ascii', 0, 5).startsWith('%PDF-');
};

const isValidMp4OrM4aSignature = (fileBuffer: Buffer): boolean => {
  if (fileBuffer.length < 8) {
    return false;
  }
  return fileBuffer.toString('ascii', 4, 8) === 'ftyp';
};

const isValidWebmSignature = (fileBuffer: Buffer): boolean => {
  if (fileBuffer.length < WEBM_MAGIC_BYTES.length) {
    return false;
  }
  return WEBM_MAGIC_BYTES.every(
    (expectedByte, byteIndex) => fileBuffer[byteIndex] === expectedByte,
  );
};

const isValidMp3Signature = (fileBuffer: Buffer): boolean => {
  if (fileBuffer.length < 3) {
    return false;
  }
  const hasId3Tag = fileBuffer.toString('ascii', 0, 3) === 'ID3';
  const hasMpegAudioFrameSync =
    fileBuffer[0] === 0xff && (fileBuffer[1] & 0xe0) === 0xe0;
  return hasId3Tag || hasMpegAudioFrameSync;
};

const isValidWavSignature = (fileBuffer: Buffer): boolean => {
  if (fileBuffer.length < 12) {
    return false;
  }
  const riffIdentifier = fileBuffer.toString('ascii', 0, 4);
  const waveIdentifier = fileBuffer.toString('ascii', 8, 12);
  return riffIdentifier === 'RIFF' && waveIdentifier === 'WAVE';
};

const isValidOggSignature = (fileBuffer: Buffer): boolean => {
  if (fileBuffer.length < 4) {
    return false;
  }
  return fileBuffer.toString('ascii', 0, 4) === 'OggS';
};

const hasValidFileSignature = (
  fileBuffer: Buffer,
  declaredMimeType: string,
): boolean => {
  if (fileBuffer.length < 4) {
    return false;
  }

  if (declaredMimeType === 'image/png') {
    return isValidPngSignature(fileBuffer);
  }

  if (declaredMimeType === 'image/jpeg' || declaredMimeType === 'image/jpg') {
    return isValidJpegSignature(fileBuffer);
  }

  if (declaredMimeType === 'image/webp') {
    return isValidWebpSignature(fileBuffer);
  }

  if (declaredMimeType === 'application/pdf') {
    return isValidPdfSignature(fileBuffer);
  }

  if (declaredMimeType === 'video/mp4' || declaredMimeType === 'audio/mp4') {
    return isValidMp4OrM4aSignature(fileBuffer);
  }

  if (declaredMimeType === 'video/webm' || declaredMimeType === 'audio/webm') {
    return isValidWebmSignature(fileBuffer);
  }

  if (declaredMimeType === 'audio/mpeg') {
    return isValidMp3Signature(fileBuffer);
  }

  if (declaredMimeType === 'audio/wav') {
    return isValidWavSignature(fileBuffer);
  }

  if (declaredMimeType === 'audio/ogg') {
    return isValidOggSignature(fileBuffer);
  }

  return false;
};

const ensureDirectoryExists = async (directoryPath: string): Promise<void> => {
  await fs.promises.mkdir(directoryPath, { recursive: true });
};

const resolveFolderByMimeType = (mimeType: string): IFolderName => {
  if (mimeType.startsWith('image/')) {
    return 'images';
  }
  if (mimeType.startsWith('video/') || mimeType.startsWith('audio/')) {
    return 'media';
  }
  if (mimeType === 'application/pdf') {
    return 'documents';
  }
  throw new ApiError(
    StatusCodes.BAD_REQUEST,
    `Unsupported file type '${mimeType}'`,
  );
};

const generateUniqueStorageKey = (
  targetFolder: IFolderName,
  rawFileExtension: string,
): string => {
  const normalizedExtension = rawFileExtension.startsWith('.')
    ? rawFileExtension.toLowerCase()
    : `.${rawFileExtension.toLowerCase()}`;
  const randomIdentifier = crypto.randomUUID();
  return `${targetFolder}/${randomIdentifier}${normalizedExtension}`;
};

export const s3 = new S3Client({
  region: config.r2?.accountId ? 'auto' : process.env.AWS_REGION || 'us-east-1',
  endpoint: config.r2?.s3ApiUrl
    ? config.r2.s3ApiUrl
    : config.r2?.accountId
      ? `https://${config.r2.accountId}.r2.cloudflarestorage.com`
      : undefined,
  credentials: {
    accessKeyId: config.r2?.accessKeyId || process.env.AWS_ACCESS_KEY_ID || '',
    secretAccessKey:
      config.r2?.secretAccessKey || process.env.AWS_SECRET_ACCESS_KEY || '',
  },
});

const buildS3PublicUrl = (storageKey: string, bucketName: string): string => {
  if (config.r2?.customDomain) {
    const formattedDomain = config.r2.customDomain.replace(/\/$/, '');
    return `${formattedDomain}/${storageKey}`;
  }

  if (config.r2?.accountId) {
    return `https://${config.r2.accountId}.r2.cloudflarestorage.com/${bucketName}/${storageKey}`;
  }

  const configuredRegion = process.env.AWS_REGION || 'us-east-1';
  return `https://${bucketName}.s3.${configuredRegion}.amazonaws.com/${storageKey}`;
};

const s3StorageProvider: StorageProvider = {
  upload: async (fileBuffer, storageKey, _targetFolder, mimeType) => {
    const bucketName = config.r2?.bucketName || process.env.AWS_S3_BUCKET || '';
    if (!bucketName) {
      throw new ApiError(
        StatusCodes.INTERNAL_SERVER_ERROR,
        'AWS S3 / Cloudflare R2 Bucket configuration is missing',
      );
    }

    await s3.send(
      new PutObjectCommand({
        Bucket: bucketName,
        Key: storageKey,
        Body: fileBuffer,
        ContentType: mimeType,
      }),
    );

    return buildS3PublicUrl(storageKey, bucketName);
  },
  delete: async storageKey => {
    const bucketName = config.r2?.bucketName || process.env.AWS_S3_BUCKET || '';
    if (!bucketName) {
      return;
    }
    await s3.send(
      new DeleteObjectCommand({
        Bucket: bucketName,
        Key: storageKey,
      }),
    );
  },
};

cloudinary.v2.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME || '',
  api_key: process.env.CLOUDINARY_API_KEY || '',
  api_secret: process.env.CLOUDINARY_API_SECRET || '',
});

const cloudinaryStorageProvider: StorageProvider = {
  upload: async (fileBuffer, storageKey, targetFolder, _mimeType) => {
    const publicId = path.basename(storageKey).replace(/\.[^/.]+$/, '');

    const uploadResult = await new Promise<cloudinary.UploadApiResponse>(
      (resolve, reject) => {
        const uploadStream = cloudinary.v2.uploader.upload_stream(
          {
            folder: targetFolder,
            resource_type: 'auto',
            public_id: publicId,
          },
          (error, response) => {
            if (error || !response) {
              reject(error || new Error('Upload failed'));
            } else {
              resolve(response);
            }
          },
        );

        uploadStream.end(fileBuffer);
      },
    );

    return uploadResult.secure_url;
  },
  delete: async storageKey => {
    const publicId = storageKey.replace(/\.[^/.]+$/, '');
    await cloudinary.v2.uploader.destroy(publicId, {
      resource_type: 'auto',
    });
  },
};

const localStorageProvider: StorageProvider = {
  upload: async (fileBuffer, storageKey, _targetFolder, _mimeType) => {
    const localDestinationPath = path.join(process.cwd(), 'uploads', storageKey);
    const destinationDirectory = path.dirname(localDestinationPath);
    await ensureDirectoryExists(destinationDirectory);
    await fs.promises.writeFile(localDestinationPath, fileBuffer);
    return `/uploads/${storageKey}`;
  },
  delete: async storageKey => {
    const localDestinationPath = path.join(process.cwd(), 'uploads', storageKey);
    try {
      await fs.promises.unlink(localDestinationPath);
    } catch {
      return;
    }
  },
};

const STORAGE_PROVIDERS: Record<StorageProviderName, StorageProvider> = {
  s3: s3StorageProvider,
  cloudinary: cloudinaryStorageProvider,
  local: localStorageProvider,
};

const optimizeImageBuffer = async (
  rawImageBuffer: Buffer,
  mimeType: string,
  maxWidth: number,
): Promise<{ buffer: Buffer; mimeType: string }> => {
  let sharpInstance = sharp(rawImageBuffer).resize({
    width: maxWidth,
    withoutEnlargement: true,
  });

  let outputMimeType = mimeType;

  if (mimeType === 'image/png') {
    sharpInstance = sharpInstance.png({ compressionLevel: 8, palette: true });
  } else if (mimeType === 'image/webp') {
    sharpInstance = sharpInstance.webp({ quality: 80 });
  } else {
    sharpInstance = sharpInstance.jpeg({ quality: 80 });
    outputMimeType = 'image/jpeg';
  }

  const optimizedBuffer = await sharpInstance.toBuffer();
  return { buffer: optimizedBuffer, mimeType: outputMimeType };
};

const prepareFileBuffer = async (
  uploadedFile: Express.Multer.File,
  storageMode: 'local' | 'memory',
  imageMaxWidth: number,
): Promise<{ buffer: Buffer; mimeType: string }> => {
  const fileBuffer =
    storageMode === 'memory'
      ? uploadedFile.buffer
      : await fs.promises.readFile(uploadedFile.path);

  const isValidSignature = hasValidFileSignature(
    fileBuffer,
    uploadedFile.mimetype,
  );
  if (!isValidSignature) {
    throw new ApiError(
      StatusCodes.BAD_REQUEST,
      `File content does not match declared format '${uploadedFile.mimetype}' (Signature verification failed)`,
    );
  }

  const isImageFile = uploadedFile.mimetype.startsWith('image/');
  if (isImageFile) {
    const { buffer: optimizedBuffer, mimeType: outputMimeType } =
      await optimizeImageBuffer(
        fileBuffer,
        uploadedFile.mimetype,
        imageMaxWidth,
      );

    if (storageMode === 'local' && uploadedFile.path) {
      await fs.promises.writeFile(uploadedFile.path, optimizedBuffer);
    }

    return { buffer: optimizedBuffer, mimeType: outputMimeType };
  }

  return { buffer: fileBuffer, mimeType: uploadedFile.mimetype };
};

const createMulterStorageEngine = (storageMode: 'local' | 'memory') => {
  if (storageMode === 'memory') {
    return multer.memoryStorage();
  }

  const baseUploadDirectory = path.join(process.cwd(), 'uploads');
  ensureDirectoryExists(path.join(baseUploadDirectory, 'images')).catch(() => {});
  ensureDirectoryExists(path.join(baseUploadDirectory, 'media')).catch(() => {});
  ensureDirectoryExists(path.join(baseUploadDirectory, 'documents')).catch(() => {});

  return multer.diskStorage({
    destination: (_req, file, callback) => {
      const canonicalFolder = resolveFolderByMimeType(file.mimetype);
      const destinationFolder = path.join(baseUploadDirectory, canonicalFolder);
      callback(null, destinationFolder);
    },
    filename: (_req, file, callback) => {
      const extension = path.extname(file.originalname).toLowerCase();
      const uniqueFilename = `${crypto.randomUUID()}${extension}`;
      callback(null, uniqueFilename);
    },
  });
};

const validateIncomingFile = (
  _req: Request,
  file: Express.Multer.File,
  callback: FileFilterCallback,
) => {
  let targetFolder: IFolderName;
  try {
    targetFolder = resolveFolderByMimeType(file.mimetype);
  } catch (error) {
    const errorMessage =
      (error as Error).message || 'Unsupported file type';
    return callback(new ApiError(StatusCodes.BAD_REQUEST, errorMessage));
  }

  const allowedMimeTypes = ALLOWED_MIME_TYPES_BY_FOLDER[targetFolder];
  const isMimeTypePermitted = allowedMimeTypes?.includes(file.mimetype);
  if (!isMimeTypePermitted) {
    const permittedMimesList = allowedMimeTypes?.join(', ') || 'none';
    return callback(
      new ApiError(
        StatusCodes.BAD_REQUEST,
        `Invalid MIME type '${file.mimetype}'. Allowed for ${targetFolder}: ${permittedMimesList}`,
      ),
    );
  }

  const fileExtension = path.extname(file.originalname).toLowerCase();
  const allowedExtensions = ALLOWED_EXTENSIONS_BY_FOLDER[targetFolder];
  const isExtensionPermitted = allowedExtensions?.includes(fileExtension);
  if (!isExtensionPermitted) {
    const permittedExtensionsList = allowedExtensions.join(', ');
    return callback(
      new ApiError(
        StatusCodes.BAD_REQUEST,
        `Invalid file extension '${fileExtension}'. Allowed for ${targetFolder}: ${permittedExtensionsList}`,
      ),
    );
  }

  callback(null, true);
};

const extractJsonPayloadFromBody = (
  requestBody: unknown,
): Record<string, unknown> | unknown[] => {
  const hasStringifiedDataField =
    Boolean(requestBody) &&
    typeof requestBody === 'object' &&
    'data' in (requestBody as object) &&
    typeof (requestBody as { data: unknown }).data === 'string';

  if (hasStringifiedDataField) {
    try {
      return JSON.parse((requestBody as { data: string }).data);
    } catch {
      throw new ApiError(
        StatusCodes.BAD_REQUEST,
        'Invalid JSON format in "data" field',
      );
    }
  }

  return (requestBody as Record<string, unknown>) || {};
};

const groupUploadedFilesByField = (
  files: Express.Multer.File[] | Record<string, Express.Multer.File[]>,
): Record<string, Express.Multer.File[]> => {
  const filesByField: Record<string, Express.Multer.File[]> = {};

  if (Array.isArray(files)) {
    for (const file of files) {
      filesByField[file.fieldname] = filesByField[file.fieldname] || [];
      filesByField[file.fieldname].push(file);
    }
  } else {
    Object.assign(filesByField, files);
  }

  return filesByField;
};

const extractBaseFieldName = (fieldName: string): string => {
  if (fieldName.includes('[')) {
    return fieldName.split('[')[0];
  }
  if (fieldName.includes('.')) {
    const segments = fieldName.split('.');
    return segments[segments.length - 1];
  }
  return fieldName;
};

const isFieldAllowedByPolicy = (
  fieldName: string,
  allowedFieldNames: string[],
): boolean => {
  const exactMatchSet = new Set(allowedFieldNames);
  if (exactMatchSet.has(fieldName)) {
    return true;
  }

  return allowedFieldNames.some(
    baseField =>
      fieldName.startsWith(`${baseField}[`) ||
      fieldName.endsWith(`.${baseField}`),
  );
};

const formatExpectedFieldsMessage = (allowedFields: string[]): string => {
  if (allowedFields.length === 1) {
    return `'${allowedFields[0]}'`;
  }
  return `'${allowedFields.join("', '")}'`;
};

const validateUploadedFieldPolicies = (
  filesByField: Record<string, Express.Multer.File[]>,
  options: FileHandlerOptions,
): void => {
  const allowedFieldNames = options.enforceAllowedFields;
  if (!allowedFieldNames || allowedFieldNames.length === 0) {
    return;
  }

  for (const [fieldName, fieldFiles] of Object.entries(filesByField)) {
    const isAllowed = isFieldAllowedByPolicy(fieldName, allowedFieldNames);
    if (!isAllowed) {
      const expectedFieldsText = formatExpectedFieldsMessage(allowedFieldNames);
      throw new ApiError(
        StatusCodes.BAD_REQUEST,
        `Expected field name ${expectedFieldsText} but got '${fieldName}'`,
      );
    }

    const baseFieldName = extractBaseFieldName(fieldName);
    const maxFilesAllowedForField = options.perFieldMaxCount?.[baseFieldName] ?? 1;

    if (fieldFiles.length > maxFilesAllowedForField) {
      throw new ApiError(
        StatusCodes.BAD_REQUEST,
        `Too many files for field '${fieldName}'. Max ${maxFilesAllowedForField}.`,
      );
    }
  }
};

const convertFieldRulesToOptions = (
  fieldRules: FieldRuleDefinition[],
): FileHandlerOptions => {
  const enforceAllowedFields: string[] = [];
  const perFieldMaxCount: Record<string, number> = {};
  let maxFilesTotal = 0;

  for (const rule of fieldRules) {
    if (typeof rule === 'string') {
      const fieldName = rule;
      enforceAllowedFields.push(fieldName);
      perFieldMaxCount[fieldName] = perFieldMaxCount[fieldName] ?? 1;
      maxFilesTotal += 1;
    } else if (rule && typeof rule.name === 'string') {
      const fieldName = rule.name;
      const fieldMaxCount = rule.maxCount ?? 1;
      enforceAllowedFields.push(fieldName);
      perFieldMaxCount[fieldName] = fieldMaxCount;
      maxFilesTotal += fieldMaxCount;
    }
  }

  return { enforceAllowedFields, perFieldMaxCount, maxFilesTotal };
};

const resolveFileHandlerOptions = (
  options?:
    | FileHandlerOptions
    | string[]
    | Array<string | { name: string; maxCount?: number }>,
): Required<
  Pick<
    FileHandlerOptions,
    | 'storageMode'
    | 'cloudProvider'
    | 'maxFileSizeMB'
    | 'maxFilesTotal'
    | 'imageMaxWidth'
  >
> &
  FileHandlerOptions => {
  const baseOptions = Array.isArray(options)
    ? convertFieldRulesToOptions(options as FieldRuleDefinition[])
    : options || {};

  const storageMode =
    baseOptions.storageMode ||
    (process.env.UPLOAD_MODE === 'memory' ? 'memory' : 'local');

  const cloudProvider =
    baseOptions.cloudProvider ||
    (process.env.CLOUD_PROVIDER as 's3' | 'cloudinary') ||
    's3';

  const maxFileSizeMB =
    baseOptions.maxFileSizeMB || DEFAULT_CATEGORY_SIZE_LIMITS_MB.documents;

  const maxFilesTotal = baseOptions.maxFilesTotal ?? 10;
  const imageMaxWidth = baseOptions.imageMaxWidth ?? 800;

  return {
    ...baseOptions,
    storageMode,
    cloudProvider,
    maxFileSizeMB,
    maxFilesTotal,
    imageMaxWidth,
  };
};

const resolveRequestBaseUrl = (req: Request, customBaseUrl?: string): string => {
  if (customBaseUrl) {
    return customBaseUrl;
  }
  if (process.env.BASE_URL) {
    return process.env.BASE_URL;
  }
  const protocol =
    (req.headers['x-forwarded-proto'] as string) || req.protocol;
  const host = req.get('host');
  return `${protocol}://${host}`;
};

const mergeUploadedUrlsIntoRequestBody = (
  currentRequestBody: unknown,
  uploadedUrlsByField: Record<string, string | string[]>,
): Record<string, unknown> | unknown[] => {
  if (Array.isArray(currentRequestBody)) {
    return currentRequestBody.map((item, itemIndex) => {
      const mergedItem = { ...item };
      for (const [fieldName, urls] of Object.entries(uploadedUrlsByField)) {
        if (Array.isArray(urls)) {
          mergedItem[fieldName] = urls[itemIndex];
        } else {
          mergedItem[fieldName] = itemIndex === 0 ? urls : undefined;
        }
      }
      return mergedItem;
    });
  }

  const baseObject =
    currentRequestBody && typeof currentRequestBody === 'object'
      ? (currentRequestBody as Record<string, unknown>)
      : {};

  return { ...baseObject, ...uploadedUrlsByField };
};

const cleanupStagedUploads = async (
  stagedStorageKeys: string[],
  storageProvider: StorageProvider,
): Promise<void> => {
  for (const storageKey of stagedStorageKeys) {
    try {
      await storageProvider.delete(storageKey);
    } catch {
      continue;
    }
  }
};

const persistFileToStorage = async (
  storageProvider: StorageProvider,
  storageMode: 'local' | 'memory',
  fileBuffer: Buffer,
  storageKey: string,
  targetFolder: IFolderName,
  mimeType: string,
  effectiveBaseUrl: string,
): Promise<string> => {
  if (storageMode === 'local') {
    await storageProvider.upload(
      fileBuffer,
      storageKey,
      targetFolder,
      mimeType,
    );
    return `${effectiveBaseUrl}/uploads/${storageKey}`;
  }

  return await storageProvider.upload(
    fileBuffer,
    storageKey,
    targetFolder,
    mimeType,
  );
};

export const fileHandler = (
  options?:
    | FileHandlerOptions
    | string[]
    | Array<string | { name: string; maxCount?: number }>,
) => {
  const resolvedOptions = resolveFileHandlerOptions(options);

  const activeProviderKey: StorageProviderName =
    resolvedOptions.storageMode === 'local'
      ? 'local'
      : resolvedOptions.cloudProvider;

  const storageProvider = STORAGE_PROVIDERS[activeProviderKey];

  const uploadMiddleware = multer({
    storage: createMulterStorageEngine(resolvedOptions.storageMode),
    fileFilter: validateIncomingFile,
    limits: {
      fileSize: resolvedOptions.maxFileSizeMB * 1024 * 1024,
      files: resolvedOptions.maxFilesTotal,
    },
  }).any();

  return async (req: Request, res: Response, next: NextFunction) => {
    uploadMiddleware(req, res, async (uploadError: unknown) => {
      if (uploadError) {
        if (uploadError instanceof multer.MulterError) {
          const formattedMessage = mapMulterErrorMessage(uploadError, {
            maxFileSizeMB: resolvedOptions.maxFileSizeMB,
            maxFilesTotal: resolvedOptions.maxFilesTotal,
          });
          return next(new ApiError(StatusCodes.BAD_REQUEST, formattedMessage));
        }
        return next(uploadError);
      }

      const stagedStorageKeys: string[] = [];

      try {
        const effectiveBaseUrl = resolveRequestBaseUrl(
          req,
          resolvedOptions.baseUrl,
        );

        req.body = extractJsonPayloadFromBody(req.body);

        if (req.files) {
          const filesByField = groupUploadedFilesByField(
            req.files as unknown as Express.Multer.File[],
          );

          validateUploadedFieldPolicies(filesByField, resolvedOptions);

          const uploadedUrlsByField: Record<string, string | string[]> = {};

          for (const [fieldName, fieldFiles] of Object.entries(filesByField)) {
            const uploadedUrls: string[] = [];

            for (const file of fieldFiles) {
              const targetFolder = resolveFolderByMimeType(file.mimetype);
              const fileExtension = path.extname(file.originalname) || '.bin';
              const storageKey = generateUniqueStorageKey(
                targetFolder,
                fileExtension,
              );

              let publicAccessUrl: string;
              try {
                const { buffer: processedBuffer, mimeType: finalMimeType } =
                  await prepareFileBuffer(
                    file,
                    resolvedOptions.storageMode,
                    resolvedOptions.imageMaxWidth,
                  );

                publicAccessUrl = await persistFileToStorage(
                  storageProvider,
                  resolvedOptions.storageMode,
                  processedBuffer,
                  storageKey,
                  targetFolder,
                  finalMimeType,
                  effectiveBaseUrl,
                );
              } finally {
                // In local mode multer first writes the raw upload to disk; the stored copy
                // lives under storageKey, so the raw file is always temporary.
                if (resolvedOptions.storageMode === 'local' && file.path) {
                  await fs.promises.unlink(file.path).catch(() => undefined);
                }
              }

              stagedStorageKeys.push(storageKey);
              uploadedUrls.push(publicAccessUrl);
            }

            uploadedUrlsByField[fieldName] =
              fieldFiles.length > 1 ? uploadedUrls : uploadedUrls[0];
          }

          req.body = mergeUploadedUrlsIntoRequestBody(
            req.body,
            uploadedUrlsByField,
          );
        }

        next();
      } catch (processingError) {
        await cleanupStagedUploads(stagedStorageKeys, storageProvider);
        next(processingError);
      }
    });
  };
};

const extractStorageKeyFromTarget = (targetPathOrUrl: string): string => {
  const isHttpUrl =
    targetPathOrUrl.startsWith('http://') ||
    targetPathOrUrl.startsWith('https://');

  if (isHttpUrl) {
    try {
      const parsedUrl = new URL(targetPathOrUrl);
      const pathnameWithoutLeadingSlash = parsedUrl.pathname.replace(
        /^\/+/,
        '',
      );
      const configuredBucketName =
        config.r2?.bucketName || process.env.AWS_S3_BUCKET || '';
      const configuredCustomDomain = config.r2?.customDomain
        ? config.r2.customDomain
            .replace(/^https?:\/\//, '')
            .replace(/\/$/, '')
        : '';

      const matchesCustomDomain =
        configuredCustomDomain &&
        targetPathOrUrl.includes(configuredCustomDomain);
      if (matchesCustomDomain) {
        return pathnameWithoutLeadingSlash;
      }

      const startsWithBucketName =
        configuredBucketName &&
        pathnameWithoutLeadingSlash.startsWith(`${configuredBucketName}/`);
      if (startsWithBucketName) {
        return pathnameWithoutLeadingSlash.slice(
          configuredBucketName.length + 1,
        );
      }

      // Local files are served at <origin>/uploads/<storageKey>; the leading slash is
      // already stripped here, so also match a pathname that starts with "uploads/".
      if (pathnameWithoutLeadingSlash.startsWith('uploads/')) {
        return pathnameWithoutLeadingSlash.slice('uploads/'.length);
      }

      const containsLocalUploadsSegment =
        pathnameWithoutLeadingSlash.includes('/uploads/');
      if (containsLocalUploadsSegment) {
        return (
          pathnameWithoutLeadingSlash.split('/uploads/')[1] ||
          pathnameWithoutLeadingSlash
        );
      }

      return pathnameWithoutLeadingSlash;
    } catch {
      return targetPathOrUrl.replace(/^https?:\/\/[^/]+\//, '');
    }
  }

  const isLocalUploadsPath = targetPathOrUrl.startsWith('/uploads/');
  if (isLocalUploadsPath) {
    return targetPathOrUrl.replace(/^\/uploads\//, '');
  }

  return targetPathOrUrl;
};

export const deleteFile = async (
  target: string,
  options?: DeleteFileOptions,
): Promise<void> => {
  if (!target) {
    return;
  }

  const providerName: StorageProviderName =
    options?.provider ||
    (process.env.CLOUD_PROVIDER as StorageProviderName) ||
    's3';

  const storageProvider = STORAGE_PROVIDERS[providerName];
  const storageKey = extractStorageKeyFromTarget(target);

  await storageProvider.delete(storageKey);
};

const mapMulterErrorMessage = (
  multerError: multer.MulterError,
  limits?: { maxFileSizeMB?: number; maxFilesTotal?: number },
): string => {
  const fieldName = (multerError as unknown as { field?: string }).field;
  const fieldSuffix = fieldName ? ` for field '${fieldName}'` : '';

  switch (multerError.code) {
    case 'LIMIT_FILE_SIZE': {
      const maxAllowedSizeText = limits?.maxFileSizeMB
        ? `Max ${limits.maxFileSizeMB} MB`
        : 'File size limit exceeded';
      return `File too large${fieldSuffix}. ${maxAllowedSizeText}.`;
    }
    case 'LIMIT_FILE_COUNT': {
      const maxAllowedFilesText = limits?.maxFilesTotal ?? 'limit';
      return `Too many files uploaded. Max total files: ${maxAllowedFilesText}.`;
    }
    case 'LIMIT_UNEXPECTED_FILE': {
      return `Unexpected file field${fieldName ? ` '${fieldName}'` : ''}.`;
    }
    case 'LIMIT_PART_COUNT': {
      return 'Too many parts in form-data. Reduce number of files or fields.';
    }
    case 'LIMIT_FIELD_KEY': {
      return 'Field name too long.';
    }
    case 'LIMIT_FIELD_VALUE': {
      return 'Field value too long.';
    }
    case 'LIMIT_FIELD_COUNT': {
      return 'Too many non-file fields.';
    }
    default: {
      const fallbackMessage = multerError.message || 'Upload error';
      const errorCodeSuffix = multerError.code ? ` (${multerError.code})` : '';
      return `${fallbackMessage}${errorCodeSuffix}`;
    }
  }
};
