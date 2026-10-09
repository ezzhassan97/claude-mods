#!/bin/bash
# Screenshots dev/preview.html in light and dark with headless Chrome.
# Usage: dev/shot.sh <out-dir>   (Chrome's headless mode keeps running after
# the shot, so each run is stopped once its file appears.)
set -u
out=${1:-/tmp/mods-shots}
here=$(cd "$(dirname "$0")" && pwd)
chrome="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
mkdir -p "$out"
for mode in light dark; do
  scheme=$([ "$mode" = dark ] && echo 0 || echo 1)
  rm -f "$out/$mode.png"
  "$chrome" --headless=new --disable-gpu --hide-scrollbars --user-data-dir="$out/profile-$mode" \
    --blink-settings=preferredColorScheme=$scheme --window-size=1080,${HEIGHT:-2600} \
    --screenshot="$out/$mode.png" "file://$here/preview.html" >/dev/null 2>&1 &
  pid=$!
  for _ in $(seq 1 60); do [ -s "$out/$mode.png" ] && break; sleep 0.5; done
  sleep 0.5
  kill $pid 2>/dev/null
  pkill -f "user-data-dir=$out/profile-$mode" 2>/dev/null
  echo "$mode: $(ls -la "$out/$mode.png" 2>/dev/null | awk '{print $5}') bytes"
done
