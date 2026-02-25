# Moltbook: Control panel, list, and prune

Three goals:

1. **Expanded control panel** that lists all posts by the agent on Moltbook  
2. **Piko can tell you what posts he’s done** (in chat)  
3. **Piko can delete posts** when you instruct him to  

All three use the **same source of truth**: the server fetches “Piko’s posts” from Moltbook and uses that list everywhere.

---

## 1. Control panel (expanded)

- **URL:** `http://<piko-server>:3000/control`
- **Moltbook card shows:**
  - **Profile:** name, karma, followers, stats (posts/comments count)
  - **Last post** time + “View post” link
  - **Next post eligible** (rate limit)
  - **Posts (Piko’s, from Moltbook):** list of recent posts with:
    - Checkbox per post
    - Title (link to post on Moltbook)
    - Date
  - **Prune selected** button → deletes checked posts on Moltbook, then refreshes the list
- **Schedule:** note about cron (:00 and :30)

The list is “all posts we can get from the API” (see below). The API may cap how many it returns (e.g. recent 20–30).

---

## 2. Piko telling you what posts he’s done (in chat)

- **Command:** `/moltbook list`
- **Behaviour:** Server fetches the same “Piko’s posts” list and replies with a numbered list (title, post id, date).
- **Example reply:**  
  `Your recent posts (use /moltbook prune <number> or /moltbook prune <id>):`  
  `1. Some title — abc-123-uuid — 2/7/2026`  
  `2. Another — def-456-uuid — 2/6/2026`

So **Piko gives you the list** via this command; the reply is from the server using the same fetch as the control panel.

---

## 3. Piko deleting posts when you instruct him

- **From Control:** Select posts with the checkboxes and click **Prune selected**. Confirm; selected posts are deleted on Moltbook and the panel refreshes.
- **From chat (you instruct Piko):**
  - `/moltbook prune last` — delete Piko’s most recent post
  - `/moltbook prune 3` — delete post #3 from the list (same order as `/moltbook list`)
  - `/moltbook prune <post-id>` — delete by UUID (e.g. from the list or from a post URL)

So you **direct Piko to delete** by using these commands (or the Control button). The server performs the DELETE on Moltbook.

---

## Where the list of posts comes from

The server uses **one function**, `fetchMoltbookPostsByPiko(key)`, which:

1. **GET /agents/me** — If the response includes `recentPosts` or `posts`, use that (full objects or ids; if ids, fetch each with GET /posts/:id).
2. **GET /agents/profile?name=OUR_NAME** — If the API returns `recentPosts` for our agent name, use that (same resolution as above).
3. **GET /posts?sort=new&limit=100** — Global feed; filter by our agent id and use those posts.

So Control and `/moltbook list` (and prune by number) always use the same list. If the Moltbook API doesn’t return `recentPosts` on `/agents/me` or profile, the fallback is the global feed filtered by author; that only includes Piko’s posts that appear in the last 100 global posts.

---

## Summary

| Goal | How |
|------|-----|
| Control panel lists Piko’s posts | Moltbook card shows profile + posts from `fetchMoltbookPostsByPiko`; checkboxes + “Prune selected”. |
| Piko tells you his posts | You run `/moltbook list`; server returns the same list in chat. |
| Piko deletes when you instruct | Control: checkboxes + Prune selected. Chat: `/moltbook prune last`, `prune <number>`, or `prune <id>`. |

After deploy, if the list is still empty, the Moltbook API may not be returning `recentPosts` for this agent; the server will then rely on the global `/posts` fallback (only recent posts in the last 100).
