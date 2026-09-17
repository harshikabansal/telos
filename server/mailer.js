import fs from 'node:fs';
import path from 'node:path';
import config from './config.js';

/**
 * Outbound mail. TELOS ships without a bundled SMTP dependency, so the default
 * transport writes the message to the server log and to data/outbox.log.
 * Reset and verification links therefore stay on the server: they are never
 * returned in an HTTP response in production, which keeps the token
 * out-of-band even though delivery is simulated.
 *
 * To send real mail, set TELOS_EMAIL_TRANSPORT=webhook and TELOS_EMAIL_WEBHOOK
 * to an endpoint that relays {to, subject, body}.
 */
export function deliverMail({ to, subject, body }) {
  const record = `\n[${new Date().toISOString()}] TO: ${to}\nSUBJECT: ${subject}\n${body}\n${'-'.repeat(60)}\n`;

  if (config.emailTransport === 'webhook' && process.env.TELOS_EMAIL_WEBHOOK) {
    fetch(process.env.TELOS_EMAIL_WEBHOOK, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(process.env.TELOS_EMAIL_WEBHOOK_TOKEN
          ? { Authorization: `Bearer ${process.env.TELOS_EMAIL_WEBHOOK_TOKEN}` }
          : {}),
      },
      body: JSON.stringify({ to, subject, body }),
    }).catch((err) => console.error('[telos] mail webhook failed:', err.message));
    return;
  }

  try {
    fs.appendFileSync(path.join(config.dataDir, 'outbox.log'), record, { mode: 0o600 });
  } catch {
    /* logging must never break a request */
  }
  if (!config.isProduction) console.log(`[telos:mail]${record}`);
}
