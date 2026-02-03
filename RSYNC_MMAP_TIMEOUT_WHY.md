# Why rsync "mmap: Operation timed out" Happens (LASKO, Zeroa)

**What you saw:** rsync failed on files in `LASKO/` and `Zeroa/` with:
- `mmap: Resource deadlock avoided` / `mmap: Operation timed out`
- `read errors mapping ... Operation timed out (60)`

**Actual cause:** Those files are **dataless** (offloaded). macOS has evicted their content to save space (e.g. "Optimize Mac Storage" or iCloud). When rsync tries to read them, the kernel has to fetch the data from cloud/storage first and the read times out (60s).

Proof:
```bash
ls -leO /Users/starkers/Projects/LASKO/.gitignore
# → ... dataless  (content not on disk)
ls -leO /Users/starkers/Projects/Zeroa/download_tinyllama.py
# → ... dataless
```

So it's not openrsync vs GNU rsync — even GNU rsync fails on dataless files because the **data isn't on disk** until something materializes it.

---

## What we do

- **Sync script** uses GNU rsync from Homebrew and **excludes** `LASKO` and `Zeroa` so the rest of `~/Projects/` syncs reliably.
- To include LASKO or Zeroa you'd need to **materialize** them first (e.g. open the folders in Finder or turn off "Optimize Mac Storage" for those paths), then run sync — or stop excluding them and accept that sync may fail on those files when they're dataless.

---

## Summary

| Item | Detail |
|------|--------|
| **Cause** | LASKO and Zeroa (or files inside them) are **dataless**; content is offloaded, so reads time out. |
| **Fix** | Exclude LASKO and Zeroa in the sync script so the rest syncs. |
| **Optional** | Use Homebrew rsync (`brew install rsync`) in the script for other projects; dataless files still can't be synced until materialized. |
