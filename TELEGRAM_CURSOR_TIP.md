# Telegram + /cursor: Use Single Hyphen for Flags

**Remember:** In Telegram, a **double hyphen** (`--`) in messages can be stripped or altered. For `/cursor` commands, use a **single hyphen** for flags.

| In Telegram send | Example |
|------------------|--------|
| `/cursor -version` | Cursor version (works) |
| `/cursor -help` | Cursor help |
| `/cursor chat "your question"` | No change needed |
| `/cursor apply "refactor X"` | No change needed |

**Avoid in Telegram:** `/cursor --version` or `/cursor --help` — the second hyphen may disappear, so prefer `/cursor -version` and `/cursor -help`.

This is documented in the bot’s `/status` reply and in the code comment for `parseCursorCommand`.
