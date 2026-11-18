import { html, raw, type Raw } from "../lib/html";
import { themeCss, type Theme } from "../lib/theme";

export interface PageOpts {
  title: string;
  theme: Theme;
  body: Raw;
  scripts?: string[];
  manifest?: string;
  bodyClass?: string;
  noindex?: boolean;
}

export const ASSET_VERSION = "1";

export function page(o: PageOpts): string {
  const t = o.theme;
  return (
    "<!doctype html>" +
    html`<html lang="en-GB">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${o.title}</title>
<meta name="theme-color" content="${t.primary}">
<meta name="referrer" content="no-referrer">
${o.noindex !== false ? raw('<meta name="robots" content="noindex">') : ""}
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-title" content="${t.name}">
<link rel="apple-touch-icon" href="${t.icons.apple}">
<link rel="icon" href="${t.icons["192"]}">
${o.manifest ? html`<link rel="manifest" href="${o.manifest}">` : ""}
${t.fontsUrl ? html`<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link rel="stylesheet" href="${t.fontsUrl}">` : ""}
<link rel="stylesheet" href="/css/app.css?v=${ASSET_VERSION}">
<style>${raw(themeCss(t))}</style>
</head>
<body class="${o.bodyClass || ""}">
${o.body}
${(o.scripts || []).map((s) => html`<script src="${s}?v=${ASSET_VERSION}" defer></script>`)}
</body>
</html>`.value
  );
}

export function brandHeader(t: Theme, size: "lg" | "sm" = "lg"): Raw {
  return html`<header class="brand brand-${size}">
    <img class="brand-logo" src="${t.logo}" alt="${t.name}" width="${size === "lg" ? 112 : 56}" height="${size === "lg" ? 112 : 56}">
    ${t.showNameWithLogo ? html`<h1 class="brand-name">${t.name}</h1>` : html`<h1 class="sr-only">${t.name}</h1>`}
  </header>`;
}

export function messagePage(theme: Theme, title: string, message: string, action?: { href: string; label: string }): string {
  return page({
    title,
    theme,
    body: html`<main class="wrap center">
      ${brandHeader(theme, "sm")}
      <section class="panel">
        <h2 class="display">${title}</h2>
        <p>${message}</p>
        ${action ? html`<a class="btn btn-primary" href="${action.href}">${action.label}</a>` : ""}
      </section>
    </main>`,
  });
}
