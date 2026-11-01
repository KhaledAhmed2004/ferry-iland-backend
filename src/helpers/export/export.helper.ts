/**
 * ExportBuilder / ExportHelper - Unified Data Export Utility
 *
 * Generates structured exports for data collections:
 * - Excel (.xlsx) with styles, headers, and column formatting
 * - CSV with custom delimiters and quoting
 * - JSON formatted payloads
 * - PDF tabular reports with PDFService
 */

import * as ExcelJS from 'exceljs';
import { Readable } from 'stream';
import { Response } from 'express';
import { format as formatDate, isValid } from 'date-fns';
import { PDFService, wrapInPDFLayout } from '../pdf';
import {
  ExportFormat,
  ExportTheme,
  ColumnConfig,
  ExportOptions,
  PDFExportOptions,
  ExportBuilderConfig,
  ExcelTheme,
} from './export.types';

// ============ THEME DEFINITIONS ============

const excelThemes: Record<ExportTheme, ExcelTheme> = {
  default: {
    headerFill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E40AF' } },
    headerFont: { bold: true, color: { argb: 'FFFFFFFF' } },
    headerAlignment: { vertical: 'middle', horizontal: 'center' },
    borderStyle: { style: 'thin', color: { argb: 'FFE5E7EB' } },
    stripeFill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF8FAFC' } },
  },
  striped: {
    headerFill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E40AF' } },
    headerFont: { bold: true, color: { argb: 'FFFFFFFF' } },
    headerAlignment: { vertical: 'middle', horizontal: 'center' },
    borderStyle: { style: 'thin', color: { argb: 'FFE5E7EB' } },
    stripeFill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF1F5F9' } },
  },
  bordered: {
    headerFill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F2937' } },
    headerFont: { bold: true, color: { argb: 'FFFFFFFF' } },
    headerAlignment: { vertical: 'middle', horizontal: 'center' },
    borderStyle: { style: 'medium', color: { argb: 'FF1F2937' } },
    stripeFill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFFFF' } },
  },
};

// ============ MAIN BUILDER CLASS ============

export class ExportBuilder<T extends Record<string, any>> {
  private data: T[];
  private config: ExportBuilderConfig;

  /**
   * Create a new ExportBuilder instance
   * @param data - Array of data objects to export
   */
  constructor(data: T[]) {
    this.data = data;
    this.config = {
      format: 'excel',
      columns: [],
      headerMap: {},
      transforms: {},
      options: {
        format: 'excel',
        includeHeaders: true,
        theme: 'default',
        sheetName: 'Data',
      },
      pdfOptions: {
        orientation: 'portrait',
        pageSize: 'A4',
      },
    };
  }

  // ===== FORMAT SELECTION =====

  format(format: ExportFormat): this {
    this.config.format = format;
    this.config.options.format = format;
    return this;
  }

  // ===== COLUMN CONFIGURATION =====

  columns(columns: (keyof T | string)[] | ColumnConfig[]): this {
    this.config.columns = columns.map(col => {
      if (typeof col === 'string') {
        return { key: col as string };
      }
      return col as ColumnConfig;
    });
    return this;
  }

  headers(headerMap: Record<string, string>): this {
    this.config.headerMap = { ...this.config.headerMap, ...headerMap };
    this.config.columns = this.config.columns.map(col => {
      if (headerMap[col.key]) {
        return { ...col, header: headerMap[col.key] };
      }
      return col;
    });
    return this;
  }

  // ===== FORMATTING OPTIONS =====

  dateFormat(format: string): this {
    this.config.options.dateFormat = format;
    return this;
  }

  numberFormat(format: string): this {
    this.config.options.numberFormat = format;
    return this;
  }

  transform(field: string, fn: (value: any) => string): this {
    this.config.transforms[field] = fn;
    this.config.columns = this.config.columns.map(col => {
      if (col.key === field) {
        return { ...col, transform: fn };
      }
      return col;
    });
    return this;
  }

  // ===== STYLING OPTIONS =====

  title(title: string): this {
    this.config.options.title = title;
    return this;
  }

  theme(theme: ExportTheme): this {
    this.config.options.theme = theme;
    return this;
  }

  sheetName(name: string): this {
    this.config.options.sheetName = name;
    return this;
  }

  // ===== PDF OPTIONS =====

  pdfOptions(options: PDFExportOptions): this {
    this.config.pdfOptions = { ...this.config.pdfOptions, ...options };
    return this;
  }

  // ===== OUTPUT METHODS =====

  async toBuffer(): Promise<Buffer> {
    if (this.config.columns.length === 0 && this.data.length > 0) {
      this.config.columns = Object.keys(this.data[0]).map(key => ({ key }));
    }

    switch (this.config.format) {
      case 'excel':
        return this.generateExcel();
      case 'csv':
        return this.generateCSV();
      case 'json':
        return this.generateJSON();
      case 'pdf':
        return this.generatePDF();
      default:
        throw new Error(`Unsupported export format: ${this.config.format}`);
    }
  }

