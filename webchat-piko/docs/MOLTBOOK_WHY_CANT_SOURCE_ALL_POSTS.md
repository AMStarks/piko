# Why we can’t source all of Piko’s posts from the API

## What the public API docs say

The official Moltbook developer docs (**https://moltbook.com/developers** and **https://moltbook.com/developers.md**) only document **identity verification**:

- **POST /api/v1/agents/me/identity-token** — bot gets a temporary token (Bearer API key).
- **POST /api/v1/agents/verify-identity** — your app verifies the token and gets the agent profile (id, name, karma, **stats.posts** count, etc.).

There is **no documented “list my posts” or “paginate my posts”** endpoint. The profile returned by verify-identity includes **stats.posts** (a number), not the list of post IDs or bodies. So from the public API alone we cannot source the full list of posts.

## What we do today (undocumented agent API)

We use the **agent** bearer token (Piko’s API key) with GET endpoints that are not in the public docs:

We try to get posts from Moltbook in three ways:

1. **GET /posts?sort=new&limit=200** (with the agent’s bearer token)  
   We take the response, filter by `author.id === agentId` or `agent_id === agentId`, and treat that as “Piko’s posts” from the global feed.

2. **GET /agents/me**  
   We use `recentPosts` / `recent_posts` / `posts` from the response. In practice this returns **one** post.

3. **GET /agents/profile?name=_Piko_servicedog_**  
   Same idea: we use the profile’s recent-post list. That also appears to be a short list (e.g. one item).

We merge these, dedupe by id, and sort by date. We still only ever see **one** post.

## Why that’s not enough

We don’t have Moltbook’s API docs. We’re inferring from behaviour:

- **GET /posts** with the agent’s token may not be a “global feed of everyone’s posts”. It might be “your feed” or “posts relevant to you”, and the backend might only include one of the authenticated agent’s own posts, or use a different response shape (e.g. no `author.id` or different nesting), so our filter matches 0 or 1.
- **/agents/me** and **/agents/profile?name=...** only expose a **short** “recent posts” list (in practice one ID or one object), not “all my posts”.
- If Moltbook has a dedicated “list all my posts” or “paginate my posts” endpoint, we don’t know the path, query params, or response format, so we can’t call it.

So with the endpoints and shapes we’re using, **the API does not give us a full list of Piko’s posts**. We only get one (or a few) from “recent” lists and, when we use it, one from the filtered `/posts` result. That’s why we can’t “source” the full list from the API alone.

## What we do instead

We **accumulate** the list ourselves:

- **Poster** (`moltbook-poster.js`): each run fetches whatever the API gives (e.g. one post from `recentPosts`), **merges** it into existing `data/moltbook-state.json` (by id), and keeps the last 10 posts. So over time we build a local list of “posts we’ve seen” and don’t overwrite it when the API only returns one.
- **Server** (`server.js`): when building the Control “All posts” payload, we merge API result + **local state** and dedupe. So the list is “whatever the API returned plus whatever we’ve stored in state”.

So the full list is “API + our own state”. We can’t source the **entire** history from the API with what we have today; we can only grow the list over time via the poster and new posts.

## If Moltbook added a proper “my posts” API

If they exposed e.g.:

- `GET /agents/me/posts?limit=100` or  
- `GET /posts?author=me&limit=100`  

and returned all of the authenticated agent’s posts (or paginated), we could call that and use it as the main source and only fall back to state for older or missing items. Until then, we’re limited to “recent” and our own merged state.
