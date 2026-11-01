/**
 * Moeb26 Trip / Ride Invoice PDF Template
 */

import { TripInvoiceData } from '../pdf.types';
import { wrapInPDFLayout } from '../pdf.layout';

export function renderTripInvoiceHTML(data: TripInvoiceData): string {
  const currency = data.currency || 'EUR';
  const companyName = data.companyName || 'Moeb26 Chauffeur Services';
  const formattedDate = typeof data.date === 'string' ? data.date : data.date.toLocaleDateString('en-GB');

  const rows = data.breakdown
    .map(
      (item) => `
      <tr>
        <td>${item.description}</td>
        <td class="text-right"><strong>${typeof item.amount === 'number' ? item.amount.toFixed(2) : item.amount} ${currency}</strong></td>
      </tr>`,
    )
    .join('');

  const bodyContent = `
    <!-- Header -->
    <div class="header">
      <div>
        <div class="brand-title">${companyName}</div>
        <div class="brand-subtitle">Official Trip Receipt & Invoice</div>
        ${data.companyAddress ? `<div class="meta-line" style="margin-top: 6px;">${data.companyAddress}</div>` : ''}
        ${data.companyEmail ? `<div class="meta-line">${data.companyEmail}</div>` : ''}
      </div>
      <div class="doc-meta">
        <div class="doc-badge ${data.paymentStatus === 'PAID' ? 'paid' : ''}">${data.paymentStatus || 'PAID'}</div>
        <div class="meta-line">Invoice: <strong>#${data.invoiceNumber}</strong></div>
        <div class="meta-line">Trip ID: <strong>#${data.tripId}</strong></div>
        <div class="meta-line">Date: <strong>${formattedDate}</strong></div>
      </div>
    </div>

    <!-- Passenger & Chauffeur Summary -->
    <div class="grid-2">
      <div class="card">
        <div class="card-title">Passenger Details</div>
        <div class="info-row">
          <span class="info-label">Name:</span>
          <span class="info-val">${data.passenger.name}</span>
        </div>
        ${data.passenger.email ? `
        <div class="info-row">
          <span class="info-label">Email:</span>
          <span class="info-val">${data.passenger.email}</span>
        </div>` : ''}
        ${data.passenger.phone ? `
        <div class="info-row">
          <span class="info-label">Phone:</span>
          <span class="info-val">${data.passenger.phone}</span>
        </div>` : ''}
      </div>

      <div class="card">
        <div class="card-title">Chauffeur & Vehicle</div>
        <div class="info-row">
          <span class="info-label">Chauffeur:</span>
          <span class="info-val">${data.chauffeur.name}</span>
        </div>
        ${data.chauffeur.vehicleModel ? `
        <div class="info-row">
          <span class="info-label">Vehicle:</span>
          <span class="info-val">${data.chauffeur.vehicleModel}</span>
        </div>` : ''}
        ${data.chauffeur.plateNumber ? `
        <div class="info-row">
          <span class="info-label">Plate Number:</span>
          <span class="info-val">${data.chauffeur.plateNumber}</span>
        </div>` : ''}
      </div>
    </div>

    <!-- Route Overview -->
    <div class="card" style="margin-bottom: 24px;">
      <div class="card-title">Ride Route & Timeline</div>
      <div class="info-row" style="margin-bottom: 8px;">
        <span class="info-label">Pickup:</span>
        <span class="info-val">${data.tripDetails.pickup || data.tripDetails.pickupLocation}</span>
      </div>
      <div class="info-row" style="margin-bottom: 8px;">
        <span class="info-label">Dropoff:</span>
        <span class="info-val">${data.tripDetails.dropoff || data.tripDetails.dropoffLocation}</span>
      </div>
      ${data.tripDetails.distanceKm ? `
      <div class="info-row">
        <span class="info-label">Distance / Duration:</span>
        <span class="info-val">${data.tripDetails.distanceKm} km (${data.tripDetails.durationMinutes || 0} mins)</span>
      </div>` : ''}
    </div>

    <!-- Fare Breakdown Table -->
    <table>
      <thead>
        <tr>
          <th>Description</th>
          <th class="text-right">Amount</th>
        </tr>
      </thead>
      <tbody>
        ${rows}
      </tbody>
    </table>

    <!-- Totals Box -->
    <div class="totals-container">
      <div class="totals-box">
        <div class="totals-row">
          <span>Subtotal</span>
          <span>${data.subtotal} ${currency}</span>
        </div>
        ${data.discount ? `
        <div class="totals-row">
          <span>Discount</span>
          <span style="color: #16A34A;">-${data.discount} ${currency}</span>
        </div>` : ''}
        ${data.tax ? `
        <div class="totals-row">
          <span>VAT / Tax</span>
          <span>${data.tax} ${currency}</span>
        </div>` : ''}
        <div class="totals-row grand-total">
          <span>Total Paid</span>
          <span>${data.total} ${currency}</span>
        </div>
        ${data.paymentMethod ? `
        <div style="font-size: 11px; color: #64748B; margin-top: 6px; text-align: right;">
          Paid via ${data.paymentMethod}
        </div>` : ''}
      </div>
    </div>

    <!-- Footer -->
    <div class="footer">
      <div>Thank you for riding with ${companyName}.</div>
      <div>Questions? Contact ${data.companyEmail || 'support@moeb26.com'}</div>
    </div>
  `;

  return wrapInPDFLayout(bodyContent, {
    title: `Trip Invoice #${data.invoiceNumber}`,
    theme: 'corporate',
  });
}
