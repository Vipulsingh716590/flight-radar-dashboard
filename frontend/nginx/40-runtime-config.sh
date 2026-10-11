#!/bin/sh
# Runs at container start (nginx image runs /docker-entrypoint.d/*.sh).
# Writes /usr/share/nginx/html/config.json from API_BASE_URL so the same image
# works behind any hostname. Empty means "the API is on this origin".
set -eu

base="${API_BASE_URL:-}"

case "$base" in
  "" | http://* | https://*) ;;
  *)
    echo "40-runtime-config: API_BASE_URL must be empty or start with http:// or https://" >&2
    exit 1
    ;;
esac

# The value goes into a JSON string; refuse anything that could break out of it.
case "$base" in
  *\"* | *\\* | *[[:space:]]*)
    echo "40-runtime-config: API_BASE_URL contains characters that are not allowed" >&2
    exit 1
    ;;
esac

printf '{\n  "apiBaseUrl": "%s"\n}\n' "$base" > /usr/share/nginx/html/config.json
echo "40-runtime-config: apiBaseUrl='${base}'"
