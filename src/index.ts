import { Hono } from "hono";
import { checkOrigin, loadSession } from "./auth";
import { ensureShop } from "./db";
import { imageHeaders } from "./lib/images";
import { resolveTheme } from "./lib/theme";
import admin from "./routes/admin";
import customer from "./routes/customer";
import customers from "./routes/customers";
import enquiry from "./routes/enquiry";
import broadcasts from "./routes/broadcasts";
import recovery from "./routes/recovery";
import staff from "./routes/staff";
import type { AppEnv } from "./types";
import { messagePage } from "./views/layout";

const app = new Hono<AppEnv>();

// Security headers on everything the Worker renders.
app.use("*", async (c, next) => {
  await next();
  c.header("Referrer-Policy", "no-referrer");
  c.header("X-Content-Type-Options", "nosniff");
  c.header("X-Frame-Options", "DENY");
  // Camera allowed for this site only (the in-app QR scanner on /staff/scan).
  c.header("Permissions-Policy", "camera=(self), microphone=(), geolocation=()");
  if (!c.res.headers.has("Content-Security-Policy")) c.header(
    "Content-Security-Policy",
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; " +
      "font-src 'self' https://fonts.gstatic.com; img-src 'self' data: blob: https:; connect-src 'self'; " +
      "manifest-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
  );
  if (new URL(c.req.url).protocol === "https:") c.header("Strict-Transport-Security", "max-age=31536000");
});

// Load (or create on first run) this deploy's shop.
app.use("*", async (c, next) => {
  c.set("shop", await ensureShop(c.env));
  await next();
});
app.use("*", checkOrigin); // every POST/PATCH/DELETE, including plain HTML forms
app.use("*", loadSession);

app.get("/", (c) => c.redirect("/join", 302));

// Uploaded logo and custom stamp icon, stored in D1.
for (const [path, table] of [["/logo", "shop_logos"], ["/stamp-icon", "shop_stamp_icons"]] as const) {
  app.get(path, async (c) => {
    const row = await c.env.DB.prepare(`SELECT content_type, data FROM ${table} WHERE shop_id = ?`)
      .bind(c.var.shop.id)
      .first<{ content_type: string; data: ArrayBuffer | number[] }>();
    if (!row) return c.notFound();
    const bytes = row.data instanceof ArrayBuffer ? row.data : new Uint8Array(row.data).buffer;
    return c.body(bytes, 200, imageHeaders(row.content_type));
  });
}

app.route("/", customer);
app.route("/", staff);
app.route("/", recovery);
app.route("/", customers);
app.route("/", broadcasts);
app.route("/", admin);
app.route("/", enquiry);

app.notFound((c) => {
  if (c.req.path.startsWith("/api/")) return c.json({ ok: false, code: "NOT_FOUND" }, 404);
  return c.html(messagePage(resolveTheme(c.var.shop), "Page not found", "That page doesn't exist.", { href: "/join", label: "Go to my card" }), 404);
});

app.onError((err, c) => {
  console.error(err);
  if (c.req.path.startsWith("/api/")) return c.json({ ok: false, code: "SERVER_ERROR", message: "Something went wrong. Please try again." }, 500);
  return c.text("Something went wrong. Please try again.", 500);
});

export default app;
