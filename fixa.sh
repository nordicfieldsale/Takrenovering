#!/usr/bin/env bash
# =====================================================================
#  Återställer mappstrukturen i repot.
#
#  Kör i terminalen i GitHub Codespaces, i repots rot:
#
#      bash fixa.sh
#
#  Zip-filen måste ligga i repot. Skriptet packar upp den, lägger
#  tillbaka web/ och server/ som riktiga mappar och pushar upp.
# =====================================================================
set -e

ZIP=$(ls villa*.zip 2>/dev/null | head -1)
if [ -z "$ZIP" ]; then
  echo "Hittar ingen zip-fil här. Ladda upp den till repot via GitHub först."
  exit 1
fi

echo "Packar upp $ZIP ..."
rm -rf /tmp/vb && mkdir -p /tmp/vb
unzip -q "$ZIP" -d /tmp/vb

DOCKERFILE=$(find /tmp/vb -name Dockerfile | head -1)
if [ -z "$DOCKERFILE" ]; then
  echo "Ingen Dockerfile i zippen. Fel fil?"
  exit 1
fi
SRC=$(dirname "$DOCKERFILE")
echo "Hittade projektet i: $SRC"

# Rensa allt utom .git, lägg sedan tillbaka med rätt struktur.
find . -mindepth 1 -maxdepth 1 ! -name '.git' -exec rm -rf {} +
cp -r "$SRC"/. .

echo
echo "Repot innehåller nu:"
ls -a

git add -A
if git diff --cached --quiet; then
  echo "Inget att committa – strukturen var redan rätt."
else
  git -c user.name="${GITHUB_USER:-codespace}" \
      -c user.email="${GITHUB_USER:-codespace}@users.noreply.github.com" \
      commit -q -m "Rätta mappstruktur"
  git push
  echo
  echo "Klart. web/ och server/ ligger nu som egna mappar på GitHub."
fi

echo
echo "Nästa steg: Render -> New -> Blueprint -> välj repot."
echo "Eller kör 'docker compose up' här för att se sidan direkt."
