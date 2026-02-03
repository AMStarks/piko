# How Projects Are Worked On: Local vs Optimus

**Short answer:** Yes. You work **locally on your Mac**; when you’re on the Mac (local drive), you **push/sync to Optimus** so Optimus has the latest copy. When the Mac is off, Piko works on the **Optimus copy**; when the Mac is back on, you can pull those changes back if needed.

---

## Two copies

| Location | Path | When it’s used |
|----------|------|----------------|
| **Mac (local)** | `/Users/starkers/Projects/` (e.g. `Piko/`) | Your main workspace. Piko runs Cursor **here** when the Mac is on. |
| **Optimus** | `/root/projects/` (mirrors `~/Projects/`) | Fallback copy. Piko runs Cursor **here** when the Mac is off. Sync from Mac when you want: run `sync-projects-to-optimus.sh`. |

---

## Workflow: local first, then push to Optimus

**1. You’re on the Mac (local drive)**  
- You (and/or Piko) work in **Mac** projects: `/Users/starkers/Projects/Piko`, etc.  
- When you’re done (or before you turn the Mac off), **push to Optimus** so the server has the latest:

```bash
# From your Mac (run when you’re on the Mac and want Optimus up to date)
rsync -az --exclude '.git' --exclude 'node_modules' --exclude '.cursor' \
  -e "ssh -i ~/.ssh/id_optimus" \
  /Users/starkers/Projects/Piko/ root@192.168.0.121:/root/projects/Piko/
```

- Repeat for other projects if you add them under `/root/projects/` on Optimus.

**Sync to Optimus (manual only):** There is no automatic sync. When you want to push what you’ve worked on in Cursor to Optimus, run from your Mac:

```bash
/Users/starkers/Projects/Piko/sync-projects-to-optimus.sh
```

That syncs **all of ~/Projects** to Optimus (`/root/projects/`). This is the only Cursor → Optimus sync.

**2. Mac is off**  
- Piko runs Cursor on **Optimus** in `/root/projects/`.  
- Any changes from Piko (e.g. edits, new files) live only on **Optimus** until you sync back.

**3. Mac is back on**  
- If Piko changed anything on Optimus while the Mac was off, **pull those changes back to the Mac** so your local copy is up to date:

```bash
# From your Mac: pull Optimus copy → Mac (use when Mac was off and Piko worked on Optimus)
rsync -az --exclude '.git' --exclude 'node_modules' --exclude '.cursor' \
  -e "ssh -i ~/.ssh/id_optimus" \
  root@192.168.0.121:/root/projects/Piko/ /Users/starkers/Projects/Piko/
```

- If you only ever work on the Mac and just use Optimus as a read-only fallback, you can skip this and only ever push Mac → Optimus.

---

## Summary

- **Work is local (Mac) first.**  
- **When you’re on the local drive:** push to Optimus with the rsync above so Optimus has the latest.  
- **When the Mac is off:** Piko works on the Optimus copy.  
- **When the Mac is on again:** optionally pull from Optimus to Mac if Piko changed anything on the server.

**To sync Cursor → Optimus:** Run `~/Projects/Piko/sync-projects-to-optimus.sh` (or the full path above) whenever you want to push.
