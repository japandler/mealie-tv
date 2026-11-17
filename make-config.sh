#!/usr/bin/env bash
# Write js/config.js (Mealie address and API token) from ~/.env.
# The token is MEALIE_TV_TOKEN, created in Mealie under Profile -> API Tokens.
# js/config.js is gitignored; it only ever lives here and on the TV.
set -euo pipefail
cd "$(dirname "$0")"
ENV=${ENV_FILE:-/home/japandler/.env}
val() { grep -E "^$1=" "$ENV" | head -1 | cut -d= -f2-; }
server="https://mealie.$(val DOMAIN)"
token=$(val MEALIE_TV_TOKEN)
[ -n "$token" ] || { echo "MEALIE_TV_TOKEN is not set in $ENV" >&2; exit 1; }
umask 077
printf 'window.KITCHEN_CONFIG = { server: "%s", token: "%s" };\n' "$server" "$token" > js/config.js
echo "wrote js/config.js for $server"
