#!/usr/bin/env bash
#
# Installs the latest Audio Switcher release into your Vicinae extensions
# directory. No Node.js / npm required — it just downloads the prebuilt
# extension and extracts it. Vicinae picks it up automatically (no restart).
#
#   curl -fsSL https://raw.githubusercontent.com/nurkert/vicinae-audio/main/install.sh | bash
#
set -euo pipefail

REPO="nurkert/vicinae-audio"
NAME="audio-switcher"
DEST="${XDG_DATA_HOME:-$HOME/.local/share}/vicinae/extensions"

command -v curl >/dev/null || { echo "curl is required" >&2; exit 1; }
command -v tar  >/dev/null || { echo "tar is required"  >&2; exit 1; }

echo "==> Looking up the latest release of $REPO"
URL=$(curl -fsSL "https://api.github.com/repos/$REPO/releases/latest" \
  | grep -oE '"browser_download_url"[[:space:]]*:[[:space:]]*"[^"]*\.tar\.gz"' \
  | head -1 \
  | sed -E 's/.*"(https[^"]+)"/\1/')

if [ -z "${URL:-}" ]; then
  echo "Could not find a .tar.gz asset in the latest release." >&2
  echo "Has a release been published yet? See https://github.com/$REPO/releases" >&2
  exit 1
fi

TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

echo "==> Downloading $URL"
curl -fsSL "$URL" -o "$TMP/ext.tar.gz"

echo "==> Installing into $DEST/$NAME"
mkdir -p "$DEST"
rm -rf "${DEST:?}/$NAME"
tar -xzf "$TMP/ext.tar.gz" -C "$DEST"

echo "==> Done. Open Vicinae and search for \"Set Audio Output\" (no restart needed)."
