/**
 * Spec 0006, AC-8: CSV for the admin payments tabs. RFC 4180 quoting, UTF-8 with BOM for Excel,
 * money as dollar strings, and text cells that a spreadsheet could run as a formula get a `'`.
 */

export const CSV_ROW_CAP = 10_000;

export type CsvColumn<T> = {
  header: string;
  value: (row: T) => string | number | null | undefined;
  /** Money and other numbers are never formula escaped. */
  money?: boolean;
};

const FORMULA_START = /^[=+\-@\t\r]/;

const quote = (cell: string) => (/[",\r\n]/.test(cell) ? `"${cell.replace(/"/g, '""')}"` : cell);

export const csvCell = (value: string | number | null | undefined, money = false): string => {
  if (value === null || value === undefined) return '';
  const text = String(value);
  return quote(!money && FORMULA_START.test(text) ? `'${text}` : text);
};

/** Cents to a dollar string with two decimals, in integers (no float rounding). */
export const centsToDollarText = (cents: number | null | undefined): string => {
  if (cents === null || cents === undefined) return '';
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(cents);
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
};

export const toCsv = <T>(rows: T[], columns: CsvColumn<T>[]): string => {
  const lines = [
    columns.map(column => csvCell(column.header)).join(','),
    ...rows.map(row => columns.map(column => csvCell(column.value(row), column.money)).join(',')),
  ];
  return `﻿${lines.join('\r\n')}\r\n`;
};

export const csvFileName = (tab: string, from?: string, to?: string) =>
  `${tab}-${from ?? 'all'}-to-${to ?? 'all'}.csv`;
