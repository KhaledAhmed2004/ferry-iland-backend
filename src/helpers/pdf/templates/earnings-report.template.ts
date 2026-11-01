/**
 * Moeb26 Driver Earnings Report Template
 */

import { EarningsReportData } from '../pdf.types';
import { wrapInPDFLayout } from '../pdf.layout';

export function renderEarningsReportHTML(data: EarningsReportData): string {
  const currency = data.currency || 'EUR';
  const companyName = data.companyName || 'Moeb26 Chauffeur Services';
  const startDate = typeof data.period.start === 'string' ? data.period.start : data.period.start.toLocaleDateString('en-GB');
  const endDate = typeof data.period.end === 'string' ? data.period.end : data.period.end.toLocaleDateString('en-GB');

  const tripRows = (data.trips || [])
    .map(
      (trip) => `
      <tr>
        <td>${trip.date}</td>
        <td>#${trip.tripId}</td>
        <td>${trip.from} ➔ ${trip.to}</td>
        <td class="text-right">${trip.fare} ${currency}</td>
        <td class="text-right"><strong>${trip.driverCut} ${currency}</strong></td>
      </tr>`,
    )
    .join('');

  const bodyContent = `
    <!-- Header -->
    <div class="header">
      <div>
        <div class="brand-title">${companyName}</div>
        <div class="brand-subtitle">Driver Payout & Earnings Statement</div>
      </div>
      <div class="doc-meta">
        <div class="doc-badge">STATEMENT</div>
        <div class="meta-line">Report ID: <strong>#${data.reportId}</strong></div>
        <div class="meta-line">Period: <strong>${startDate} – ${endDate}</strong></div>
      </div>
    </div>

    <!-- Summary Cards -->
    <div class="grid-2">
      <div class="card">
        <div class="card-title">Driver Profile</div>
        <div class="info-row">
          <span class="info-label">Driver Name:</span>
          <span class="info-val">${data.driver.name}</span>
        </div>
        <div class="info-row">
          <span class="info-label">Driver ID:</span>
          <span class="info-val">#${data.driver.driverId}</span>
        </div>
        ${data.driver.email ? `
        <div class="info-row">
          <span class="info-label">Email:</span>
          <span class="info-val">${data.driver.email}</span>
        </div>` : ''}
      </div>

      <div class="card">
        <div class="card-title">Performance Metrics</div>
        <div class="info-row">
          <span class="info-label">Total Completed Rides:</span>
          <span class="info-val">${data.summary.totalTrips}</span>
        </div>
        <div class="info-row">
          <span class="info-label">Total Online Hours:</span>
          <span class="info-val">${data.summary.totalHours} hrs</span>
        </div>
      </div>
    </div>

    <!-- Financial Breakdown -->
    <div class="card" style="margin-bottom: 24px;">
      <div class="card-title">Payout Breakdown</div>
      <div class="info-row">
        <span class="info-label">Gross Ride Fares:</span>
        <span class="info-val">${data.summary.grossEarnings} ${currency}</span>
      </div>
      <div class="info-row">
        <span class="info-label">Platform Commission:</span>
        <span class="info-val" style="color: #DC2626;">-${data.summary.platformCommission} ${currency}</span>
      </div>
      <div class="info-row">
        <span class="info-label">Passenger Tips (100% to Driver):</span>
        <span class="info-val" style="color: #16A34A;">+${data.summary.tips} ${currency}</span>
      </div>
      <div class="info-row" style="border-top: 2px solid #E2E8F0; padding-top: 8px; margin-top: 8px; font-size: 14px;">
        <span class="info-label" style="font-weight: 700; color: #0F172A;">Net Payout Amount:</span>
        <span class="info-val" style="font-size: 15px; font-weight: 800; color: #16A34A;">${data.summary.netPayout} ${currency}</span>
      </div>
    </div>

    ${data.trips && data.trips.length > 0 ? `
    <!-- Trip Details -->
    <div style="font-size: 12px; font-weight: 700; text-transform: uppercase; margin-bottom: 8px; color: #64748B;">
      Trip Logs in Period
    </div>
    <table>
      <thead>
        <tr>
          <th>Date</th>
          <th>Trip</th>
          <th>Route</th>
          <th class="text-right">Total Fare</th>
          <th class="text-right">Driver Payout</th>
        </tr>
      </thead>
      <tbody>
        ${tripRows}
      </tbody>
    </table>` : ''}

    <!-- Footer -->
    <div class="footer">
      <div>Moeb26 Financial Settlement Division</div>
      <div>Confidential Document for Driver Record</div>
    </div>
  `;

  return wrapInPDFLayout(bodyContent, {
    title: `Earnings Statement #${data.reportId}`,
    theme: 'corporate',
  });
}
