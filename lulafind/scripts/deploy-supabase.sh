#!/usr/bin/env bash
# Deploy the LulaFind Supabase backend in one repeatable command.
#
# This deploys the canonical SQL and both Edge Functions. It does not deploy
# the Angular/Ionic frontend or Android APK. Never commit the environment values
# used by this script.
#
# Required environment variables:
#   SUPABASE_PROJECT_REF       default: srwdtguxdjsjlkaydhet
#   RESEND_API_KEY             Resend API key for moderation email
#   MODERATION_EMAIL_TO        moderation inbox
#   REPORT_WEBHOOK_SECRET      long random shared secret
#   SUPABASE_SERVICE_ROLE_KEY  stored in Vault for the database push trigger
#   FCM_SERVICE_ACCOUNT_FILE   path to the Firebase service-account JSON file
#
# Optional:
#   APP_URL                    public LulaFind URL
#   MODERATION_EMAIL_FROM     verified Resend sender
#
# Example:
#   export RESEND_API_KEY='re_...'
#   export MODERATION_EMAIL_TO='trust@example.com'
#   export REPORT_WEBHOOK_SECRET="$(openssl rand -hex 32)"
#   export SUPABASE_SERVICE_ROLE_KEY='...'
#   export FCM_SERVICE_ACCOUNT_FILE="$HOME/secrets/lulafinds-fcm.json"
#   export APP_URL='https://your-app.example'
#   ./scripts/deploy-supabase.sh

set -Eeuo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
SUPABASE_DIR="$(cd -- "$SCRIPT_DIR/.." && pwd)/supabase"
PROJECT_REF="${SUPABASE_PROJECT_REF:-srwdtguxdjsjlkaydhet}"
APP_URL="${APP_URL:-https://lulafind.app}"
CLI=(npx --yes supabase)

required=(
  RESEND_API_KEY
  MODERATION_EMAIL_TO
  REPORT_WEBHOOK_SECRET
  SUPABASE_SERVICE_ROLE_KEY
  FCM_SERVICE_ACCOUNT_FILE
)
for name in "${required[@]}"; do
  if [[ -z "${!name:-}" ]]; then
    echo "Missing required environment variable: $name" >&2
    exit 1
  fi
done

if [[ ! -f "$FCM_SERVICE_ACCOUNT_FILE" ]]; then
  echo "FCM service-account file does not exist: $FCM_SERVICE_ACCOUNT_FILE" >&2
  exit 1
fi

# Keep the service-account value on one line for the Edge Function secret.
FCM_SERVICE_ACCOUNT_JSON="$(node -e '
  const fs = require("fs");
  const file = process.argv[1];
  process.stdout.write(JSON.stringify(JSON.parse(fs.readFileSync(file, "utf8"))));
' "$FCM_SERVICE_ACCOUNT_FILE")"

run_sql() {
  local file="$1"
  echo "==> Applying $(basename "$file")"
  "${CLI[@]}" db query --linked --project-ref "$PROJECT_REF" --file "$file"
}

# Escape a value into a PostgreSQL single-quoted literal without printing it.
pg_quote() {
  local value="$1"
  value="${value//\'/\'\'}"
  printf "'%s'" "$value"
}

# Store a secret in Supabase Vault without putting it in a committed SQL file.
# This is needed because the database triggers call the Edge Functions without
# a user JWT. Existing secrets are updated; missing ones are created.
put_vault_secret() {
  local name="$1"
  local value="$2"
  local sql_file
  sql_file="$(mktemp)"
  trap 'rm -f "$sql_file"' RETURN
  {
    printf 'do $$\ndeclare secret_id uuid;\nbegin\n'
    printf '  select id into secret_id from vault.secrets where name = %s;\n' "$(pg_quote "$name")"
    printf '  if secret_id is null then\n'
    printf '    perform vault.create_secret(%s, %s);\n' "$(pg_quote "$value")" "$(pg_quote "$name")"
    printf '  else\n'
    printf '    perform vault.update_secret(secret_id, %s);\n' "$(pg_quote "$value")"
    printf '  end if;\nend $$;\n'
  } > "$sql_file"
  echo "==> Updating Vault secret $name"
  "${CLI[@]}" db query --project-ref "$PROJECT_REF" --file "$sql_file" >/dev/null
  rm -f "$sql_file"
  trap - RETURN
}

# schema.sql is the canonical current schema. It already contains the current
# post-interaction, lookout and patch functions; the older standalone files
# would overwrite those definitions with older variants, so they are not run.
run_sql "$SUPABASE_DIR/schema.sql"
run_sql "$SUPABASE_DIR/fix-photo-uploads.sql"
run_sql "$SUPABASE_DIR/push-tokens.sql"
run_sql "$SUPABASE_DIR/report-moderation.sql"

# Functions must exist before the database webhooks/triggers are activated.
echo '==> Deploying Edge Functions'
"${CLI[@]}" functions deploy send-push \
  --project-ref "$PROJECT_REF" --no-verify-jwt --use-api
"${CLI[@]}" functions deploy send-report-email \
  --project-ref "$PROJECT_REF" --no-verify-jwt --use-api

echo '==> Setting Edge Function secrets'
secret_args=(
  "RESEND_API_KEY=$RESEND_API_KEY"
  "MODERATION_EMAIL_TO=$MODERATION_EMAIL_TO"
  "REPORT_WEBHOOK_SECRET=$REPORT_WEBHOOK_SECRET"
  "APP_URL=$APP_URL"
  "FCM_SERVICE_ACCOUNT=$FCM_SERVICE_ACCOUNT_JSON"
)
if [[ -n "${MODERATION_EMAIL_FROM:-}" ]]; then
  secret_args+=("MODERATION_EMAIL_FROM=$MODERATION_EMAIL_FROM")
fi
"${CLI[@]}" secrets set --project-ref "$PROJECT_REF" "${secret_args[@]}"

put_vault_secret report_webhook_secret "$REPORT_WEBHOOK_SECRET"
put_vault_secret service_role_key "$SUPABASE_SERVICE_ROLE_KEY"

# These triggers are deliberately installed only after functions and secrets
# exist. Use the SQL trigger OR a Dashboard webhook for push, never both.
run_sql "$SUPABASE_DIR/push-webhook.sql"
run_sql "$SUPABASE_DIR/report-email-webhook.sql"

# Read-only verification. A NULL caller identity in SQL Editor is expected;
# the script checks that the server objects exist, not a user JWT.
run_sql "$SUPABASE_DIR/check-setup.sql"

echo
 echo 'LulaFind Supabase deployment completed.'
 echo 'Test one report, one in-app notification, and one push notification.'
 echo 'Check Edge Function logs and Resend/FCM logs for delivery confirmation.'
