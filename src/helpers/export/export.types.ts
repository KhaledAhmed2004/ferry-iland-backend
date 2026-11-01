/**
 * Data Export Type Definitions
 */

import type * as ExcelJS from 'exceljs';

/**
 * Supported export formats
 */
export type ExportFormat = 'excel' | 'csv' | 'json' | 'pdf';

/**
 * Theme types for styling exports
 */
export type ExportTheme = 'default' | 'striped' | 'bordered';

/**
 * Column configuration for exports
 */
export type ColumnConfig = {
  /** Data field name (supports nested keys like 'user.name') */
  key: string;
  /** Display header text (default: key name) */
  header?: string;
  /** Column width in characters (Excel only) */
  width?: number;
  /** Custom value transformer function */
  transform?: (value: any) => string;
  /** Date format string (date-fns format) */
  dateFormat?: string;
  /** Text alignment */
  align?: 'left' | 'center' | 'right';
}

/**
 * Export configuration options
 */
export type ExportOptions = {
  /** Export format */
  format: ExportFormat;
  /** Output filename (without extension) */
  filename?: string;
  /** Excel sheet name */
  sheetName?: string;
  /** Document title (PDF/Excel header) */
  title?: string;
  /** Include headers row (default: true) */
  includeHeaders?: boolean;
  /** Global date format string */
  dateFormat?: string;
  /** Number format string */
  numberFormat?: string;
  /** Visual theme */
  theme?: ExportTheme;
}

/**
 * PDF-specific export options
 */
export type PDFExportOptions = {
  /** Page orientation */
  orientation?: 'portrait' | 'landscape';
  /** Page size */
  pageSize?: 'A4' | 'Letter' | 'Legal';
  /** Base font size */
  fontSize?: number;
  /** Table header background color */
  headerColor?: string;
}

/**
 * Internal configuration structure
 */
export type ExportBuilderConfig = {
  format: ExportFormat;
  columns: ColumnConfig[];
  headerMap: Record<string, string>;
  transforms: Record<string, (value: any) => string>;
  options: ExportOptions;
  pdfOptions: PDFExportOptions;
}

export type ExcelTheme = {
  headerFill: ExcelJS.Fill;
  headerFont: Partial<ExcelJS.Font>;
  headerAlignment: Partial<ExcelJS.Alignment>;
  borderStyle: Partial<ExcelJS.Border>;
  stripeFill: ExcelJS.Fill;
}
