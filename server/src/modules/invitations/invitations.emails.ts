import { escapeHtml, type MailMessage } from '../../lib/mailer.ts';

const fmt = (d: Date, timeZone: string) =>
  new Intl.DateTimeFormat('en-GB', {
    timeZone,
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(d);

/** FR-084, FR-085 — event details, the guest's assigned activities and personal invitation link. */
export function invitationEmail(o: {
  to: string;
  guestName: string;
  event: { name: string; description: string; startsAt: Date; endsAt: Date; timezone: string };
  activities: { name: string; startsAt: Date; timezone: string; venue: string | null }[];
  organiserName: string | null;
  url: string;
}): MailMessage {
  const eventWhen = `${fmt(o.event.startsAt, o.event.timezone)} – ${fmt(o.event.endsAt, o.event.timezone)}`;
  const organiserLine = o.organiserName ? `You're invited by ${o.organiserName}.` : "You're invited to an event.";
  const intro = [
    `Hi ${o.guestName},`,
    `${organiserLine} We'd love you to join us for ${o.event.name}.`,
    `When: ${eventWhen}`,
    ...(o.event.description ? [o.event.description.slice(0, 500)] : []),
  ];

  const activityLines = o.activities.map((activity) => {
    const when = fmt(activity.startsAt, activity.timezone);
    return `${activity.name} — ${when}${activity.venue ? ` · ${activity.venue}` : ''}`;
  });

  const plainSchedule = activityLines.length
    ? `\n\nYour activities:\n${activityLines.map((line) => `• ${line}`).join('\n')}`
    : '\n\nOpen your personal event page to see the event details and schedule.';

  const personalNote =
    "This invitation link is personal to you, so please don't forward it. You can view your event details and update your RSVP using the link below. No account is needed.";

  const activityRows = o.activities
    .map((activity) => {
      const venue = activity.venue
        ? `<div style="margin-top:5px;color:#6b7280;font-size:13px;">${escapeHtml(activity.venue)}</div>`
        : '';
      return `
        <tr>
          <td style="padding:14px 16px;border-bottom:1px solid #eeeaf5;">
            <div style="font-weight:600;color:#25213a;font-size:15px;">${escapeHtml(activity.name)}</div>
            <div style="margin-top:5px;color:#5b5670;font-size:13px;">${escapeHtml(fmt(activity.startsAt, activity.timezone))}</div>
            ${venue}
          </td>
        </tr>`;
    })
    .join('');

  const scheduleSection = o.activities.length
    ? `
      <div style="margin:26px 0 10px;font-size:16px;font-weight:700;color:#25213a;">Your schedule</div>
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border:1px solid #eeeaf5;border-radius:10px;border-collapse:separate;border-spacing:0;overflow:hidden;">
        ${activityRows}
      </table>`
    : `
      <p style="margin:24px 0 0;color:#5b5670;line-height:1.6;">
        Open your personal event page to see the full event details and schedule.
      </p>`;

  const html = `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:28px 12px;background:#f5f3fa;font-family:Arial,Helvetica,sans-serif;color:#25213a;">
  <div style="max-width:600px;margin:0 auto;">
    <div style="padding:18px 24px;text-align:center;">
      <div style="font-size:25px;font-weight:700;letter-spacing:-.5px;color:#5141a5;">Gatherly</div>
      <div style="margin-top:5px;font-size:12px;color:#77718d;letter-spacing:1.2px;text-transform:uppercase;">Make moments together</div>
    </div>
    <div style="background:#ffffff;border:1px solid #ece8f4;border-radius:16px;padding:32px 28px;">
      <div style="display:inline-block;padding:6px 11px;border-radius:20px;background:#f0edff;color:#5141a5;font-size:12px;font-weight:700;">YOU'RE INVITED</div>
      <h1 style="margin:18px 0 12px;font-size:27px;line-height:1.25;color:#25213a;">${escapeHtml(o.event.name)}</h1>
      <p style="margin:0 0 8px;font-size:15px;line-height:1.65;color:#4b465d;">Hi ${escapeHtml(o.guestName)},</p>
      <p style="margin:0 0 16px;font-size:15px;line-height:1.65;color:#4b465d;">${escapeHtml(organiserLine)} We'd love you to join us for <strong>${escapeHtml(o.event.name)}</strong>.</p>
      <div style="padding:14px 16px;border-radius:10px;background:#f7f5fc;color:#40396a;font-size:14px;line-height:1.6;">
        <strong>When</strong><br>${escapeHtml(eventWhen)}
      </div>
      ${o.event.description ? `<p style="margin:18px 0 0;font-size:14px;line-height:1.7;color:#5b5670;">${escapeHtml(o.event.description.slice(0, 500))}</p>` : ''}
      ${scheduleSection}
      <div style="margin:28px 0 8px;text-align:center;">
        <a href="${escapeHtml(o.url)}" style="display:inline-block;padding:14px 25px;border-radius:9px;background:#5141a5;color:#ffffff;text-decoration:none;font-size:15px;font-weight:700;">View Invitation &amp; RSVP</a>
      </div>
      <p style="margin:14px 0 0;text-align:center;font-size:12px;line-height:1.6;color:#77718d;">No account needed — open your personal invitation to view the details and RSVP.</p>
      <div style="margin-top:28px;padding-top:20px;border-top:1px solid #eeeaf5;">
        <p style="margin:0;font-size:13px;line-height:1.7;color:#6b667b;">${escapeHtml(personalNote)}</p>
        <p style="margin:12px 0 0;font-size:12px;line-height:1.6;color:#77718d;">If the button doesn't work, copy and paste this link into your browser:<br>
          <a href="${escapeHtml(o.url)}" style="color:#5141a5;word-break:break-all;">${escapeHtml(o.url)}</a>
        </p>
      </div>
    </div>
    <div style="padding:20px 12px;text-align:center;font-size:12px;line-height:1.6;color:#8a849a;">
      Sent with care by Gatherly<br>
      Please don't forward this personal invitation.
    </div>
  </div>
</body>
</html>`;

  return {
    to: o.to,
    subject: `You're invited: ${o.event.name}`,
    text: `${intro.join('\n\n')}${plainSchedule}\n\nView Invitation & RSVP: ${o.url}\n\n${personalNote}\n`,
    html,
  };
}
