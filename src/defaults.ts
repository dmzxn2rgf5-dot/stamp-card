// Neutral defaults for a fresh Stamp Card. Everything here can be changed
// by the owner in the setup wizard or /admin – nothing is per-business code.

export type StampIcon = "circle" | "cup" | "glass" | "plate" | "star" | "custom";
export type VenueType = "coffee" | "bar" | "restaurant" | "other";

export const PROJECT_NAME = "Stamp Card";
export const PROJECT_TAGLINE = "the loyalty card alternative";
/** Linked from the "Powered by Stamp Card" footer line. */
export const PROJECT_URL = "https://github.com/dmzxn2rgf5-dot/stamp-card";

export const DEFAULTS = {
  name: "Your Shop",
  tagline: "Collect a stamp every visit",
  rewardLabel: "Free drink",
  stampsRequired: 10,
  logo: "/img/logo.svg",
  icon: "/img/icon.svg",
  showNameWithLogo: true,
  stampIcon: "circle" as StampIcon,
  colours: {
    primary: "#2F6FED", // stamps, buttons, accents
    secondary: "#0B1F4B", // broadcast pop-up background, headings
    text: "#FFFFFF", // text on primary/secondary backgrounds
    accent: "#F5B700",
    ink: "#14161A", // body text on the page background
    background: "#FFFFFF",
    surface: "#F2F4F8",
  },
  fonts: {
    display: "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
    body: "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
  },
};

/** Venue type only picks sensible starting points for the icon and reward wording. */
export const VENUE_PRESETS: Record<VenueType, { label: string; stampIcon: StampIcon; rewardLabel: string }> = {
  coffee: { label: "Coffee shop", stampIcon: "cup", rewardLabel: "Free drink" },
  bar: { label: "Bar", stampIcon: "glass", rewardLabel: "Free drink" },
  restaurant: { label: "Restaurant", stampIcon: "plate", rewardLabel: "Free dessert" },
  other: { label: "Other", stampIcon: "circle", rewardLabel: "Free reward" },
};
export const VENUE_TYPES = Object.keys(VENUE_PRESETS) as VenueType[];
