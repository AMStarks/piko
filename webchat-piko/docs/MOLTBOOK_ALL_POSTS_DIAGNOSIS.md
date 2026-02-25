# Moltbook “All posts” not showing full list — diagnosis and fix

## What you want
The Control → Moltbook page (“All posts”) should list **all** of Piko’s Moltbook posts, not just one.

## What’s happening
Only **one** post is shown (e.g. “The Calculus of Conquest”). Older posts (e.g. “Technological Omnipotence”) do not appear.

## Why (conceptually)
Three things must all line up:

1. The **right `server.js`** must be running (the one with the merge logic).
2. The **right `moltbook-state.json`** must exist and live next to that server (`webchat-piko/data/` on the same host).
3. The **poster script** must be **merging** into that file (not overwriting): it must add/update from the API while **keeping** existing posts.

The Moltbook API only returns one “recent” post. We merge that with **`data/moltbook-state.json`** (written by `scripts/moltbook-poster.js`, last 10 posts). If the poster **replaced** `state.posts` with only the API result each run, the file never held more than one post—so the Control merge had nothing extra to show. The poster is now fixed to **merge** API results into existing `state.posts` so history accumulates.

---

## 1. Lock in the correct code on Optimus

**Goal:** Make sure the `/api/control` handler on `192.168.0.121` is the one with the merge logic.

1. SSH into Optimus:
   ```bash
   ssh root@192.168.0.121
   cd /root/webchat-piko
   ```
2. Confirm the merge code is present:
   ```bash
   grep -n "Merge with local state" server.js
   ```
   - If this returns **nothing**, you have **old code**. Re-deploy from your dev machine:
     ```bash
     ./scripts/webchat-deploy/deploy-to-optimus.sh
     ```
   - Then on Optimus:
     ```bash
     systemctl restart piko-webchat.service
     ```

If `grep` shows the merge block, the right file is on disk; the restart ensures systemd is running it.

---

## 2. Ensure `moltbook-poster.js` is writing to the same `data/` as the server

**Goal:** When the poster fetches engagement and posts, it must write **`data/moltbook-state.json`** in **`/root/webchat-piko/data/`** on Optimus.

1. On Optimus, open the crontab that runs the poster:
   ```bash
   crontab -e
   ```
2. Make sure the cron line looks like this (or equivalent):
   ```bash
   */30 * * * * cd /root/webchat-piko && /usr/bin/node scripts/moltbook-poster.js >> /root/webchat-piko/logs/moltbook-poster.log 2>&1
   ```
   Key things:
   - **`cd /root/webchat-piko`** so the poster’s `data/` is `/root/webchat-piko/data/`.
   - No different path (e.g. `/home/.../webchat-piko`).
3. Check the state file:
   ```bash
   cd /root/webchat-piko
   ls data
   cat data/moltbook-state.json | head -50
   ```
   You want to see something like:
   ```json
   {
     "posts": [
       { "id": "...", "title": "...", "createdAt": "...", ... },
       ...
     ],
     "lastFetchedAt": "..."
   }
   ```
   If:
   - **File is missing** → poster isn’t running here; fix cron path and run the poster manually once: `node scripts/moltbook-poster.js`.
   - **`posts` is `[]`** → poster is running but hasn’t successfully fetched/recorded posts; check `logs/moltbook-poster.log`.

---

## 3. Confirm the merge via logs

The server logs a **`moltbook-merge`** line when it merges API + local state, and **`moltbook-merge-failed`** if something goes wrong.

1. Hit `/api/control` (or open the Control → Moltbook page).
2. On Optimus, tail logs:
   ```bash
   tail -f /root/webchat-piko/data/piko.log | grep moltbook
   ```
3. You should see:
   - **`moltbook-merge`** with `apiCount`, `localCount`, `mergedCount`. If it’s working, `localCount` and `mergedCount` will be > 1 when you have multiple posts.
   - If you see **`moltbook-merge-failed`**, the `error` field will tell you whether it’s “file not found” or a JSON parse error.

---

## 4. Quick checklist to get “All posts” working

Run through this sequence on Optimus:

**Step 1 — Code**
```bash
cd /root/webchat-piko
grep -n "Merge with local state" server.js
```
- If **missing**, re-deploy (e.g. `./scripts/webchat-deploy/deploy-to-optimus.sh` from your dev machine) and **restart**: `systemctl restart piko-webchat.service`.

**Step 2 — State file**
```bash
ls data/moltbook-state.json
cat data/moltbook-state.json | head -20
```
- If **missing**, fix cron so it runs from `/root/webchat-piko`, then run the poster once: `node scripts/moltbook-poster.js`.
- If **`posts` is `[]`**, check `logs/moltbook-poster.log` for fetch/post errors.

**Step 3 — Logs**
- Restart the service: `systemctl restart piko-webchat.service`.
- Hit the Control page (or `/api/control`).
- Watch logs: `tail -f data/piko.log | grep moltbook`.
- You want **`moltbook-merge`** with **`mergedCount > 1`** when you have multiple posts.

Once all three are true (correct `server.js`, non-empty `moltbook-state.json` in `/root/webchat-piko/data/`, and merge logs showing multiple posts), the “All posts” view should show the full list (up to the last 10 in state).
