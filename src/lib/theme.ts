// Turns a shop row into a resolved theme. Everything visual on every page
// comes from here; owners change it in the setup wizard or /admin.
import { DEFAULTS, VENUE_TYPES, type StampIcon, type VenueType } from "../defaults";
import type { ShopRow } from "../types";

export interface ThemeOverrides {
  accent?: string;
  ink?: string;
  background?: string;
  surface?: string;
  fontDisplay?: string;
  fontBody?: string;
  fontsUrl?: string;
  stampIcon?: StampIcon;
  tagline?: string;
  showNameWithLogo?: boolean;
  /** Show "Powered by Stamp Card" on the card page (default true). */
  poweredBy?: boolean;
  venueType?: VenueType;
  /** Set when a custom stamp icon is uploaded (cache buster for /stamp-icon). */
  stampIconVersion?: number;
}

export interface Theme {
  name: string;
  tagline: string;
  logo: string;
  showNameWithLogo: boolean;
  primary: string;
  secondary: string;
  /** Text on primary/secondary backgrounds (the shop's "Text colour"). */
  onPrimary: string;
  /** Background of the broadcast pop-up: the secondary or primary colour. */
  broadcastBg: string;
  broadcastBgSetting: "primary" | "secondary";
  accent: string;
  onAccent: string;
  ink: string;
  background: string;
  surface: string;
  fontDisplay: string;
  fontBody: string;
  fontsUrl?: string;
  stampIcon: StampIcon;
  /** URL of the uploaded stamp icon when stampIcon is "custom". */
  stampIconUrl: string | null;
  poweredBy: boolean;
  venueType: VenueType | null;
  icons: { "192": string; "512": string; apple: string };
}

/** Built-in icons (plus "custom", which needs an uploaded image). */
export const STAMP_ICONS: StampIcon[] = ["circle", "cup", "glass", "plate", "star"];
export const HEX = /^#[0-9a-fA-F]{6}$/;

export function parseOverrides(json: string | null | undefined): ThemeOverrides {
  try {
    const v = JSON.parse(json || "{}");
    return v && typeof v === "object" ? v : {};
  } catch {
    return {};
  }
}

export function luminance(hex: string): number {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const [r, g, b] = c.map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio between two hex colours (1–21). */
export function contrastRatio(a: string, b: string): number {
  if (!HEX.test(a) || !HEX.test(b)) return 1;
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}
export const WCAG_AA = 4.5;

/** Black or white text, whichever reads better on `bg`. */
export function textOn(bg: string, dark = "#111111"): string {
  if (!HEX.test(bg)) return "#ffffff";
  const L = luminance(bg);
  return (1.05 / (L + 0.05)) >= ((L + 0.05) / 0.05) ? "#ffffff" : dark;
}

const pick = (v: string | undefined | null, fallback: string) => (v && HEX.test(v) ? v : fallback);

export function resolveTheme(shop: ShopRow): Theme {
  const d = DEFAULTS;
  const o = parseOverrides(shop.theme);
  const primary = pick(shop.primary_colour, d.colours.primary);
  const secondary = pick(shop.secondary_colour, d.colours.secondary);
  const text = pick(shop.text_colour, d.colours.text);
  const broadcastBgSetting = shop.broadcast_bg === "primary" ? "primary" : "secondary";
  const accent = pick(o.accent, d.colours.accent);
  const ink = pick(o.ink, d.colours.ink);
  const custom = o.stampIcon === "custom" && !!o.stampIconVersion;
  const logo = shop.logo_url || d.logo;
  const icon = shop.logo_url || d.icon;
  return {
    name: shop.name,
    tagline: o.tagline ?? d.tagline,
    logo,
    showNameWithLogo: o.showNameWithLogo ?? d.showNameWithLogo,
    primary,
    secondary,
    onPrimary: text,
    broadcastBg: broadcastBgSetting === "primary" ? primary : secondary,
    broadcastBgSetting,
    accent,
    onAccent: textOn(accent, ink),
    ink,
    background: pick(o.background, d.colours.background),
    surface: pick(o.surface, d.colours.surface),
    fontDisplay: o.fontDisplay || d.fonts.display,
    fontBody: o.fontBody || d.fonts.body,
    fontsUrl: o.fontsUrl || undefined,
    stampIcon: custom ? "custom" : o.stampIcon && STAMP_ICONS.includes(o.stampIcon) ? o.stampIcon : d.stampIcon,
    stampIconUrl: custom ? `/stamp-icon?v=${o.stampIconVersion}` : null,
    poweredBy: o.poweredBy !== false,
    venueType: o.venueType && VENUE_TYPES.includes(o.venueType) ? o.venueType : null,
    icons: { "192": icon, "512": icon, apple: icon },
  };
}

/** CSS custom properties injected into every page. */
export function themeCss(t: Theme): string {
  const safeFont = (f: string) => f.replace(/[;{}<>]/g, "");
  return `:root{--primary:${t.primary};--secondary:${t.secondary};--on-primary:${t.onPrimary};--broadcast-bg:${t.broadcastBg};--accent:${t.accent};--on-accent:${t.onAccent};--ink:${t.ink};--bg:${t.background};--surface:${t.surface};--font-display:${safeFont(t.fontDisplay)};--font-body:${safeFont(t.fontBody)}}`;
}

/** Filled stamp artwork. Uses theme colours via CSS variables. */
export function stampSvg(icon: StampIcon, customUrl?: string | null): string {
  if (icon === "custom" && customUrl) return `<img class="stamp-art" src="${customUrl.replace(/[^\w\-./?=]/g, "")}" alt="" aria-hidden="true">`;
  const open = `<svg viewBox="0 0 48 48" aria-hidden="true" class="stamp-art">`;
  switch (icon) {
    case "cup":
      return (
        open +
        `<path d="M9 17h26v11a11 11 0 01-11 11h-4A11 11 0 019 28z" fill="var(--primary)"/>` +
        `<path d="M35 20h3a5 5 0 010 10h-3" stroke="var(--primary)" stroke-width="3.5" fill="none"/>` +
        `<path d="M17 6c-2 3 2 4 0 7M24 6c-2 3 2 4 0 7" stroke="var(--accent)" stroke-width="2.5" fill="none" stroke-linecap="round"/>` +
        `<rect x="6" y="41" width="32" height="3" rx="1.5" fill="var(--primary)"/></svg>`
      );
    case "glass":
      return (
        open +
        `<path d="M10 6h28l-3 18a11 11 0 01-22 0z" fill="var(--primary)"/>` +
        `<path d="M12 13h24" stroke="var(--accent)" stroke-width="2.5" stroke-linecap="round"/>` +
        `<rect x="22" y="33" width="4" height="8" fill="var(--primary)"/>` +
        `<rect x="14" y="40" width="20" height="4" rx="2" fill="var(--primary)"/></svg>`
      );
    case "plate":
      return (
        open +
        `<circle cx="24" cy="24" r="20" fill="var(--primary)"/>` +
        `<circle cx="24" cy="24" r="12" fill="none" stroke="var(--accent)" stroke-width="2.5"/></svg>`
      );
    case "star":
      return open + `<path d="M24 4l6 13 14 1.6-10.5 9.5 3 14L24 35l-12.5 7.1 3-14L4 18.6 18 17z" fill="var(--primary)"/></svg>`;
    case "circle":
    default:
      return open + `<circle cx="24" cy="24" r="20" fill="var(--primary)"/></svg>`;
  }
}
