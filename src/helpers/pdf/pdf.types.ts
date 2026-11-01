/**
 * PDF Service Type Definitions for Moeb26
 */

export type PDFThemeColors = {
  primary: string;
  secondary: string;
  accent: string;
  background: string;
  surface: string;
  text: string;
  mutedText: string;
  border: string;
  success: string;
  error: string;
}

export type PDFThemeType = 'modern' | 'corporate' | 'minimal' | 'dark';

export type PDFPageOptions = {
  format?: 'A4' | 'Letter';
  orientation?: 'portrait' | 'landscape';
  margin?: {
    top?: string;
    right?: string;
    bottom?: string;
    left?: string;
  };
  displayHeaderFooter?: boolean;
}

export type BasePDFData = {
  companyName?: string;
  companyLogo?: string;
  companyAddress?: string;
  companyEmail?: string;
  companyPhone?: string;
  generatedAt?: Date | string;
}

// 1. Trip / Ride Invoice
export type TripInvoiceData = {
  invoiceNumber: string;
  tripId: string;
  date: Date | string;
  passenger: {
    name: string;
    email?: string;
    phone?: string;
  };
  chauffeur: {
    name: string;
    vehicleModel?: string;
    plateNumber?: string;
  };
  tripDetails: {
    pickup: string;
    dropoff: string;
    pickupLocation?: string;
    dropoffLocation?: string;
    distanceKm?: number;
    durationMinutes?: number;
    pickupTime?: Date | string;
    dropoffTime?: Date | string;
  };
  breakdown: Array<{
    description: string;
    amount: number | string;
  }>;
  subtotal: number | string;
  discount?: number | string;
  tax?: number | string;
  total: number | string;
  currency?: string;
  paymentMethod?: string;
  paymentStatus?: 'PAID' | 'PENDING' | 'REFUNDED';
  qrData?: string;
} & BasePDFData

// 2. Driver Subscription Receipt
export type SubscriptionReceiptData = {
  receiptNumber: string;
  subscriptionId: string;
  date: Date | string;
  driver: {
    name: string;
    email?: string;
    phone?: string;
    driverId?: string;
  };
  plan: {
    name: string;
    tier: string;
    billingCycle: 'MONTHLY' | 'QUARTERLY' | 'YEARLY';
    validUntil: Date | string;
  };
  amount: number | string;
  tax?: number | string;
  total: number | string;
  currency?: string;
  paymentMethod?: string;
  transactionId?: string;
} & BasePDFData

// 3. Driver Earnings Report
export type EarningsReportData = {
  reportId: string;
  period: {
    start: Date | string;
    end: Date | string;
  };
  driver: {
    name: string;
    driverId: string;
    email?: string;
  };
  summary: {
    totalTrips: number;
    totalHours: number;
    grossEarnings: number | string;
    platformCommission: number | string;
    tips: number | string;
    netPayout: number | string;
  };
  trips?: Array<{
    date: string;
    tripId: string;
    from: string;
    to: string;
    fare: number | string;
    driverCut: number | string;
  }>;
  currency?: string;
} & BasePDFData
