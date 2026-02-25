# source-to-qa Not Persisting: Root Cause

## What Happens

1. **source-to-qa.js** loops over 200 chunks, calls Grok for each, accumulates in `allPairs` **in memory**
2. **Only at the end** (after the loop) does it write:
   - `fs.writeFileSync(outApproved, ...)` 
   - `fs.writeFileSync(outPending, ...)`
3. All sources are `theology` → all pairs go to `forReview` → `synthetic_theology_islam.jsonl`
4. `approved` is always empty for theology-only sources

## Root Cause

**The process is killed before it reaches the write.**

- 200 chunks × (~3s Grok + 1.5s delay) ≈ **15 minutes** for source-to-qa
- When run via `ssh ... "run-on-optimus.sh"` with a timeout (e.g. 10 min), the SSH session closes and the remote process gets SIGHUP → it exits before the loop finishes
- No write ever happens; files stay as they were
- The 0-byte files are from the earlier **Ollama run** (all chunks failed with Connection error → `allPairs` empty → wrote empty)

## Evidence

- Synthetic files: 0 bytes, modified 20:10 (Ollama run write)
- Grok run was producing "5 pairs" per chunk (stdout) but never reached the write
- Training completed because merge ran with empty synthetic + chat export only

## Fix

Write **incrementally** (append after each chunk) instead of only at the end. If killed at chunk 50, we still have 50 chunks of data on disk.
