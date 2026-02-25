#!/usr/bin/env bash
# 21-prompt reciprocity test suite for Phase 3.1.
# Usage: chmod +x scripts/test_piko_casual.sh && ./scripts/test_piko_casual.sh | tee casual_test_$(date +%Y%m%d).log

API_URL="${PIKO_API_URL:-http://localhost:3000/api/chat}"
SESSION_ID="test-casual-$(date +%Y%m%d)"
echo "Running 21-prompt reciprocity test suite..."
echo "Session: $SESSION_ID | API: $API_URL"
echo "----------------------------------------"

prompts=(
  "G'day Piko."
  "Hey, how's it going?"
  "Morning mate."
  "Hi Piko — what's new?"
  "Not bad, how about you?"
  "Pretty good — yourself?"
  "Going well thanks. You?"
  "Same here — how's your day?"
  "All good over here. How're things?"
  "Not much, just chilling. You?"
  "I had a rough day today."
  "Feeling a bit flat."
  "Great day — finally got something done!"
  "What do you think about coffee?"
  "Ever tried Vegemite?"
  "What's your take on rainy days?"
  "Thanks, that's all for now."
  "Catch you later."
  "Cheers mate."
  "Talk soon."
  "Feels like I'm not making progress lately."
)

for i in "${!prompts[@]}"; do
  p="${prompts[$i]}"
  # Unique session per prompt to eliminate session priming (Phase 3.1.1)
  session_id="test-casual-$(date +%s)-$i"
  echo "[$((i+1))] Prompt: $p"
  body=$(jq -n --arg m "$p" --arg s "$session_id" '{message:$m,sessionId:$s,stream:false}')
  curl -s -X POST "$API_URL" -H "Content-Type: application/json" -d "$body" \
    | jq -r '.reply // .error // .'
  echo "----------------------------------------"
done
echo "Done. Target: ≥16/21 clean (short, reciprocal, no themes/leaks)."
