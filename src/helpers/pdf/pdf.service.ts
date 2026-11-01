/**
 * Central PDF Generation Service for Moeb26
 * Handles Chromium browser lifecycle, HTML-to-PDF rendering, and buffer exports.
 */

import puppeteer, { Browser } from 'puppeteer';
import { PDFPageOptions, TripInvoiceData, SubscriptionReceiptData, EarningsReportData } from './pdf.types';
import {
  renderTripInvoiceHTML,
  renderSubscriptionReceiptHTML,
  renderEarningsReportHTML,
} from './templates';

export class PDFService {
  private static browserInstance: Browser | null = null;
  private static isLaunching = false;

  /**
   * Acquire or reuse a Singleton Puppeteer Browser instance to prevent RAM exhaustion
   */
  public static async getBrowser(): Promise<Browser> {
    if (this.browserInstance && this.browserInstance.isConnected()) {
      return this.browserInstance;
    }

    if (!this.isLaunching) {
      this.isLaunching = true;
      try {
        this.browserInstance = await puppeteer.launch({
          headless: true,
          args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-gpu',
            '--no-first-run',
            '--no-zygote',
            '--single-process',
          ],
        });
      } finally {
        this.isLaunching = false;
      }
    } else {
      // Wait briefly if browser is currently being launched by another thread
      while (this.isLaunching) {
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      if (this.browserInstance) return this.browserInstance;
    }

    return this.browserInstance!;
  }

  /**
   * Graceful cleanup on server shutdown
   */
  public static async closeBrowser(): Promise<void> {
    if (this.browserInstance) {
      await this.browserInstance.close();
      this.browserInstance = null;
    }
  }

  /**
   * Convert raw HTML string into a PDF Buffer
   */
  public static async generateFromHTML(
    html: string,
    options?: PDFPageOptions,
  ): Promise<Buffer> {
    const browser = await this.getBrowser();
    const page = await browser.newPage();

    try {
      await page.setContent(html, {
        waitUntil: 'networkidle0',
        timeout: 30000,
      });

      const pdfBuffer = await page.pdf({
        format: options?.format || 'A4',
        landscape: options?.orientation === 'landscape',
        printBackground: true,
        margin: {
          top: options?.margin?.top || '15mm',
          right: options?.margin?.right || '15mm',
          bottom: options?.margin?.bottom || '15mm',
          left: options?.margin?.left || '15mm',
        },
      });

      return Buffer.from(pdfBuffer);
    } finally {
      await page.close();
    }
  }

  // ================= DOMAIN GENERATORS =================

  /**
   * Generate Trip Invoice PDF Buffer
   */
  public static async generateTripInvoice(data: TripInvoiceData): Promise<Buffer> {
    const html = renderTripInvoiceHTML(data);
    return this.generateFromHTML(html);
  }

  /**
   * Generate Driver Subscription Receipt PDF Buffer
   */
  public static async generateSubscriptionReceipt(data: SubscriptionReceiptData): Promise<Buffer> {
    const html = renderSubscriptionReceiptHTML(data);
    return this.generateFromHTML(html);
  }

  /**
   * Generate Driver Earnings Report PDF Buffer
   */
  public static async generateEarningsReport(data: EarningsReportData): Promise<Buffer> {
    const html = renderEarningsReportHTML(data);
    return this.generateFromHTML(html);
  }
}

export default PDFService;
