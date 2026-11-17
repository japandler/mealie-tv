#!/usr/bin/env bash
# Package the app, install it on the kitchen TV and start it.
# Needs Tizen Studio's CLI in ~/tizen-studio, the TV in developer mode with
# 192.168.0.87 as its host IP, and the "kitchen-tv" signing profile.
#
# Usage: ./deploy.sh [TV address, default 192.168.0.9]
set -euo pipefail
cd "$(dirname "$0")"
TV=${1:-192.168.0.9}
TIZEN=/home/japandler/tizen-studio/tools/ide/bin/tizen
SDB=/home/japandler/tizen-studio/tools/sdb
APP_ID=KtchnRcp01.KitchenRecipes

./make-config.sh

# Only the app's own files go into the package.
rm -rf build && mkdir build
cp -r config.xml index.html icon.png css js build/

"$SDB" connect "$TV" >/dev/null
target="$TV:26101"

# Signing. Without a desktop keyring the CLI can't read the passwords it
# stores: after each run it rewrites them in a form it then rejects. So reset
# them in plain text before every build (the file is mode 600), and answer
# its terminal prompts: the author password, then "N" to saving it.
# TIZEN_CERT_PASSWORD in ~/.env is the password of
# ~/tizen-studio-data/keystore/author/kitchen-tv.p12; the distributor one is
# Tizen's published default.
pw=$(grep -E '^TIZEN_CERT_PASSWORD=' /home/japandler/.env | cut -d= -f2-)
PW="$pw" python3 - <<'PY'
import os, re, pathlib
p = pathlib.Path.home() / "tizen-studio-data/profile/profiles.xml"
s = p.read_text()
s = re.sub(r'(distributor="0" key="[^"]*" password=")[^"]*"', lambda m: m.group(1) + os.environ["PW"] + '"', s)
s = re.sub(r'(distributor="1" key="[^"]*" password=")[^"]*"', lambda m: m.group(1) + 'tizenpkcs12passfordsigner"', s)
p.write_text(s)
os.chmod(p, 0o600)
PY
(sleep 3; printf '%s\n' "$pw"; sleep 2; printf 'N\n') |
    script -qec "$TIZEN package -t wgt -s kitchen-tv -- build" /dev/null |
    grep -E 'Package File Location|rror' || true
wgt=$(ls build/*.wgt 2>/dev/null) || { echo "packaging failed; see ~/tizen-studio-data/cli/logs/cli.log" >&2; exit 1; }
"$TIZEN" install -n "$(basename "$wgt")" -s "$target" -- build
"$TIZEN" run -p "$APP_ID" -s "$target"
