#!/usr/bin/env bash
set -euo pipefail

tools_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)" #"
repo_dir="$(cd "$tools_dir/.." && pwd)"
target="${COPYQ_COMMANDS_FILE:-${XDG_CONFIG_HOME:-$HOME/.config}/copyq/copyq-commands.ini}"

mapfile -d '' -t repo_files < <(
  find "$repo_dir" -maxdepth 1 -type f \
    \( -name '*.ini' -o -name '*.command.ini' \) \
    ! -name 'README.md' \
    ! -name 'update-from-repo.sh' \
    ! -name 'update-repo.sh' \
    -print0 | sort -z
)

normalize_command_file() {
  local src="$1"
  local dst="$2"

  awk '
    BEGIN { mode = ""; in_command = 0 }
    /^\[Commands\]$/ { print; mode = "commands"; next }
    /^\[Command\]$/ { print "[Commands]"; mode = "single"; next }
    mode == "" { next }
    mode == "commands" { print; next }
    mode == "single" {
      if (!in_command && $0 ~ /^[A-Za-z][A-Za-z0-9]*=/) {
        print "1\\" $0
        if ($0 ~ /^Command="/ && $0 !~ /"$/)
          in_command = 1
        next
      }
      print
      if (in_command && $0 == "\"")
        in_command = 0
    }
  ' "$src" > "$dst"
}

mkdir -p "$(dirname "$target")"

if [[ -f "$target" ]]; then
  backup="$target.backup-$(date +%Y%m%d-%H%M%S)"
  cp -a "$target" "$backup"
fi

settings_dir="$(mktemp -d /tmp/copyq-sync.XXXXXX)"
import_dir="$settings_dir/import"
session="u$(date +%s | tail -c 6)"
mkdir -p "$import_dir"

import_files=()
for i in "${!repo_files[@]}"; do
  import_file="$import_dir/$i.ini"
  normalize_command_file "${repo_files[$i]}" "$import_file"
  import_files+=("$import_file")
done

cleanup() {
  COPYQ_SETTINGS_PATH="$settings_dir" copyq --session="$session" exit >/dev/null 2>&1 || true
  rm -rf "$settings_dir" >/dev/null 2>&1 || true
}

trap cleanup EXIT INT TERM

COPYQ_SETTINGS_PATH="$settings_dir" QT_QPA_PLATFORM=offscreen \
  copyq --session="$session" --start-server >/dev/null 2>&1 || true

ready=0
for _ in $(seq 1 10); do
  if timeout 1s env COPYQ_SETTINGS_PATH="$settings_dir" QT_QPA_PLATFORM=offscreen \
      copyq --session="$session" eval '1+1' >/dev/null 2>&1; then
    ready=1
    break
  fi
  sleep 0.2
done

if [[ "$ready" != 1 ]]; then
  echo "CopyQ isolated session did not become ready" >&2
  exit 1
fi

result=$(
  timeout 30s env COPYQ_SETTINGS_PATH="$settings_dir" QT_QPA_PLATFORM=offscreen \
    copyq --session="$session" eval - update-from-repo "$target" "$repo_dir" "${import_files[@]}" < "$tools_dir/copyq_import_export.js"
)

printf 'exported=%s\n' "$result"
