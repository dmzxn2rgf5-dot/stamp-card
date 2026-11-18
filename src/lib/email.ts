// All outgoing email goes through sendEmail(), so the provider can be
// swapped later by changing only this file.
//
// Production: Cloudflare Email Service via the `send_email` binding (EMAIL)
// with EMAIL_FROM on an onboarded domain.
// Local dev / tests: EMAIL_DEV_LOG=1 logs the email instead of sending it.
import { esc } from "./html";
import type { Theme } from "./theme";
import type { Env } from "../types";

export interface OutgoingEmail {
  to: string;
  subject: string;
  text: string;
  html: string;
}

/** Last emails "sent" in dev-log mode (handy for tests and local debugging). */
export const devOutbox: OutgoingEmail[] = [];

/** Email features exist only when EMAIL_RECOVERY=on. Off (the default) hides them everywhere. */
export function emailFeatureOn(env: Env): boolean {
  return (env.EMAIL_RECOVERY || "").trim().toLowerCase() === "on";
}

/** Switched on and able to send (or log, in local dev). */
export function emailEnabled(env: Env): boolean {
  return emailFeatureOn(env) && (env.EMAIL_DEV_LOG === "1" || (!!env.EMAIL && !!env.EMAIL_FROM));
}

export async function sendEmail(env: Env, fromName: string, msg: OutgoingEmail): Promise<boolean> {
  if (env.EMAIL_DEV_LOG === "1") {
    devOutbox.push(msg);
    if (devOutbox.length > 50) devOutbox.shift();
    console.log(`[email:dev] to=${msg.to} subject="${msg.subject}"\n${msg.text}`);
    return true;
  }
  if (!env.EMAIL || !env.EMAIL_FROM) {
    console.error("[email] not configured: add the send_email binding and EMAIL_FROM");
    return false;
  }
  try {
    await env.EMAIL.send({
      to: msg.to,
      from: { email: env.EMAIL_FROM, name: fromName.slice(0, 60) },
      subject: msg.subject,
      text: msg.text,
      html: msg.html,
    });
    return true;
  } catch (e) {
    const err = e as { code?: string; message?: string };
    console.error(`[email] send failed: ${err.code ?? ""} ${err.message ?? e}`);
    return false;
  }
}

/** Plain, short, one-button email in the shop's brand colour. */
export function linkEmail(t: Theme, opts: { to: string; subject: string; intro: string; button: string; url: string }): OutgoingEmail {
  const text = `${opts.intro}

${opts.button}: ${opts.url}

This link expires in 15 minutes.
Didn't ask for this? Ignore it – nothing will change.

${t.name}`;
  const html = `<!doctype html><html><body style="margin:0;padding:24px;background:#f4f4f6;font-family:Arial,Helvetica,sans-serif;color:#111">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">
<table role="presentation" width="100%" style="max-width:440px;background:#fff;border-radius:16px;padding:28px" cellpadding="0" cellspacing="0">
<tr><td style="font-size:20px;font-weight:bold;color:${esc(t.primary)};padding-bottom:12px">${esc(t.name)}</td></tr>
<tr><td style="font-size:16px;line-height:1.5;padding-bottom:22px">${esc(opts.intro)}</td></tr>
<tr><td align="center" style="padding-bottom:22px">
<a href="${esc(opts.url)}" style="display:inline-block;background:${esc(t.primary)};color:${esc(t.onPrimary)};font-size:18px;font-weight:bold;text-decoration:none;padding:16px 28px;border-radius:999px">${esc(opts.button)}</a>
</td></tr>
<tr><td style="font-size:14px;color:#555;line-height:1.5">This link expires in 15 minutes.<br>Didn't ask for this? Ignore it – nothing will change.</td></tr>
</table></td></tr></table></body></html>`;
  return { to: opts.to, subject: opts.subject, text, html };
}

/** a•••@example.com */
export function maskEmail(email: string): string {
  const [user, domain] = email.split("@");
  if (!domain) return "•••";
  return `${user.slice(0, 1)}•••${user.length > 4 ? user.slice(-1) : ""}@${domain}`;
}

export function normaliseEmail(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const e = v.trim().toLowerCase();
  if (e.length > 254 || !/^[^\s@<>"',;]+@[^\s@<>"',;]+\.[a-z]{2,}$/.test(e)) return null;
  return e;
}
