#!/usr/bin/env bash
# Add Council vendor connections (Groq, NVIDIA NIM, Gemini) to the local Paperclip.
# You type each API key at a hidden prompt; it goes straight to Paperclip's connection API and is
# never printed, logged, put on a command line or written to a file. Leave a prompt empty to skip.
# Each key is ALSO written to the UGREEN NAS (mode 600) next to the other llm-edge secrets, in its own file
# .env.council, so the existing .env.nvidia / .env.gemini / .env.openrouter gateway files are never touched.
# Usage: bash scripts/council-add-vendors.sh             Paperclip + NAS (Paperclip must be on 127.0.0.1:3100)
#        bash scripts/council-add-vendors.sh --nas-only  only the NAS (run it from the home network)
#        bash scripts/council-add-vendors.sh --no-nas    only Paperclip
set -u
API="${PAPERCLIP_API:-http://127.0.0.1:3100/api}"
NAS_HOST="${COUNCIL_NAS_HOST:-ugreen-nas}"
NAS_DIR="${COUNCIL_NAS_DIR:-/volume3/Docker AI Home Lab UGREEN/llm-edge}"
NAS_FILE=".env.council"
USE_PAPERCLIP=1; USE_NAS=1
case "${1:-}" in --nas-only) USE_PAPERCLIP=0;; --no-nas) USE_NAS=0;; "") ;; *) echo "unknown option $1"; exit 1;; esac

command -v node >/dev/null || { echo "node not found (run: nvm use 24)"; exit 1; }
if [ "$USE_PAPERCLIP" = 1 ]; then
  curl -s -m 5 "$API/health" >/dev/null || { echo "Paperclip is not answering at $API"; exit 1; }
fi
if [ "$USE_NAS" = 1 ]; then
  if ssh -o BatchMode=yes -o ConnectTimeout=6 "$NAS_HOST" true 2>/dev/null; then NAS_UP=1; echo "NAS: reachable ($NAS_HOST)"
  else NAS_UP=0; echo "NAS: NOT reachable from here - keys go to Paperclip only. Later, from the home network run: bash $0 --nas-only"; fi
else NAS_UP=0; fi

# save_nas <ENV_VAR> <key>: replace/append VAR=key in $NAS_DIR/$NAS_FILE (mode 600). The key travels on ssh stdin only.
save_nas() {
  [ "$NAS_UP" = 1 ] || return 0
  local remote_script remote_cmd
  # Fixed one-line POSIX script; the dir, file and variable name are passed as quoted arguments ($1 $2 $3).
  remote_script='umask 077; d=$1; f=$d/$2; mkdir -p "$d" && read -r L && { grep -v "^$3=" "$f" 2>/dev/null; printf "%s\n" "$L"; } > "$f.tmp" && mv "$f.tmp" "$f" && chmod 600 "$f"'
  remote_cmd="$(printf 'sh -c %q sh %q %q %q' "$remote_script" "$NAS_DIR" "$NAS_FILE" "$1")"
  if printf '%s=%s\n' "$1" "$2" | ssh -o BatchMode=yes "$NAS_HOST" "$remote_cmd"; then
    echo "    NAS: saved $1 to $NAS_FILE (mode 600)"
  else echo "    NAS: FAILED to save $1 (Paperclip copy is unaffected)"; fi
}

if [ "$USE_PAPERCLIP" = 1 ]; then
COMPANY="$(curl -s -m 10 "$API/companies" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const c=JSON.parse(s);console.log(c[0]?.id||"")})')"
[ -n "$COMPANY" ] || { echo "No company found in Paperclip"; exit 1; }
EXISTING="$(curl -s -m 10 "$API/companies/$COMPANY/ai-connections" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{console.log((JSON.parse(s).connections||[]).map(c=>c.name).join("\n"))}catch{}})')"
else COMPANY=""; EXISTING=""; fi

