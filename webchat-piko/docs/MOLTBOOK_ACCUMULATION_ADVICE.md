# Moltbook local accumulation — what we did and what we deferred

The advice was: API-only is impossible (feed-centric, no history endpoint); local accumulation is correct; harden with schema, merge from feed, freshness, invariants, and doctor check.

## Adopted

1. **Operational invariants**  
   PHASE2_RUNBOOK now states the **forever rules**: cron from `/root/webchat-piko`, systemd from same dir, state must have `posts.length >= 2`. If any break → "All posts" shows 1.

2. **State schema**  
   Poster now writes **`agentId`** and **`maxPosts`** (50) into state. We already had `lastFetchedAt`, `posts`, `newPostsContext`, `profile`. No change to server merge logic (it already merges API + state and dedupes).

3. **Poster: merge from feed**  
   After merging **recentPosts** from `/agents/me`, the poster now also calls **GET /posts?sort=new&limit=25**, filters by **agentId**, and merges any of our posts that appear there (fetches each by id if not already in state). So we pull from both "recent" and "feed" into one list.

4. **Poster: limited freshness**  
   Each run, we **refresh engagement** (GET /posts/:id) for the **newest 5** posts only, then re-sort and prune. That keeps Control up-to-date on upvotes/downvotes without doing 50 GETs per run.

5. **Max posts 50**  
   **MAX_POSTS_IN_STATE** increased from 10 to 50 so we keep more history.

6. **Doctor**  
   If local **moltbook-state.json** exists and **posts.length < 2**, doctor now prints:  
   `⚠️ Fewer than 2 posts in state — "All posts" may show only 1 until poster runs and accumulates.`

## Deferred (optional later)

- **Refresh ALL posts every run**  
  Advised: update every known post with fresh engagement. We only refresh the **top 5** to avoid N GETs per run (e.g. 50). You can later add a "full refresh" every 6th run or on a longer cron if you want engagement on older posts.

- **Explicit `url` and `lastChecked` per post in state**  
  We derive `url` from `id` when building Control payload; we didn’t add `lastChecked` to the schema. Optional if you want to show "last refreshed" in the UI.

- **Server merge cap at 50**  
  Server already merges API + state and returns the combined list; we didn’t add an explicit `.slice(0, 50)` in the Control handler. State is already capped at 50, so the list size is bounded. Add a cap in the handler if you want a hard limit on response size.

## Bottom line

- **You cannot get full history from the API** — the design is feed-centric. Local accumulation is the right and only approach.
- **Solution is already correct**: poster builds history incrementally (now from recent + feed + 5 refreshed); server merges API + state; Control shows the full list.
- **The only remaining operational requirement**: poster and server must share the same **data/** directory (same cron path, same systemd cwd). That’s documented as the forever rules in PHASE2_RUNBOOK.
