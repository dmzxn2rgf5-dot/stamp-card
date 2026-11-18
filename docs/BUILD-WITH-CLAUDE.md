# Build a customised version with Claude Code

Stamp Card was built from a plain-English brief by [Claude Code](https://claude.com/claude-code), Anthropic's coding assistant that works in your terminal. You can use it the same way to change Stamp Card or build something new on the same idea.

## 1. Change this project

Most venues won't need to. Branding, rewards and stamp counts are all in the setup wizard and Admin. For anything else, open Claude Code in the project folder and describe the change as you would to a developer. It works best when you say what should happen, who it's for, and how you'll know it's done. For example:

```text
Read README.md, docs/CONFIG.md and the code in src/ first.

Add a "birthday stamp": the owner can tick "give a bonus stamp in a customer's
birthday month" in Admin. Customers can optionally add their birthday month (not
the day or year) on their card page.

- Keep it optional and off by default.
- Follow the existing patterns: Hono routes in src/routes, D1 migration in
  migrations/, no build step for public/js.
- Add tests next to the existing ones in test/.
- Done when npm run check passes.
```

Tips:

- Ask for a plan first ("don't change anything yet, tell me how you'd do it") on bigger changes.
- Keep `npm run check` green. It runs type-check, lint, tests and the clean check.
- Never paste your Cloudflare account ID, database ID or secrets into a prompt you might share. They belong in `wrangler.toml` and `wrangler secret`, which stay on your machine.

## 2. Build your own from scratch

To build something different on the same idea, for example a gym punch card or a car-wash loyalty scheme, write a short brief and hand it to Claude Code in a new, empty folder:

1. Describe how it works from the customer's side and the staff's side, step by step.
2. List the screens, the data you'll store, and the limits (stamps per day, undo window and so on).
3. Cover security and edge cases: lost phones, double taps, two staff scanning at once.
4. End with "done when" checks you can tick off.
5. Open Claude Code in that folder and say:
   ```text
   Read brief.md and build it. Ask me about anything unclear before you start.
   ```
6. Add extra features as separate, smaller briefs once the main build works and its tests pass.

This project's [README](../README.md), [CONFIG](CONFIG.md) and [SECURITY](../SECURITY.md) docs are a good checklist of what a brief like this needs to cover.
