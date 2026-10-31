#!/data/data/com.termux/files/usr/bin/bash
# Sets up Helper's engine in Termux. Run it from the folder that holds helper-engine.zip
# (or from the unzipped helper-bots folder):   bash install-termux*.sh
set -euo pipefail

echo "== Helper: installing Python, Termux:API tools and Ollama"
pkg update -y
pkg install -y python termux-api ollama

echo "== Installing the Helper engine"
# Phone browsers sometimes rename downloads ("helper-engine (1).zip"), so take the newest match.
ENGINE="$(ls -t helper-engine*.zip 2>/dev/null | head -n 1 || true)"
if [ -n "$ENGINE" ]; then
  echo "   using $ENGINE"
  pip install --upgrade "./$ENGINE"
elif [ -f pyproject.toml ]; then
  pip install --upgrade .
else
  echo "Put helper-engine.zip in the same folder as this script first (it is on the same release page)." >&2
  exit 1
fi

echo "== Creating ~/.helper (policy, agents, key)"
helper init

# The phone uses the smaller model.
sed -i 's/^model = "qwen3:8b".*/model = "qwen3:4b"   # phone/' ~/.helper/settings.toml

echo "== Letting the Helper app start the engine (Termux RUN_COMMAND)"
mkdir -p ~/.termux
grep -q '^allow-external-apps' ~/.termux/termux.properties 2>/dev/null \
  || echo 'allow-external-apps = true' >> ~/.termux/termux.properties
termux-reload-settings || true

echo "== Start on boot (needs the Termux:Boot app, opened once)"
mkdir -p ~/.termux/boot
cat > ~/.termux/boot/helper.sh <<'BOOT'
#!/data/data/com.termux/files/usr/bin/sh
termux-wake-lock
ollama serve >/dev/null 2>&1 &
sleep 3
helper serve >/dev/null 2>&1 &
BOOT
chmod 700 ~/.termux/boot/helper.sh

echo "== Copying your key to the clipboard for the Helper app"
termux-clipboard-set < ~/.helper/secret/token && echo "Key copied. Paste it into the Helper app."

cat <<'NEXT'

Next:
  1. ollama serve &          (leave it running)
  2. ollama pull qwen3:4b    (about 2.5 GB, once)
  3. helper serve            (or tap "Start Helper in Termux" in the app)
  4. Settings > Battery > Background usage limits > Never sleeping apps: add Termux and Helper.
NEXT
