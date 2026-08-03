/**
 * Deterministic slash-command grammar — no regex, no LLM.
 * Prefix + token split only.
 */

const { collapseWhitespace, isSafeName, isAsciiDigit, isHexChar } = require('./text');

function tokenize(message) {
  const s = collapseWhitespace(String(message || '').trim());
  if (!s) return [];
  return s.split(' ').filter(Boolean);
}

function isJobIdToken(tok) {
  const t = String(tok || '');
  if (!t.startsWith('job_')) return false;
  const rest = t.slice(4);
  if (rest.length < 8) return false;
  for (let i = 0; i < rest.length; i++) {
    const ch = rest[i];
    if (!(isHexChar(ch) || ch === '-')) return false;
  }
  return true;
}

/**
 * Parse known slash commands.
 * Returns null if message is not a slash command.
 * @returns {{ kind: string, tokens: string[], raw: string, ... } | null}
 */
function parseSlashCommand(message) {
  const raw = String(message || '').trim();
  if (!raw.startsWith('/')) return null;
  const tokens = tokenize(raw);
  if (!tokens.length) return null;
  const head = tokens[0].toLowerCase();

  // /learning
  if (head === '/learning') {
    return { kind: 'learning', tokens, raw };
  }

  // /++ name  /-- name  /+? name
  if (head === '/++' || head === '/--' || head === '/+?') {
    const name = tokens[1] || '';
    if (!isSafeName(name, { min: 1, max: 64, allowHyphen: true, allowUnderscore: true })) {
      return { kind: 'feedback_invalid', op: head, tokens, raw };
    }
    const op = head === '/++' ? 'plus' : head === '/--' ? 'minus' : 'question';
    return { kind: 'feedback', op, name, tokens, raw };
  }

  // /agent stop|cancel|close <id>
  // /agents stop|cancel|close <id>
  if (head === '/agent' || head === '/agents') {
    const verb = (tokens[1] || '').toLowerCase();
    if (verb === 'stop' || verb === 'cancel' || verb === 'close') {
      const id = tokens[2] || '';
      return {
        kind: 'agent_stop',
        jobId: id,
        validJobId: isJobIdToken(id) || isSafeName(id, { min: 3, max: 80, allowHyphen: true, allowUnderscore: true, allowDot: true }),
        tokens,
        raw,
      };
    }
    if (verb === 'run') {
      const agent = tokens[2] || '';
      const rest = tokens.slice(3).join(' ');
      return {
        kind: 'agent_run',
        agent,
        brief: rest,
        tokens,
        raw,
      };
    }
    if (verb === 'status' || (head === '/agents' && !tokens[1])) {
      return { kind: 'agent_status', tokens, raw };
    }
    return { kind: 'agent_unknown', tokens, raw };
  }

  // /legion approve … / /legion-approve …
  const legionHead = head === '/legion' || head.startsWith('/legion-');
  if (legionHead) {
    let restTokens = tokens.slice(1);
    if (head.startsWith('/legion-') && head !== '/legion') {
      // /legion-approve → treat as legion + approve
      const fused = head.slice('/legion-'.length);
      restTokens = [fused, ...tokens.slice(1)];
    }
    const action = (restTokens[0] || '').toLowerCase();
    if (action === 'approve') {
      const sub = (restTokens[1] || '').toLowerCase();
      if (sub === 'cancel') {
        return { kind: 'legion_approve_cancel', tokens, raw };
      }
      return {
        kind: 'legion_approve',
        target: restTokens.slice(1).join(' '),
        tokens,
        raw,
      };
    }
    return { kind: 'legion_unknown', action, tokens, raw };
  }

  // Unknown slash — still a slash command (caller may ignore)
  return { kind: 'unknown_slash', head, tokens, raw };
}

function isSlashCommand(message) {
  return String(message || '').trim().startsWith('/');
}

/** Option pickers like "2", "option 2", "the second" — no regex. */
const ORDINAL = { first: 1, second: 2, third: 3, fourth: 4 };

function parseOptionNumber(message) {
  const tokens = tokenize(message);
  if (!tokens.length) return null;
  const lower = tokens.map((t) => t.toLowerCase());

  // bare digit
  if (tokens.length === 1 && tokens[0].length === 1 && isAsciiDigit(tokens[0])) {
    return Number(tokens[0]);
  }
  // option N / number N / #N
  for (let i = 0; i < lower.length; i++) {
    const t = lower[i];
    if (t === 'option' || t === 'number' || t === '#') {
      const next = tokens[i + 1];
      if (next && next.length === 1 && isAsciiDigit(next)) return Number(next);
    }
    if (t.startsWith('#') && t.length === 2 && isAsciiDigit(t[1])) {
      return Number(t[1]);
    }
  }
  // the first/second/…
  for (const t of lower) {
    if (ORDINAL[t] != null) return ORDINAL[t];
  }
  return null;
}

module.exports = {
  tokenize,
  isJobIdToken,
  parseSlashCommand,
  isSlashCommand,
  parseOptionNumber,
};
