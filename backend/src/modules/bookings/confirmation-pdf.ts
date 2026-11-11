// Booking confirmation PDF (§10.10): A4, 48 pt margins, Helvetica. Generated on demand, never stored.
import PDFDocument from 'pdfkit';
import { ROLE_LABELS, formatDuration, type Booking } from '@campushub/shared';
import { config } from '../../config/env.js';
import { appError } from '../../errors/app-error.js';
import { campusTimestamp, longDate } from '../../lib/format.js';

interface PdfContext {
  institutionName: string;
  supportEmail: string | null;
  campusTimezone: string;
}

export function assertApproved(b: { status: string }) {
  if (b.status !== 'approved') {
    throw appError('INVALID_STATUS_TRANSITION', 'A confirmation is only available for approved bookings.');
  }
}

export function renderConfirmationPdf(b: Booking, ctx: PdfContext): Promise<Buffer> {
  assertApproved(b);
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margins: { top: 48, bottom: 48, left: 48, right: 48 }, info: { Title: `Booking confirmation ${b.reference}` } });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const left = 48;
    const width = doc.page.width - 96;
    const muted = '#5E6A82';
    const ink = '#141B2D';

    // 1. Header band
    const top = 48;
    doc.font('Helvetica-Bold').fontSize(14).fillColor('#1E3A8A').text(ctx.institutionName, left, top, { width: width - 170 });
    doc.font('Helvetica-Bold').fontSize(20).fillColor(ink).text('Venue Booking Confirmation', left, doc.y + 4, { width: width - 170 });
    doc.font('Helvetica').fontSize(9).fillColor(muted).text('REFERENCE', left + width - 160, top, { width: 160, align: 'right', characterSpacing: 0.6 });
    doc.font('Helvetica-Bold').fontSize(12).fillColor(ink).text(b.reference, left + width - 160, top + 13, { width: 160, align: 'right' });
    doc.font('Helvetica-Bold').fontSize(11).fillColor('#146C43').text('APPROVED', left + width - 160, top + 31, { width: 160, align: 'right', characterSpacing: 0.8 });

    // 2. Divider
    let y = Math.max(doc.y, top + 50) + 16;
    doc.moveTo(left, y).lineTo(left + width, y).lineWidth(1).strokeColor('#E4E8F1').stroke();
    y += 20;

    const section = (title: string, rows: [string, string][]) => {
      doc.font('Helvetica-Bold').fontSize(11).fillColor('#1E3A8A').text(title, left, y, { characterSpacing: 0.3 });
      y = doc.y + 10;
      for (const [label, value] of rows) {
        doc.font('Helvetica').fontSize(9).fillColor(muted).text(label.toUpperCase(), left, y, { width: 150, characterSpacing: 0.6 });
        doc.font('Helvetica').fontSize(11).fillColor(ink).text(value, left + 160, y - 1, { width: width - 160 });
        y = Math.max(doc.y, y + 12) + 9;
      }
      y += 12;
    };

    section('Booking details', [
      ['Venue', b.venue.name],
      ['Location', b.venue.locationDetails ? `${b.venue.building}, ${b.venue.locationDetails}` : b.venue.building],
      ['Date', longDate(b.date)],
      ['Time', `${b.startTime} – ${b.endTime} (${ctx.campusTimezone})`],
      ['Duration', formatDuration(b.durationMinutes)],
      ['Purpose', b.purpose],
      ['Expected attendees', b.expectedAttendees ? String(b.expectedAttendees) : 'Not specified'],
    ]);
    section('Requested by', [
      ['Name', b.requester.fullName],
      ['Email', b.requester.email],
      ['Role', ROLE_LABELS[b.requester.role]],
      ...(b.requester.department ? ([['Department', b.requester.department]] as [string, string][]) : []),
    ]);
    section('Approval', [
      ['Approved by', b.decidedBy?.fullName ?? '—'],
      ['Approved on', b.decidedAt ? campusTimestamp(new Date(b.decidedAt), ctx.campusTimezone) : '—'],
      ...(b.approvalNote ? ([['Note', b.approvalNote]] as [string, string][]) : []),
    ]);

    // 6. Footer
    const footerLines = [
      `Generated on ${campusTimestamp(new Date(), ctx.campusTimezone)} (${ctx.campusTimezone}).`,
      `This confirmation is valid only while the booking remains Approved. Check the current status at ${config.FRONTEND_URL}/bookings/${b.id}.`,
      ...(ctx.supportEmail ? [`Questions: ${ctx.supportEmail}`] : []),
    ];
    const footerY = doc.page.height - 48 - footerLines.length * 22;
    doc.moveTo(left, footerY - 10).lineTo(left + width, footerY - 10).strokeColor('#E4E8F1').stroke();
    doc.font('Helvetica').fontSize(8).fillColor(muted);
    let fy = footerY;
    for (const line of footerLines) {
      doc.text(line, left, fy, { width, lineBreak: true });
      fy = doc.y + 4;
    }
    doc.end();
  });
}
