/**
 * PDF Layout & Styling Engine for Moeb26
 * Pixel-perfect, print-optimized CSS with pagebreak controls
 */

import { PDFThemeColors, PDFThemeType } from './pdf.types';

export const PDF_THEMES: Record<PDFThemeType, PDFThemeColors> = {
  corporate: {
    primary: '#0F172A',
    secondary: '#3B82F6',
    accent: '#10B981',
    background: '#FFFFFF',
    surface: '#F8FAFC',
    text: '#0F172A',
    mutedText: '#64748B',
    border: '#E2E8F0',
    success: '#16A34A',
    error: '#DC2626',
  },
  modern: {
    primary: '#1E293B',
    secondary: '#6366F1',
    accent: '#06B6D4',
    background: '#FFFFFF',
    surface: '#F1F5F9',
    text: '#1E293B',
    mutedText: '#64748B',
    border: '#CBD5E1',
    success: '#10B981',
    error: '#EF4444',
  },
  minimal: {
    primary: '#000000',
    secondary: '#4B5563',
    accent: '#000000',
    background: '#FFFFFF',
    surface: '#FAFAFA',
    text: '#111827',
    mutedText: '#6B7280',
    border: '#E5E7EB',
    success: '#059669',
    error: '#DC2626',
  },
  dark: {
    primary: '#38BDF8',
    secondary: '#818CF8',
    accent: '#34D399',
    background: '#0F172A',
    surface: '#1E293B',
    text: '#F8FAFC',
    mutedText: '#94A3B8',
    border: '#334155',
    success: '#4ADE80',
    error: '#F87171',
  },
};

export type LayoutOptions = {
  title: string;
  theme?: PDFThemeType;
  customStyles?: string;
}

export function wrapInPDFLayout(content: string, options: LayoutOptions): string {
  const theme = PDF_THEMES[options.theme || 'corporate'];

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>${options.title}</title>
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap');

    @page {
      size: A4;
      margin: 18mm 16mm;
    }

    *, *::before, *::after {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
      -webkit-print-color-adjust: exact !important;
      print-color-adjust: exact !important;
    }

    body {
      font-family: 'Inter', system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      font-size: 13px;
      line-height: 1.5;
      color: ${theme.text};
      background: ${theme.background};
      padding: 0;
    }

    .container {
      width: 100%;
      max-width: 100%;
      margin: 0 auto;
    }

    /* Header Component */
    .header {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      padding-bottom: 24px;
      border-bottom: 2px solid ${theme.border};
      margin-bottom: 24px;
    }

    .brand-title {
      font-size: 24px;
      font-weight: 800;
      color: ${theme.primary};
      letter-spacing: -0.5px;
    }

    .brand-subtitle {
      font-size: 11px;
      font-weight: 600;
      color: ${theme.secondary};
      text-transform: uppercase;
      letter-spacing: 1px;
      margin-top: 2px;
    }

    .doc-meta {
      text-align: right;
    }

    .doc-badge {
      display: inline-block;
      font-size: 11px;
      font-weight: 700;
      padding: 4px 10px;
      border-radius: 4px;
      background: ${theme.surface};
      color: ${theme.primary};
      border: 1px solid ${theme.border};
      margin-bottom: 6px;
    }

    .doc-badge.paid {
      background: #DCFCE7;
      color: #15803D;
      border-color: #BBF7D0;
    }

    .meta-line {
      font-size: 12px;
      color: ${theme.mutedText};
      margin-top: 2px;
    }

    .meta-line strong {
      color: ${theme.text};
    }

    /* Two Column Cards */
    .grid-2 {
      display: flex;
      gap: 20px;
      margin-bottom: 24px;
    }

    .card {
      flex: 1;
      background: ${theme.surface};
      border: 1px solid ${theme.border};
      border-radius: 8px;
      padding: 16px;
    }

    .card-title {
      font-size: 11px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.8px;
      color: ${theme.mutedText};
      margin-bottom: 10px;
      border-bottom: 1px solid ${theme.border};
      padding-bottom: 6px;
    }

    .info-row {
      display: flex;
      justify-content: space-between;
      font-size: 12px;
      margin-bottom: 6px;
    }

    .info-row:last-child {
      margin-bottom: 0;
    }

    .info-label {
      color: ${theme.mutedText};
    }

    .info-val {
      font-weight: 600;
      color: ${theme.text};
    }

    /* Table Styles */
    table {
      width: 100%;
      border-collapse: collapse;
      margin-bottom: 24px;
    }

    th {
      background: ${theme.surface};
      color: ${theme.primary};
      font-size: 11px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      text-align: left;
      padding: 10px 14px;
      border-top: 1px solid ${theme.border};
      border-bottom: 2px solid ${theme.border};
    }

    th.text-right, td.text-right {
      text-align: right;
    }

    td {
      padding: 12px 14px;
      font-size: 12px;
      border-bottom: 1px solid ${theme.border};
      color: ${theme.text};
    }

    tr:nth-child(even) td {
      background-color: ${theme.surface};
    }

    /* Totals Summary */
    .totals-container {
      display: flex;
      justify-content: flex-end;
      margin-bottom: 30px;
    }

    .totals-box {
      width: 260px;
      border: 1px solid ${theme.border};
      border-radius: 8px;
      background: ${theme.surface};
      padding: 14px;
    }

    .totals-row {
      display: flex;
      justify-content: space-between;
      font-size: 12px;
      margin-bottom: 6px;
      color: ${theme.mutedText};
    }

    .totals-row.grand-total {
      border-top: 2px solid ${theme.border};
      padding-top: 8px;
      margin-top: 8px;
      font-size: 15px;
      font-weight: 800;
      color: ${theme.primary};
    }

    /* Footer */
    .footer {
      margin-top: 30px;
      padding-top: 16px;
      border-top: 1px solid ${theme.border};
      display: flex;
      justify-content: space-between;
      align-items: center;
      font-size: 11px;
      color: ${theme.mutedText};
    }

    /* Print utility */
    .page-break {
      page-break-after: always;
    }

    .no-break {
      break-inside: avoid;
    }

    ${options.customStyles || ''}
  </style>
</head>
<body>
  <div class="container">
    ${content}
  </div>
</body>
</html>`;
}
