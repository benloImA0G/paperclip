#!/usr/bin/env bash
# Add Council vendor connections (Groq, NVIDIA NIM, Gemini) to the local Paperclip.
# You type each API key at a hidden prompt; it goes straight to Paperclip's connection API and is
# never printed, logged, put on a command line or written to a file. Leave a prompt empty to skip.
# Usage: bash scripts/council-add-vendors.sh        (Paperclip must be running on 127.0.0.1:3100)
set -u
API="${PAPERCLIP_API:-http://127.0.0.1:3100/api}"

command -v node >/dev/null || { echo "node not found (run: nvm use 24)"; exit 1; }
curl -s -m 5 "$API/health" >/dev/null || { echo "Paperclip is not answering at $API"; exit 1; }

COMPANY="$(curl -s -m 10 "$API/companies" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const c=JSON.parse(s);console.log(c[0]?.id||"")})')"
[ -n "$COMPANY" ] || { echo "No company found in Paperclip"; exit 1; }
EXISTING="$(curl -s -m 10 "$API/companies/$COMPANY/ai-connections" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{console.log((JSON.parse(s).connections||[]).map(c=>c.name).join("\n"))}catch{}})')"

# add_vendor <label> <connection name> <provider> <routing json or ""> <models json> <model-list url> <header style>
add_vendor() {
  local label="$1" name="$2" provider="$3" routing="$4" models="$5" listurl="$6" hdr="$7" key
  if printf '%s\n' "$EXISTING" | grep -Fxq "$name"; then echo "- $label: '$name' already exists, skipping"; return; fi
  printf '%s API key (input hidden, Enter to skip): ' "$label"
  IFS= read -rs key; echo
  [ -n "$key" ] || { echo "- $label: skipped"; return; }

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
  rm -f /tmp/council-vendor-resp.$$
  key=""
}

echo "Paperclip company: $COMPANY"
add_vendor "Groq" "Groq (council)" "openai" \
  '{"kind":"gateway","protocol":"chat","baseUrl":"https://api.groq.com/openai/v1","auth":"bearer"}' \
  '["openai/gpt-oss-120b","openai/gpt-oss-20b"]' \
  "https://api.groq.com/openai/v1/models" "Authorization: Bearer "
add_vendor "NVIDIA NIM" "NVIDIA NIM (council)" "openai" \
  '{"kind":"gateway","protocol":"chat","baseUrl":"https://integrate.api.nvidia.com/v1","auth":"bearer"}' \
  '["nvidia/nemotron-3-nano-omni-30b-a3b-reasoning","openai/gpt-oss-120b"]' \
  "https://integrate.api.nvidia.com/v1/models" "Authorization: Bearer "
add_vendor "Gemini" "Gemini (council)" "google" "" \
  '["gemini-2.5-flash","gemini-flash-latest"]' \
  "https://generativelanguage.googleapis.com/v1beta/models?pageSize=200" "x-goog-api-key: "
echo "Done. Tell Claude 'keys saved' and I will build the seats and test them."