  async toFile(path: string): Promise<void> {
    const fs = await import('fs/promises');
    const buffer = await this.toBuffer();

    const extensions: Record<ExportFormat, string> = {
      excel: '.xlsx',
      csv: '.csv',
      json: '.json',
      pdf: '.pdf',
    };

    const ext = extensions[this.config.format];
    const finalPath = path.endsWith(ext) ? path : path + ext;

    await fs.writeFile(finalPath, buffer);
  }

  async toBase64(): Promise<string> {
    const buffer = await this.toBuffer();
    return buffer.toString('base64');
  }

  async toStream(): Promise<Readable> {
    const buffer = await this.toBuffer();
    const stream = new Readable();
    stream.push(buffer);
    stream.push(null);
    return stream;
  }

  async sendResponse(res: Response, filename?: string): Promise<void> {
    const buffer = await this.toBuffer();
    const name = filename || `export-${Date.now()}`;

    const contentTypes: Record<ExportFormat, string> = {
      excel: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      csv: 'text/csv; charset=utf-8',
      json: 'application/json; charset=utf-8',
      pdf: 'application/pdf',
    };

    const extensions: Record<ExportFormat, string> = {
      excel: 'xlsx',
      csv: 'csv',
      json: 'json',
      pdf: 'pdf',
    };

    res.setHeader('Content-Type', contentTypes[this.config.format]);
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${name}.${extensions[this.config.format]}"`
    );
    res.setHeader('Content-Length', buffer.length);
    res.send(buffer);
  }

  // ===== PRIVATE: EXCEL GENERATION =====

  private async generateExcel(): Promise<Buffer> {
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'ExportHelper';
    workbook.created = new Date();

    const sheet = workbook.addWorksheet(this.config.options.sheetName || 'Data');
    const theme = excelThemes[this.config.options.theme || 'default'];

    let startRow = 1;
    if (this.config.options.title) {
      const titleRow = sheet.getRow(1);
      titleRow.getCell(1).value = this.config.options.title;
      titleRow.getCell(1).font = { bold: true, size: 16 };
      sheet.mergeCells(1, 1, 1, this.config.columns.length);
      startRow = 3;
    }

    sheet.columns = this.config.columns.map(col => ({
      header: col.header || this.config.headerMap[col.key] || this.formatHeader(col.key),
      key: col.key,
      width: col.width || this.calculateColumnWidth(col.key),
    }));

    if (this.config.options.title) {
      const headerRowNum = startRow;
      const headerRow = sheet.getRow(headerRowNum);

      this.config.columns.forEach((col, index) => {
        headerRow.getCell(index + 1).value =
          col.header || this.config.headerMap[col.key] || this.formatHeader(col.key);
      });

      this.applyHeaderStyle(headerRow, theme);
      startRow++;
    } else {
      const headerRow = sheet.getRow(1);
      this.applyHeaderStyle(headerRow, theme);
      startRow = 2;
    }

    for (let i = 0; i < this.data.length; i++) {
      const item = this.data[i];
      const rowNum = startRow + i;
      const row = sheet.getRow(rowNum);

      this.config.columns.forEach((col, colIndex) => {
        const cell = row.getCell(colIndex + 1);
        cell.value = this.getValue(item, col);

        if (col.align) {
          cell.alignment = { horizontal: col.align };
        }
      });

      this.applyRowStyle(row, i, theme);
    }

    const lastRow = startRow + this.data.length - 1;
    for (let r = this.config.options.title ? 3 : 1; r <= lastRow; r++) {
      const row = sheet.getRow(r);
      for (let c = 1; c <= this.config.columns.length; c++) {
        row.getCell(c).border = {
          top: theme.borderStyle,
          left: theme.borderStyle,
          bottom: theme.borderStyle,
          right: theme.borderStyle,
        };
      }
    }

    sheet.views = [
      { state: 'frozen', xSplit: 0, ySplit: this.config.options.title ? 3 : 1 },
    ];

    const arrayBuffer = await workbook.xlsx.writeBuffer();
    return Buffer.from(arrayBuffer);
  }

  private applyHeaderStyle(row: ExcelJS.Row, theme: ExcelTheme): void {
    row.eachCell((cell, colNumber) => {
      if (colNumber <= this.config.columns.length) {
        cell.fill = theme.headerFill;
        cell.font = theme.headerFont;
        cell.alignment = theme.headerAlignment;
        cell.border = {
          top: theme.borderStyle,
          left: theme.borderStyle,
          bottom: theme.borderStyle,
          right: theme.borderStyle,
        };
      }
    });
    row.height = 25;
  }

  private applyRowStyle(row: ExcelJS.Row, index: number, theme: ExcelTheme): void {
    const isStriped = this.config.options.theme === 'striped' && index % 2 === 1;

    row.eachCell((cell, colNumber) => {
      if (colNumber <= this.config.columns.length) {
        if (isStriped) {
          cell.fill = theme.stripeFill;
        }
        cell.alignment = { vertical: 'middle' };
      }
    });
    row.height = 20;
  }

  // ===== PRIVATE: CSV GENERATION =====

  private async generateCSV(): Promise<Buffer> {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Data');

    sheet.columns = this.config.columns.map(col => ({
      header: col.header || this.config.headerMap[col.key] || this.formatHeader(col.key),
      key: col.key,
    }));

    for (const item of this.data) {
      const row: Record<string, any> = {};
      for (const col of this.config.columns) {
        row[col.key] = this.getValue(item, col);
      }
      sheet.addRow(row);
    }

    const csvBuffer = await workbook.csv.writeBuffer({
      formatterOptions: {
        delimiter: ',',
        quote: '"',
        quoteColumns: true,
      },
    });

    return Buffer.from(csvBuffer);
  }

  // ===== PRIVATE: JSON GENERATION =====

  private generateJSON(): Buffer {
    const result = this.data.map(item => {
      const row: Record<string, any> = {};
      for (const col of this.config.columns) {
        const headerName = col.header || this.config.headerMap[col.key] || col.key;
        row[headerName] = this.getValue(item, col);
      }
      return row;
    });

    return Buffer.from(JSON.stringify(result, null, 2), 'utf-8');
  }

  // ===== PRIVATE: PDF GENERATION =====

  private async generatePDF(): Promise<Buffer> {
    const title = this.config.options.title || 'Export Data';
    const headers = this.config.columns.map(
      col => col.header || this.config.headerMap[col.key] || this.formatHeader(col.key),
    );

    const rows = this.data.map(item =>
      this.config.columns.map(col => {
        const value = this.getValue(item, col);
        return value !== null && value !== undefined ? String(value) : '';
      }),
    );

    const headerHtml = headers.map(h => `<th>${h}</th>`).join('');
    const rowsHtml = rows
      .map(r => `<tr>${r.map(cell => `<td>${cell}</td>`).join('')}</tr>`)
      .join('');

    const content = `
      <div class="header">
        <div>
          <div class="brand-title">${title}</div>
          <div class="brand-subtitle">Export Generated on ${new Date().toLocaleDateString('en-GB')}</div>
        </div>
      </div>
      <table>
        <thead>
          <tr>${headerHtml}</tr>
        </thead>
        <tbody>
          ${rowsHtml}
        </tbody>
      </table>
    `;

    const fullHtml = wrapInPDFLayout(content, {
      title,
      theme: 'corporate',
    });

    return PDFService.generateFromHTML(fullHtml, {
      format: (this.config.pdfOptions.pageSize as any) || 'A4',
      orientation: this.config.pdfOptions.orientation || 'portrait',
    });
  }

  // ===== PRIVATE: HELPER METHODS =====

  private getValue(item: T, col: ColumnConfig): any {
    let value = col.key.split('.').reduce((obj: any, key: string) => {
      if (obj === null || obj === undefined) return undefined;
      return obj[key];
    }, item);

    if (value instanceof Date || this.isDateString(value)) {
      const dateValue = value instanceof Date ? value : new Date(value);
      if (isValid(dateValue)) {
        const format = col.dateFormat || this.config.options.dateFormat;
        if (format) {
          try {
            value = formatDate(dateValue, this.convertDateFormat(format));
          } catch {
            value = dateValue.toLocaleDateString();
          }
        } else {
          value = dateValue.toLocaleDateString();
        }
      }
    }

    if (col.transform) {
      value = col.transform(value);
    } else if (this.config.transforms[col.key]) {
      value = this.config.transforms[col.key](value);
    }

    return value ?? '';
  }

  private isDateString(value: any): boolean {
    if (typeof value !== 'string') return false;
    const datePatterns = [
      /^\d{4}-\d{2}-\d{2}/,
      /^\d{2}\/\d{2}\/\d{4}/,
      /^\d{2}-\d{2}-\d{4}/,
    ];
    return datePatterns.some(pattern => pattern.test(value));
  }

  private convertDateFormat(format: string): string {
    return format
      .replace(/YYYY/g, 'yyyy')
      .replace(/DD/g, 'dd')
      .replace(/MM/g, 'MM')
      .replace(/D/g, 'd')
      .replace(/M(?!M)/g, 'M');
  }

  private formatHeader(key: string): string {
    const lastKey = key.split('.').pop() || key;
    return lastKey
      .replace(/([A-Z])/g, ' $1')
      .replace(/[_-]/g, ' ')
      .replace(/\b\w/g, l => l.toUpperCase())
      .trim();
  }

  private calculateColumnWidth(key: string): number {
    const header = this.formatHeader(key);
    const headerLength = header.length;

    let maxContentLength = headerLength;
    const sampleSize = Math.min(100, this.data.length);

    for (let i = 0; i < sampleSize; i++) {
      const value = this.getValue(this.data[i], { key });
      const valueLength = String(value).length;
      if (valueLength > maxContentLength) {
        maxContentLength = valueLength;
      }
    }

    return Math.min(50, Math.max(10, maxContentLength + 2));
  }
}

export default ExportBuilder;
