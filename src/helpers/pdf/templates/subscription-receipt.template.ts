/**
 * Moeb26 Driver Subscription Receipt Template
 */

import { SubscriptionReceiptData } from '../pdf.types';
import { wrapInPDFLayout } from '../pdf.layout';

export function renderSubscriptionReceiptHTML(data: SubscriptionReceiptData): string {
  const currency = data.currency || 'EUR';
  const companyName = data.companyName || 'Moeb26 Platform Services';
  const formattedDate = typeof data.date === 'string' ? data.date : data.date.toLocaleDateString('en-GB');
  const validUntil = typeof data.plan.validUntil === 'string' ? data.plan.validUntil : data.plan.validUntil.toLocaleDateString('en-GB');

  const bodyContent = `
    <!-- Header -->
    <div class="header">
      <div>
        <div class="brand-title">${companyName}</div>
        <div class="brand-subtitle">Driver Subscription Payment Receipt</div>
      </div>
      <div class="doc-meta">
        <div class="doc-badge paid">PAYMENT COMPLETED</div>
        <div class="meta-line">Receipt: <strong>#${data.receiptNumber}</strong></div>
        <div class="meta-line">Date: <strong>${formattedDate}</strong></div>
        ${data.transactionId ? `<div class="meta-line">Txn: <strong>${data.transactionId}</strong></div>` : ''}
      </div>
    </div>

    <!-- Driver & Plan Cards -->
    <div class="grid-2">
      <div class="card">
        <div class="card-title">Driver Information</div>
        <div class="info-row">
          <span class="info-label">Name:</span>
          <span class="info-val">${data.driver.name}</span>
        </div>
        ${data.driver.driverId ? `
        <div class="info-row">
          <span class="info-label">Driver ID:</span>
          <span class="info-val">#${data.driver.driverId}</span>
        </div>` : ''}
        ${data.driver.email ? `
        <div class="info-row">
          <span class="info-label">Email:</span>
          <span class="info-val">${data.driver.email}</span>
        </div>` : ''}
      </div>

      <div class="card">
        <div class="card-title">Active Subscription Plan</div>
        <div class="info-row">
          <span class="info-label">Plan Name:</span>
          <span class="info-val">${data.plan.name} (${data.plan.tier})</span>
        </div>
        <div class="info-row">
          <span class="info-label">Billing Cycle:</span>
          <span class="info-val">${data.plan.billingCycle}</span>
        </div>
        <div class="info-row">
          <span class="info-label">Valid Until:</span>
          <span class="info-val">${validUntil}</span>
        </div>
      </div>
    </div>

    <!-- Charges Table -->
    <table>
      <thead>
        <tr>
          <th>Description</th>
          <th>Period</th>
          <th class="text-right">Total</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>
            <strong>${data.plan.name} Membership</strong>
            <div style="font-size: 11px; color: #64748B;">Access to Moeb26 Chauffeur Dispatch Network</div>
          </td>
          <td>${data.plan.billingCycle}</td>
          <td class="text-right"><strong>${data.amount} ${currency}</strong></td>
        </tr>
      </tbody>
    </table>

    <!-- Totals -->
    <div class="totals-container">
      <div class="totals-box">
        <div class="totals-row">
          <span>Subtotal</span>
          <span>${data.amount} ${currency}</span>
        </div>
        ${data.tax ? `
        <div class="totals-row">
          <span>Tax</span>
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
      <div>Moeb26 Chauffeur Platform · Automated Payment Engine</div>
      <div>Receipt generated on ${new Date().toISOString().split('T')[0]}</div>
    </div>
  `;

  return wrapInPDFLayout(bodyContent, {
    title: `Subscription Receipt #${data.receiptNumber}`,
    theme: 'corporate',
  });
}
