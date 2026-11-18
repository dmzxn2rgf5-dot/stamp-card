#!/usr/bin/env bash
# Fails if anything that looks like a real business, account or secret is in the repo.
# Runs in CI on every push. Run it yourself before every release: npm run check:clean
set -u
cd "$(dirname "$0")/.."

# Everything git would commit (tracked + new files not in .gitignore). Outside git: every file
# except dependencies and local state.
if git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  LIST=$(git ls-files --cached --others --exclude-standard | sort -u)
else
  LIST=$(find . -type f -not -path "./node_modules/*" -not -path "./.git/*" -not -path "./.wrangler/*" | sed 's|^\./||')
fi
# Lock files and vendored libraries are third-party; this script contains the patterns themselves.
LIST=$(printf '%s\n' "$LIST" | grep -vE '^(package-lock\.json|public/js/vendor/.*|scripts/check-clean\.sh)$')

fail=0
check() { # label, extended regex, optional grep flag, optional "allowed" regex
  local label="$1" re="$2" flag="${3:-}" allow="${4:-}"
  local hits
  hits=$(printf '%s\n' "$LIST" | tr '\n' '\0' | xargs -0 grep -nIE $flag -e "$re" -- 2>/dev/null || true)
  if [ -n "$allow" ] && [ -n "$hits" ]; then
    # Drop lines where every match is an allowed one.
    hits=$(printf '%s\n' "$hits" | while IFS= read -r line; do
      rest=$(printf '%s' "${line#*:*:}" | grep -oE $flag -e "$re" | grep -vE $flag -e "$allow" || true)
      [ -n "$rest" ] && printf '%s\n' "$line"
    done)
  fi
  if [ -n "$hits" ]; then
    echo "✗ $label"
    printf '%s\n' "$hits" | head -20 | sed 's/^/    /'
    fail=1
  else
    echo "✓ $label"
  fi
}

# Private names (e.g. the business this was first built for) live in an untracked file,
# scripts/.private-patterns: one extended regex per line, matched case-insensitively,
# blank lines and lines starting with # ignored. Skipped when the file doesn't exist (e.g. in CI).
PRIVATE="$(dirname "$0")/.private-patterns"
if [ -f "$PRIVATE" ]; then
  private_re=$(grep -vE '^[[:space:]]*(#|$)' "$PRIVATE" | paste -sd '|' -)
  if [ -n "$private_re" ]; then
    check "private names (scripts/.private-patterns)" "$private_re" -i
  fi
else
  echo "- private names: skipped (no scripts/.private-patterns)"
fi
# Allowed: the public Stamp Card demo, linked from the README.
check "workers.dev addresses" '[a-z0-9-]+\.[a-z0-9-]+\.workers\.dev' '' '^stamp-card-demo\.getstampcard\.workers\.dev$'
check "32-character hex strings (Cloudflare account IDs)" '(^|[^0-9a-f])[0-9a-f]{32}([^0-9a-f]|$)'
# Allowed: the all-zero test ID, and the public Web3Forms key for the enquiry form (src/config.ts).
check "UUIDs (D1 database IDs)" '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}' -i '^(0{8}-0{4}-0{4}-0{4}-0{12}|6b778227-8154-4f3e-a4db-b113abc77d11)$'
check "email addresses (only example.com/.org/.net allowed)" '[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}' -i '@example\.(com|org|net)$'
check "API tokens and private keys" '(gh[pousr]_[A-Za-z0-9]{20,}|sk-[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16}|xox[baprs]-[A-Za-z0-9-]{10,}|-----BEGIN [A-Z ]*PRIVATE KEY-----)'
check "phone numbers" '(\+44 ?|(^|[^0-9])0)7[0-9]{3} ?[0-9]{3} ?[0-9]{3}([^0-9]|$)'

# Files that must never be tracked at all.
bad=$(printf '%s\n' "$LIST" | grep -E '(^|/)(\.dev\.vars|\.env(\..*)?|wrangler\.toml|[^/]*\.sqlite[0-9]*|\.setup-token|\.private-patterns)$' || true)
if [ -n "$bad" ]; then
  echo "✗ local config, secrets or databases are in the repo:"
  printf '    %s\n' $bad
  fail=1
else
  echo "✓ no local config, secrets or databases in the repo"
fi

if [ "$fail" -ne 0 ]; then
  echo
  echo "Clean check FAILED"
  exit 1
fi
echo
echo "Clean check passed"