# add_vendor <label> <connection name> <provider> <routing json or ""> <models json> <model-list url> <header style> <NAS env var>
add_vendor() {
  local label="$1" name="$2" provider="$3" routing="$4" models="$5" listurl="$6" hdr="$7" envvar="$8" key
  if [ "$USE_PAPERCLIP" = 1 ] && printf '%s\n' "$EXISTING" | grep -Fxq "$name"; then echo "- $label: '$name' already exists, skipping"; return; fi
  printf '%s API key (input hidden, Enter to skip): ' "$label"
  IFS= read -rs key; echo
  [ -n "$key" ] || { echo "- $label: skipped"; return; }
  if [ "$USE_PAPERCLIP" = 0 ]; then echo "- $label:"; save_nas "$envvar" "$key"; key=""; return; fi

  local code
  code="$(KEY="$key" NAME="$name" PROVIDER="$provider" ROUTING="$routing" MODELS="$models" node -e '
    const routing = process.env.ROUTING ? JSON.parse(process.env.ROUTING) : undefined;
    if (routing) routing.models = JSON.parse(process.env.MODELS).map((id) => ({ id }));
    process.stdout.write(JSON.stringify({
      provider: process.env.PROVIDER, method: "api_key", name: process.env.NAME,
      ownership: "shared", allAgents: true, apiKey: process.env.KEY, ...(routing ? { routing } : {}),
    }));' | curl -s -m 60 -o /tmp/council-vendor-resp.$$ -w '%{http_code}' -X POST \
      "$API/companies/$COMPANY/ai-connections" -H 'Content-Type: application/json' --data-binary @-)"
  if [ "$code" = "201" ]; then
    echo "- $label: saved ($(node -e 'const r=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));console.log("connectionId="+r.connectionId+" grantId="+r.grantId)' /tmp/council-vendor-resp.$$))"
    # Show which of the models we plan to use really exist for this key (key goes via curl config on stdin, not argv).
    local ids
    ids="$(printf 'header = "%s%s"\n' "$hdr" "$key" | curl -s -m 20 -K - "$listurl" | node -e '
      let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const j=JSON.parse(s);
      const l=(j.data||j.models||[]).map(m=>String(m.id||m.name).replace(/^models\//,""));console.log(l.join("\n"))}catch{}})')"
    if [ -n "$ids" ]; then
      echo "    provider lists $(printf '%s\n' "$ids" | wc -l) models; plan models available:"
      for m in $(node -e 'JSON.parse(process.argv[1]).forEach(m=>console.log(m))' "$models"); do
        if printf '%s\n' "$ids" | grep -Fxq "$m"; then echo "      ok      $m"; else echo "      MISSING $m"; fi
      done
    else
      echo "    (could not list models; check the key and model names in the UI)"
    fi
  else
    echo "- $label: FAILED (HTTP $code): $(head -c 300 /tmp/council-vendor-resp.$$)"
  fi
  rm -f /tmp/council-vendor-resp.$
  save_nas "$envvar" "$key"
  key=""
}

[ "$USE_PAPERCLIP" = 1 ] && echo "Paperclip company: $COMPANY"
add_vendor "Groq" "Groq (council)" "openai" \
  '{"kind":"gateway","protocol":"chat","baseUrl":"https://api.groq.com/openai/v1","auth":"bearer"}' \
  '["openai/gpt-oss-120b","openai/gpt-oss-20b"]' \
  "https://api.groq.com/openai/v1/models" "Authorization: Bearer " GROQ_API_KEY
add_vendor "NVIDIA NIM" "NVIDIA NIM (council)" "openai" \
  '{"kind":"gateway","protocol":"chat","baseUrl":"https://integrate.api.nvidia.com/v1","auth":"bearer"}' \
  '["nvidia/nemotron-3-nano-omni-30b-a3b-reasoning","openai/gpt-oss-120b"]' \
  "https://integrate.api.nvidia.com/v1/models" "Authorization: Bearer " NVIDIA_API_KEY
add_vendor "Gemini" "Gemini (council)" "google" "" \
  '["gemini-2.5-flash","gemini-flash-latest"]' \
  "https://generativelanguage.googleapis.com/v1beta/models?pageSize=200" "x-goog-api-key: " GEMINI_API_KEY
echo "Done. Tell Claude 'keys saved' and I will build the seats and test them."
