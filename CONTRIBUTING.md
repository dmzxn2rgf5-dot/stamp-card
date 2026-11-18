# Contributing

Thanks for helping. Keep it simple: Stamp Card is meant to stay small enough for one person to understand.

1. **Fork** the repo and create a branch: `git checkout -b my-change`.
2. **Set up locally:**
   ```sh
   npm install
   cp wrangler.toml.example wrangler.toml
   cp .dev.vars.example .dev.vars
   npm run db:migrate:local
   npm run seed     # optional demo data
   npm run dev
   ```
3. **Make your change.** Follow the existing style: Hono routes in `src/routes`, plain JavaScript with no build step in `public/js`, and a new numbered file in `migrations/` for any schema change. Never edit an existing migration.
4. **Add or update tests** in `test/`.
5. **Check everything passes:** `npm run check` (type-check, lint, tests, clean check).
6. **Open a pull request** that explains what changed and why.

Please don't add tracking, third-party scripts, or anything that needs a paid plan for the basic features. Venue-specific wording belongs in settings, not code.

Found a security problem? See [SECURITY.md](SECURITY.md) instead of opening an issue.
