/**
 * Smart local answer finalization.
 *
 * Class A: template only (queue, instant reads)
 * Class B: 8B first attempt within budget → grounded fallback → optional async upgrade
 *
 * PIKO_LOCAL_SYNTH_MODE:
 *   smart (default) — budget 8B attempt, fallback, async upgrade on miss
 *   off             — template only
 *   async           — template first, background upgrade only
 *   opportunistic   — single HTTP race (web)
 *   blocking        — await full synth (web only)
 */
function getLocalSynthMode(ctx = {}) {
  const raw = String(process.env.PIKO_LOCAL_SYNTH_MODE || '').trim().toLowerCase();
  if (process.env.PIKO_LOCAL_SYNTHESIS === '0' || process.env.PIKO_LOCAL_SYNTHESIS === 'false') {
    return 'off';
  }
  if (['off', 'smart', 'async', 'opportunistic', 'blocking'].includes(raw)) {
    return raw || 'smart';
  }
  const sessionId = String(ctx.sessionId || '');
  const source = String(ctx.reqSource || '').toLowerCase();
  const isTelegram = source === 'telegram' || sessionId.startsWith('telegram');
  return isTelegram ? 'smart' : 'opportunistic';
}

function isTelegramContext(ctx = {}) {
  const sessionId = String(ctx.sessionId || '');
  const source = String(ctx.reqSource || '').toLowerCase();
  return source === 'telegram' || sessionId.startsWith('telegram');
}

function parseTelegramChatId(sessionId) {
  const s = String(sessionId || '');
  if (!s.startsWith('telegram-')) return null;
  const id = s.slice('telegram-'.length).trim();
  return id || null;
}

function withTimeout(promise, ms) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`timeout after ${ms}ms`)), ms);
    }),
  ]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

function synthBudgetMs(ctx = {}) {
  if (isTelegramContext(ctx)) {
    return Number(process.env.PIKO_TELEGRAM_LOCAL_SYNTH_BUDGET_MS || 8000);
  }
  return Number(process.env.PIKO_LOCAL_SYNTH_BUDGET_MS || 12000);
}

function scheduleAsyncLocalSynthesis(opts = {}) {
  const { userMessage, facts, route, formattedFallback, history, sessionId } = opts;

  setImmediate(() => {
    (async () => {
      try {
        const { synthesizeLocalReply } = require('./frontDesk');
        const reply = await synthesizeLocalReply({
          userMessage,
          facts,
          route,
          formattedFallback,
          history,
          background: true,
        });
        const trimmed = String(reply || '').trim();
        const fallback = String(formattedFallback || '').trim();
        if (!trimmed || trimmed === fallback) return;

        const chatId = parseTelegramChatId(sessionId);
        if (!chatId) return;

        const { sendTelegramToChat } = require('./telegramNotifier');
        const body = trimmed.length > 3800 ? `${trimmed.slice(0, 3800)}…` : trimmed;
        await sendTelegramToChat(chatId, body, { parseMode: 'none', skipFeed: true });
        if (process.env.PIKO_LOG_PLANNER === '1') {
          console.log('[localAnswer] Async upgrade pushed to Telegram', chatId);
        }
      } catch (e) {
        console.warn('[localAnswer] Async upgrade failed:', e.message);
      }
    })();
  });
}

async function attemptGroundedSynthesis(localAnswer, message, history, ctx, budgetMs) {
  const { synthesizeLocalReply } = require('./frontDesk');
  return withTimeout(
    synthesizeLocalReply({
      userMessage: message,
      facts: localAnswer.facts,
      route: localAnswer.route,
      formattedFallback: localAnswer.reply,
      history,
      speechAct: localAnswer.facts?.speechAct,
      dialogue: localAnswer.facts?.dialogue,
    }),
    budgetMs,
  );
}

/**
 * @param {object} localAnswer
 * @param {string} message
 * @param {Array} history
 * @param {{ reqSource?: string, sessionId?: string, dataDir?: string }} [ctx]
 */
async function finalizeLocalAnswer(localAnswer, message, history = [], ctx = {}) {
  if (!localAnswer) return null;

  const base = {
    reply: localAnswer.reply,
    route: localAnswer.route,
    synthesized: false,
    instant: true,
  };

  if (!localAnswer.synthesize) {
    return base;
  }

  // Legion schedule permission stays template-authoritative (avoid inventing schedule mutations).
  // Config permission/how-to: synthesize from facts JSON (standard AI pattern).
  if (localAnswer.route === 'legion_permission') {
    return base;
  }

  const { localSynthesisEnabled } = require('./frontDesk');
  if (!localSynthesisEnabled()) {
    return base;
  }

  const mode = getLocalSynthMode(ctx);
  if (mode === 'off') {
    return base;
  }

  const synthOpts = {
    userMessage: message,
    facts: localAnswer.facts,
    route: localAnswer.route,
    formattedFallback: localAnswer.reply,
    history,
    sessionId: ctx.sessionId,
  };

  // Legacy: template first, upgrade async only
  if (mode === 'async') {
    scheduleAsyncLocalSynthesis(synthOpts);
    return { ...base, synthesisPending: true };
  }

  if (mode === 'blocking' && !isTelegramContext(ctx)) {
    try {
      const reply = await attemptGroundedSynthesis(localAnswer, message, history, ctx, 120000);
      const trimmed = String(reply || '').trim();
      if (trimmed.length > 20) {
        return { reply: trimmed, route: localAnswer.route, synthesized: true };
      }
    } catch (e) {
      console.warn('[localAnswer] Blocking synthesis failed:', e.message);
    }
    return { ...base, synthesisFallback: true };
  }

  const budget = synthBudgetMs(ctx);

  // smart + opportunistic: 8B gets first shot within budget
  try {
    const reply = await attemptGroundedSynthesis(localAnswer, message, history, ctx, budget);
    const trimmed = String(reply || '').trim();
    if (trimmed.length > 20 && trimmed !== String(localAnswer.reply || '').trim()) {
      return {
        reply: trimmed,
        route: localAnswer.route,
        synthesized: true,
        instant: true,
      };
    }
  } catch (e) {
    if (process.env.PIKO_LOG_PLANNER === '1') {
      console.log('[localAnswer] Budget synthesis missed:', e.message);
    }
  }

  // Missed budget — grounded fallback immediately; optional async upgrade on Telegram
  if (mode === 'smart' && isTelegramContext(ctx)) {
    scheduleAsyncLocalSynthesis(synthOpts);
    return { ...base, synthesisFallback: true, synthesisPending: true };
  }

  return { ...base, synthesisFallback: true };
}

module.exports = {
  getLocalSynthMode,
  parseTelegramChatId,
  scheduleAsyncLocalSynthesis,
  finalizeLocalAnswer,
};
