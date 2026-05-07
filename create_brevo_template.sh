#!/usr/bin/env bash
# Creates the May 7 reminder template on Brevo.
# Runs on YOUR Mac (not in a sandbox) — it needs api.brevo.com network access
# AND your BREVO_API_KEY in the environment.
#
# Recommended invocation (pulls the key from 1Password at runtime, never on disk):
#
#   op run --no-masking -- ./create_brevo_template.sh
#
#   …with a .env file next to it containing:
#       BREVO_API_KEY=op://Private/Brevo/credential
#
# Or one-shot:
#
#   BREVO_API_KEY="$(op read 'op://Private/Brevo/credential')" ./create_brevo_template.sh
#
# Or just export it manually if you don't use 1Password CLI.
#
# Does NOT send any email — only creates the template (isActive=true means
# "available for sending", not "sent now"). Sending is a separate step.

set -euo pipefail

if [ -z "${BREVO_API_KEY:-}" ]; then
  echo "ERROR: BREVO_API_KEY is not set." >&2
  echo "Try:   op run -- ./create_brevo_template.sh" >&2
  exit 1
fi

if ! command -v jq >/dev/null 2>&1; then
  echo "ERROR: jq is required (brew install jq)." >&2
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
HTML_FILE="${SCRIPT_DIR}/reminder-template.html"

if [ ! -f "$HTML_FILE" ]; then
  echo "ERROR: $HTML_FILE not found." >&2
  exit 1
fi

# --- Template metadata (edit if you want different copy) ---
TEMPLATE_NAME="ZRH Field Robotics Leads — Meetup Reminder (May 7)"
SUBJECT="See you Thursday — ZRH Field Robotics Leads at Café des Amis"
SENDER_NAME="Marco and Maurin"
SENDER_EMAIL="maurin@dai.cx"
REPLY_TO="maurin@dai.cx"
TAG="meetup-reminder-may7"

# Build JSON payload safely (jq handles HTML escaping).
PAYLOAD=$(jq -n \
  --arg name        "$TEMPLATE_NAME" \
  --arg subject     "$SUBJECT" \
  --arg senderName  "$SENDER_NAME" \
  --arg senderEmail "$SENDER_EMAIL" \
  --arg replyTo     "$REPLY_TO" \
  --arg tag         "$TAG" \
  --rawfile html    "$HTML_FILE" \
  '{
    templateName: $name,
    subject:      $subject,
    sender:       { name: $senderName, email: $senderEmail },
    replyTo:      $replyTo,
    htmlContent:  $html,
    isActive:     true,
    tag:          $tag
  }')

echo "→ POST https://api.brevo.com/v3/smtp/templates"
RESPONSE=$(curl -sS -w $'\n%{http_code}' -X POST "https://api.brevo.com/v3/smtp/templates" \
  -H "accept: application/json" \
  -H "api-key: $BREVO_API_KEY" \
  -H "content-type: application/json" \
  --data "$PAYLOAD")

HTTP_CODE=$(printf '%s' "$RESPONSE" | tail -n1)
BODY=$(printf '%s' "$RESPONSE" | sed '$d')

echo "← HTTP $HTTP_CODE"
echo "$BODY" | jq . 2>/dev/null || echo "$BODY"

if [[ "$HTTP_CODE" =~ ^2 ]]; then
  TEMPLATE_ID=$(printf '%s' "$BODY" | jq -r '.id // empty')
  if [ -n "$TEMPLATE_ID" ]; then
    echo ""
    echo "✓ Template created — id=$TEMPLATE_ID"
    echo "  Edit / preview: https://my.brevo.com/camp/template/$TEMPLATE_ID/message-setup"
  fi
else
  echo "✗ Failed." >&2
  exit 1
fi
