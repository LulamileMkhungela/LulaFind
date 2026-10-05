// Deliver a durable moderation report to the trust-and-safety inbox.
//
// This function is intentionally separate from the browser: writing a report
// row is not the same thing as sending Gmail. Deploy it and install the
// `lula_report_email` database webhook/trigger described in
// supabase/report-email-webhook.sql.
//
// Required Edge Function secrets:
//   RESEND_API_KEY       API key for the chosen Resend account
//   MODERATION_EMAIL_TO  inbox that owns the moderation queue
//   REPORT_WEBHOOK_SECRET secret shared with the database trigger
// Optional:
//   MODERATION_EMAIL_FROM a verified sender (defaults to reports@resend.dev)

interface WebhookRow {
  collection?: string;
  id?: string;
  payload?: Record<string, unknown>;
}
interface WebhookEnvelope { record?: WebhookRow; }

const json = (body: unknown, status = 200): Response => new Response(JSON.stringify(body), {
  status,
  headers: { 'content-type': 'application/json' }
});

const text = (value: unknown, max: number): string => String(value ?? '').trim().slice(0, max);
const html = (value: string): string => value
  .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;').replaceAll("'", '&#39;');

Deno.serve(async (request) => {
  if (request.method !== 'POST') return json({ error: 'POST required' }, 405);
  const expected = Deno.env.get('REPORT_WEBHOOK_SECRET');
  if (!expected || request.headers.get('authorization') !== `Bearer ${expected}`) {
    return json({ error: 'Webhook is not configured or authorization is invalid' }, 401);
  }

  const apiKey = Deno.env.get('RESEND_API_KEY');
  const to = Deno.env.get('MODERATION_EMAIL_TO');
  if (!apiKey || !to) {
    // The report is already durable in Postgres. Returning an explicit state
    // makes a missing email integration observable instead of a fake success.
    console.error('send-report-email is not configured: set RESEND_API_KEY and MODERATION_EMAIL_TO');
    return json({ delivered: false, configured: false, reason: 'email provider or recipient is not configured' }, 503);
  }

  let envelope: WebhookEnvelope;
  try { envelope = await request.json() as WebhookEnvelope; } catch { return json({ error: 'Invalid JSON' }, 400); }
  const row = envelope.record;
  if (row?.collection !== 'reports' || !row.payload) return json({ ignored: true });

  const p = row.payload;
  const id = text(row.id, 120);
  const target = text(p.target, 30);
  const summary = text(p.summary, 300);
  const reason = text(p.reason, 160);
  const detail = text(p.detail, 900);
  const reporter = text(p.byUserId, 120);
  const reportUrl = `${Deno.env.get('APP_URL') ?? 'https://lulafind.app'}/admin`;
  const subject = `[LulaFind] New ${target || 'content'} report ${id}`;
  const body = [
    `A new LulaFind report needs review.`,
    `Report: ${id}`,
    `Target: ${target}`,
    `Reason: ${reason}`,
    `Summary: ${summary}`,
    `Details: ${detail || '(none)'}`,
    `Reporter: ${reporter}`,
    `Open the moderation queue: ${reportUrl}`
  ].join('\n');

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: Deno.env.get('MODERATION_EMAIL_FROM') ?? 'LulaFind reports <reports@resend.dev>',
      to: [to], subject,
      text: body,
      html: `<h2>LulaFind report</h2><p>A new report needs review.</p><dl>` +
        `<dt>Report</dt><dd>${html(id)}</dd><dt>Target</dt><dd>${html(target)}</dd>` +
        `<dt>Reason</dt><dd>${html(reason)}</dd><dt>Summary</dt><dd>${html(summary)}</dd>` +
        `<dt>Details</dt><dd>${html(detail || '(none)')}</dd><dt>Reporter</dt><dd>${html(reporter)}</dd>` +
        `</dl><p><a href="${html(reportUrl)}">Open the moderation queue</a></p>`
    })
  });

  if (!response.ok) {
    console.error('Resend rejected report email:', response.status, await response.text());
    return json({ delivered: false, configured: true, reason: 'email provider rejected the message' }, 502);
  }
  return json({ delivered: true, configured: true });
});
