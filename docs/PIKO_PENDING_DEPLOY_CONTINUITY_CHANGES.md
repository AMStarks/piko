# Piko Pending Deploy — Continuity/Conversation Changes

This records local changes completed while away from Optimus.

## Status

- Implemented locally
- **Not deployed** to Optimus in this step

## Files changed

- `webchat-piko/server.js`
  - Tweaked deterministic fallback rotation to include `sessionId + mode + turnCount`.
  - Reduced fallback aggressiveness (less over-triggering).
  - Kept mode-specific guardrails (`GREETING`, `RECIPROCITY`, `SOCIAL_EMPATHY`, `LIGHT_OPINION`, `SIGN_OFF`, `SOCIAL_CHAT`).

- `webchat-piko/scripts/continuity-scenarios.json`
  - Upgraded to v1.1 with:
    - 12 scenarios
    - `name`, `tags`, per-scenario `criteria`
    - root `scoring_schema` (weights + thresholds)

- `webchat-piko/scripts/continuity-eval.js`
  - Supports scoring schema weights and thresholds from scenario JSON.
  - Includes diagnostics per turn (`guessed_route`, `reset_trigger`, `bleed_trigger`, `stilted_trigger`, `likely_template_fallback`).
  - Writes telemetry to `data/conversation-eval-logs/`.
  - Added resilient timeout/error handling per turn.
  - Added `PIKO_CONTINUITY_SCENARIO_LIMIT` for smoke runs.

- `webchat-piko/scripts/continuity-eval-report.js`
  - Added release gate output (`PASS/FAIL`) based on `overall_pass_threshold`.

- `webchat-piko/scripts/README.md`
  - Updated continuity eval usage/docs.

- `docs/PIKO_SYNTHESIS_AND_RECOMMENDATION.md`
  - Expanded continuity eval section and diagnostics/report notes.

## Deploy when back home

1. Deploy code:
   - `scripts/webchat-deploy/deploy-to-optimus.sh`
2. Restart service on Optimus:
   - `sudo systemctl restart piko-webchat.service`
   - verify: `sudo systemctl is-active piko-webchat.service`
3. Run continuity eval smoke:
   - `PIKO_API_URL=http://192.168.0.121:3000/api/chat PIKO_CONTINUITY_RUNS=1 PIKO_CONTINUITY_SCENARIO_LIMIT=2 node scripts/continuity-eval.js`
4. Run full eval:
   - `PIKO_API_URL=http://192.168.0.121:3000/api/chat PIKO_CONTINUITY_RUNS=3 node scripts/continuity-eval.js`
5. Summarize latest run:
   - `node scripts/continuity-eval-report.js`

## Expected checks

- Overall pass rate >= `overall_pass_threshold` (default 80%)
- Naturalness >= 4.0 average
- Reset trigger count near zero
- Bleed trigger count near zero
