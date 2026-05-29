#!/usr/bin/env bash
# One-time backfill: send the (now reusable) welcome template + the June 11 RSVP
# template to the 3 newly approved members, then mark WELCOME_SENT=true on each.
#
# Run on YOUR Mac (the Cowork sandbox can't reach api.brevo.com):
#
#   op run --no-masking -- ./send_welcome_backfill.sh
#
# Requires BREVO_API_KEY in env (1Password injects it).
#
# Recipients are hard-coded to the 3 contacts approved as of 2026-05-09 who do
# not yet have WELCOME_SENT set:
#   - Jonathan Pacheco  (jolewa1094@gmail.com)        — Tethys Robotics
#   - Joram Eickhoff    (eickhoff@embotech.com)       — Embotech AG
#   - Timon Mathis      (timon@aithon-robotics.ch)    — Aithon Robotics

set -euo pipefail

if [ -z "${BREVO_API_KEY:-}" ]; then
  echo "ERROR: BREVO_API_KEY is not set. Try: op run -- ./send_welcome_backfill.sh" >&2
  exit 1
fi

if ! command -v jq >/dev/null 2>&1; then
  echo "ERROR: jq is required (brew install jq)." >&2
  exit 1
fi

WELCOME_TEMPLATE_ID=1
JUNE11_TEMPLATE_ID=7
DELAY_BETWEEN_BATCHES=300   # 5 minutes between welcome batch and June 11 batch

# email|first|last
RECIPIENTS=(
  "jolewa1094@gmail.com|Jonathan|Pacheco"
  "eickhoff@embotech.com|Joram|Eickhoff"
  "timon@aithon-robotics.ch|Timon|Mathis"
)

send_template_to() {
  local template_id="$1" email="$2" first="$3" last="$4"
  local payload
  payload=$(jq -n \
    --argjson tid "$template_id" \
    --arg email "$email" \
    --arg name "$first $last" \
    '{ templateId: $tid, to: [ { email: $email, name: $name } ] }')

  echo "→ POST /v3/smtp/email  template=$template_id  to=$email"
  local resp http body
  resp=$(curl -sS -w $'\n%{http_code}' -X POST "https://api.brevo.com/v3/smtp/email" \
    -H "accept: application/json" \
    -H "api-key: $BREVO_API_KEY" \
    -H "content-type: application/json" \
    --data "$payload")
  http=$(printf '%s' "$resp" | tail -n1)
  body=$(printf '%s' "$resp" | sed '$d')
  echo "← HTTP $http  $body"
  [[ "$http" =~ ^2 ]] || { echo "✗ send failed for $email" >&2; exit 1; }
}

mark_welcome_sent() {
  local email="$1"
  local payload='{"attributes":{"WELCOME_SENT":true}}'
  echo "→ PUT /v3/contacts/$email  WELCOME_SENT=true"
  # url-encode the @ in the email path segment
  local enc_email
  enc_email=$(printf '%s' "$email" | jq -sRr @uri)
  local resp http body
  resp=$(curl -sS -w $'\n%{http_code}' -X PUT "https://api.brevo.com/v3/contacts/$enc_email" \
    -H "accept: application/json" \
    -H "api-key: $BREVO_API_KEY" \
    -H "content-type: application/json" \
    --data "$payload")
  http=$(printf '%s' "$resp" | tail -n1)
  body=$(printf '%s' "$resp" | sed '$d')
  echo "← HTTP $http  ${body:-(empty)}"
  [[ "$http" =~ ^2 ]] || { echo "✗ attribute update failed for $email" >&2; exit 1; }
}

echo "=== Phase 1: welcome emails (template $WELCOME_TEMPLATE_ID) ==="
for r in "${RECIPIENTS[@]}"; do
  IFS='|' read -r email first last <<<"$r"
  send_template_to "$WELCOME_TEMPLATE_ID" "$email" "$first" "$last"
  mark_welcome_sent "$email"
  sleep 2   # gentle pacing, individual sends
done

echo
echo "=== Sleeping ${DELAY_BETWEEN_BATCHES}s before June 11 invites ==="
sleep "$DELAY_BETWEEN_BATCHES"

echo "=== Phase 2: June 11 RSVP (template $JUNE11_TEMPLATE_ID) ==="
for r in "${RECIPIENTS[@]}"; do
  IFS='|' read -r email first last <<<"$r"
  send_template_to "$JUNE11_TEMPLATE_ID" "$email" "$first" "$last"
  sleep 2
done

echo
echo "✓ Done. All 3 received welcome + June 11 RSVP, WELCOME_SENT marked true."
