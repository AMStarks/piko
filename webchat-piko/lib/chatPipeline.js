/**
 * P3.1c — Chat pipeline factory extracted from server.js (handleApiChat).
 * Preserves understand→legate→triage→persona ordering; deps inject server closures.
 */
const path = require('path');

function createHandleApiChat(deps) {
  const {
    AUSMAKER_BASE_URL,
    CHAT_QUEUE_WAIT_MS,
    CURRENT_MODEL_FILE,
    CURSOR_OPTIMUS_ONLY,
    DATA_DIR,
    GMAIL_ACCESS_TOKEN,
    GMAIL_CLIENT_ID,
    GMAIL_CLIENT_SECRET,
    GMAIL_REFRESH_TOKEN,
    GROK_API_KEY,
    LEGION_ADAPTER_API_BASE,
    MOLTBOOK_API_KEY,
    NEWS_API_KEY,
    OLLAMA_MODEL,
    OLLAMA_URL,
    PENDING_CANCEL_TTL_MS,
    PENDING_INTENT_EXPIRY_MS,
    PIKO_HEAVY_MODEL,
    PROMPTS_DIR,
    SANDBOX_DIR,
    SERPER_API_KEY,
    SLICE_HISTORY,
    SYSTEM_PROMPT,
    TASK_OPTIMUS_ONLY,
    TENANT_BG,
    rootDir,
    acquireChatSlot,
    acquireSessionLock,
    appendConfirmedBrief,
    appendCorrection,
    appendPendingNotification,
    beliefLoop,
    buildLearningUpdateReply,
    classifyDepthOptional,
    clearApprovalPending,
    clearBriefSession,
    collapseWhitespace,
    createIntent,
    createLegionScheduledWithTask,
    createResponsePlan,
    createRule,
    dispatchLegionBrief,
    dispatchLegionPoSubmit,
    endsWithAny,
    enforceReplyConstraints,
    extractHref,
    extractNicknameFromMessage,
    extractSentenceLimit,
    extractTag,
    extractWordLimit,
    fetchMoltbookPostsByPiko,
    findRequestedNickname,
    formatPlanForPrompt,
    formatRecap,
    fs,
    getAndConsumePendingQuestionBlock,
    getBriefSession,
    getCorpusBlockForPrompt,
    getCurrentModelOverride,
    getDailyMemoryBlock,
    getKnowledgeBaseBlockForPrompt,
    getRagContext,
    getRagContextAsync,
    getRecentLearningBlock,
    getStickyIdeasBlock,
    getTruthBlockForPrompt,
    grokChat,
    hasAnyWord,
    hasColonDirective,
    http,
    httpRequest,
    https,
    httpsRequest,
    inFlightRequests,
    includesAny,
    isAllAsciiDigits,
    isAllowedByAllowlist,
    isAsciiDigit,
    isAutomationSession,
    isBriefComplete,
    isKeepItShortPrompt,
    isLegionApproveAllowed,
    isSafeName,
    isSimpleStatusAck,
    isToneDriftComplaint,
    isUuidLike,
    isYyyyMm,
    loadAllowlist,
    loadApprovalPending,
    loadDataSoul,
    loadIntents,
    loadMind,
    loadRules,
    loadSessionsConfig,
    loadedSkills,
    log,
    memory,
    metrics,
    nextDueFromSchedule,
    nextMissingField,
    normalizeApostrophes,
    normalizeSchedule,
    ollamaChat,
    ollamaChatStream,
    ollamaNativeChat,
    parseCursorCommand,
    parseDuration,
    parseFieldValueLine,
    parseHhMm,
    parseSessionSource,
    parseSlashCommand,
    parseTaskCommand,
    path,
    pendingCancelConfirmations,
    pendingIntentsBySession,
    pickBySeed,
    promoteModel,
    rateLimit,
    readBody,
    replaceAllLiteral,
    requestsLearningUpdate,
    requestsLegionBrief,
    requestsNoQuestion,
    resolveSandboxPath,
    runCursorCommand,
    runTaskCommand,
    saveAllowlist,
    savePendingCancelConfirmations,
    saveSessionsConfig,
    send,
    sessionStore,
    setApprovalPending,
    setBriefField,
    setImmediate,
    setTimeout,
    splitLines,
    splitRssItems,
    splitSentencesSimple,
    startBriefSession,
    stripCancelPrefix,
    stripCodeFences,
    stripListMarker,
    stripMarkdownFromText,
    stripTrailingPunct,
    stripTrailingSlash,
    stripWrappingQuotes,
    telegramNotify,
    toLowerAsciiish,
    toggleRule,
    truncateToWords,
    updateIntent,
    updateMind,
    upsertModel,
    url,
    verifyAndStripApprovalPin,
  } = deps;

  return async function handleApiChat(req, res) {
  metrics.requests++;
  const body = await readBody(req);
  let json;
  try {
    json = JSON.parse(body || '{}');
  } catch (_) {
    metrics.errors++;
    log('warn', 'Invalid JSON', {}, req.requestId);
    return send(res, 400, JSON.stringify({ error: 'Invalid JSON' }));
  }
  const rawMessage = (() => {
    const raw = typeof json.message === 'string' ? json.message.trim() : '';
    try {
      const { normalizeApostrophes } = require('./queueRead');
      return normalizeApostrophes(raw);
    } catch (_) {
      return raw;
    }
  })();
  const attachmentList = Array.isArray(json.attachments) ? json.attachments : [];
  let message = rawMessage;
  if (attachmentList.length) {
    try {
      const { enrichMessageWithAttachments } = require('./chatAttachments');
      const enriched = await enrichMessageWithAttachments(rawMessage, attachmentList);
      message = enriched.message;
      if (process.env.PIKO_LOG_PLANNER === '1') {
        console.log('[CHAT] attachments saved', (enriched.saved || []).map((s) => s.filename).join(', '));
      }
    } catch (e) {
      metrics.errors++;
      return send(res, 400, JSON.stringify({ error: e.message || 'Attachment upload failed' }));
    }
  }
  if (!message) {
    metrics.errors++;
    return send(res, 400, JSON.stringify({ error: 'Missing message' }));
  }
  const streamReply = json.stream === true;
  const sessionId = typeof json.sessionId === 'string' ? json.sessionId : null;
  // Session key: keep unified memory for human channels, but isolate automation clients.
  const automationSession = isAutomationSession(sessionId);
  if (!automationSession) {
    try {
      require('../scripts/proactiveThinker').updateLastInteraction();
    } catch (_) {}
  }
  const key = automationSession ? (sessionId || 'automation') : (process.env.PIKO_UNIFIED_SESSION_ID || sessionId || 'main');
  // Keep identity facts scoped to the caller-provided session to avoid cross-channel nickname bleed.
  const identityKey = sessionId || key;
  const clientIp = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || (req.socket && req.socket.remoteAddress) || 'unknown';
  const ollamaPriority = automationSession ? 'background' : 'user';
  const { runWithContext } = require('./requestContext');
  return runWithContext({ priority: ollamaPriority }, async () => {
  return acquireSessionLock(key, async () => {
  const limit = rateLimit.check(clientIp);
  if (!limit.ok) return send(res, 429, JSON.stringify({ error: 'Too many requests' }));

  // Promise-based request coalescing: duplicate requests wait for original and get same payload
  const userIdentifier = key;
  const msgSignature = `${userIdentifier}::${message.trim().toLowerCase()}`;

  if (inFlightRequests.has(msgSignature)) {
    console.warn('[SERVER] Piggybacking duplicate request onto active process:', msgSignature.slice(0, 80) + (msgSignature.length > 80 ? '...' : ''));
    try {
      const { statusCode, body } = await inFlightRequests.get(msgSignature);
      return send(res, statusCode, body);
    } catch (e) {
      return send(res, 500, JSON.stringify({ reply: 'Concurrent request failed.' }));
    }
  }

  let resolveReq;
  const reqPromise = new Promise((resolve) => { resolveReq = resolve; });
  inFlightRequests.set(msgSignature, reqPromise);

  const originalEnd = res.end.bind(res);
  const originalWriteHead = res.writeHead.bind(res);
  let capturedStatus = 200;
  res.writeHead = function (statusCode, ...args) {
    capturedStatus = statusCode;
    return originalWriteHead(statusCode, ...args);
  };
  res.end = function (body, encoding, callback) {
    if (resolveReq) {
      try {
        resolveReq({ statusCode: capturedStatus, body: typeof body === 'string' ? body : String(body) });
      } catch (_) {
        resolveReq({ statusCode: 500, body: JSON.stringify({ reply: '' }) });
      }
      resolveReq = null;
      setTimeout(() => inFlightRequests.delete(msgSignature), 5000);
    }
    return originalEnd(body, encoding, callback);
  };

  const sessionsConfig = loadSessionsConfig();
  const profile = (sessionsConfig[key] && sessionsConfig[key].profile) || 'main';
  const sessionModel = (sessionsConfig[key] && sessionsConfig[key].model) || getCurrentModelOverride() || OLLAMA_MODEL;

  const { source: reqSource, externalId: reqExternalId } = parseSessionSource(sessionId || 'default');
  const allowlist = loadAllowlist();
  if (!isAllowedByAllowlist(allowlist, reqSource, reqExternalId)) {
    const channelId = reqSource && reqExternalId != null ? `${reqSource}-${reqExternalId}` : (sessionId || 'unknown');
    log('warn', 'Allowlist denied: ' + channelId + ' not in allowlist', { source: reqSource, externalId: reqExternalId }, req.requestId);
    return send(res, 403, JSON.stringify({
      error: 'channel not allowed',
      channel: reqSource || 'unknown',
      id: reqExternalId != null ? String(reqExternalId) : undefined,
      hint: 'Add this channel via /allow <source> <id> from WebChat or update data/allowlist.json',
    }));
  }

  // Command vs chat for metrics
  const isCommand = message.startsWith('/') && !message.startsWith('//');
  if (isCommand) metrics.commands++; else metrics.chat++;

  // —— /allow, /block (only from WebChat) ——
  if ((message === '/allow' || message.startsWith('/allow ')) && reqSource === 'webchat') {
    const rest = message.slice(7).trim();
    const parts = collapseWhitespace(rest).split(' ').filter(Boolean);
    if (parts.length < 2) return send(res, 200, JSON.stringify({ reply: 'Usage: /allow <source> <id> e.g. /allow discord 123456' }));
    const [src, id] = [parts[0].toLowerCase(), parts[1]];
    if (!allowlist[src]) allowlist[src] = [];
    if (!allowlist[src].includes(id)) allowlist[src].push(id);
    saveAllowlist(allowlist);
    return send(res, 200, JSON.stringify({ reply: `Allowed ${src}: ${id}.` }));
  }
  if ((message === '/block' || message.startsWith('/block ')) && reqSource === 'webchat') {
    const rest = message.slice(6).trim();
    const parts = collapseWhitespace(rest).split(' ').filter(Boolean);
    if (parts.length < 2) return send(res, 200, JSON.stringify({ reply: 'Usage: /block <source> <id>' }));
    const [src, id] = [parts[0].toLowerCase(), parts[1]];
    if (Array.isArray(allowlist[src])) allowlist[src] = allowlist[src].filter((x) => x !== id);
    saveAllowlist(allowlist);
    return send(res, 200, JSON.stringify({ reply: `Blocked ${src}: ${id}.` }));
  }

  // —— Phase B: Moltbook feedback signals /++ and /-- ——
  const MOLTBOOK_FEEDBACK_WHITELIST = ['clarity', 'tooLong', 'goodQuestions', 'tooAbstract', 'moreExamples'];
  const MOLTBOOK_FEEDBACK_FILE = path.join(DATA_DIR, 'moltbook-feedback.json');
  const _fbSlash = parseSlashCommand(message);
  const feedbackPlus = (_fbSlash && _fbSlash.kind === 'feedback' && _fbSlash.op === 'plus') ? [null, _fbSlash.name] : null;
  const feedbackMinus = (_fbSlash && _fbSlash.kind === 'feedback' && _fbSlash.op === 'minus') ? [null, _fbSlash.name] : null;
  const feedbackQ = (_fbSlash && _fbSlash.kind === 'feedback' && _fbSlash.op === 'question') ? [null, _fbSlash.name] : null;
  const feedbackMatch = feedbackPlus || feedbackMinus || feedbackQ;
  if (feedbackMatch) {
    const signal = feedbackMatch[1];
    if (!MOLTBOOK_FEEDBACK_WHITELIST.includes(signal)) {
      return send(res, 200, JSON.stringify({ reply: `Unknown signal. Use: ${MOLTBOOK_FEEDBACK_WHITELIST.join(', ')}.` }));
    }
    let data = { signals: {}, lastUpdated: null };
    try {
      if (fs.existsSync(MOLTBOOK_FEEDBACK_FILE)) {
        const raw = fs.readFileSync(MOLTBOOK_FEEDBACK_FILE, 'utf8');
        data = JSON.parse(raw);
        if (!data || typeof data.signals !== 'object') data = { signals: data?.signals || {}, lastUpdated: data?.lastUpdated || null };
      }
    } catch (_) {}
    data.signals[signal] = (data.signals[signal] || 0) + 1;
    data.lastUpdated = new Date().toISOString();
    try {
      fs.mkdirSync(DATA_DIR, { recursive: true });
      fs.writeFileSync(MOLTBOOK_FEEDBACK_FILE, JSON.stringify(data, null, 2), 'utf8');
    } catch (e) {
      return send(res, 200, JSON.stringify({ reply: 'Failed to save feedback: ' + e.message }));
    }
    const total = data.signals[signal];
    return send(res, 200, JSON.stringify({ reply: `Feedback recorded: +1 ${signal} (total: ${total}). Next journal cycle will see this.` }));
  }

  // —— Per-session toolsAllowed (restrict commands to list if set) ——
  const toolsAllowed = sessionsConfig[key] && sessionsConfig[key].toolsAllowed;
  if (Array.isArray(toolsAllowed) && toolsAllowed.length > 0) {
    const allowed = ['/new', '/status', '/profile', '/model', '/allow', '/block', '/agents', '/agent', '/mission'];
    const ok = allowed.some((a) => message === a || message.startsWith(a + ' ')) || toolsAllowed.some((p) => message === p || message.startsWith(p + ' '));
    if (!ok) return send(res, 200, JSON.stringify({ reply: 'Command not allowed in this session.' }));
  }

  // —— Agent orch (EI): brief wizard, /agents, /agent run|stop, /mission + light NL ——
  try {
    const { tryHandleAgentChat } = require('./agentChatCommands');
    const agentHandled = await tryHandleAgentChat(message, rootDir, {
      sessionKey: key,
      dataDir: DATA_DIR,
    });
    if (agentHandled && agentHandled.reply) {
      return send(res, 200, JSON.stringify({ reply: agentHandled.reply }));
    }
  } catch (e) {
    if (process.env.PIKO_LOG_PLANNER === '1') console.warn('[agent-chat]', e.message);
  }

  const lowerMessage = String(message || '').toLowerCase().trim();

  // —— Pending Legion approve: next message is PO payload or cancel ——
  const approvalPending = loadApprovalPending()[key];
  if (approvalPending && approvalPending.awaiting === 'po_submit') {
    const trimmed = String(message || '').trim();
    if ((() => { const s=parseSlashCommand(trimmed); return s && s.kind === 'legion_approve_cancel'; })() || includesAny(toLowerAsciiish(trimmed), ['approve cancel'])) {
      clearApprovalPending(key);
      return send(res, 200, JSON.stringify({ reply: 'Legion approve cancelled.' }));
    }
    if (trimmed.startsWith('{')) {
      let poPayload = null;
      try {
        poPayload = JSON.parse(trimmed);
      } catch (_) {}
      if (poPayload && typeof poPayload === 'object' && !Array.isArray(poPayload)) {
        if (!isLegionApproveAllowed(reqSource)) {
          return send(res, 403, JSON.stringify({ reply: 'PO approval is restricted to primary channels. Set PIKO_LEGION_APPROVE_PRIMARY_SOURCES to allow this source.' }));
        }
        const initSource = approvalPending.source;
        if (initSource != null && String(reqSource || '') !== String(initSource)) {
          clearApprovalPending(key);
          return send(res, 403, JSON.stringify({ reply: 'PO approval must be completed from the same channel that initiated it.' }));
        }
        const pinCheck = verifyAndStripApprovalPin(poPayload);
        if (!pinCheck.ok) {
          return send(res, 403, JSON.stringify({ reply: pinCheck.error }));
        }
        clearApprovalPending(key);
        const pikoUserId = reqExternalId != null ? `${reqSource}:${reqExternalId}` : `${reqSource}:${key}`;
        const { beginChatMoneyConfirm } = require('./moneyPlaneGate');
        const confirm = beginChatMoneyConfirm(key, {
          kind: 'po_submit',
          summary: 'purchase order submit',
          payload: pinCheck.payload,
          pikoUserId,
          role: 'operator',
          source: reqSource,
        });
        return send(res, 200, JSON.stringify({
          reply: confirm.reply,
          route: confirm.route || 'money_confirm_required',
          error: confirm.error || 'money_confirm_required',
          needs_confirm: true,
        }));
      }
    }
    clearApprovalPending(key);
    return send(res, 200, JSON.stringify({
      reply: 'Expected JSON PO payload. Cancelled. Use /legion approve submit from-draft dry, or inline JSON: /legion approve submit {"supplier":"X","lines":[{"sku":"A","quantity":1}]}',
    }));
  }

  // —— /legion approve submit (PO approval path) ——
  if (lowerMessage.startsWith('/legion approve') || lowerMessage.startsWith('/legion-approve')) {
    if (!isLegionApproveAllowed(reqSource)) {
      return send(res, 403, JSON.stringify({ reply: 'PO approval is restricted to primary channels. Set PIKO_LEGION_APPROVE_PRIMARY_SOURCES (e.g. webchat,app) to allow this source.' }));
    }
    const rest = lowerMessage.replace('/legion-approve', '/legion approve').replace('/legion approve', '').trim();
    if (rest.startsWith('submit')) {
      const afterSubmit = rest.slice(6).trim();
      let poPayload = null;
      if (afterSubmit.startsWith('from-draft')) {
        const { loadLastPoDraft, buildSubmitPayloadFromDraft, formatPoDraftSummary } = require('./poWriteLadder');
        const tail = afterSubmit.slice(10).trim();
        const dry = hasAnyWord(toLowerAsciiish(tail), ['dry']) || toLowerAsciiish(tail).includes('--dry-run');
        const supplier = (() => {
          let s = String(tail || '');
          const low = toLowerAsciiish(s);
          for (const p of ['--dry-run', ' dry', 'dry ']) {
            const idx = low.indexOf(p.trim() === 'dry' ? 'dry' : p);
          }
          s = replaceAllLiteral(s, '--dry-run', '');
          s = replaceAllLiteral(s, '--DRY-RUN', '');
          // remove standalone dry token
          s = collapseWhitespace(s.split(' ').filter((w) => toLowerAsciiish(w) !== 'dry').join(' '));
          return s.trim() || undefined;
        })();
        const built = buildSubmitPayloadFromDraft(loadLastPoDraft(DATA_DIR), supplier);
        if (!built.ok) {
          const hint = formatPoDraftSummary(loadLastPoDraft(DATA_DIR));
          return send(res, 200, JSON.stringify({ reply: `${built.message} ${hint}` }));
        }
        poPayload = { ...built.payload, dry_run: dry || process.env.PIKO_PO_SUBMIT_DRY_RUN === '1' };
      } else if (afterSubmit.startsWith('{')) {
        try {
          poPayload = JSON.parse(afterSubmit);
        } catch (_) {}
      }
      if (poPayload && typeof poPayload === 'object' && !Array.isArray(poPayload)) {
        const pinCheck = verifyAndStripApprovalPin(poPayload);
        if (!pinCheck.ok) {
          return send(res, 403, JSON.stringify({ reply: pinCheck.error }));
        }
        const pikoUserId = reqExternalId != null ? `${reqSource}:${reqExternalId}` : `${reqSource}:${key}`;
        const { beginChatMoneyConfirm } = require('./moneyPlaneGate');
        const confirm = beginChatMoneyConfirm(key, {
          kind: 'po_submit',
          summary: 'purchase order submit',
          payload: pinCheck.payload,
          pikoUserId,
          role: 'operator',
          source: reqSource,
        });
        return send(res, 200, JSON.stringify({
          reply: confirm.reply,
          route: confirm.route || 'money_confirm_required',
          error: confirm.error || 'money_confirm_required',
          needs_confirm: true,
        }));
      }
      setApprovalPending(key, { source: reqSource });
      const pinHint = process.env.PIKO_LEGION_APPROVE_PIN ? ' Include "_pin": "your-pin" in the JSON when you paste it.' : '';
      return send(res, 200, JSON.stringify({
        reply: 'Awaiting PO payload. Use `/legion approve submit from-draft dry` after a draft, or paste JSON. `/legion approve cancel` to abort.' + pinHint,
      }));
    }
    if (rest.startsWith('cancel')) {
      clearApprovalPending(key);
      return send(res, 200, JSON.stringify({ reply: 'Legion approve cancelled.' }));
    }
    if (rest === 'draft' || rest.startsWith('draft')) {
      const { loadLastPoDraft, formatPoDraftSummary } = require('./poWriteLadder');
      return send(res, 200, JSON.stringify({ reply: formatPoDraftSummary(loadLastPoDraft(DATA_DIR)) }));
    }
    return send(res, 200, JSON.stringify({
      reply: 'Usage: /legion approve submit from-draft [supplier] [dry] | /legion approve submit {<json>} | /legion approve draft | /legion approve cancel',
    }));
  }

  // —— Legion brief wizard (/legion brief) ——
  const isLegionBriefCommand = lowerMessage.startsWith('/legion brief') || lowerMessage.startsWith('/legion-brief');
  let activeBrief = getBriefSession(DATA_DIR, key);
  const isNaturalStart = !activeBrief && !isLegionBriefCommand && requestsLegionBrief(message);
  let shouldHandleActiveBriefTurn = !!activeBrief && !String(message || '').trim().startsWith('/');

  // Stale brief expiration: if idle >15 min, assume user abandoned the form
  if (activeBrief && !isLegionBriefCommand) {
    const updatedMs = activeBrief.updatedAt ? new Date(activeBrief.updatedAt).getTime() : 0;
    if (Date.now() - updatedMs > 15 * 60 * 1000) {
      clearBriefSession(DATA_DIR, key);
      console.log(`[BRIEF INTERRUPT] Brief for session ${key} is stale (>15 mins). Auto-cancelling.`);
      shouldHandleActiveBriefTurn = false;
      activeBrief = null;
    }
  }

  // Semantic Bouncer: context-switching logic (is user answering the wizard or switching to a new command?)
  if (activeBrief && !isLegionBriefCommand) {
    const { classifyUserIntent } = require('./semanticBouncer');
    const nextField = nextMissingField(activeBrief);
    const currentQuestion = nextField ? nextField.prompt : 'Unknown';
    const intent = await classifyUserIntent(message, currentQuestion, sessionModel);
    if (process.env.PIKO_LOG_PLANNER === '1') console.log(`[SEMANTIC ROUTER] User intent classified as: ${intent}`);

    if (intent === 'escape') {
      clearBriefSession(DATA_DIR, key);
      return send(res, 200, JSON.stringify({ reply: "Okay, I've cancelled the brief. What do you need?" }));
    }
    if (intent === 'intent_override') {
      clearBriefSession(DATA_DIR, key);
      console.log('[BRIEF INTERRUPT] User switched context (intent_override). Cancelling brief.');
      shouldHandleActiveBriefTurn = false;
      activeBrief = null;
    }
    // intent === 'form_input' — let the brief wizard absorb the message
  }

  if (isLegionBriefCommand || isNaturalStart || shouldHandleActiveBriefTurn) {
    const cmdRest = isLegionBriefCommand
      ? lowerMessage.replace('/legion-brief', '/legion brief').slice('/legion brief'.length).trim()
      : '';

    if (isLegionBriefCommand && (cmdRest === 'cancel' || cmdRest === 'stop')) {
      clearBriefSession(DATA_DIR, key);
      return send(res, 200, JSON.stringify({ reply: 'Legion Brief cancelled.' }));
    }

    if (!activeBrief && (isNaturalStart || isLegionBriefCommand)) {
      const started = startBriefSession(DATA_DIR, key);
      const next = nextMissingField(started);
      const intro = [
        'Legion Brief started.',
        'I will collect the required details step-by-step, then relay the full recap before proceeding.',
        next ? `${next.prompt}` : 'Please provide the objective.',
        'Tips: use "field: value" to set specific fields; /legion brief show; /legion brief cancel.',
      ].join('\n');
      return send(res, 200, JSON.stringify({ reply: intro }));
    }

    const brief = getBriefSession(DATA_DIR, key);
    if (!brief) {
      return send(res, 200, JSON.stringify({ reply: 'No active Legion Brief. Start with /legion brief.' }));
    }

    if (isLegionBriefCommand && cmdRest === 'show') {
      const recap = formatRecap(brief);
      const next = nextMissingField(brief);
      const trailer = next ? `\n\nNext needed: ${next.prompt}` : '\n\nAll fields captured. Reply "/legion brief confirm" to proceed or "/legion brief edit <field>: <value>".';
      return send(res, 200, JSON.stringify({ reply: recap + trailer }));
    }

    if (isLegionBriefCommand && cmdRest === 'confirm') {
      if (!isBriefComplete(brief)) {
        const next = nextMissingField(brief);
        return send(res, 200, JSON.stringify({ reply: `Brief is incomplete. ${next ? next.prompt : 'Please continue.'}` }));
      }
      appendConfirmedBrief(DATA_DIR, brief);
      let dispatch = null;
      try {
        const pikoUserId = reqExternalId != null ? `${reqSource}:${reqExternalId}` : `${reqSource}:${key}`;
        dispatch = await dispatchLegionBrief(brief, { piko_user_id: pikoUserId, model: sessionModel });
      } catch (e) {
        dispatch = { ok: false, code: 'DISPATCH_EXCEPTION', message: e && e.message ? e.message : 'Dispatch failed' };
      }
      clearBriefSession(DATA_DIR, key);
      let resultSummary = '';
      if (dispatch && dispatch.ok && dispatch.runId && dispatch.capability) {
        try {
          const { pollLegionRun, buildSummaryFromResult } = require('./legionRunPoller');
          const { saveLegionResult, isSilentCapability } = require('./sharedContext');
          const polled = await pollLegionRun(dispatch.runId, LEGION_ADAPTER_API_BASE);
          if (polled.ok && polled.result) {
            saveLegionResult(DATA_DIR, dispatch.capability, polled.result, { source: 'brief' });
            const fromIntentPoller = String(key || '').toLowerCase() === 'intent-poller';
            const skipNotify = fromIntentPoller && isSilentCapability(dispatch.capability, DATA_DIR);
            if (!skipNotify) {
              resultSummary = buildSummaryFromResult(polled.result, dispatch.capability, DATA_DIR);
              if (resultSummary) {
                appendPendingNotification(resultSummary);
                telegramNotify(resultSummary, { category: 'legion', title: 'Legion', source: 'legion_brief_confirm' }).catch(() => {});
              }
            }
          }
        } catch (e) {
          if (process.env.PIKO_LOG_PLANNER === '1') console.warn('[legion-brief] poll/deliver:', e.message);
        }
      }
      const dispatchLine = dispatch && dispatch.ok
        ? `Dispatch accepted: adapter=${dispatch.adapterId}, capability=${dispatch.capability}, run_id=${dispatch.runId || 'n/a'} (${dispatch.status}).`
        : `Dispatch not started: ${dispatch && dispatch.message ? dispatch.message : 'No matching capability or Legion unavailable.'}`;
      const reply = [
        `${formatRecap(brief)}`,
        '',
        'Confirmed. I will proceed with this Legion Brief.',
        dispatchLine,
        resultSummary ? `\n${resultSummary}` : '',
      ].join('\n');
      return send(res, 200, JSON.stringify({ reply }));
    }

    let fieldInput = null;
    if (isLegionBriefCommand && cmdRest.startsWith('edit ')) {
      fieldInput = parseFieldValueLine(cmdRest.slice(5).trim());
    } else if (!isLegionBriefCommand) {
      fieldInput = parseFieldValueLine(message);
    }

    if (!fieldInput && !isLegionBriefCommand) {
      const next = nextMissingField(brief);
      if (next) fieldInput = { fieldKey: next.key, value: message };
    }

    if (!fieldInput) {
      return send(res, 200, JSON.stringify({ reply: 'Usage: /legion brief | /legion brief show | /legion brief edit <field>: <value> | /legion brief confirm | /legion brief cancel' }));
    }

    const saved = setBriefField(DATA_DIR, key, fieldInput.fieldKey, fieldInput.value);
    if (!saved.ok) return send(res, 200, JSON.stringify({ reply: saved.error || 'Could not update Legion Brief field.' }));

    const current = saved.session;
    if (!isBriefComplete(current)) {
      const next = nextMissingField(current);
      return send(res, 200, JSON.stringify({ reply: `Saved.\n${next ? next.prompt : 'Continue.'}` }));
    }

    return send(res, 200, JSON.stringify({
      reply: `${formatRecap(current)}\n\nReply "/legion brief confirm" to proceed, or "/legion brief edit <field>: <value>" to revise.`,
    }));
  }

  // —— /legion schedule ——
  if (lowerMessage.startsWith('/legion schedule') || lowerMessage.startsWith('/legion-schedule')) {
    const rest = lowerMessage.replace('/legion-schedule', '/legion schedule').replace('/legion schedule', '').trim();
    if (rest === 'list' || rest === '') {
      const intents = loadIntents();
      const legionScheduled = intents.filter((i) => i && i.type === 'legion_scheduled' && (i.status === 'pending' || !i.status));
      if (legionScheduled.length === 0) {
        return send(res, 200, JSON.stringify({ reply: 'No scheduled Legion tasks. Use /legion schedule daily 08:00 <objective> to add one.' }));
      }
      const lines = legionScheduled.map((s) => {
        const due = s.dueAt ? new Date(s.dueAt).toLocaleString() : '—';
        const sched = s.schedule || 'one-shot';
        const obj = (s.title || s.description || s.briefFields?.objective || s.command || '').slice(0, 50);
        const cap = s.capability ? ` [${s.capability}]` : '';
        const last = s.lastRunStatus ? ` last: ${s.lastRunStatus}` : '';
        return `- ${s.id}: ${sched} (next: ${due})${cap}${last} ${obj}`;
      });
      return send(res, 200, JSON.stringify({ reply: 'Scheduled Legion tasks:\n' + lines.join('\n') + '\n\nCancel: /legion schedule cancel <id>' }));
    }
    if (rest.startsWith('cancel ')) {
      const id = rest.slice(7).trim();
      if (!id) return send(res, 200, JSON.stringify({ reply: 'Usage: /legion schedule cancel <id> (e.g. intent_1772943737170_210)' }));
      const updated = updateIntent(id, { status: 'cancelled' });
      if (!updated) return send(res, 200, JSON.stringify({ reply: `Intent ${id} not found.` }));
      if (updated.type !== 'legion_scheduled') return send(res, 200, JSON.stringify({ reply: 'That intent is not a Legion schedule.' }));
      return send(res, 200, JSON.stringify({ reply: `Cancelled: ${(updated.title || updated.description || '').slice(0, 50)}` }));
    }
    // /legion schedule daily 08:00 <objective> | hourly HH:MM-HH:MM <objective> | cron 0 17 * * 1-5 <objective> | in N <objective>
    const parts = collapseWhitespace(rest).split(' ').filter(Boolean);
    if (parts.length < 3) {
      return send(res, 200, JSON.stringify({ reply: 'Usage: /legion schedule daily HH:MM <objective> | hourly HH:MM-HH:MM <objective> | cron 0 17 * * 1-5 <objective> | in N <objective>' }));
    }
    const [freq, timeStr, ...restParts] = parts;
    let schedule, nextDue, objective;
    const inMatch = toLowerAsciiish(freq) === 'in' && isAllAsciiDigits(timeStr);
    if (inMatch) {
      objective = restParts.join(' ').trim();
      const mins = Math.max(1, Math.min(60, parseInt(timeStr, 10)));
      const from = new Date();
      nextDue = new Date(from.getTime() + mins * 60 * 1000).toISOString();
      schedule = `in ${mins}`;
    } else if (toLowerAsciiish(freq) === 'cron') {
      // cron 0 17 * * 1-5 <objective> — 5 fields: min hour dom month dow
      if (restParts.length < 6) {
        return send(res, 200, JSON.stringify({ reply: 'Usage: /legion schedule cron 0 17 * * 1-5 <objective> (5 cron fields + objective, e.g. weekdays at 5pm)' }));
      }
      const cronFields = restParts.slice(0, 5);
      objective = restParts.slice(5).join(' ').trim();
      schedule = `cron ${cronFields.join(' ')}`;
      nextDue = nextDueFromSchedule(schedule, new Date());
    } else {
      objective = restParts.join(' ').trim();
      schedule = `${freq.toLowerCase()} ${timeStr}`;
      nextDue = nextDueFromSchedule(schedule, new Date());
    }
    if (!objective) {
      return send(res, 200, JSON.stringify({ reply: 'Usage: /legion schedule daily HH:MM <objective> | hourly HH:MM-HH:MM <objective> | cron 0 17 * * 1-5 <objective>' }));
    }
    if (!nextDue) {
      return send(res, 200, JSON.stringify({ reply: 'Invalid schedule. Use: daily HH:MM, hourly HH:MM-HH:MM, cron 0 17 * * 1-5 (weekdays 5pm), or in N' }));
    }
    // Idempotency: skip duplicate if same schedule+objective created in last 30s (client double-send)
    const intents = loadIntents();
    const cutoff = Date.now() - 30000;
    const recentDup = intents.find(
      (i) =>
        i &&
        i.type === 'legion_scheduled' &&
        (i.status === 'pending' || !i.status) &&
        i.schedule === schedule &&
        (i.title === objective || i.description === objective) &&
        new Date(i.createdAt || 0).getTime() >= cutoff
    );
    if (recentDup) {
      const replyMsg = inMatch
        ? `Already scheduled (in ${timeStr} min). I'll run ${objective.slice(0, 50)}${objective.length > 50 ? '…' : ''} when it's due.`
        : schedule.startsWith('hourly ') || schedule.startsWith('cron ')
          ? `Already scheduled ${schedule}. I'll run ${objective.slice(0, 50)}${objective.length > 50 ? '…' : ''} when it's due.`
          : `Already scheduled daily at ${timeStr}. I'll run ${objective.slice(0, 50)}${objective.length > 50 ? '…' : ''} when it's due.`;
      return send(res, 200, JSON.stringify({ reply: replyMsg }));
    }
    const { formatTaskRef } = require('./legionTaskCreate');
    let schedOut;
    try {
      schedOut = createLegionScheduledWithTask({
        schedule,
        title: objective,
        objective,
        description: objective,
        dueAt: nextDue,
        mode: 'auto',
        source: reqSource,
        sessionId: key,
        _creationSource: 'slash_legion_schedule',
      });
    } catch (e) {
      return send(res, 200, JSON.stringify({ reply: `Couldn't schedule: ${e.message || e}` }));
    }
    const taskRef = formatTaskRef(schedOut.task_id);
    const replyMsg = inMatch
      ? `Done — ${taskRef}. Scheduled in ${timeStr} min — ${objective.slice(0, 50)}${objective.length > 50 ? '…' : ''}.`
      : schedule.startsWith('hourly ')
        ? `Done — ${taskRef}. Scheduled ${schedule} — ${objective.slice(0, 50)}${objective.length > 50 ? '…' : ''}.`
        : schedule.startsWith('cron ')
          ? `Done — ${taskRef}. Scheduled ${schedule} — ${objective.slice(0, 50)}${objective.length > 50 ? '…' : ''}.`
          : `Done — ${taskRef}. Scheduled daily at ${timeStr} — ${objective.slice(0, 50)}${objective.length > 50 ? '…' : ''}.`;
    return send(res, 200, JSON.stringify({ reply: replyMsg }));
  }

  // —— /webhook (rules for event-driven actions) ——
  if (lowerMessage.startsWith('/webhook') || lowerMessage.startsWith('/webhook ')) {
    const rest = (lowerMessage.startsWith('/webhook') ? lowerMessage.slice('/webhook'.length) : lowerMessage).trim();
    if (rest === '' || rest === 'rules' || rest === 'list') {
      const rules = loadRules();
      if (rules.length === 0) {
        return send(res, 200, JSON.stringify({ reply: 'No webhook rules yet. Add one with ' + '/webhook' + ' add <eventType> legion [or dm]. Example: ' + '/webhook' + ' add low_stock_alert legion' }));
      }
      const lines = rules.map((r) => {
        const acts = (r.actions || []).map((a) => a.type).join(', ') || 'none';
        const status = r.enabled ? 'on' : 'off';
        return `• ${r.eventType} (${r.id}) [${status}]: ${acts}`;
      });
      return send(res, 200, JSON.stringify({ reply: 'Webhook rules:\n' + lines.join('\n') }));
    }
    if (rest.startsWith('add ')) {
      const spec = rest.slice(4).trim();
      const parts = collapseWhitespace(spec).split(' ').filter(Boolean);
      const eventType = parts[0];
      if (!eventType || !isSafeName(eventType, { min: 1, max: 64, allowHyphen: false, allowUnderscore: true })) {
        return send(res, 200, JSON.stringify({ reply: 'Usage: ' + '/webhook' + ' add <eventType> legion or dm. Example: ' + '/webhook' + ' add low_stock_alert legion' }));
      }
      const actions = [];
      if (parts.includes('legion')) {
        let capability = 'inventory.low_stock.scan';
        if (includesAny(eventType, ['low_stock', 'inventory', 'stock'])) capability = 'inventory.low_stock.scan';
        else if (includesAny(eventType, ['sale', 'forecast', 'analysis'])) capability = 'sales.analysis.run';
        actions.push({ type: 'legion', adapterId: 'ausmakersupplies', capability });
      }
      if (parts.includes('dm')) {
        actions.push({ type: 'dm', channel: 'telegram', template: `Webhook: {{eventType}} — {{payload}}` });
      }
      if (actions.length === 0) actions.push({ type: 'log' });
      const rule = createRule({ eventType, sourceFilter: [], actions });
      return send(res, 200, JSON.stringify({ reply: `Added rule for \`${eventType}\`: ${actions.map((a) => a.type).join(', ')}.` }));
    }
    if (rest.startsWith('pause ')) {
      const eventType = rest.slice(6).trim();
      const rules = loadRules().filter((r) => r.eventType === eventType);
      let toggled = 0;
      for (const r of rules) {
        if (r.enabled) {
          toggleRule(r.id);
          toggled++;
        }
      }
      return send(res, 200, JSON.stringify({ reply: toggled > 0 ? `Paused ${toggled} rule(s) for \`${eventType}\`.` : `No enabled rules for \`${eventType}\`.` }));
    }
    if (rest.startsWith('resume ')) {
      const eventType = rest.slice(7).trim();
      const rules = loadRules().filter((r) => r.eventType === eventType);
      let toggled = 0;
      for (const r of rules) {
        if (!r.enabled) {
          toggleRule(r.id);
          toggled++;
        }
      }
      return send(res, 200, JSON.stringify({ reply: toggled > 0 ? `Resumed ${toggled} rule(s) for \`${eventType}\`.` : `No disabled rules for \`${eventType}\`.` }));
    }
    return send(res, 200, JSON.stringify({ reply: 'Usage: /webhook rules | add <eventType> legion or dm | pause <eventType> | resume <eventType>' }));
  }

  // —— /new ——
  if (message === '/new') {
    (async () => {
      try {
        const { flushSessionToVectorMemory } = require('./vectorMemory');
        await flushSessionToVectorMemory(key);
      } catch (_) {}
      sessionStore.clear(key);
      clearBriefSession(DATA_DIR, key);
      clearApprovalPending(key);
    })().then(() => send(res, 200, JSON.stringify({ reply: 'New session.' })));
    return;
  }

  // —— Phase 4: /profile (multi-session) ——
  if (message === '/profile' || message.startsWith('/profile ')) {
    const rest = message.slice(9).trim().toLowerCase();
    if (rest === '') {
      return send(res, 200, JSON.stringify({ reply: `Profile: ${profile}. Use /profile work or /profile main to set.` }));
    }
    if (rest === 'work' || rest === 'main') {
      sessionsConfig[key] = { ...(sessionsConfig[key] || {}), profile: rest, updatedAt: new Date().toISOString() };
      saveSessionsConfig(sessionsConfig);
      return send(res, 200, JSON.stringify({ reply: `Profile set to ${rest}.` }));
    }
    return send(res, 200, JSON.stringify({ reply: 'Usage: /profile work or /profile main' }));
  }
  // —— /model (switch to 32B or back to default; no restart) ——
  if (message === '/' + 'model' || message.startsWith('/' + 'model' + ' ')) {
    const rest = message.slice(7).trim();
    if (rest === '') {
      const override = getCurrentModelOverride();
      const current = (sessionsConfig[key] && sessionsConfig[key].model) || override || OLLAMA_MODEL;
      return send(res, 200, JSON.stringify({ reply: `Model: ${current}. Use /model <ollama-tag> (e.g. gemma2:27b or qwen2.5:14b) or /model default to reset.` }));
    }
    if (rest.toLowerCase() === 'default' || rest.toLowerCase() === 'reset') {
      try {
        if (fs.existsSync(CURRENT_MODEL_FILE)) fs.unlinkSync(CURRENT_MODEL_FILE);
      } catch (_) {}
      try {
        upsertModel(OLLAMA_MODEL, { status: 'primary', source: 'model_command_default' });
        promoteModel({
          modelTag: OLLAMA_MODEL,
          toStage: 'primary',
          by: 'model_command',
          notes: 'Reset to default model',
          allowUnsafe: true,
        });
      } catch (_) {}
      if (sessionsConfig[key] && sessionsConfig[key].model) {
        const { model, ...restConfig } = sessionsConfig[key];
        sessionsConfig[key] = Object.keys(restConfig).length ? restConfig : undefined;
        if (!sessionsConfig[key]) delete sessionsConfig[key];
        saveSessionsConfig(sessionsConfig);
      }
      return send(res, 200, JSON.stringify({ reply: 'Model reset to default (' + OLLAMA_MODEL + ').' }));
    }
    // Ollama tags: alphanumeric, colon, hyphen, underscore, dot
    if (!isSafeName(rest, { min: 1, max: 128, allowDot: true, allowColon: true, allowHyphen: true, allowUnderscore: true })) {
      return send(res, 200, JSON.stringify({ reply: 'Invalid model tag. Use e.g. qwen2.5:32b or qwen2.5:14b.' }));
    }
    try {
      fs.mkdirSync(DATA_DIR, { recursive: true });
      fs.writeFileSync(CURRENT_MODEL_FILE, rest, 'utf8');
      try {
        upsertModel(rest, { status: 'primary', source: 'model_command' });
        promoteModel({
          modelTag: rest,
          toStage: 'primary',
          by: 'model_command',
          notes: 'Set by /model command',
          allowUnsafe: true,
        });
      } catch (_) {}
    } catch (e) {
      return send(res, 200, JSON.stringify({ reply: 'Failed to save model override: ' + e.message }));
    }
    return send(res, 200, JSON.stringify({ reply: `Model set to ${rest}. Next message will use it.` }));
  }
  // —— /status ——
  if (message === '/status') {
    const statusReply = (TASK_OPTIMUS_ONLY && CURSOR_OPTIMUS_ONLY)
      ? 'Piko is up. ' + '/cursor' + ' and ' + '/task' + ' on Optimus. Phase 4: ' + '/profile' + ' work or main, ' + '/model' + ' <tag> or default (32B when needed). WhatsApp+BlueBubbles adapters, CLI, optional Docker sandbox, Voice, local skills/. Tools, intent orders, /control, streaming.'
      : 'Piko is up. Phase 4: ' + '/profile' + ' work or main, ' + '/model' + ' <tag> or default (e.g. 32B when needed). WhatsApp+BlueBubbles adapters, CLI, optional Docker sandbox, Voice, local skills/. Tools, intent orders, /control, streaming. /doctor.';
    return send(res, 200, JSON.stringify({ reply: statusReply }));
  }

  // —— Phase 1: /calc ——
  if (message.startsWith('/calc ')) {
    const expr = message.slice(6).trim();
    if ((() => { for (const ch of expr) { if (!(isAsciiDigit(ch) || ' +-*/().'.includes(ch))) return false; } return expr.length > 0; })()) {
      try {
        const result = Function('"use strict"; return (' + expr + ')')();
        return send(res, 200, JSON.stringify({ reply: String(result) }));
      } catch (_) {
        return send(res, 200, JSON.stringify({ reply: 'Invalid expression.' }));
      }
    }
    return send(res, 200, JSON.stringify({ reply: 'Only numbers and + - * / ( ) allowed.' }));
  }

  // —— /time ——
  if (message === '/time' || message.startsWith('/time ')) {
    const tz = message === '/time' ? (process.env.PIKO_DEFAULT_TZ || 'UTC') : message.slice(6).trim();
    try {
      const now = new Date().toLocaleString('en-GB', { timeZone: tz });
      return send(res, 200, JSON.stringify({ reply: `${tz}: ${now}` }));
    } catch (_) {
      return send(res, 200, JSON.stringify({ reply: 'Invalid timezone.' }));
    }
  }

  // —— /read ——
  if (message.startsWith('/read ')) {
    const userPath = message.slice(6).trim();
    const fullPath = resolveSandboxPath(userPath);
    if (!fullPath) return send(res, 200, JSON.stringify({ reply: 'Path blocked or outside sandbox.' }));
    try {
      const content = fs.readFileSync(fullPath, 'utf8');
      const out = content.length > 12000 ? content.slice(0, 12000) + '\n… (truncated)' : content;
      return send(res, 200, JSON.stringify({ reply: out }));
    } catch (e) {
      return send(res, 200, JSON.stringify({ reply: e.code === 'ENOENT' ? 'File not found.' : 'Read error: ' + e.message }));
    }
  }

  // —— /ls ——
  if (message === '/ls' || message.startsWith('/ls ')) {
    const userPath = message === '/ls' ? '.' : message.slice(4).trim();
    const fullPath = resolveSandboxPath(userPath);
    if (!fullPath) return send(res, 200, JSON.stringify({ reply: 'Path blocked or outside sandbox.' }));
    try {
      const names = fs.readdirSync(fullPath);
      const list = names.slice(0, 200).join('\n');
      return send(res, 200, JSON.stringify({ reply: list || '(empty)' }));
    } catch (e) {
      return send(res, 200, JSON.stringify({ reply: e.code === 'ENOENT' ? 'Not found.' : 'List error: ' + e.message }));
    }
  }

  // —— /search ——
  if (message.startsWith('/search ')) {
    const query = message.slice(8).trim();
    if (!query) return send(res, 200, JSON.stringify({ reply: 'Usage: /search "your query"' }));
    try {
      let reply = '';
      const { querySearXNG } = require('./sovereignSearch');
      const searxResults = await querySearXNG(query, 5);
      if (searxResults.length > 0) {
        reply = searxResults.map((r, i) => `${i + 1}. ${r.title || ''}\n${r.url || ''}\n${(r.content || '').slice(0, 200)}…`).join('\n\n');
      } else if (SERPER_API_KEY) {
        const body = JSON.stringify({ q: query });
        const u = new URL('https://google.serper.dev/search');
        const opts = { hostname: u.hostname, port: 443, path: u.pathname, method: 'POST', headers: { 'Content-Type': 'application/json', 'X-API-KEY': SERPER_API_KEY } };
        const { data } = await httpsRequest(opts, body);
        const json = JSON.parse(data);
        const results = (json.organic || []).slice(0, 5);
        reply = results.map((r, i) => `${i + 1}. ${r.title || ''}\n${r.link || ''}\n${(r.snippet || '').slice(0, 200)}…`).join('\n\n') || 'No results.';
      } else {
        reply = 'No results. Ensure SearXNG is running on port 8080, or set SERPER_API_KEY for fallback.';
      }
      return send(res, 200, JSON.stringify({ reply }));
    } catch (e) {
      console.error('[search]', e.message);
      return send(res, 200, JSON.stringify({ reply: 'Search failed: ' + e.message }));
    }
  }

  // —— /moltbook (register does not require API key; feed/post do) ——
  if (message.startsWith('/moltbook ')) {
    const rest = message.slice(10).trim();
    if (rest.startsWith('register ')) {
      const args = rest.slice(9).trim();
      const firstSpace = args.indexOf(' ');
      const name = firstSpace >= 0 ? args.slice(0, firstSpace).trim() : args;
      const description = firstSpace >= 0 ? args.slice(firstSpace + 1).trim() : '';
      if (!name) return send(res, 200, JSON.stringify({ reply: 'Usage: /moltbook register <name> [description]. Name: 3–30 chars, alphanumeric + underscores/hyphens.' }));
      if (!isSafeName(name, { min: 3, max: 30, allowHyphen: true, allowUnderscore: true })) return send(res, 200, JSON.stringify({ reply: 'Name must be 3–30 characters, alphanumeric with underscores or hyphens only.' }));
      try {
        const body = JSON.stringify({ name, description: (description || '').slice(0, 500) });
        const u = new URL('https://www.moltbook.com/api/v1/agents/register');
        const opts = { hostname: u.hostname, port: 443, path: u.pathname, method: 'POST', headers: { 'Content-Type': 'application/json' } };
        const { statusCode, data } = await httpsRequest(opts, body);
        const json = JSON.parse(data);
        const claimUrl = json.claim_url || json.agent?.claim_url;
        const apiKey = json.api_key || json.agent?.api_key;
        if (claimUrl) {
          let reply = 'Claim link: ' + claimUrl;
          if (apiKey) reply += '\n\nSave this API key and set MOLTBOOK_API_KEY on Optimus so Piko can post/feed:\n' + apiKey;
          return send(res, 200, JSON.stringify({ reply }));
        }
        const err = json.error || json.message || (statusCode !== 200 ? data : 'No claim_url in response.');
        return send(res, 200, JSON.stringify({ reply: 'Moltbook: ' + (typeof err === 'string' ? err : JSON.stringify(err)).slice(0, 400) }));
      } catch (e) {
        console.error('[moltbook register]', e.message);
        return send(res, 200, JSON.stringify({ reply: 'Moltbook register failed: ' + e.message }));
      }
    }
    if (MOLTBOOK_API_KEY) {
      try {
        if (rest === 'feed' || rest.startsWith('feed ')) {
          const u = new URL('https://www.moltbook.com/api/v1/feed');
          u.searchParams.set('sort', 'hot');
          u.searchParams.set('limit', '10');
          const opts = { hostname: u.hostname, port: 443, path: u.pathname + u.search, method: 'GET', headers: { 'Authorization': 'Bearer ' + MOLTBOOK_API_KEY } };
          const { statusCode, data } = await httpsRequest(opts);
          const json = JSON.parse(data);
          if (statusCode === 401 || (json.success === false && (json.error || '').toLowerCase().includes('auth'))) {
            return send(res, 200, JSON.stringify({ reply: 'Moltbook: Invalid or expired API key. Set MOLTBOOK_API_KEY to a valid key from registration.' }));
          }
          const raw = json.data != null ? (Array.isArray(json.data) ? json.data : json.data.posts || json.data.items) : null;
          const items = (raw || json.posts || json.items || []).slice(0, 10);
          const reply = items.length ? items.map((p, i) => `${i + 1}. ${(p.title || p.content || '').toString().slice(0, 120)}`).join('\n') : 'Feed empty.';
          return send(res, 200, JSON.stringify({ reply }));
        }
        if (rest.startsWith('post ')) {
          const payload = rest.slice(5).trim();
          const pipe = payload.indexOf('|');
          let title = pipe >= 0 ? payload.slice(0, pipe).trim() : payload.slice(0, 80);
          let content = pipe >= 0 ? payload.slice(pipe + 1).trim() : payload;
          title = stripWrappingQuotes(stripMarkdownFromText(title) || title) || stripMarkdownFromText(title) || title;
          content = stripMarkdownFromText(content || title) || (content || title);
          const body = JSON.stringify({ submolt: 'general', title, content: content || title });
          const u = new URL('https://www.moltbook.com/api/v1/posts');
          const opts = { hostname: u.hostname, port: 443, path: u.pathname, method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + MOLTBOOK_API_KEY } };
          const { statusCode, data: postData } = await httpsRequest(opts, body);
          const postJson = JSON.parse(postData);
          if (statusCode === 429) {
            const hint = postJson.retry_after_minutes != null ? ` Try again in ${postJson.retry_after_minutes} min.` : '';
            return send(res, 200, JSON.stringify({ reply: 'Moltbook: Rate limit (1 post per 30 min).' + hint }));
          }
          if (statusCode === 401 || (postJson.success === false && (postJson.error || '').toLowerCase().includes('auth'))) {
            return send(res, 200, JSON.stringify({ reply: 'Moltbook: Invalid API key. Set MOLTBOOK_API_KEY to a valid key.' }));
          }
          if (statusCode >= 400) {
            const err = postJson.error || postJson.hint || postData.slice(0, 200);
            return send(res, 200, JSON.stringify({ reply: 'Moltbook: ' + (typeof err === 'string' ? err : JSON.stringify(err)).slice(0, 300) }));
          }
          return send(res, 200, JSON.stringify({ reply: 'Posted to Moltbook.' }));
        }
        if (rest === 'list' || rest.startsWith('list')) {
          const posts = await fetchMoltbookPostsByPiko(MOLTBOOK_API_KEY);
          if (!posts.length) return send(res, 200, JSON.stringify({ reply: "I don't have any posts in my list right now — the Moltbook API may not be returning them in this view. You can check the Control panel to see my Moltbook activity and prune posts there: open the Control page and look at the Moltbook section." }));
          const lines = posts.map((p, i) => `${i + 1}. ${(p.title || 'Post').slice(0, 60)} — ${p.id} — ${p.createdAt ? new Date(p.createdAt).toLocaleDateString() : ''}`);
          return send(res, 200, JSON.stringify({ reply: 'Your recent posts (use /moltbook prune <number> or /moltbook prune <id>):\n' + lines.join('\n') }));
        }
        if (rest.startsWith('prune ')) {
          const arg = rest.slice(6).trim();
          if (!arg) return send(res, 200, JSON.stringify({ reply: 'Usage: /moltbook prune last | <number> | <post-id>' }));
          let toDelete = [];
          if (arg.toLowerCase() === 'last') {
            try {
              const lastId = fs.readFileSync(path.join(DATA_DIR, 'moltbook-last-post-id.txt'), 'utf8').trim();
              if (lastId) toDelete = [lastId];
            } catch (_) {}
            if (!toDelete.length) {
              const posts = await fetchMoltbookPostsByPiko(MOLTBOOK_API_KEY);
              if (posts.length) toDelete = [posts[0].id];
            }
          } else if (isAllAsciiDigits(arg)) {
            const n = parseInt(arg, 10);
            const posts = await fetchMoltbookPostsByPiko(MOLTBOOK_API_KEY);
            if (n >= 1 && n <= posts.length) toDelete = [posts[n - 1].id];
          } else if (isUuidLike(arg)) {
            toDelete = [arg];
          }
          if (!toDelete.length) return send(res, 200, JSON.stringify({ reply: 'No post to prune. Use /moltbook list to see posts, then /moltbook prune <number> or prune last.' }));
          let pruned = 0;
          let failed = 0;
          for (const id of toDelete) {
            try {
              const opts = { hostname: 'www.moltbook.com', port: 443, path: '/api/v1/posts/' + encodeURIComponent(id), method: 'DELETE', headers: { 'Authorization': 'Bearer ' + MOLTBOOK_API_KEY } };
              const { statusCode } = await httpsRequest(opts);
              if (statusCode >= 200 && statusCode < 300) pruned++;
              else failed++;
            } catch (_) { failed++; }
          }
          const reply = pruned ? `Pruned ${pruned} post(s) from Moltbook.` + (failed ? ` ${failed} failed.` : '') : (failed ? 'Prune failed (not your post or already deleted?).' : 'Nothing pruned.');
          return send(res, 200, JSON.stringify({ reply }));
        }
        return send(res, 200, JSON.stringify({ reply: 'Usage: /moltbook register <name> [desc] | feed | post <title> | <content> | list | prune last | prune <number> | prune <post-id>' }));
      } catch (e) {
        console.error('[moltbook]', e.message);
        return send(res, 200, JSON.stringify({ reply: 'Moltbook error: ' + e.message }));
      }
    }
    return send(res, 200, JSON.stringify({ reply: 'Usage: /moltbook register <name> [desc]. For feed/post/list/prune set MOLTBOOK_API_KEY.' }));
  }

  // —— Moltbook aim refinement: /aim approve | /aim reject ——
  const MOLTBOOK_PENDING_PROPOSAL_FILE = path.join(DATA_DIR, 'moltbook-pending-proposal.txt');
  const MOLTBOOK_REFINEMENTS_FILE = path.join(PROMPTS_DIR, 'MOLTBOOK_REFINEMENTS.md');
  if (message === '/aim approve' || message === '/aim reject') {
    let proposal = '';
    try {
      proposal = fs.readFileSync(MOLTBOOK_PENDING_PROPOSAL_FILE, 'utf8').trim();
    } catch (_) {}
    if (!proposal) {
      return send(res, 200, JSON.stringify({ reply: 'No pending Moltbook aim proposal. Run the nightly proposal script or wait for the next run.' }));
    }
    if (message === '/aim reject') {
      try {
        fs.unlinkSync(MOLTBOOK_PENDING_PROPOSAL_FILE);
      } catch (_) {}
      return send(res, 200, JSON.stringify({ reply: 'Proposal rejected and discarded.' }));
    }
    const dateStr = new Date().toISOString().slice(0, 10);
    const line = '- [' + dateStr + '] ' + splitLines(proposal).map((l) => stripListMarker(l)).filter(Boolean).join('; ') + '\n';
    try {
      fs.appendFileSync(MOLTBOOK_REFINEMENTS_FILE, line, 'utf8');
    } catch (e) {
      return send(res, 200, JSON.stringify({ reply: 'Failed to append to refinements file: ' + e.message }));
    }
    try {
      fs.unlinkSync(MOLTBOOK_PENDING_PROPOSAL_FILE);
    } catch (_) {}
    return send(res, 200, JSON.stringify({ reply: 'Refinements added to ' + MOLTBOOK_REFINEMENTS_FILE + '. Pending proposal cleared.' }));
  }

  // —— Moltbook goals (v2): /goals [set <horizon> "value"] ——
  const PIKO_MEMORY_FILE = path.join(DATA_DIR, 'piko-memory.json');
  if (message === '/goals' || message.startsWith('/goals ')) {
    const rest = message.slice(6).trim();
    if (rest.startsWith('set ')) {
      const afterSet = rest.slice(4).trim();
      const _cadToks = collapseWhitespace(afterSet).split(' ').filter(Boolean);
      const _cadFreq = (_cadToks[0] || '').toLowerCase();
      let _cadParsed = null;
      if (['immediate','week','month'].includes(_cadFreq)) {
        let rest = afterSet.slice(afterSet.toLowerCase().indexOf(_cadFreq) + _cadFreq.length).trim();
        if (rest.startsWith('"') && rest.endsWith('"') && rest.length >= 2) {
          _cadParsed = { freq: _cadFreq, text: rest.slice(1, -1) };
        } else if (rest) {
          _cadParsed = { freq: _cadFreq, text: rest };
        }
      }
      const horizon = _cadParsed ? _cadParsed.freq : null;
      const value = _cadParsed ? _cadParsed.text : null;
      if (!horizon || value === null) {
        return send(res, 200, JSON.stringify({ reply: 'Usage: /goals set immediate "..." or /goals set week "..." or /goals set month "..."' }));
      }
      let memory;
      try {
        const raw = fs.readFileSync(PIKO_MEMORY_FILE, 'utf8');
        memory = JSON.parse(raw);
        if (!memory.goals) memory.goals = { immediate: [], week: [], month: [], aim: '' };
      } catch (_) {
        memory = { goals: { immediate: ['Write one post that advances the aim'], week: ['Get steady engagement'], month: ['Grow presence on Moltbook'], aim: 'Advance my Moltbook aim' }, metrics: { totalPosts: 0, avgUpvotes: 0, last10Avg: 0 }, lastCycle: null };
      }
      const arr = Array.isArray(memory.goals[horizon]) ? memory.goals[horizon] : [memory.goals[horizon]].filter(Boolean);
      memory.goals[horizon] = [value];
      try {
        fs.mkdirSync(DATA_DIR, { recursive: true });
        fs.writeFileSync(PIKO_MEMORY_FILE, JSON.stringify(memory, null, 2), 'utf8');
      } catch (e) {
        return send(res, 200, JSON.stringify({ reply: 'Failed to save goals: ' + e.message }));
      }
      return send(res, 200, JSON.stringify({ reply: 'Updated ' + horizon + ' goal to: ' + value }));
    }
    let memory;
    try {
      if (!fs.existsSync(PIKO_MEMORY_FILE)) {
        return send(res, 200, JSON.stringify({ reply: 'No goals file yet (piko-memory.json). Run the Moltbook poster once to create it, or use /goals set immediate "..." to create and set.' }));
      }
      const raw = fs.readFileSync(PIKO_MEMORY_FILE, 'utf8');
      memory = JSON.parse(raw);
    } catch (e) {
      return send(res, 200, JSON.stringify({ reply: 'Could not read goals: ' + e.message }));
    }
    const g = memory.goals || {};
    const m = memory.metrics || {};
    const im = Array.isArray(g.immediate) ? g.immediate[0] : g.immediate;
    const wk = Array.isArray(g.week) ? g.week[0] : g.week;
    const mo = Array.isArray(g.month) ? g.month[0] : g.month;
    const lines = [
      'Immediate: ' + (im || '—'),
      'Week: ' + (wk || '—'),
      'Month: ' + (mo || '—'),
      'Aim: ' + (g.aim || '—'),
      'Posts in state: ' + (m.totalPosts ?? '—'),
      'Avg upvotes: ' + (m.avgUpvotes != null ? m.avgUpvotes.toFixed(1) : '—'),
      'Last 10 avg: ' + (m.last10Avg != null ? m.last10Avg.toFixed(1) : '—'),
      memory.lastCycle ? 'Last cycle: ' + new Date(memory.lastCycle).toLocaleString() : '',
    ].filter(Boolean);
    return send(res, 200, JSON.stringify({ reply: lines.join('\n') }));
  }

  // —— v2.0: /memory (selfAssessment + cycleHistory) ——
  if (message === '/memory') {
    try {
      if (!fs.existsSync(PIKO_MEMORY_FILE)) {
        return send(res, 200, JSON.stringify({ reply: 'No memory file yet. Run the Moltbook poster to create it.' }));
      }
      const raw = fs.readFileSync(PIKO_MEMORY_FILE, 'utf8');
      const memory = JSON.parse(raw);
      const sa = memory.selfAssessment || {};
      const strengths = (sa.strengths || []).slice(0, 5);
      const weaknesses = (sa.weaknesses || []).slice(0, 5);
      const experiments = (sa.nextExperiments || []).slice(0, 5);
      const history = (memory.cycleHistory || []).slice(0, 5);
      const lines = [
        'Self-assessment:',
        strengths.length ? 'Strengths: ' + strengths.join('; ') : '',
        weaknesses.length ? 'Weaknesses: ' + weaknesses.join('; ') : '',
        experiments.length ? 'Next experiments: ' + experiments.join('; ') : 'Next experiments: (none)',
        '',
        'Last 5 cycles:',
        ...history.map((h) => `#${h.cycle} ${h.timestamp ? new Date(h.timestamp).toLocaleString() : ''} — ${(h.title || '').slice(0, 40)}${h.plannedForNext ? ' → ' + h.plannedForNext.slice(0, 40) : ''}`),
      ].filter(Boolean);
      return send(res, 200, JSON.stringify({ reply: lines.join('\n') }));
    } catch (e) {
      return send(res, 200, JSON.stringify({ reply: 'Could not read memory: ' + e.message }));
    }
  }

  // —— v2.0: /experiments (nextExperiments list) ——
  if (message === '/experiments') {
    try {
      if (!fs.existsSync(PIKO_MEMORY_FILE)) {
        return send(res, 200, JSON.stringify({ reply: 'No memory file yet. Run the Moltbook poster to create it.' }));
      }
      const raw = fs.readFileSync(PIKO_MEMORY_FILE, 'utf8');
      const memory = JSON.parse(raw);
      const experiments = (memory.selfAssessment && memory.selfAssessment.nextExperiments) || [];
      if (experiments.length === 0) {
        return send(res, 200, JSON.stringify({ reply: 'No experiments queued. The next poster run will add one from the critique step.' }));
      }
      const lines = experiments.map((e, i) => (i + 1) + '. ' + e);
      return send(res, 200, JSON.stringify({ reply: lines.join('\n') }));
    } catch (e) {
      return send(res, 200, JSON.stringify({ reply: 'Could not read memory: ' + e.message }));
    }
  }

  // —— /cycle (Moltbook disabled — no longer maintained)
  if (message === '/cycle') {
    return send(res, 200, JSON.stringify({ reply: 'Moltbook is disabled. Use /queue, /status, or /profile main for other actions.' }));
  }

  // —— Phase 2: /weather ——
  if (message.startsWith('/weather ')) {
    const city = message.slice(9).trim();
    if (!city) return send(res, 200, JSON.stringify({ reply: 'Usage: /weather <city>' }));
    try {
      const geoUrl = 'https://geocoding-api.open-meteo.com/v1/search?name=' + encodeURIComponent(city) + '&count=1';
      const geoOpts = { hostname: 'geocoding-api.open-meteo.com', port: 443, path: '/v1/search?name=' + encodeURIComponent(city) + '&count=1', method: 'GET' };
      const { data: geoData } = await httpsRequest(geoOpts);
      const geo = JSON.parse(geoData);
      const loc = geo.results && geo.results[0];
      if (!loc) return send(res, 200, JSON.stringify({ reply: 'City not found.' }));
      const lat = loc.latitude;
      const lon = loc.longitude;
      const name = loc.name + (loc.country ? ', ' + loc.country : '');
      const weatherPath = '/v1/forecast?latitude=' + lat + '&longitude=' + lon + '&current=temperature_2m,relative_humidity_2m,weather_code,wind_speed_10m';
      const wOpts = { hostname: 'api.open-meteo.com', port: 443, path: weatherPath, method: 'GET' };
      const { data: wData } = await httpsRequest(wOpts);
      const w = JSON.parse(wData);
      const cur = w.current;
      if (!cur) return send(res, 200, JSON.stringify({ reply: 'Weather unavailable.' }));
      const temp = cur.temperature_2m != null ? cur.temperature_2m + '°C' : '';
      const humidity = cur.relative_humidity_2m != null ? cur.relative_humidity_2m + '%' : '';
      const wind = cur.wind_speed_10m != null ? cur.wind_speed_10m + ' km/h' : '';
      const code = cur.weather_code;
      const codes = { 0: 'Clear', 1: 'Mainly clear', 2: 'Partly cloudy', 3: 'Overcast', 45: 'Fog', 48: 'Fog', 51: 'Drizzle', 61: 'Rain', 63: 'Rain', 65: 'Heavy rain', 80: 'Showers', 81: 'Showers', 82: 'Heavy showers', 95: 'Thunderstorm' };
      const desc = codes[code] || 'Code ' + code;
      const reply = `${name}: ${desc}. ${temp}${humidity ? ', ' + humidity + ' humidity' : ''}${wind ? ', wind ' + wind : ''}`;
      return send(res, 200, JSON.stringify({ reply }));
    } catch (e) {
      console.error('[weather]', e.message);
      return send(res, 200, JSON.stringify({ reply: 'Weather error: ' + e.message }));
    }
  }

  // —— Phase 2: /news ——
  if (message === '/news' || message.startsWith('/news ')) {
    const query = message === '/news' ? '' : message.slice(6).trim();
    try {
      if (NEWS_API_KEY && query) {
        const u = new URL('https://newsapi.org/v2/everything');
        u.searchParams.set('q', query);
        u.searchParams.set('pageSize', '5');
        u.searchParams.set('apiKey', NEWS_API_KEY);
        const opts = { hostname: 'newsapi.org', port: 443, path: u.pathname + '?' + u.searchParams.toString(), method: 'GET' };
        const { data } = await httpsRequest(opts);
        const json = JSON.parse(data);
        const articles = (json.articles || []).slice(0, 5);
        const reply = articles.length ? articles.map((a, i) => `${i + 1}. ${(a.title || '').slice(0, 80)}\n   ${(a.url || '')}`).join('\n') : 'No articles.';
        return send(res, 200, JSON.stringify({ reply }));
      }
      const rssUrl = process.env.PIKO_NEWS_RSS_URL || 'https://feeds.bbci.co.uk/news/rss.xml';
      const u = new URL(rssUrl);
      const opts = { hostname: u.hostname, port: 443, path: u.pathname + (u.search || ''), method: 'GET' };
      const { data } = await httpsRequest(opts);
      const itemBlocks = splitRssItems(data);
      const items = itemBlocks.map((block) => {
        const t = extractTag(block, 'title');
        const l = extractTag(block, 'link') || extractHref(block);
        const title = String(t || '').split('<').map((part, i) => i === 0 ? part : (part.includes('>') ? part.split('>').slice(1).join('>') : part)).join('').trim().slice(0, 80);
        const link = String(l || '').trim();
        return { title, link };
      });
      const reply = items.length ? items.map((it, i) => `${i + 1}. ${it.title}\n   ${it.link}`).join('\n') : 'No items. Set PIKO_NEWS_RSS_URL or NEWS_API_KEY for /news <query>.';
      return send(res, 200, JSON.stringify({ reply }));
    } catch (e) {
      console.error('[news]', e.message);
      return send(res, 200, JSON.stringify({ reply: 'News error: ' + e.message }));
    }
  }

  // —— Phase 2: /gmail ——
  const gmailRefreshLive = process.env.GMAIL_REFRESH_TOKEN || GMAIL_REFRESH_TOKEN;
  const gmailConfigured = GMAIL_ACCESS_TOKEN || (gmailRefreshLive && GMAIL_CLIENT_ID && GMAIL_CLIENT_SECRET);
  if (message.startsWith('/gmail ') && gmailConfigured) {
    const rest = message.slice(7).trim();
    const parts = collapseWhitespace(rest).split(' ').filter(Boolean);
    const cmd = (parts[0] || '').toLowerCase();
    const arg = parts.slice(1).join(' ');
    try {
      const { fetchUnreadEmails, fetchSearchEmails, fetchMessageById } = require('./gmailContext');
      let lines = [];
      if (cmd === 'unread' || cmd === 'inbox') {
        const includeBody = arg.toLowerCase() === 'full';
        const { ok, emails } = await fetchUnreadEmails({ maxResults: 10, includeBody });
        if (!ok) return send(res, 200, JSON.stringify({ reply: 'Gmail: could not fetch unread.' }));
        lines = emails.map((e, i) => {
          let l = `${i + 1}. ${e.from || '(unknown)'} | ${(e.subject || '(no subject)').slice(0, 60)}`;
          if (includeBody && e.body && e.body.trim()) l += '\n   ' + e.body.trim().slice(0, 300);
          return l;
        });
      } else if (cmd === 'search') {
        if (!arg) return send(res, 200, JSON.stringify({ reply: 'Usage: /gmail search <query>' }));
        const { ok, emails } = await fetchSearchEmails(arg, { maxResults: 8, includeBody: true });
        if (!ok) return send(res, 200, JSON.stringify({ reply: 'Gmail: search failed.' }));
        lines = emails.map((e, i) => {
          let l = `${i + 1}. ${e.from || '(unknown)'} | ${(e.subject || '(no subject)').slice(0, 60)}`;
          if (e.body && e.body.trim()) l += '\n   ' + e.body.trim().slice(0, 200);
          return l;
        });
      } else if (cmd === 'read') {
        if (!arg) return send(res, 200, JSON.stringify({ reply: 'Usage: /gmail read <message-id>' }));
        const { ok, email } = await fetchMessageById(arg, true);
        if (!ok || !email) return send(res, 200, JSON.stringify({ reply: 'Gmail: could not fetch that message.' }));
        lines = [`From: ${email.from || '(unknown)'}`, `Subject: ${email.subject || '(no subject)'}`, `Date: ${email.date || ''}`, '', (email.body || email.snippet || '').slice(0, 2000)];
      } else {
        return send(res, 200, JSON.stringify({ reply: 'Usage: /gmail unread | unread full | search <query> | read <id>' }));
      }
      const reply = lines.length ? lines.join('\n') : 'No messages found.';
      return send(res, 200, JSON.stringify({ reply }));
    } catch (e) {
      console.error('[gmail]', e.message);
      return send(res, 200, JSON.stringify({ reply: 'Gmail error: ' + e.message }));
    }
  }
  if (message.startsWith('/gmail ') && !gmailConfigured) {
    return send(res, 200, JSON.stringify({ reply: 'Set GMAIL_ACCESS_TOKEN or GMAIL_REFRESH_TOKEN + GMAIL_CLIENT_ID + GMAIL_CLIENT_SECRET for /gmail.' }));
  }

  // —— Intent orders: /intents (list, show, done, snooze, add task) ——
  if (message === '/intents' || message.startsWith('/intents ')) {
    const rest = message.slice(8).trim();
    const intents = loadIntents();
    if (rest === 'list' || rest.startsWith('list')) {
      const statusPart = rest.slice(4).trim() || 'pending';
      const status = statusPart === 'all' ? null : statusPart;
      const filtered = status ? intents.filter((i) => i.status === status) : intents;
      if (!filtered.length) return send(res, 200, JSON.stringify({ reply: `No intents with status ${status || 'any'}.` }));
      const lines = filtered.map((i) => `${i.id}: [${i.type}/${i.status}] ${(i.title || i.description || i.task || i.message || '(no title)').slice(0, 60)}`);
      return send(res, 200, JSON.stringify({ reply: lines.join('\n') }));
    }
    if (rest.startsWith('show ')) {
      const id = rest.slice(5).trim();
      const intent = intents.find((i) => i.id === id || String(i.id) === id);
      if (!intent) return send(res, 200, JSON.stringify({ reply: `No intent found with id ${id}.` }));
      const reply = [
        `id: ${intent.id}`,
        `type: ${intent.type}`,
        `status: ${intent.status}`,
        `title: ${intent.title || ''}`,
        `description: ${intent.description || ''}`,
        `dueAt: ${intent.dueAt || intent.time || intent.run || ''}`,
        `schedule: ${intent.schedule || ''}`,
        `command: ${intent.command || ''}`,
        `source: ${intent.source || ''}`,
        `sessionId: ${intent.sessionId || ''}`,
        `snoozedUntil: ${intent.snoozedUntil || ''}`,
        `lastFiredAt: ${intent.lastFiredAt || ''}`,
      ].join('\n');
      return send(res, 200, JSON.stringify({ reply }));
    }
    if (rest.startsWith('done ')) {
      const id = rest.slice(5).trim();
      const updated = updateIntent(id, { status: 'done' });
      if (!updated) return send(res, 200, JSON.stringify({ reply: `No intent found with id ${id}.` }));
      return send(res, 200, JSON.stringify({ reply: `Marked ${id} as done.` }));
    }
    if (rest.startsWith('snooze ')) {
      const parts = rest.slice(7).trim().split(' ').filter(Boolean);
      const id = parts[0];
      const durationStr = parts[1];
      const ms = parseDuration(durationStr);
      if (!ms) return send(res, 200, JSON.stringify({ reply: 'Invalid duration. Use 30m, 2h, 1d, 1w.' }));
      const until = new Date(Date.now() + ms).toISOString();
      const updated = updateIntent(id, { snoozedUntil: until });
      if (!updated) return send(res, 200, JSON.stringify({ reply: `No intent found with id ${id}.` }));
      return send(res, 200, JSON.stringify({ reply: `Snoozed ${id} until ${until}.` }));
    }
    if (rest.startsWith('add task ')) {
      const taskRest = rest.slice(9).trim();
      const pipe = taskRest.indexOf('|');
      const title = (pipe >= 0 ? taskRest.slice(0, pipe).trim() : taskRest) || '';
      const description = pipe >= 0 ? taskRest.slice(pipe + 1).trim() : '';
      if (!title) return send(res, 200, JSON.stringify({ reply: 'Usage: /intents add task <title> [| description]' }));
      const intent = createIntent({ type: 'task', title, description, source: reqSource, sessionId: key });
      return send(res, 200, JSON.stringify({ reply: `Created task intent ${intent.id}.` }));
    }
    return send(res, 200, JSON.stringify({ reply: 'Usage: /intents list [status] | show <id> | done <id> | snooze <id> <duration> | add task <title> [| description]' }));
  }

  // —— Intent orders: /queue ——
  if (message === '/queue' || message.startsWith('/queue ')) {
    const rest = message.slice(7).trim();
    const intents = loadIntents();
    const queue = intents.filter((i) => (i.type === 'queue' || i.type === 'task') && (i.status === 'pending' || !i.status));
    if (rest === 'list') {
      const lines = queue.length ? queue.map((q, i) => `${i + 1}. ${q.title || q.task || q.message || ''}`).join('\n') : 'Queue is empty.';
      return send(res, 200, JSON.stringify({ reply: lines }));
    }
    if (rest === 'next') {
      const next = queue[0];
      if (!next) return send(res, 200, JSON.stringify({ reply: 'Queue is empty.' }));
      const taskMsg = (next.title || next.task || next.message || '').trim();
      updateIntent(next.id, { status: 'done' });
      const apiKey = process.env.CURSOR_API_KEY || process.env.CURSOR_API_KEY_BOT;
      if (apiKey && taskMsg.toLowerCase().startsWith('/task')) {
        const taskCmd = parseTaskCommand(taskMsg);
        if (taskCmd && taskCmd.task) {
          const cursorOutput = await runTaskCommand(taskCmd, { sandbox: sessionsConfig[key] && sessionsConfig[key].sandbox });
          return send(res, 200, JSON.stringify({ reply: 'Queue item done:\n' + (cursorOutput.slice(0, 2000) + (cursorOutput.length > 2000 ? '…' : '')) }));
        }
      }
      return send(res, 200, JSON.stringify({ reply: 'Ran: ' + taskMsg.slice(0, 200) + (taskMsg.length > 200 ? '…' : '') }));
    }
    if (rest.startsWith('add ')) {
      const task = rest.slice(4).trim();
      if (!task) return send(res, 200, JSON.stringify({ reply: 'Usage: /queue add <task or /task ...>' }));
      createIntent({ type: 'task', title: task, source: reqSource, sessionId: key });
      return send(res, 200, JSON.stringify({ reply: 'Added to queue: ' + task.slice(0, 100) }));
    }
    return send(res, 200, JSON.stringify({ reply: 'Usage: /queue add <task> | list | next' }));
  }

  // —— Intent orders: /remind ——
  if (message.startsWith('/remind ')) {
    const rest = message.slice(8).trim();
    if (rest === 'list') {
      const intents = loadIntents();
      const reminders = intents.filter((i) => i.type === 'reminder').sort((a, b) => new Date(a.dueAt || a.time || 0) - new Date(b.dueAt || b.time || 0));
      const lines = reminders.length ? reminders.map((r) => `${r.dueAt || r.time || ''} — ${(r.title || r.message || r.text || '').slice(0, 60)}`).join('\n') : 'No reminders.';
      return send(res, 200, JSON.stringify({ reply: lines }));
    }
    const space = rest.indexOf(' ');
    if (space <= 0) return send(res, 200, JSON.stringify({ reply: 'Usage: /remind <time> <text> or /remind list' }));
    const timeStr = rest.slice(0, space).trim();
    const text = rest.slice(space + 1).trim();
    if (!text) return send(res, 200, JSON.stringify({ reply: 'Usage: /remind <time> <text>' }));
    let at;
    try {
      const match = (() => { const p = parseHhMm(timeStr); return p ? [null, String(p.h), String(p.m).padStart(2,'0')] : null; })();
      if (match) {
        const h = parseInt(match[1], 10);
        const m = parseInt(match[2], 10);
        if (h >= 0 && h <= 23 && m >= 0 && m <= 59) {
          at = new Date();
          at.setHours(h, m, 0, 0);
          if (at <= new Date()) at.setDate(at.getDate() + 1);
        }
      } else {
        at = new Date(timeStr);
      }
      if (!at || isNaN(at.getTime())) return send(res, 200, JSON.stringify({ reply: 'Invalid time. Use HH:MM or ISO date.' }));
      createIntent({ type: 'reminder', title: text, dueAt: at.toISOString(), source: reqSource, sessionId: key });
      return send(res, 200, JSON.stringify({ reply: `Reminder set for ${at.toLocaleString()}: ${text.slice(0, 50)}${text.length > 50 ? '…' : ''}` }));
    } catch (_) {
      return send(res, 200, JSON.stringify({ reply: 'Invalid time.' }));
    }
  }

  // —— Intent orders: /schedule ——
  if (message.startsWith('/schedule ')) {
    const rest = message.slice(10).trim();
    const space = rest.indexOf(' ');
    if (space <= 0) return send(res, 200, JSON.stringify({ reply: 'Usage: /schedule <time> <command> e.g. /schedule 09:00 /task Weekly report' }));
    const timeStr = rest.slice(0, space).trim();
    const command = rest.slice(space + 1).trim();
    if (!command) return send(res, 200, JSON.stringify({ reply: 'Usage: /schedule <time> <command>' }));
    try {
      let runAt = new Date(timeStr);
      if (isNaN(runAt.getTime())) {
        const [h, m] = timeStr.split(':').map(Number);
        if (h >= 0 && h <= 23 && m >= 0 && m <= 59) {
          runAt = new Date();
          runAt.setHours(h, m, 0, 0);
          if (runAt <= new Date()) runAt.setDate(runAt.getDate() + 1);
        }
      }
      if (isNaN(runAt.getTime())) return send(res, 200, JSON.stringify({ reply: 'Invalid time. Use HH:MM or ISO.' }));
      createIntent({ type: 'scheduled', dueAt: runAt.toISOString(), command, source: reqSource, sessionId: key });
      return send(res, 200, JSON.stringify({ reply: `Scheduled for ${runAt.toLocaleString()}: ${command.slice(0, 60)}…` }));
    } catch (_) {
      return send(res, 200, JSON.stringify({ reply: 'Invalid time.' }));
    }
  }

  // —— Phase 3: /chart ——
  if (message.startsWith('/chart ')) {
    const rest = message.slice(7).trim();
    const parts = collapseWhitespace(rest).split(' ').filter(Boolean);
    const type = (parts[0] || 'bar').toLowerCase();
    const dataStr = parts.slice(1).join(' ').split(' ').join(',') || '';
    const values = dataStr.split(',').flatMap((p) => p.split(';')).flatMap((p) => collapseWhitespace(p).split(' ')).map((s) => parseFloat(s.trim())).filter((n) => !isNaN(n));
    if (values.length === 0) return send(res, 200, JSON.stringify({ reply: 'Usage: /chart bar 10,20,30 or /chart line 1,2,3,4' }));
    const safe = values.map((v) => v).join(',');
    const url = `/api/chart?type=${encodeURIComponent(type)}&data=${encodeURIComponent(safe)}`;
    return send(res, 200, JSON.stringify({ reply: `${type} chart (${values.length} values): ${values.join(', ')}\nView: ${url}` }));
  }

  // —— /doctor ——
  if (message === '/doctor') {
    const lines = [];
    lines.push('Piko health:');
    lines.push('- Node: ' + process.version);
    lines.push('- Sandbox dir: ' + SANDBOX_DIR);
    try {
      fs.accessSync(SANDBOX_DIR, fs.constants.R_OK);
      lines.push('- Sandbox: readable');
    } catch (_) {
      lines.push('- Sandbox: not readable (mkdir or set PIKO_SANDBOX_DIR)');
    }
    try {
      const u = new URL(OLLAMA_URL);
      const opts = { hostname: u.hostname, port: u.port || 80, path: u.pathname, method: 'POST' };
      const body = JSON.stringify({ model: OLLAMA_MODEL, messages: [{ role: 'user', content: 'hi' }], stream: false });
      await httpRequest(opts, body);
      lines.push('- Ollama: reachable');
    } catch (_) {
      lines.push('- Ollama: unreachable');
    }
    try {
      fs.mkdirSync(DATA_DIR, { recursive: true });
      const intents = loadIntents();
      lines.push('- Intents: ' + intents.length + ' stored');
    } catch (_) {
      lines.push('- Intents: storage error');
    }
    return send(res, 200, JSON.stringify({ reply: lines.join('\n') }));
  }

  // —— /task ——
  // P0.4: shell-interpolation surface — disabled unless PIKO_TASK_ENDPOINT=1.
  const taskCmd = parseTaskCommand(message);
  if (taskCmd && taskCmd.task) {
    const taskOn = (() => {
      const v = String(process.env.PIKO_TASK_ENDPOINT || '').trim().toLowerCase();
      return v === '1' || v === 'true' || v === 'on' || v === 'yes';
    })();
    if (!taskOn) {
      return send(res, 200, JSON.stringify({
        reply: '/task is disabled on this tenant (set PIKO_TASK_ENDPOINT=1 to enable).',
      }));
    }
    const cursorOutput = await runTaskCommand(taskCmd, { sandbox: sessionsConfig[key] && sessionsConfig[key].sandbox });
    let reply = (cursorOutput.startsWith('Task skipped') || cursorOutput.startsWith('Task failed'))
      ? cursorOutput
      : 'Task finished:\n' + cursorOutput;

    // Discernment: Piko (Ollama) evaluates whether Cursor's result is satisfactory; if not, consult Grok.
    const discernmentSystem = 'You are Piko. Given a task and the result from Cursor, say whether the result fully addresses the task. Reply with exactly one line: SATISFIED or NOT_SATISFIED. Optionally add a short reason after a space or newline. Be concise.';
    const discernmentUser = `Task: ${taskCmd.task}\n\nCursor result:\n${cursorOutput.slice(0, 3000)}\n\nAre you satisfied that this result fully addresses the task? Reply SATISFIED or NOT_SATISFIED and optionally one short reason.`;
    try {
      const discernReply = await ollamaChat([
        { role: 'system', content: discernmentSystem },
        { role: 'user', content: discernmentUser },
      ], sessionModel);
      const notSatisfied = (toLowerAsciiish(discernReply || '').includes('not_satisfied') || toLowerAsciiish(discernReply || '').includes('not satisfied'));
      if (notSatisfied && GROK_API_KEY) {
        const grokSuggestion = await grokChat([
          { role: 'system', content: 'You are a neutral advisor. Give a brief, actionable suggestion only.' },
          { role: 'user', content: `Task sent to Cursor: "${taskCmd.task}"\n\nCursor result:\n${cursorOutput.slice(0, 2500)}\n\nWhat should we try next to get a better result from Cursor (e.g. how to re-prompt or what to clarify)? One short paragraph.` },
        ]);
        const reason = collapseWhitespace(replaceAllLiteral(replaceAllLiteral(replaceAllLiteral(replaceAllLiteral(discernReply, 'NOT_SATISFIED', ''), 'SATISFIED', ''), 'not_satisfied', ''), 'not satisfied', '')).trim().slice(0, 200);
        reply += '\n\nPiko wasn\'t fully satisfied.';
        if (reason) reply += ' ' + reason;
        if (grokSuggestion) reply += '\n\nGrok suggests: ' + grokSuggestion.slice(0, 600);
      }
    } catch (e) {
      console.error('[discernment]', e.message);
    }

    return send(res, 200, JSON.stringify({ reply }));
  }
  // —— /cursor ——
  const cursor = parseCursorCommand(message);
  if (cursor) {
    const reply = await runCursorCommand(cursor);
    return send(res, 200, JSON.stringify({ reply }));
  }

  // —— Phase 4: Local skills (loadable from skills/index.js) ——
  for (const s of loadedSkills) {
    const match = typeof s.pattern === 'string' ? message.startsWith(s.pattern) : (s.pattern && s.pattern.test && s.pattern.test(message));
    if (match && typeof s.handler === 'function') {
      try {
        const reply = await Promise.resolve(s.handler(message));
        if (reply != null && reply !== '') return send(res, 200, JSON.stringify({ reply: typeof reply === 'string' ? reply : (reply.reply || '') }));
      } catch (e) {
        console.error('[skill]', e.message);
        return send(res, 200, JSON.stringify({ reply: 'Skill error: ' + e.message }));
      }
    }
  }

  // —— Chat (Ollama) ——
  if (profile === 'work') {
    return send(res, 200, JSON.stringify({ reply: 'Work session: use /task, /queue, /read, /ls, /status, /profile main for full chat.' }));
  }
  let history = sessionStore.getHistory(key) || [];
  history.push({ role: 'user', content: message });

  // —— Pending cancel confirmation: "yes" executes multi-item cancel ——
  const trimmedMsg = stripTrailingPunct(String(message || '').trim());

  // —— Clarify follow-through: "2", "nightly", natural paraphrase ——
  const { tryResolveClarifyPending, setClarifyPending } = require('./clarifyHandler');
  const clarifyResolved = await tryResolveClarifyPending(key, message, { sessionId: key, reqSource });
  if (clarifyResolved) {
    let clarifyReply = clarifyResolved.reply;
    if (clarifyResolved.delegate) {
      const d = clarifyResolved.delegate;
      if (d.type === 'config_mutate' && d.intent) {
        const { setPending: setConfigMutatePending } = require('./configMutatePending');
        const { formatConfigMutateConfirm: fmtConfirm } = require('./configMutate');
        setConfigMutatePending(key, d.intent);
        clarifyReply = fmtConfirm(d.intent);
      } else if (d.type === 'legion_schedule') {
        const { buildLegionScheduleReply } = require('./nlLegionSchedule');
        clarifyReply = buildLegionScheduleReply({
          schedule: d.schedule,
          objective: d.objective,
          key,
          reqSource,
          normalizeSchedule,
          loadIntents,
          createLegionScheduledWithTask,
        });
      } else if (d.type === 'replay' && d.mode === 'schedule_work') {
        const { tryParseLegionScheduleFromNL, buildLegionScheduleReply } = require('./nlLegionSchedule');
        const parsed = tryParseLegionScheduleFromNL(d.message || message);
        if (parsed) {
          clarifyReply = buildLegionScheduleReply({
            schedule: parsed.schedule,
            objective: parsed.objective,
            key,
            reqSource,
            normalizeSchedule,
            loadIntents,
            createLegionScheduledWithTask,
          });
        } else {
          clarifyReply =
            (clarifyResolved.reply || 'Sure — I can schedule that.') +
            ' What time should it run? e.g. daily at 9am.';
        }
      } else if (d.type === 'replay' && d.mode === 'work_now') {
        clarifyReply =
          (clarifyResolved.reply || 'Got it — running that now.') +
          ' If nothing happens in a moment, ask again with a clear task like stock on hand for a SKU or run low stock scan.';
      }
    }
    history.push({ role: 'assistant', content: clarifyReply });
    sessionStore.append(key, 'user', message);
    sessionStore.append(key, 'assistant', clarifyReply);
    return send(res, 200, JSON.stringify({
      reply: clarifyReply,
      route: clarifyResolved.route || 'clarify_resolved',
      selection: clarifyResolved.selection,
    }));
  }

  if ((['yes','y','confirm','ok','sure','yes please','do it'].includes(toLowerAsciiish(trimmedMsg).trim())) && pendingCancelConfirmations.has(key)) {
    const pending = pendingCancelConfirmations.get(key);
    pendingCancelConfirmations.delete(key);
    savePendingCancelConfirmations(pendingCancelConfirmations);
    if (pending.expiresAt && Date.now() > pending.expiresAt) {
      const reply = "That confirmation expired. Ask to cancel again if you still want to.";
      history.push({ role: 'assistant', content: reply });
      sessionStore.append(key, 'user', message);
      sessionStore.append(key, 'assistant', reply);
      return send(res, 200, JSON.stringify({ reply }));
    }
    const { removeIntentById } = require('./intents');
    let cancelled = 0;
    for (const id of pending.intentIds || []) {
      if (removeIntentById(id)) cancelled++;
    }
    const reply = cancelled > 0 ? `Too easy. I've cancelled those ${cancelled} schedule(s) for you. Anything else?` : 'No matching schedules found.';
    history.push({ role: 'assistant', content: reply });
    sessionStore.append(key, 'user', message);
    sessionStore.append(key, 'assistant', reply);
    return send(res, 200, JSON.stringify({ reply }));
  }

  // —— P3 Tier 2: Legion queue reschedule/cancel by Task #N ——
  const { tryConfirm: tryLegionScheduleMutateConfirm } = require('./legionScheduleMutatePending');
  const legionScheduleMutateConfirm = tryLegionScheduleMutateConfirm(key, trimmedMsg);
  if (legionScheduleMutateConfirm) {
    history.push({ role: 'assistant', content: legionScheduleMutateConfirm.reply });
    sessionStore.append(key, 'user', message);
    sessionStore.append(key, 'assistant', legionScheduleMutateConfirm.reply);
    return send(res, 200, JSON.stringify({
      reply: legionScheduleMutateConfirm.reply,
      route: legionScheduleMutateConfirm.route,
    }));
  }

  const {
    parseLegionScheduleMutateIntent,
    formatLegionScheduleMutateConfirm,
    isLegionScheduleMutateIntent,
  } = require('./legionScheduleMutate');
  const { setPending: setLegionScheduleMutatePending } = require('./legionScheduleMutatePending');
  if (isLegionScheduleMutateIntent(message)) {
    const legionMutateIntent = parseLegionScheduleMutateIntent(message);
    if (legionMutateIntent) {
      setLegionScheduleMutatePending(key, legionMutateIntent);
      const legionMutateReply = formatLegionScheduleMutateConfirm(legionMutateIntent);
      history.push({ role: 'assistant', content: legionMutateReply });
      sessionStore.append(key, 'user', message);
      sessionStore.append(key, 'assistant', legionMutateReply);
      return send(res, 200, JSON.stringify({
        reply: legionMutateReply,
        route: 'legion_schedule_mutate_pending',
        pending: { summary: legionMutateIntent.summary },
      }));
    }
  }

  // —— P3 Tier 3: background job enable/disable ——
  const { tryConfirm: tryOperationsMutateConfirm } = require('./operationsMutatePending');
  const operationsMutateConfirm = tryOperationsMutateConfirm(key, trimmedMsg);
  if (operationsMutateConfirm) {
    history.push({ role: 'assistant', content: operationsMutateConfirm.reply });
    sessionStore.append(key, 'user', message);
    sessionStore.append(key, 'assistant', operationsMutateConfirm.reply);
    return send(res, 200, JSON.stringify({
      reply: operationsMutateConfirm.reply,
      route: operationsMutateConfirm.route,
    }));
  }

  const {
    parseOperationsMutateIntent,
    formatOperationsMutateConfirm,
    isOperationsMutateIntent,
  } = require('./operationsMutate');
  const { setPending: setOperationsMutatePending } = require('./operationsMutatePending');
  if (isOperationsMutateIntent(message)) {
    const opsMutateIntent = parseOperationsMutateIntent(message);
    if (opsMutateIntent) {
      setOperationsMutatePending(key, opsMutateIntent);
      const opsMutateReply = formatOperationsMutateConfirm(opsMutateIntent);
      history.push({ role: 'assistant', content: opsMutateReply });
      sessionStore.append(key, 'user', message);
      sessionStore.append(key, 'assistant', opsMutateReply);
      return send(res, 200, JSON.stringify({
        reply: opsMutateReply,
        route: 'operations_mutate_pending',
        pending: { summary: opsMutateIntent.summary },
      }));
    }
  }

  // —— P4.4a: money-plane dual-confirm (YES executes pending PO/ERP action) ——
  const {
    tryChatMoneyConfirm,
    assertPlaneAllowed: assertMoneyPlane,
  } = require('./moneyPlaneGate');
  const moneyMutateConfirm = tryChatMoneyConfirm(key, trimmedMsg);
  if (moneyMutateConfirm) {
    if (moneyMutateConfirm.route === 'money_mutate_cancelled') {
      history.push({ role: 'assistant', content: moneyMutateConfirm.reply });
      sessionStore.append(key, 'user', message);
      sessionStore.append(key, 'assistant', moneyMutateConfirm.reply);
      return send(res, 200, JSON.stringify({
        reply: moneyMutateConfirm.reply,
        route: moneyMutateConfirm.route,
      }));
    }
    if (moneyMutateConfirm.confirmed && moneyMutateConfirm.intent) {
      const intent = moneyMutateConfirm.intent;
      const planeCheck = assertMoneyPlane('money', {
        role: intent.role || 'operator',
        principal: intent.principal,
        moneyConfirmed: true,
      });
      if (!planeCheck.ok) {
        const denyReply = 'Money-plane action denied.';
        history.push({ role: 'assistant', content: denyReply });
        sessionStore.append(key, 'user', message);
        sessionStore.append(key, 'assistant', denyReply);
        return send(res, planeCheck.status || 403, JSON.stringify({
          reply: denyReply,
          error: planeCheck.error || 'plane_denied',
          route: 'plane_denied',
        }));
      }
      if (intent.kind === 'po_submit' && intent.payload) {
        let dispatch;
        try {
          dispatch = await dispatchLegionPoSubmit(intent.payload, {
            piko_user_id: intent.pikoUserId || `${reqSource || 'chat'}:${key}`,
          });
        } catch (e) {
          dispatch = {
            ok: false,
            code: 'DISPATCH_EXCEPTION',
            message: e && e.message ? e.message : 'Dispatch failed',
          };
        }
        const reply = dispatch.message || (dispatch.ok ? 'PO submit accepted.' : 'PO submit failed.');
        history.push({ role: 'assistant', content: reply });
        sessionStore.append(key, 'user', message);
        sessionStore.append(key, 'assistant', reply);
        return send(res, 200, JSON.stringify({
          reply,
          runId: dispatch.runId || null,
          route: 'money_po_submit',
        }));
      }
      if (intent.kind === 'capability' && intent.flowOpts) {
        const { runLegionCapabilityFlow } = require('./frontDesk');
        const legionOut = await runLegionCapabilityFlow({
          ...intent.flowOpts,
          moneyConfirmed: true,
        });
        const reply = legionOut.reply || (legionOut.ok ? 'Done.' : 'Money action failed.');
        history.push({ role: 'assistant', content: reply });
        sessionStore.append(key, 'user', message);
        sessionStore.append(key, 'assistant', reply);
        return send(res, 200, JSON.stringify({
          reply,
          route: legionOut.route || 'money_capability',
          runId: legionOut.runId || null,
        }));
      }
      const noopReply = 'Confirmed, but no executable money action was pending.';
      history.push({ role: 'assistant', content: noopReply });
      sessionStore.append(key, 'user', message);
      sessionStore.append(key, 'assistant', noopReply);
      return send(res, 200, JSON.stringify({ reply: noopReply, route: 'money_mutate_empty' }));
    }
  }

  // —— P3 Tier 1: chat-driven config mutations (confirm before apply) ——
  const { tryConfirm: tryConfigMutateConfirm } = require('./configMutatePending');
  const configMutateConfirm = tryConfigMutateConfirm(key, trimmedMsg);
  if (configMutateConfirm) {
    history.push({ role: 'assistant', content: configMutateConfirm.reply });
    sessionStore.append(key, 'user', message);
    sessionStore.append(key, 'assistant', configMutateConfirm.reply);
    return send(res, 200, JSON.stringify({
      reply: configMutateConfirm.reply,
      route: configMutateConfirm.route,
    }));
  }

  const { parseConfigMutateIntent, formatConfigMutateConfirm, isConfigMutateIntent } = require('./configMutate');
  const { setPending: setConfigMutatePending } = require('./configMutatePending');
  if (isConfigMutateIntent(message)) {
    const mutateIntent = parseConfigMutateIntent(message);
    if (mutateIntent) {
      setConfigMutatePending(key, mutateIntent);
      const mutateReply = formatConfigMutateConfirm(mutateIntent);
      history.push({ role: 'assistant', content: mutateReply });
      sessionStore.append(key, 'user', message);
      sessionStore.append(key, 'assistant', mutateReply);
      return send(res, 200, JSON.stringify({
        reply: mutateReply,
        route: 'config_mutate_pending',
        pending: { summary: mutateIntent.summary },
      }));
    }
  }

  // —— Culture: corpus Flag review rules via chat (confirm before apply) ——
  if (TENANT_BG.isCulture) {
    // P2.3: when Legate owns chat routing, do not let Flag-rules LLM topic
    // matching steal campaign_control / schedule / identity asks. Only enter
    // this path on explicit flag-policy language (or pending confirmations).
    let legateOwnsRouting = false;
    try {
      legateOwnsRouting = require('./legateChat').isLegateChatEnabled(rootDir);
    } catch (_) { legateOwnsRouting = false; }
    const msgLowerForFlags = toLowerAsciiish(message);
    const explicitFlagPolicy = includesAny(msgLowerForFlags, [
      'flag rule', 'flag rules', 'flag keep', 'flag drop',
      'always keep', 'keep/drop', 'corpus rule', 'corpus rules',
      'review rule', 'review rules',
    ]);

    const { tryConfirm: tryCorpusRulesConfirm } = require('./corpusReviewRulesMutatePending');
    const corpusRulesConfirm = await tryCorpusRulesConfirm(key, trimmedMsg);
    if (corpusRulesConfirm) {
      history.push({ role: 'assistant', content: corpusRulesConfirm.reply });
      sessionStore.append(key, 'user', message);
      sessionStore.append(key, 'assistant', corpusRulesConfirm.reply);
      return send(res, 200, JSON.stringify({
        reply: corpusRulesConfirm.reply,
        route: corpusRulesConfirm.route,
      }));
    }

    const {
      isCorpusRulesTopic,
      resolveCorpusReviewRulesIntent,
      formatCorpusReviewRulesMutateConfirm,
      formatCorpusReviewRulesShow,
      formatCorpusReviewRulesCoach,
      formatCorpusReviewRulesClarify,
      touchRulesDialog,
    } = require('./corpusReviewRulesMutate');
    const { setPending: setCorpusRulesPending } = require('./corpusReviewRulesMutatePending');
    let skipCorpusRules = false;
    if (legateOwnsRouting && !explicitFlagPolicy) {
      skipCorpusRules = true;
    }
    try {
      const { classifyEiFrontDoor } = require('./eiIntentGate');
      const door = await classifyEiFrontDoor(message, {});
      if (door.lane === 'work' || door.lane === 'chat') skipCorpusRules = true;
    } catch (_) { /* ignore */ }
    const onCorpusRulesTopic = skipCorpusRules
      ? false
      : await isCorpusRulesTopic(message, { sessionKey: key });
    if (onCorpusRulesTopic) {
      const rulesIntent = await resolveCorpusReviewRulesIntent(message, {
        sessionKey: key,
        history,
        skipTopicCheck: true,
      });
      if (rulesIntent) {
        if (rulesIntent.read_only) {
          const showReply = rulesIntent.kind === 'clarify'
            ? formatCorpusReviewRulesClarify()
            : rulesIntent.kind === 'coach'
              ? formatCorpusReviewRulesCoach()
              : formatCorpusReviewRulesShow();
          if (rulesIntent.kind === 'coach' || rulesIntent.kind === 'clarify') touchRulesDialog(key);
          history.push({ role: 'assistant', content: showReply });
          sessionStore.append(key, 'user', message);
          sessionStore.append(key, 'assistant', showReply);
          return send(res, 200, JSON.stringify({
            reply: showReply,
            route: rulesIntent.kind === 'clarify'
              ? 'corpus_rules_clarify'
              : rulesIntent.kind === 'coach'
                ? 'corpus_rules_coach'
                : 'corpus_rules_show',
            source: rulesIntent.source || null,
          }));
        }
        touchRulesDialog(key);
        setCorpusRulesPending(key, rulesIntent);
        const rulesReply = formatCorpusReviewRulesMutateConfirm(rulesIntent);
        history.push({ role: 'assistant', content: rulesReply });
        sessionStore.append(key, 'user', message);
        sessionStore.append(key, 'assistant', rulesReply);
        return send(res, 200, JSON.stringify({
          reply: rulesReply,
          route: 'corpus_rules_mutate_pending',
          pending: { summary: rulesIntent.summary },
          source: rulesIntent.source || null,
        }));
      }
    }
  }

  // —— Pending NL intent confirmation: "yes" creates the legion_scheduled ——
  const pending = pendingIntentsBySession.get(key);
  if (pending) {
    const age = Date.now() - (pending.createdAt || 0);
    if (age > PENDING_INTENT_EXPIRY_MS) {
      if (process.env.PIKO_LOG_PLANNER === '1') console.log('[intent] Pending expired for key:', key);
      pendingIntentsBySession.delete(key);
    } else if ((['yes','y','confirm','ok','sure'].includes(toLowerAsciiish(trimmedMsg).trim()))) {
      pendingIntentsBySession.delete(key);
      const { type, schedule, objective } = pending.extracted;
      if (process.env.PIKO_LOG_PLANNER === '1') console.log('[intent] Confirmation received for key:', key, 'objective:', objective, 'schedule:', schedule);
      const nextDue = nextDueFromSchedule(schedule, new Date());
      if (nextDue) {
        const { formatTaskRef } = require('./legionTaskCreate');
        let taskRef = 'Task #?';
        try {
          const out = createLegionScheduledWithTask({
            schedule,
            title: objective,
            objective,
            description: objective,
            dueAt: nextDue,
            mode: 'auto',
            source: reqSource,
            sessionId: key,
            _creationSource: 'nl_confirm',
          });
          taskRef = formatTaskRef(out.task_id);
        } catch (e) {
          const reply = `Couldn't schedule that: ${e.message || e}`;
          history.push({ role: 'assistant', content: reply });
          sessionStore.append(key, 'user', message);
          sessionStore.append(key, 'assistant', reply);
          return send(res, 200, JSON.stringify({ reply }));
        }
        if (process.env.PIKO_LOG_PLANNER === '1') console.log('[intent] Created from confirmation:', objective, schedule);
        const reply = `Done — ${taskRef} scheduled: "${objective}" ${schedule}. Reference this as ${taskRef} in chat.`;
        history.push({ role: 'assistant', content: reply });
        sessionStore.append(key, 'user', message);
        sessionStore.append(key, 'assistant', reply);
        return send(res, 200, JSON.stringify({ reply }));
      }
    } else {
      if (process.env.PIKO_LOG_PLANNER === '1') console.log('[intent] Pending cleared (no yes match) for key:', key);
      pendingIntentsBySession.delete(key);
    }
  } else if (require('./proactivePendingAction').isAffirmativeReply(message)) {
    const { loadPending, clearPending } = require('./proactivePendingAction');
    const pp = loadPending(DATA_DIR);
    if (pp && pp.action) {
      clearPending(DATA_DIR);
      const capabilityToObjective = {
        'purchase_order.draft.create': 'purchase order draft',
        'inventory.low_stock.scan': 'low stock scan',
        'sales.analysis.run': 'sales analysis',
      };
      const objective = capabilityToObjective[pp.action] || pp.action;
      const syntheticBrief = {
        fields: {
          objective,
          execution_mode: 'auto',
          risk_level: 'low',
        },
      };
      try {
        if (pp.action === 'purchase_order.draft.create') {
          // Proactive offer + user YES is the dual-confirm pair for money plane.
          const { assertPlaneAllowed: assertMoneyPlaneProactive } = require('./moneyPlaneGate');
          const moneyOk = assertMoneyPlaneProactive('money', {
            role: 'operator',
            moneyConfirmed: true,
          });
          if (!moneyOk.ok) {
            const denyReply = 'Money-plane action denied.';
            history.push({ role: 'assistant', content: denyReply });
            sessionStore.append(key, 'user', message);
            sessionStore.append(key, 'assistant', denyReply);
            return send(res, moneyOk.status || 403, JSON.stringify({
              reply: denyReply,
              error: moneyOk.error || 'plane_denied',
            }));
          }
          const { runLegionCapabilityFlow } = require('./frontDesk');
          const legionOut = await runLegionCapabilityFlow({
            route: { actionType: 'run_capability', capability: pp.action },
            message,
            sessionModel,
            dataDir: DATA_DIR,
            legionAdapterApiBase: LEGION_ADAPTER_API_BASE,
            reqSource,
            key,
            moneyConfirmed: true,
          });
          if (legionOut.ok) {
            const reply = legionOut.reply;
            history.push({ role: 'assistant', content: reply });
            sessionStore.append(key, 'user', message);
            sessionStore.append(key, 'assistant', reply);
            try {
              const { logActivity } = require('./activityLog');
              logActivity('action_router_run', { capability: pp.action, outcome: 'success', source: 'proactive_followup', runId: legionOut.runId });
            } catch (err) {
              void err;
            }
            return send(res, 200, JSON.stringify({ reply }));
          }
        }
        const dispatch = await dispatchLegionBrief(syntheticBrief, { piko_user_id: `${reqSource || 'chat'}:${key}`, model: sessionModel });
        if (dispatch.ok && dispatch.runId) {
          const { pollLegionRun, formatInventoryReply, buildSummaryFromResult } = require('./legionRunPoller');
          const { saveLegionResult } = require('./sharedContext');
          const polled = await pollLegionRun(dispatch.runId, LEGION_ADAPTER_API_BASE);
          if (polled.ok && polled.result) {
            saveLegionResult(DATA_DIR, dispatch.capability, polled.result, { source: 'proactive_followup' });
            const reply = dispatch.capability === 'inventory.low_stock.scan'
              ? formatInventoryReply(polled.result, dispatch.capability, DATA_DIR, message)
              : (buildSummaryFromResult(polled.result, dispatch.capability, DATA_DIR) || 'Done.');
            history.push({ role: 'assistant', content: reply });
            sessionStore.append(key, 'user', message);
            sessionStore.append(key, 'assistant', reply);
            try {
              const { logActivity } = require('./activityLog');
              logActivity('action_router_run', { capability: pp.action, outcome: 'success', source: 'proactive_followup' });
            } catch (_) {}
            return send(res, 200, JSON.stringify({ reply }));
          }
        }
      } catch (e) {
        if (process.env.PIKO_LOG_PLANNER === '1') console.warn('[proactive-followup]', e.message);
      }
      const reply = "Couldn't run that — Legion may be unavailable. Try again in a minute.";
      history.push({ role: 'assistant', content: reply });
      sessionStore.append(key, 'user', message);
      sessionStore.append(key, 'assistant', reply);
      return send(res, 200, JSON.stringify({ reply }));
    }

    const lastAssistant = [...history].slice(0, -1).reverse().find((m) => m.role === 'assistant' && m.content);
    const lastAskedConfirm = lastAssistant && includesAny(toLowerAsciiish(lastAssistant.content || ''), ['shall i schedule', 'reply yes to confirm']);
    if (lastAskedConfirm && (['yes','y','confirm','ok','sure'].includes(toLowerAsciiish(message).trim()))) {
      if (process.env.PIKO_LOG_PLANNER === '1') console.log('[intent] User said yes but no pending intent for key:', key, '(possible session mismatch or expiry)');
      const expiredReply = 'Sorry, that confirmation expired. Please try again — e.g. "schedule Load Recent Data every hour between 6am and 11pm" then reply yes.';
      history.push({ role: 'assistant', content: expiredReply });
      sessionStore.append(key, 'user', message);
      sessionStore.append(key, 'assistant', expiredReply);
      return send(res, 200, JSON.stringify({ reply: expiredReply }));
    }
  }

  const nicknameDeclared = extractNicknameFromMessage(message);
  if (nicknameDeclared) {
    const safeNick = nicknameDeclared.slice(0, 24);
    try {
      memory.setSessionNickname(identityKey, safeNick, 'chat_declared');
    } catch (_) {}
    const reply = `Got it — I will use ${safeNick}.`;
    history.push({ role: 'assistant', content: reply });
    sessionStore.append(key, 'user', message);
    sessionStore.append(key, 'assistant', reply);
    return send(res, 200, JSON.stringify({ reply }));
  }

  const wordLimit = extractWordLimit(message);
  const sentenceLimit = extractSentenceLimit(message);
  const noQuestionRequested = requestsNoQuestion(message);
  if (isKeepItShortPrompt(message) && wordLimit === 0 && sentenceLimit === 0) {
    const reply = 'Got it — keeping it short.';
    history.push({ role: 'assistant', content: reply });
    sessionStore.append(key, 'user', message);
    sessionStore.append(key, 'assistant', reply);
    return send(res, 200, JSON.stringify({ reply }));
  }
  const formatDirectiveOnly = sentenceLimit === 1 && noQuestionRequested && wordLimit === 0 && !hasColonDirective(message);
  if (formatDirectiveOnly) {
    const reply = 'Understood — one concise line, no questions.';
    history.push({ role: 'assistant', content: reply });
    sessionStore.append(key, 'user', message);
    sessionStore.append(key, 'assistant', reply);
    return send(res, 200, JSON.stringify({ reply }));
  }
  // Culture/Legate spines: learning / tone / status-ack questions belong to the
  // decide model + lookups — not fossil rabbit-hole / canned templates.
  // Keep explicit /learning slash command on the fast path.
  let legateChatActive = false;
  try {
    const { isLegateChatEnabled } = require('./legateChat');
    legateChatActive = isLegateChatEnabled(rootDir);
  } catch (_) { legateChatActive = false; }
  if (requestsLearningUpdate(message) && (!legateChatActive || (parseSlashCommand(message) && parseSlashCommand(message).kind === 'learning'))) {
    const reply = buildLearningUpdateReply();
    history.push({ role: 'assistant', content: reply });
    sessionStore.append(key, 'user', message);
    sessionStore.append(key, 'assistant', reply);
    return send(res, 200, JSON.stringify({ reply }));
  }
  if (!legateChatActive && isToneDriftComplaint(message)) {
    const reply = "You're right — I drifted there. I'll keep it plain and on-topic.";
    history.push({ role: 'assistant', content: reply });
    sessionStore.append(key, 'user', message);
    sessionStore.append(key, 'assistant', reply);
    return send(res, 200, JSON.stringify({ reply }));
  }
  if (!legateChatActive && isSimpleStatusAck(message)) {
    const reply = pickBySeed([
      'Good to hear.',
      'Nice one.',
      'Glad it is going smoothly.',
    ], `${identityKey}:${message}`);
    history.push({ role: 'assistant', content: reply });
    sessionStore.append(key, 'user', message);
    sessionStore.append(key, 'assistant', reply);
    return send(res, 200, JSON.stringify({ reply }));
  }
  if (wordLimit > 0) {
    const summaryTargetMatch = (() => {
      const raw = String(message);
      const low = toLowerAsciiish(raw);
      let idx = low.indexOf('summarise');
      if (idx < 0) idx = low.indexOf('summarize');
      if (idx < 0) return null;
      const colon = raw.indexOf(':', idx);
      if (colon < 0) return null;
      return [null, raw.slice(colon + 1).trim()];
    })();
    const explicitTarget = summaryTargetMatch && summaryTargetMatch[1] ? summaryTargetMatch[1].trim() : '';
    const prevAssistant = [...history].slice(0, -1).reverse().find((m) => m.role === 'assistant' && m.content);
    const sourceText = explicitTarget || (prevAssistant && prevAssistant.content ? prevAssistant.content : '');
    if (sourceText) {
      const concise = truncateToWords(sourceText, wordLimit);
      history.push({ role: 'assistant', content: concise });
      sessionStore.append(key, 'user', message);
      sessionStore.append(key, 'assistant', concise);
      return send(res, 200, JSON.stringify({ reply: concise }));
    }
  }

  if (toLowerAsciiish(message).includes('what nickname did i ask you to use')) {
    const nick = findRequestedNickname(history, identityKey);
    const reply = nick ? `You asked me to use ${nick}.` : 'You have not told me a nickname in this session yet.';
    history.push({ role: 'assistant', content: reply });
    sessionStore.append(key, 'user', message);
    sessionStore.append(key, 'assistant', reply);
    return send(res, 200, JSON.stringify({ reply }));
  }

  const correctionMatch = (() => {
      const raw = String(message || '');
      const low = toLowerAsciiish(raw);
      const prefixes = ['actually ', 'no, it\'s ', "no it's ", 'no its ', "that's wrong ", 'thats wrong ', 'correction: ', 'correction:'];
      for (const p of prefixes) {
        if (low.startsWith(p)) return [null, raw.slice(p.length).trim()];
      }
      if (low.startsWith('no, it') || low.startsWith('no it')) {
        const sp = raw.indexOf(' ');
        // fall through soft
      }
      return null;
    })();
  if (correctionMatch && history.length >= 2) {
    const lastAssistant = [...history].reverse().find((m) => m.role === 'assistant');
    if (lastAssistant && lastAssistant.content) {
      setImmediate(() => {
        try {
          appendCorrection(lastAssistant.content.slice(0, 400), correctionMatch[1].trim());
        } catch (_) {}
      });
    }
  }

  const wisdomIdHit = (() => {
    const low = toLowerAsciiish(message);
    const phrases = ['is spot on', 'is right', "that's right", 'thats right', 'affirm', 'confirmed', 'exactly', 'spot on'];
    // find wNNN token
    const tokens = collapseWhitespace(low).split(' ');
    let wid = '';
    for (const tok of tokens) {
      if (tok.length === 4 && tok[0] === 'w' && isAllAsciiDigits(tok.slice(1))) {
        wid = tok;
        break;
      }
    }
    if (!wid) return '';
    if (includesAny(low, phrases)) return wid;
    return '';
  })();
  if (wisdomIdHit) {
    setImmediate(() => {
      try {
        const { wisdomConfirmed: metricsWisdomConfirmed } = require('./metrics');
        metricsWisdomConfirmed(wisdomIdHit);
      } catch (_) {}
    });
  }

  /** Plan first with minimal data. Pass recentTurns for history-aware routing (e.g. "Why?" after deep exchange). */
  const recentTurnsForPlan = history.slice(-4).map((h) => ({ role: h.role, content: (h.content || '').slice(0, 500) }));
  let plan = createResponsePlan({
    userBeliefs: [],
    mind: {},
    userMessage: message,
    recentEpisodic: [],
    recentTurns: recentTurnsForPlan,
  });
  /** Optional model classification for borderline full-path messages (15–120 chars). Gate: PIKO_MODEL_ROUTING=1. */
  if (!plan.casual && !plan.socialChat && !plan.deepReasoning && message.length >= 15 && message.length <= 120) {
    const modelDepth = await classifyDepthOptional(message, recentTurnsForPlan, sessionModel);
    if (modelDepth === 'deep') {
      plan = { ...plan, deepReasoning: true, mode: 'DEEP' };
      if (process.env.PIKO_LOG_PLANNER === '1') console.log('[PLANNER] Model classified as deep');
    }
  }
  if (process.env.PIKO_PLANNER_DEBUG === '1' || process.env.PIKO_PLANNER_DEBUG === 'true') {
    log('info', 'planner', { plan: { verbosity: plan.verbosity, tone: plan.tone }, reason: plan.reason || null }, {}, req.requestId);
  }

  // Ambiguous work/mutate — clarify before triage or action router guesses wrong.
  // Legate spines skip the clarify offer: the decide model reads the ask itself
  // (clarify regexes are AusMaker-oriented and steal EI status questions).
  const clarifyDataDir = path.join(rootDir, 'data');
  const { getSessionState: getClarifySessionState } = require('./sessionState');
  const { resolveDialogueTurn: resolveClarifyDialogue } = require('./dialogueManager');
  const { shouldOfferClarify, finalizeClarifyTurn } = require('./clarifyHandler');
  const clarifySessionState = getClarifySessionState(key, clarifyDataDir);
  const clarifyDialogue = resolveClarifyDialogue(message, { sessionState: clarifySessionState });
  if (!legateChatActive && shouldOfferClarify(message, { dialogue: clarifyDialogue, sessionKey: key })) {
    const turned = await finalizeClarifyTurn(message, {
      dialogue: clarifyDialogue,
      sessionState: clarifySessionState,
      history,
    });
    setClarifyPending(key, {
      bundle: turned.bundle,
      originalMessage: message,
    });
    history.push({ role: 'assistant', content: turned.reply });
    sessionStore.append(key, 'user', message);
    sessionStore.append(key, 'assistant', turned.reply);
    return send(res, 200, JSON.stringify({
      reply: turned.reply,
      route: 'clarify',
      reason: turned.bundle.reason,
    }));
  }

  // —— Legate chat (EI/culture): read ask → answer | dispatch agent; skip classifier routing ——
  // WP7.8: when Legate is active, omit campaign state by default (crash-safe).
  let legateOmitCampaignState = !!legateChatActive;
  try {
    const { handleLegateChatTurn } = require('./legateChat');
    if (legateChatActive) {
      console.log('[LEGATE] Handling turn (actionRouter/triage bypassed)');
      const priorHistory = history.slice(0, -1).slice(-6);
      // WP7.6: mirror REST operator gate for campaign control via chat.
      let chatIsOperator = true;
      try {
        const adminAuth = require('./adminAuth');
        if (adminAuth.isEnabled()) {
          const session = adminAuth.getSessionFromRequest(req, DATA_DIR);
          chatIsOperator = !!(session && session.role !== 'client');
        }
      } catch (_) {
        chatIsOperator = true;
      }
      const lastAsstForLegate = [...priorHistory].reverse().find((m) => m.role === 'assistant' && m.content);
      const legateOut = await handleLegateChatTurn(message, {
        rootDir: rootDir,
        sessionKey: key,
        history: priorHistory,
        lastAssistant: lastAsstForLegate ? lastAsstForLegate.content : '',
        model: sessionModel,
        isOperator: chatIsOperator,
      });
      if (legateOut && legateOut.reply) {
        const route = legateOut.mode === 'dispatch'
          ? 'legate_dispatch'
          : (legateOut.mode === 'control' || legateOut.mode === 'control_failed' || legateOut.mode === 'control_denied')
            ? 'legate_control'
            : 'legate_answer';
        history.push({ role: 'assistant', content: legateOut.reply });
        sessionStore.append(key, 'user', message);
        sessionStore.append(key, 'assistant', legateOut.reply);
        return send(res, 200, JSON.stringify({
          reply: legateOut.reply,
          route,
          job_id: legateOut.job && legateOut.job.id ? legateOut.job.id : undefined,
          legate: {
            mode: legateOut.mode,
            reason: legateOut.decision && legateOut.decision.reason,
          },
        }));
      }
      // Only allow state injection when Legate explicitly opts in.
      if (legateOut && legateOut.inject_campaign_state === true) {
        legateOmitCampaignState = false;
      }
    }
  } catch (e) {
    console.warn('[LEGATE]', e.message || e);
  }

  // Unified 8B semantic triage: this is the front-door lane decision.
  // Exact commands and safety confirmations above remain deterministic; below this point,
  // chat/deep/clarify lanes do not pass through work-routing regexes.
  // Legate-enabled culture spines skip triage + actionRouter entirely.
  const useIntentTriage = !legateChatActive
    && process.env.PIKO_USE_INTENT_TRIAGE !== '0'
    && process.env.PIKO_USE_INTENT_TRIAGE !== 'false';
  let triage = null;
  let triageAllowsWorkRouting = !useIntentTriage && !legateChatActive;
  let triageProgressAck = null;
  if (useIntentTriage) {
    try {
      const { resolveTriage } = require('./intentTriage');
      const { isInstantChatMessage, stripOuterPunct } = require('./instantChat');
      const { allowsWorkRouting, fireTriageProgressAck } = require('./policyGate');
      triage = await resolveTriage(message, {
        model: process.env.PIKO_TRIAGE_MODEL || process.env.PIKO_ROUTER_MODEL || sessionModel,
        history,
      });
      triageAllowsWorkRouting = allowsWorkRouting(triage);
      if (process.env.PIKO_LOG_PLANNER === '1') {
        console.log('[TRIAGE]', JSON.stringify({ route: triage.route, confidence: triage.confidence, reason: triage.reason, source: triage.source || 'llm' }));
      }
      if (triage.route === 'CLARIFY') {
        const turned = await finalizeClarifyTurn(message, {
          triage,
          dialogue: clarifyDialogue,
          sessionState: clarifySessionState,
          history,
        });
        setClarifyPending(key, {
          bundle: turned.bundle,
          originalMessage: message,
        });
        history.push({ role: 'assistant', content: turned.reply });
        sessionStore.append(key, 'user', message);
        sessionStore.append(key, 'assistant', turned.reply);
        return send(res, 200, JSON.stringify({
          reply: turned.reply,
          triage,
          route: 'clarify',
          reason: turned.bundle.reason,
        }));
      }
      if (triage.route === 'CHAT_FAST' || triage.route === 'CHAT_LIGHT') {
        // Grounding guard: semantic router can force WORK_NOW for factual business data.
        let forcedWork = false;
        try {
          const { routeToAction } = require('./actionRouter');
          const { isBusinessDataAction, shouldForceWorkFromChat } = require('./businessDataGuard');
          const lastAsst = [...history].reverse().find((m) => m.role === 'assistant' && m.content);
          const probe = await routeToAction(message, sessionModel, {
            lastAssistantMessage: lastAsst ? lastAsst.content : '',
          });
          if (shouldForceWorkFromChat(triage, probe) && isBusinessDataAction(probe)) {
            console.log('[GROUNDING] Chat lane overrode → WORK_NOW for', probe.actionType, probe.capability || probe.sku || '');
            triage = {
              ...triage,
              route: 'WORK_NOW',
              reason: 'grounding_guard:' + (probe.actionType || 'business'),
              source: 'grounding_guard',
              policyOverride: 'CHAT',
            };
            triageAllowsWorkRouting = true;
            req._groundingRoute = probe;
            forcedWork = true;
            plan = { ...plan, casual: false, socialChat: false, deepReasoning: false, mode: 'WORK', reason: 'grounding_guard' };
          }
        } catch (e) {
          console.warn('[GROUNDING] probe failed:', e.message);
        }
        if (!forcedWork) {
          triageAllowsWorkRouting = false;
          const useInstantChat = isInstantChatMessage(message) && process.env.PIKO_CHAT_FAST_TEMPLATE !== '0';
          if (useInstantChat) {
            const lower = stripOuterPunct(message);
            let reply;
            if (lower.includes('thank') || lower.includes('cheers')) {
              reply = 'No worries.';
            } else if (lower.includes('bye') || lower.includes('catch you') || lower.includes('talk soon') || lower.includes('see you')) {
              reply = 'Catch you later.';
            } else if (lower.includes('how are you') || lower.includes("how's it going") || lower.includes('hows it going')) {
              reply = 'Doing alright — you?';
            } else {
              reply = pickBySeed([
                'Hey there — good to hear from you.',
                "G'day — nice to hear from you.",
                'Hey — good to hear your voice.',
              ], `${key}:${message}:${history.length}`);
            }
            history.push({ role: 'assistant', content: reply });
            sessionStore.append(key, 'user', message);
            sessionStore.append(key, 'assistant', reply);
            return send(res, 200, JSON.stringify({ reply, triage, route: 'chat_fast', instant: true }));
          }
          if (!plan.casual && !plan.socialChat) {
            plan = { ...plan, casual: false, socialChat: true, deepReasoning: false, mode: 'SOCIAL', reason: 'triage:chat' };
          }
        }
      } else if (triage.route === 'ANSWER_LOCAL') {
        triageAllowsWorkRouting = false;
        const { resolveAnswerLocal, recordLocalAnswerContext } = require('./answerLocal');
        const { finalizeLocalAnswer } = require('./localAnswerHandler');
        const { getSessionState } = require('./sessionState');
        const localDataDir = path.join(rootDir, 'data');
        const sessionState = getSessionState(key, localDataDir);
        const localAnswer = resolveAnswerLocal(message, {
          rootDir: rootDir,
          intents: loadIntents(),
          sessionState,
        });
        if (localAnswer) {
          const finalized = await finalizeLocalAnswer(localAnswer, message, history, {
            reqSource,
            sessionId: key,
            dataDir: localDataDir,
          });
          recordLocalAnswerContext(key, localAnswer, localDataDir);
          history.push({ role: 'assistant', content: finalized.reply });
          sessionStore.append(key, 'user', message);
          sessionStore.append(key, 'assistant', finalized.reply);
          return send(res, 200, JSON.stringify({
            reply: finalized.reply,
            triage,
            route: finalized.route,
            instant: finalized.instant !== false,
            ...(finalized.synthesized ? { synthesized: true } : {}),
            ...(finalized.synthesisPending ? { synthesisPending: true } : {}),
          }));
        }
        if (!plan.casual && !plan.socialChat) {
          plan = { ...plan, casual: false, socialChat: true, deepReasoning: false, mode: 'SOCIAL', reason: 'triage:answer_local_miss' };
        }
      } else if (triage.route === 'WORK_NOW' || triage.route === 'SCHEDULE_WORK') {
        triageAllowsWorkRouting = true;
      } else if (triage.route === 'DEEP_REASONING') {
        triageAllowsWorkRouting = false;
        plan = { ...plan, casual: false, socialChat: false, deepReasoning: true, mode: 'DEEP', reason: 'triage:' + triage.route };
        // Ack deferred until after local-read / safety overrides (no premature promises)
        req._pendingDeepAck = true;
      }
    } catch (e) {
      console.warn('[TRIAGE] failed; falling back to legacy router:', e.message);
      triage = null;
      triageAllowsWorkRouting = true;
    }
  }

  // Pure greetings: instant template reply (no Ollama). Sub-second UX; 8B reserved for non-trivial casual.
  const instantGreetingLike = (() => {
    const t = toLowerAsciiish(String(message || '')).trim();
    const greet = ['hi','hey','hello','howdy','yo','hiya','greetings','morning','evening',"g'day",'gday'];
    const words = t.split(' ').filter(Boolean);
    if (!words.length) return false;
    const head = words[0].replaceAll('.','').replaceAll('!','').replaceAll('?','');
    if (!greet.includes(words[0]) && !greet.includes(head)) return false;
    if (words.length === 1) return true;
    if (words.length === 2) {
      const w = words[1].replaceAll('.','').replaceAll('!','').replaceAll('?','');
      return w === 'piko' || w === 'mate' || w === '';
    }
    return false;
  })();
  if (instantGreetingLike && plan.casual && plan.casualMode === 'GREETING' && process.env.PIKO_GREETING_INSTANT !== '0') {
    const reply = pickBySeed([
      'Hey there — good to hear from you.',
      "G'day — nice to hear from you.",
      'Hey — good to hear your voice.',
    ], `${key}:${message}:${history.length}`);
    history.push({ role: 'user', content: message });
    history.push({ role: 'assistant', content: reply });
    sessionStore.append(key, 'user', message);
    sessionStore.append(key, 'assistant', reply);
    if (process.env.PIKO_LOG_CASUAL === '1') console.log('[CASUAL] instant greeting (no LLM)');
    return send(res, 200, JSON.stringify({ reply, route: 'casual', instant: true }));
  }

  const { isQueueReadQuery, formatQueueReadReply } = require('./queueRead');
  const { isAnswerLocalQuery, resolveAnswerLocal } = require('./answerLocal');

  // Policy gate: capabilities/operations/queue/task/sync reads — even if triage said CHAT_LIGHT.
  const { isSalesSyncStatusQuery, fetchSalesSyncStatus } = require('./salesSyncStatus');
  if (isSalesSyncStatusQuery(message)) {
    try {
      const { getUrl } = require('./legionRunPoller');
      const fetched = await fetchSalesSyncStatus(getUrl, AUSMAKER_BASE_URL);
      const reply = fetched.ok ? fetched.reply : fetched.error;
      history.push({ role: 'assistant', content: reply });
      sessionStore.append(key, 'user', message);
      sessionStore.append(key, 'assistant', reply);
      return send(res, 200, JSON.stringify({ reply, route: 'sales_sync_read', instant: true }));
    } catch (e) {
      const reply = 'Could not read sales sync status: ' + (e.message || 'unknown error');
      history.push({ role: 'assistant', content: reply });
      sessionStore.append(key, 'user', message);
      sessionStore.append(key, 'assistant', reply);
      return send(res, 200, JSON.stringify({ reply, route: 'sales_sync_read' }));
    }
  }
  // Safety override: deterministic reads if triage misclassified (never when triage already returned ANSWER_LOCAL).
  const localDataDir = path.join(rootDir, 'data');
  const { getSessionState } = require('./sessionState');
  const sessionStateForLocal = getSessionState(key, localDataDir);
  if ((!triage || triage.route !== 'ANSWER_LOCAL') && isAnswerLocalQuery(message, sessionStateForLocal)) {
    const { finalizeLocalAnswer } = require('./localAnswerHandler');
    const { recordLocalAnswerContext } = require('./answerLocal');
    const localAnswer = resolveAnswerLocal(message, {
      rootDir: rootDir,
      intents: loadIntents(),
      sessionState: sessionStateForLocal,
    });
    if (localAnswer) {
      const finalized = await finalizeLocalAnswer(localAnswer, message, history, {
        reqSource,
        sessionId: key,
        dataDir: localDataDir,
      });
      recordLocalAnswerContext(key, localAnswer, localDataDir);
      history.push({ role: 'assistant', content: finalized.reply });
      sessionStore.append(key, 'user', message);
      sessionStore.append(key, 'assistant', finalized.reply);
      return send(res, 200, JSON.stringify({
        reply: finalized.reply,
        route: finalized.route,
        instant: finalized.instant !== false && !finalized.synthesized,
        ...(finalized.synthesized ? { synthesized: true } : {}),
        ...(finalized.synthesisPending ? { synthesisPending: true } : {}),
        ...(triage ? { triage } : {}),
      }));
    }
  }

  // Work/deep-lane ack only after local-read override cleared (no false schedule/work promises).
  if (triage) {
    const { shouldFireWorkLaneAck, fireTriageProgressAck } = require('./policyGate');
    if (triageAllowsWorkRouting && shouldFireWorkLaneAck(message, triage)) {
      try {
        triageProgressAck = await fireTriageProgressAck(triage, message, { sessionId: key, reqSource });
      } catch (_) {}
    } else if (req._pendingDeepAck && String(triage.route || '').toUpperCase() === 'DEEP_REASONING') {
      // Deep ack only if we did not divert to ANSWER_LOCAL / sales_sync above
      try {
        const { isAnswerLocalQuery } = require('./answerLocal');
        if (!isAnswerLocalQuery(message, sessionStateForLocal)) {
          triageProgressAck = await fireTriageProgressAck(triage, message, { sessionId: key, reqSource });
        }
      } catch (_) {}
    }
  }

  // —— ROUTING: Semantic action router (no regex intent short-circuits) ——
  // Skipped on Legate chat spines (EI/culture) — Legate already answered or dispatched.
  const useReAct = process.env.PIKO_USE_REACT_AGENT === '1' || process.env.PIKO_USE_REACT_AGENT === 'true';

  if (!legateChatActive) {
  const { loadCapabilityRegistry, getPikoNativeCapabilityIds } = require('./actionRouter');
  const { allowsNlSchedule, allowsWorkCircuits, allowsActionRouter, allowsCompoundOrchestrator } = require('./policyGate');
  const circuitRegistry = loadCapabilityRegistry();
  const circuitNativeIds = getPikoNativeCapabilityIds();
  const circuitValidCaps = new Set([...circuitRegistry.map((c) => c.id), ...circuitNativeIds]);

  // Optional pre-routed action from chat→work grounding guard (avoid double router call).
  let circuitRoute = req._groundingRoute || null;
  if (circuitRoute) {
    console.log('[DECISION] Using grounding-guard route →', circuitRoute.actionType, circuitRoute.capability || circuitRoute.sku || '');
  }

  // Sales summary helper remains available for WORK_NOW; router is primary.
  if (!circuitRoute && triageAllowsWorkRouting && allowsWorkCircuits(triage)) {
    const { buildSalesRoute } = require('./salesSummary');
    const salesRoute = buildSalesRoute(message, recentTurnsForPlan);
    if (salesRoute) {
      console.log('[DECISION] Sales summary helper → sales_summary_get period=', salesRoute.period, 'top=', salesRoute.topLimit);
      circuitRoute = salesRoute;
    }
  }

  // NL legion schedule — SCHEDULE_WORK lane only (triage is law)
  if (!circuitRoute && triageAllowsWorkRouting && allowsNlSchedule(triage)) {
    const { tryParseLegionScheduleFromNL, buildLegionScheduleReply } = require('./nlLegionSchedule');
    const parsed = tryParseLegionScheduleFromNL(message);
    if (parsed) {
      console.log('[DECISION] Policy gate (nl schedule) →', parsed.schedule, String(parsed.objective).slice(0, 50));
      const reply = buildLegionScheduleReply({
        schedule: parsed.schedule,
        objective: parsed.objective,
        key,
        reqSource,
        normalizeSchedule,
        loadIntents,
        createLegionScheduledWithTask,
      });
      history.push({ role: 'assistant', content: reply });
      sessionStore.append(key, 'user', message);
      sessionStore.append(key, 'assistant', reply);
      try {
        const { logActivity } = require('./activityLog');
        logActivity('action_router_run', { actionType: 'nl_schedule_fastpath', schedule: parsed.schedule, outcome: 'success' });
      } catch (_) {}
      return send(res, 200, JSON.stringify({ reply, ...(triageProgressAck ? { progressAck: triageProgressAck } : {}), ...(triage ? { triage } : {}) }));
    }
  }

  if (circuitRoute) {
    // Circuit breaker matched — run capability directly (no LLM)
    const route = circuitRoute;
    const requestStartedAt = Date.now();
    if (route.actionType === 'clear_digest_schedule') {
      const { clearDigestSchedule } = require('./tripwireEngine');
      const success = clearDigestSchedule();
      const reply = success
        ? "Done, boss. I've stopped the daily product change summary and cleared your digest schedule. You won't get those morning alerts anymore."
        : "I tried to clear the digest schedule, boss, but I hit a file system error. You might need to check my logs.";
      history.push({ role: 'assistant', content: reply });
      sessionStore.append(key, 'user', message);
      sessionStore.append(key, 'assistant', reply);
      try { const { logActivity } = require('./activityLog'); logActivity('action_router_run', { actionType: 'clear_digest_schedule', outcome: success ? 'success' : 'error', fastPath: true }); } catch (_) {}
      return send(res, 200, JSON.stringify({ reply }));
    }
    if (route.actionType === 'sales_summary_get') {
      const { getUrl } = require('./legionRunPoller');
      const { fireProgressAck, finalizeToolReply } = require('./frontDesk');
      const { runSalesSummaryReply } = require('./salesSummary');
      const progressAck = await fireProgressAck(route, message, { sessionId: key, reqSource });
      try {
        const { reply } = await runSalesSummaryReply({
          getUrl,
          baseUrl: AUSMAKER_BASE_URL,
          route,
          message,
          recentTurns: recentTurnsForPlan,
          finalizeToolReply,
        });
        history.push({ role: 'assistant', content: reply });
        sessionStore.append(key, 'user', message);
        sessionStore.append(key, 'assistant', reply);
        try { const { logActivity } = require('./activityLog'); logActivity('action_router_run', { capability: 'sales_summary_get', outcome: 'success', fastPath: true }); } catch (_) {}
        return send(res, 200, JSON.stringify({ reply, ...(progressAck ? { progressAck } : {}) }));
      } catch (e) {
        const reply = "Couldn't fetch sales: " + (e.message || 'Unknown error');
        history.push({ role: 'assistant', content: reply });
        sessionStore.append(key, 'user', message);
        sessionStore.append(key, 'assistant', reply);
        return send(res, 200, JSON.stringify({ reply }));
      }
    }
    if (route.actionType === 'stock_on_hand_get' && route.sku) {
      const { getStockOnHand, formatStockOnHandReply } = require('./inventoryStockOnHand');
      try {
        const result = await getStockOnHand(route.sku, { ausmakerBase: AUSMAKER_BASE_URL, dataDir: DATA_DIR });
        const reply = formatStockOnHandReply(result);
        history.push({ role: 'assistant', content: reply });
        sessionStore.append(key, 'user', message);
        sessionStore.append(key, 'assistant', reply);
        try { const { logActivity } = require('./activityLog'); logActivity('action_router_run', { actionType: 'stock_on_hand_get', sku: route.sku, outcome: result.found ? 'success' : 'not_found', source: result.source || null }); } catch (_) {}
        return send(res, 200, JSON.stringify({ reply, ...(triageProgressAck ? { progressAck: triageProgressAck } : {}), ...(triage ? { triage } : {}) }));
      } catch (e) {
        const reply = "Couldn't look up stock on hand: " + (e.message || 'Unknown error');
        history.push({ role: 'assistant', content: reply });
        sessionStore.append(key, 'user', message);
        sessionStore.append(key, 'assistant', reply);
        return send(res, 200, JSON.stringify({ reply }));
      }
    }
    if (route.capability === 'system.operations.read') {
      const { loadOperations, formatOperationsForPrompt } = require('./operations');
      const ops = loadOperations();
      const formatted = formatOperationsForPrompt(ops);
      const reply = formatted
        ? `Here's what's running: ${collapseWhitespace(formatted).trim()}.`
        : "No background operations configured. Add knowledge/piko-operations.json if you want to track crons.";
      history.push({ role: 'assistant', content: reply });
      sessionStore.append(key, 'user', message);
      sessionStore.append(key, 'assistant', reply);
      try { const { logActivity } = require('./activityLog'); logActivity('action_router_run', { capability: route.capability, outcome: 'success', fastPath: true }); } catch (_) {}
      return send(res, 200, JSON.stringify({ reply }));
    }
    if (route.capability === 'system.intents.read') {
      const reply = formatQueueReadReply(loadIntents());
      history.push({ role: 'assistant', content: reply });
      sessionStore.append(key, 'user', message);
      sessionStore.append(key, 'assistant', reply);
      try { const { logActivity } = require('./activityLog'); logActivity('action_router_run', { capability: route.capability, outcome: 'success', fastPath: true }); } catch (_) {}
      return send(res, 200, JSON.stringify({ reply }));
    }
    if (route.capability === 'system.intents.manage') {
      if (isQueueReadQuery(message)) {
        const reply = formatQueueReadReply(loadIntents());
        history.push({ role: 'assistant', content: reply });
        sessionStore.append(key, 'user', message);
        sessionStore.append(key, 'assistant', reply);
        return send(res, 200, JSON.stringify({ reply }));
      }
      const { getPendingIntents, removeIntentById, findIntentsByDescriptions } = require('./intents');
      const { ollamaNativeChat } = require('./llm');
      const pending = getPendingIntents();
      if (pending.length === 0) {
        const reply = "Queue is already empty mate. Nothing to cancel.";
        history.push({ role: 'assistant', content: reply });
        sessionStore.append(key, 'user', message);
        sessionStore.append(key, 'assistant', reply);
        return send(res, 200, JSON.stringify({ reply }));
      }
      const simplifiedIntents = pending.map((i) => ({
        id: i.id,
        task: `${((i.briefFields && i.briefFields.objective) || i.title || i.description || i.command || i.task || i.type || 'Task').slice(0, 60)} (${i.schedule || 'pending'})`,
      }));
      const extractPrompt = `You are a strict data extraction assistant.
User Request to Cancel: "${String(message || '').slice(0, 500)}"

Current Active Tasks:
${JSON.stringify(simplifiedIntents, null, 2)}

RULES:
1. Match the user's request to the Active Tasks. The user will use natural language (e.g., "8am" instead of "08:00", "both" to mean multiple tasks).
2. Respond ONLY with a valid JSON object. It must contain exactly one key: "ids".
3. The value of "ids" must be an array of the matched "id" strings.

EXAMPLE OUTPUTS:
{"ids": ["intent_123_456", "intent_789_012"]}
{"ids": []}`;
      let idsToDelete = [];
      try {
        const extractModel = process.env.PIKO_ROUTER_MODEL || process.env.PIKO_CASUAL_MODEL || sessionModel;
        const raw = await ollamaNativeChat(extractModel, [{ role: 'user', content: extractPrompt }], { format: 'json', temperature: 0, max_tokens: 120 });
        const parsed = JSON.parse(stripCodeFences(raw || ''));
        idsToDelete = Array.isArray(parsed.ids) ? parsed.ids : (parsed.idsToDelete || []);
        if (!Array.isArray(idsToDelete)) idsToDelete = [];
        const validIds = new Set(pending.map((i) => i.id));
        idsToDelete = idsToDelete.filter((id) => validIds.has(String(id)));
      } catch (e) {
        const raw = stripCancelPrefix(String(message || '')).trim();
        const parts = splitLines(raw).flatMap((line) => line.split(',')).flatMap((p) => (() => { const low=toLowerAsciiish(p); const i=low.indexOf(' and '); return i>=0 ? [p.slice(0,i), p.slice(i+5)] : [p]; })()).map((p) => stripListMarker(p)).filter(Boolean);
        idsToDelete = findIntentsByDescriptions(parts.length ? parts : [message]).map((m) => m.id);
      }
      if (idsToDelete.length === 0) {
        const reply = "No matching schedules found. Ask \"what's in the queue?\" to see what's pending.";
        history.push({ role: 'assistant', content: reply });
        sessionStore.append(key, 'user', message);
        sessionStore.append(key, 'assistant', reply);
        return send(res, 200, JSON.stringify({ reply }));
      }
      const preview = idsToDelete.map((id) => {
        const i = pending.find((p) => p.id === id);
        const task = (i && ((i.briefFields && i.briefFields.objective) || i.title || i.description || i.command || i.task || i.type || 'Task')) || id;
        return `${String(task).slice(0, 50)} (${(i && i.schedule) || 'pending'})`;
      }).join('; ');
      const reply = `I'll cancel: ${preview}. Reply YES to confirm.`;
      pendingCancelConfirmations.set(key, { intentIds: idsToDelete, expiresAt: Date.now() + PENDING_CANCEL_TTL_MS });
      savePendingCancelConfirmations(pendingCancelConfirmations);
      history.push({ role: 'assistant', content: reply });
      sessionStore.append(key, 'user', message);
      sessionStore.append(key, 'assistant', reply);
      try { const { logActivity } = require('./activityLog'); logActivity('action_router_run', { capability: route.capability, outcome: 'preview', pendingCount: idsToDelete.length }); } catch (_) {}
      return send(res, 200, JSON.stringify({ reply }));
    }
    if (route.capability === 'inventory.csv.generate') {
      const { formatInventoryReply, getUrl } = require('./legionRunPoller');
      const csvUrl = `${stripTrailingSlash(AUSMAKER_BASE_URL)}/api/forecast/csv`;
      try {
        const res2 = await getUrl(csvUrl);
        if (res2.statusCode !== 200) {
          const reply = "Couldn't fetch the CSV — AusMaker API may be unavailable. Try again in a minute.";
          history.push({ role: 'assistant', content: reply });
          sessionStore.append(key, 'user', message);
          sessionStore.append(key, 'assistant', reply);
          return send(res, 200, JSON.stringify({ reply }));
        }
        const data = JSON.parse(res2.body || '{}');
        if (!data.success || !data.csv_content) {
          const reply = data.error || "No CSV data available. Run a low stock scan first to prime the cache.";
          history.push({ role: 'assistant', content: reply });
          sessionStore.append(key, 'user', message);
          sessionStore.append(key, 'assistant', reply);
          return send(res, 200, JSON.stringify({ reply }));
        }
        const reply = formatInventoryReply(data, 'inventory.csv.generate', DATA_DIR, message, route.opts || {});
        history.push({ role: 'assistant', content: reply });
        sessionStore.append(key, 'user', message);
        sessionStore.append(key, 'assistant', reply);
        try { const { logActivity } = require('./activityLog'); logActivity('action_router_run', { capability: route.capability, outcome: 'success', fastPath: true }); } catch (_) {}
        return send(res, 200, JSON.stringify({ reply }));
      } catch (e) {
        const reply = "Couldn't generate CSV: " + (e.message || 'Unknown error') + ". Try again in a minute.";
        history.push({ role: 'assistant', content: reply });
        sessionStore.append(key, 'user', message);
        sessionStore.append(key, 'assistant', reply);
        return send(res, 200, JSON.stringify({ reply }));
      }
    }
    const { isLegionFlowCapability, runLegionCapabilityFlow } = require('./frontDesk');
    if (isLegionFlowCapability(route.capability)) {
      const legionOut = await runLegionCapabilityFlow({
        route,
        message,
        sessionModel,
        dataDir: DATA_DIR,
        legionAdapterApiBase: LEGION_ADAPTER_API_BASE,
        reqSource,
        key,
        requestStartedAt,
      });
      const reply = legionOut.reply;
      history.push({ role: 'assistant', content: reply });
      sessionStore.append(key, 'user', message);
      sessionStore.append(key, 'assistant', reply);
      if (legionOut.ok) {
        try { const { logActivity } = require('./activityLog'); logActivity('action_router_run', { capability: route.capability, runId: legionOut.runId, outcome: 'success', fastPath: true }); } catch (err) { void err; }
      }
      return send(res, 200, JSON.stringify({
        reply,
        route: legionOut.needs_confirm
          ? 'money_confirm_required'
          : (legionOut.ok ? 'legion_capability' : 'legion_adapter_error'),
        ...(legionOut.needs_confirm ? { error: 'money_confirm_required', needs_confirm: true } : {}),
        ...(legionOut.progressAck ? { progressAck: legionOut.progressAck } : {}),
      }));
    }
  }

  if (!circuitRoute && allowsActionRouter(triage)) {
    const { matchCompoundWorkflow } = require('./compoundWorkflows');
    const matchedWorkflow = matchCompoundWorkflow(message);
    const isCompoundTask = matchedWorkflow
      || includesAny(toLowerAsciiish(message), [
        'and then', 'also', 'first', 'secondly', 'after that', 'finally',
        'forecast and', 'ping ', 'metrics', 'revenue', 'sync sales', 'tell me what needs',
      ]);
    if (isCompoundTask && allowsCompoundOrchestrator(triage)) {
      console.log('[ROUTING] Compound task detected. Routing to Plan-and-Execute Orchestrator.');
      try {
        const { planAndExecute } = require('./taskOrchestrator');
        const { beginPlan, clearSessionState } = require('./sessionState');
        beginPlan(key, ['Analyse request', 'Execute tools', 'Synthesise reply'], DATA_DIR);
        const finalResponse = await planAndExecute(message, {
          sessionModel,
          message,
          dataDir: DATA_DIR,
          ausmakerBaseUrl: AUSMAKER_BASE_URL,
          dispatchLegionBrief,
          legionAdapterApiBase: LEGION_ADAPTER_API_BASE,
          sessionId: key,
          reqSource,
        });
        clearSessionState(key, DATA_DIR);
        if (finalResponse) {
          history.push({ role: 'assistant', content: finalResponse });
          sessionStore.append(key, 'user', message);
          sessionStore.append(key, 'assistant', finalResponse);
          return send(res, 200, JSON.stringify({
            reply: finalResponse,
            ...(triageProgressAck ? { progressAck: triageProgressAck } : {}),
            ...(triage ? { triage } : {}),
          }));
        }
      } catch (e) {
        console.error('[ORCHESTRATOR] Error, falling back to single-shot:', e.message);
      }
    }
    // 8B action router — only WORK_NOW / SCHEDULE_WORK lanes (triage is law).
    if (!(plan && (plan.casual || plan.socialChat))) {
      console.log('[DECISION] No circuit match → routing via 8B actionRouter');
      try {
      const { routeToAction } = require('./actionRouter');
      const lastAssistant = [...history].slice(0, -1).reverse().find((m) => m.role === 'assistant' && m.content);
      const route = await routeToAction(message, sessionModel, {
        lastAssistantMessage: lastAssistant ? lastAssistant.content : '',
      });
      if (route.actionType === 'none') {
        if (shouldOfferClarify(message, { dialogue: clarifyDialogue, sessionKey: key })) {
          const turned = await finalizeClarifyTurn(message, {
            dialogue: clarifyDialogue,
            sessionState: clarifySessionState,
            history,
          });
          setClarifyPending(key, {
            bundle: turned.bundle,
            originalMessage: message,
          });
          history.push({ role: 'assistant', content: turned.reply });
          sessionStore.append(key, 'user', message);
          sessionStore.append(key, 'assistant', turned.reply);
          return send(res, 200, JSON.stringify({
            reply: turned.reply,
            route: 'clarify',
            reason: turned.bundle.reason,
          }));
        }
        // Fall through to casual chat — routeToAction is gatekeeper; chat goes to standard LLM
        console.log('[DECISION] 7B returned none → casual chat (main LLM)');
      } else if (route.actionType === 'clarification_needed') {
        let reply = route.fallbackMessage;
        if (!reply) {
          const turned = await finalizeClarifyTurn(message, {
            dialogue: clarifyDialogue,
            sessionState: clarifySessionState,
            history,
          });
          setClarifyPending(key, {
            bundle: turned.bundle,
            originalMessage: message,
          });
          reply = turned.reply;
        }
        history.push({ role: 'assistant', content: reply });
        sessionStore.append(key, 'user', message);
        sessionStore.append(key, 'assistant', reply);
        if (process.env.PIKO_LOG_PLANNER === '1') console.log('[SERVER] Clarification Loop — router uncertainty');
        return send(res, 200, JSON.stringify({ reply, route: 'clarify' }));
      } else if (route.actionType === 'web_research_run' && route.query) {
        // Deterministic execution: router said web search — 70B synthesises scraped data
        console.log('[EXECUTION] Bypassing ReAct. Deterministically executing: web_research_run');
        try {
          const { fireProgressAck } = require('./frontDesk');
          const progressAck = await fireProgressAck(route, message, { sessionId: key, reqSource });
          const { sovereignSearchAndSynthesize } = require('./sovereignSearch');
          const q = String(route.query).trim().slice(0, 500);
          const reply = await sovereignSearchAndSynthesize(q, message, sessionModel, { topN: 2 });
          history.push({ role: 'assistant', content: reply });
          sessionStore.append(key, 'user', message);
          sessionStore.append(key, 'assistant', reply);
          return send(res, 200, JSON.stringify({ reply, ...(progressAck ? { progressAck } : {}) }));
        } catch (e) {
          const reply = "Couldn't search the web: " + (e.message || 'Unknown error');
          history.push({ role: 'assistant', content: reply });
          sessionStore.append(key, 'user', message);
          sessionStore.append(key, 'assistant', reply);
          return send(res, 200, JSON.stringify({ reply }));
        }
      } else if (route.actionType === 'memory_subconscious_search' && route.query) {
        // Deterministic execution: 7B router said memory search — execute directly, bypass ReAct
        console.log('[EXECUTION] Bypassing ReAct. Deterministically executing: memory_subconscious_search');
        try {
          const vectorMemory = require('./vectorMemory');
          const hits = await vectorMemory.search(route.query, { limit: 5 });
          const reply = hits.length === 0
            ? 'No relevant past context found.'
            : 'Past context:\n' + hits.map((h, i) => `${i + 1}. ${h.text}`).join('\n');
          history.push({ role: 'assistant', content: reply });
          sessionStore.append(key, 'user', message);
          sessionStore.append(key, 'assistant', reply);
          return send(res, 200, JSON.stringify({ reply }));
        } catch (e) {
          const reply = "Couldn't search memory: " + (e.message || 'Unknown error');
          history.push({ role: 'assistant', content: reply });
          sessionStore.append(key, 'user', message);
          sessionStore.append(key, 'assistant', reply);
          return send(res, 200, JSON.stringify({ reply }));
        }
      } else if (route.actionType === 'python_execute' && route.objective) {
        // Deterministic execution: router said Python — 70B generates code, sandbox runs, 70B synthesises
        console.log('[EXECUTION] Bypassing ReAct. Deterministically executing: python_execute');
        try {
          const { ollamaNativeChat } = require('./llm');
          const { executePythonCode } = require('./pythonSandbox');
          const { fireProgressAck, getCodeGenModel, finalizeToolReply } = require('./frontDesk');
          const progressAck = await fireProgressAck(route, message, { sessionId: key, reqSource });
          const model = getCodeGenModel();
          const genPrompt = `Generate a Python script that accomplishes this: ${route.objective}
Use only standard library and common packages (math, json, csv). If you need pandas or matplotlib, try import them but handle ImportError.
Output ONLY the raw Python code. No markdown, no explanation, no \`\`\`python.`;
          const rawCode = await ollamaNativeChat(model, [{ role: 'user', content: genPrompt }], { max_tokens: 1500, temperature: 0.2 });
          const code = (rawCode && typeof rawCode === 'string' ? rawCode : String(rawCode || ''))
            /*fences*/;
          if (!code || code.length < 5) {
            const reply = "Couldn't generate valid Python code for that request.";
            history.push({ role: 'assistant', content: reply });
            sessionStore.append(key, 'user', message);
            sessionStore.append(key, 'assistant', reply);
            return send(res, 200, JSON.stringify({ reply }));
          }
          const output = await executePythonCode(code);
          const fallback = output.startsWith('Error:') ? output : output;
          const reply = await finalizeToolReply({
            route,
            userMessage: message,
            toolResult: { stdout: output, objective: route.objective },
            formattedFallback: fallback,
          });
          history.push({ role: 'assistant', content: reply });
          sessionStore.append(key, 'user', message);
          sessionStore.append(key, 'assistant', reply);
          return send(res, 200, JSON.stringify({ reply, ...(progressAck ? { progressAck } : {}) }));
        } catch (e) {
          const reply = "Couldn't run Python: " + (e.message || 'Unknown error');
          history.push({ role: 'assistant', content: reply });
          sessionStore.append(key, 'user', message);
          sessionStore.append(key, 'assistant', reply);
          return send(res, 200, JSON.stringify({ reply }));
        }
      } else if (route.actionType === 'email_send' && route.to && route.subject != null) {
        console.log('[EXECUTION] Deterministically executing: email_send');
        try {
          const { sendEmail } = require('./emailClient');
          const reply = await sendEmail({ to: route.to, subject: route.subject, body: route.body || '' });
          history.push({ role: 'assistant', content: reply });
          sessionStore.append(key, 'user', message);
          sessionStore.append(key, 'assistant', reply);
          return send(res, 200, JSON.stringify({ reply }));
        } catch (e) {
          const reply = 'Failed to send email: ' + (e.message || 'Unknown error');
          history.push({ role: 'assistant', content: reply });
          sessionStore.append(key, 'user', message);
          sessionStore.append(key, 'assistant', reply);
          return send(res, 200, JSON.stringify({ reply }));
        }
      } else if (route.actionType === 'document_parse' && route.filePath) {
        console.log('[EXECUTION] Deterministically executing: document_parse');
        try {
          const { parseLocalDocument } = require('./documentParser');
          const reply = await parseLocalDocument(route.filePath);
          history.push({ role: 'assistant', content: reply });
          sessionStore.append(key, 'user', message);
          sessionStore.append(key, 'assistant', reply);
          return send(res, 200, JSON.stringify({ reply }));
        } catch (e) {
          const reply = 'Failed to parse document: ' + (e.message || 'Unknown error');
          history.push({ role: 'assistant', content: reply });
          sessionStore.append(key, 'user', message);
          sessionStore.append(key, 'assistant', reply);
          return send(res, 200, JSON.stringify({ reply }));
        }
      } else if (route.actionType === 'browser_actuate' && route.url && route.actions && route.actions.length) {
        console.log('[EXECUTION] Deterministically executing: browser_actuate');
        try {
          const { actuateWebPage } = require('./webReader');
          const reply = await actuateWebPage(route.url, route.actions);
          history.push({ role: 'assistant', content: reply });
          sessionStore.append(key, 'user', message);
          sessionStore.append(key, 'assistant', reply);
          return send(res, 200, JSON.stringify({ reply }));
        } catch (e) {
          const reply = 'Web actuation failed: ' + (e.message || 'Unknown error');
          history.push({ role: 'assistant', content: reply });
          sessionStore.append(key, 'user', message);
          sessionStore.append(key, 'assistant', reply);
          return send(res, 200, JSON.stringify({ reply }));
        }
      } else if (route.actionType === 'system_settings_update' && route.key && route.value != null) {
        console.log('[EXECUTION] Deterministically executing: system_settings_update', route.key, route.value);
        try {
          const { updateConfig } = require('./configManager');
          const { synthesizeToolReply } = require('./frontDesk');
          const result = updateConfig(route.key, route.value);
          if (process.env.PIKO_LOG_PLANNER === '1') console.log('[SYNTHESIS] 70B confirming settings update...');
          const reply = await synthesizeToolReply({
            userMessage: message,
            toolResult: { ok: true, key: route.key, value: route.value, result },
            formattedFallback: result,
            hint: 'settings update confirmation',
            maxTokens: 150,
          });
          history.push({ role: 'assistant', content: reply });
          sessionStore.append(key, 'user', message);
          sessionStore.append(key, 'assistant', reply);
          return send(res, 200, JSON.stringify({ reply }));
        } catch (e) {
          const reply = 'Settings update failed: ' + (e.message || 'Unknown error');
          history.push({ role: 'assistant', content: reply });
          sessionStore.append(key, 'user', message);
          sessionStore.append(key, 'assistant', reply);
          return send(res, 200, JSON.stringify({ reply }));
        }
      } else if (route.actionType === 'legion_deploy_agent' && route.role && route.taskContext) {
        console.log('[EXECUTION] Deterministically executing: legion_deploy_agent', route.role);
        try {
          const { deploySubAgent } = require('./legionSwarm');
          const { fireProgressAck, finalizeToolReply } = require('./frontDesk');

          // Asynchronous progress ping — quant keeps legacy Telegram ping; others use front-desk ack
          if (route.role === 'quant') {
            const { sendToAdmin } = require('./telegramNotifier');
            sendToAdmin("⏳ *Piko:* I'm spinning up the Quant Agent to crunch these numbers. This requires processing thousands of rows, so it might take a minute or two. I'll ping you as soon as the forecast is ready!").catch(() => {});
          } else {
            await fireProgressAck(route, message, { sessionId: key, reqSource });
          }

          const rawResult = await deploySubAgent(route.role, route.taskContext);
          if (rawResult.startsWith('Error:') || rawResult.includes('Failed after')) {
            history.push({ role: 'assistant', content: rawResult });
            sessionStore.append(key, 'user', message);
            sessionStore.append(key, 'assistant', rawResult);
            return send(res, 200, JSON.stringify({ reply: rawResult }));
          }
          if (process.env.PIKO_LOG_PLANNER === '1') console.log('[SYNTHESIS] 70B formatting agent raw data...');
          const reply = await finalizeToolReply({
            route,
            userMessage: message,
            toolResult: rawResult,
            formattedFallback: rawResult,
          });
          history.push({ role: 'assistant', content: reply });
          sessionStore.append(key, 'user', message);
          sessionStore.append(key, 'assistant', reply);
          return send(res, 200, JSON.stringify({ reply }));
        } catch (e) {
          const reply = 'Legion agent failed: ' + (e.message || 'Unknown error');
          history.push({ role: 'assistant', content: reply });
          sessionStore.append(key, 'user', message);
          sessionStore.append(key, 'assistant', reply);
          return send(res, 200, JSON.stringify({ reply }));
        }
      } else if (route.actionType === 'stock_on_hand_get' && route.sku) {
        console.log('[EXECUTION] Deterministically executing: stock_on_hand_get', route.sku);
        const { getStockOnHand, formatStockOnHandReply } = require('./inventoryStockOnHand');
        try {
          const result = await getStockOnHand(route.sku, { ausmakerBase: AUSMAKER_BASE_URL, dataDir: DATA_DIR });
          const reply = formatStockOnHandReply(result);
          history.push({ role: 'assistant', content: reply });
          sessionStore.append(key, 'user', message);
          sessionStore.append(key, 'assistant', reply);
          try { const { logActivity } = require('./activityLog'); logActivity('action_router_run', { actionType: 'stock_on_hand_get', sku: route.sku, outcome: result.found ? 'success' : 'not_found', source: result.source || null }); } catch (_) {}
          return send(res, 200, JSON.stringify({ reply, ...(triageProgressAck ? { progressAck: triageProgressAck } : {}), ...(triage ? { triage } : {}) }));
        } catch (e) {
          const reply = "Couldn't look up stock on hand: " + (e.message || 'Unknown error');
          history.push({ role: 'assistant', content: reply });
          sessionStore.append(key, 'user', message);
          sessionStore.append(key, 'assistant', reply);
          return send(res, 200, JSON.stringify({ reply }));
        }
      } else if (route.actionType === 'stock_on_hand_get' && route.sku) {
        console.log('[EXECUTION] Deterministically executing: stock_on_hand_get', route.sku);
        const { getStockOnHand, formatStockOnHandReply } = require('./inventoryStockOnHand');
        try {
          const result = await getStockOnHand(route.sku, { ausmakerBase: AUSMAKER_BASE_URL, dataDir: DATA_DIR });
          const reply = formatStockOnHandReply(result);
          history.push({ role: 'assistant', content: reply });
          sessionStore.append(key, 'user', message);
          sessionStore.append(key, 'assistant', reply);
          try { const { logActivity } = require('./activityLog'); logActivity('action_router_run', { actionType: 'stock_on_hand_get', sku: route.sku, outcome: result.found ? 'success' : 'not_found', source: result.source || null }); } catch (_) {}
          return send(res, 200, JSON.stringify({ reply, ...(triageProgressAck ? { progressAck: triageProgressAck } : {}), ...(triage ? { triage } : {}) }));
        } catch (e) {
          const reply = "Couldn't look up stock on hand: " + (e.message || 'Unknown error');
          history.push({ role: 'assistant', content: reply });
          sessionStore.append(key, 'user', message);
          sessionStore.append(key, 'assistant', reply);
          return send(res, 200, JSON.stringify({ reply }));
        }
      } else if (route.actionType === 'forecast_get' && route.sku) {
        console.log('[EXECUTION] Deterministically executing: forecast_get', route.sku);
        const { getUrl } = require('./legionRunPoller');
        const sku = String(route.sku || '').trim();
        const url = `${stripTrailingSlash(AUSMAKER_BASE_URL)}/api/forecast/summary?sku=${encodeURIComponent(sku)}`;
        try {
          const getRes = await getUrl(url);
          if (getRes.statusCode !== 200) {
            const reply = 'Forecast API unavailable. Try again in a minute.';
            history.push({ role: 'assistant', content: reply });
            sessionStore.append(key, 'user', message);
            sessionStore.append(key, 'assistant', reply);
            return send(res, 200, JSON.stringify({ reply }));
          }
          const data = JSON.parse(getRes.body || '{}');
          const months = (data.months || []).map((m) => `${m.year_month}: ${m.qty} (${m.source})`).join(', ');
          const reply = `Forecast for ${sku}: daily run rate ${Number(data.daily_run_rate || 0).toFixed(2)}. Next months: ${months || 'none'}.`;
          history.push({ role: 'assistant', content: reply });
          sessionStore.append(key, 'user', message);
          sessionStore.append(key, 'assistant', reply);
          return send(res, 200, JSON.stringify({ reply }));
        } catch (e) {
          const reply = "Couldn't fetch forecast: " + (e.message || 'Unknown error');
          history.push({ role: 'assistant', content: reply });
          sessionStore.append(key, 'user', message);
          sessionStore.append(key, 'assistant', reply);
          return send(res, 200, JSON.stringify({ reply }));
        }
      } else if (route.actionType === 'forecast_override_set' && route.sku && route.year_month && route.qty != null) {
        console.log('[EXECUTION] Deterministically executing: forecast_override_set', route.sku);
        const { postJson } = require('./legionRunPoller');
        const url = `${stripTrailingSlash(AUSMAKER_BASE_URL)}/api/forecast/override`;
        try {
          const postRes = await postJson(url, { sku: route.sku, year_month: route.year_month, override_qty: route.qty });
          if (postRes.statusCode < 200 || postRes.statusCode >= 300) {
            const reply = 'Override failed. ' + (JSON.parse(postRes.body || '{}').error || postRes.body || '').slice(0, 80);
            history.push({ role: 'assistant', content: reply });
            sessionStore.append(key, 'user', message);
            sessionStore.append(key, 'assistant', reply);
            return send(res, 200, JSON.stringify({ reply }));
          }
          const reply = `Override applied. ${route.sku} is now set to ${route.qty} units for ${route.year_month}.`;
          history.push({ role: 'assistant', content: reply });
          sessionStore.append(key, 'user', message);
          sessionStore.append(key, 'assistant', reply);
          return send(res, 200, JSON.stringify({ reply }));
        } catch (e) {
          const reply = "Couldn't apply override: " + (e.message || 'Unknown error');
          history.push({ role: 'assistant', content: reply });
          sessionStore.append(key, 'user', message);
          sessionStore.append(key, 'assistant', reply);
          return send(res, 200, JSON.stringify({ reply }));
        }
      } else if (route.actionType === 'forecast_review' && route.sku) {
        console.log('[EXECUTION] Deterministically executing: forecast_review', route.sku);
        try {
          const { fireProgressAck } = require('./frontDesk');
          const progressAck = await fireProgressAck(route, message, { sessionId: key, reqSource });
          const { buildForecastReviewReply } = require('./ausmakerForecast');
          const reply = await buildForecastReviewReply(message, String(route.sku).trim(), sessionModel, AUSMAKER_BASE_URL);
          history.push({ role: 'assistant', content: reply });
          sessionStore.append(key, 'user', message);
          sessionStore.append(key, 'assistant', reply);
          return send(res, 200, JSON.stringify({ reply, ...(progressAck ? { progressAck } : {}) }));
        } catch (e) {
          const reply = "Couldn't review forecast: " + (e.message || 'Unknown error');
          history.push({ role: 'assistant', content: reply });
          sessionStore.append(key, 'user', message);
          sessionStore.append(key, 'assistant', reply);
          return send(res, 200, JSON.stringify({ reply }));
        }
      } else if (route.actionType === 'forecast_recompute' && route.sku) {
        console.log('[EXECUTION] Deterministically executing: forecast_recompute', route.sku);
        try {
          const { buildForecastRecomputeReply } = require('./ausmakerForecast');
          const reply = await buildForecastRecomputeReply(String(route.sku).trim(), AUSMAKER_BASE_URL);
          history.push({ role: 'assistant', content: reply });
          sessionStore.append(key, 'user', message);
          sessionStore.append(key, 'assistant', reply);
          return send(res, 200, JSON.stringify({ reply }));
        } catch (e) {
          const reply = "Couldn't reforecast: " + (e.message || 'Unknown error');
          history.push({ role: 'assistant', content: reply });
          sessionStore.append(key, 'user', message);
          sessionStore.append(key, 'assistant', reply);
          return send(res, 200, JSON.stringify({ reply }));
        }
      } else if (useReAct && (route.actionType === 'run_capability' || route.actionType === 'create_intent' || route.actionType === 'create_reminder' || route.actionType === 'create_tripwire' || route.actionType === 'create_digest_schedule' || route.actionType === 'sales_summary_get' || route.actionType === 'memory_core_update' || route.actionType === 'cancel_intent')) {
        // sales_summary_get: bypass ReAct — agent often picks sales.analysis.run (Legion) instead, which returns "Legion run completed." with no data
        if (route.actionType === 'sales_summary_get') {
          const { getUrl } = require('./legionRunPoller');
          const { fireProgressAck, finalizeToolReply } = require('./frontDesk');
          const { runSalesSummaryReply } = require('./salesSummary');
          const progressAck = await fireProgressAck(route, message, { sessionId: key, reqSource });
          try {
            const { reply } = await runSalesSummaryReply({
              getUrl,
              baseUrl: AUSMAKER_BASE_URL,
              route,
              message,
              recentTurns: recentTurnsForPlan,
              finalizeToolReply,
            });
            history.push({ role: 'assistant', content: reply });
            sessionStore.append(key, 'user', message);
            sessionStore.append(key, 'assistant', reply);
            try { const { logActivity } = require('./activityLog'); logActivity('action_router_run', { actionType: 'sales_summary_get', outcome: 'success', fastPath: true }); } catch (_) {}
            return send(res, 200, JSON.stringify({ reply, ...(progressAck ? { progressAck } : {}) }));
          } catch (_) {}
          const reply = "Sales API unavailable. Try again in a minute.";
          history.push({ role: 'assistant', content: reply });
          sessionStore.append(key, 'user', message);
          sessionStore.append(key, 'assistant', reply);
          return send(res, 200, JSON.stringify({ reply }));
        }
        // Task detected — use ReAct agent
        console.log('[DECISION] Executing via ReAct agent:', route.actionType, route.capability || route.schedule || route.dueAt || '');
        const { runAgent } = require('./agentBrain');
      const capabilityToObjective = {
        'inventory.low_stock.scan': 'low stock scan',
        'inventory.report.export': 'low stock scan',
        'sales.analysis.run': 'sales analysis',
        'purchase_order.draft.create': 'purchase order draft',
      };
      const executeTool = async (action, params) => {
        if (action === 'create_intent' && params.schedule && params.objective) {
          const { formatTaskRef } = require('./legionTaskCreate');
          const normalizedSchedule = normalizeSchedule(params.schedule);
          try {
            const out = createLegionScheduledWithTask({
              schedule: normalizedSchedule,
              title: params.objective,
              objective: params.objective,
              description: params.objective,
              mode: 'auto',
              source: reqSource,
              sessionId: key,
              _creationSource: 'agent_brain',
            });
            if (out.duplicate) {
              return `Already set up — ${formatTaskRef(out.task_id)}: ${params.objective} ${normalizedSchedule}.`;
            }
            return `Done — ${formatTaskRef(out.task_id)} scheduled: ${params.objective} ${normalizedSchedule}.`;
          } catch (e) {
            return { error: e.message || String(e) };
          }
        }
        if (action === 'create_reminder' && params.dueAt && params.objective) {
          const at = new Date(params.dueAt);
          if (isNaN(at.getTime())) return { error: "Couldn't parse the time. Use ISO format." };
          createIntent({ type: 'reminder', title: params.objective, dueAt: at.toISOString(), source: reqSource, sessionId: key, _creationSource: 'agent_brain' });
          return `Reminder set — ${params.objective} at ${at.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}.`;
        }
        if (action === 'create_tripwire' && params.sku && params.operator != null && params.value != null) {
          const { addTripwire } = require('./tripwireEngine');
          const sku = String(params.sku || '').trim();
          const field = String(params.field || 'stock').toLowerCase();
          const op = String(params.operator).trim() === '=' ? '==' : String(params.operator).trim();
          const val = parseFloat(params.value);
          if (!sku || isNaN(val)) return { error: 'I need a SKU and a numeric value to set a tripwire.' };
          addTripwire(sku, field, op, val);
          return `Tripwire set! I will alert you if the ${field} for ${sku} goes ${op} ${val}.`;
        }
        if (action === 'create_digest_schedule' && params.time) {
          const { addSummarySchedule, normalizeTimeString } = require('./tripwireEngine');
          const normalized = normalizeTimeString(params.time);
          if (!normalized) return { error: 'Please specify a time (e.g. 4pm, 16:00, 9am).' };
          addSummarySchedule(normalized);
          return `Got it. I will compile and send the Product Change Summary every day at ${normalized}.`;
        }
        if (action === 'forecast_get' && params.sku) {
          const { getUrl } = require('./legionRunPoller');
          const sku = String(params.sku || '').trim();
          if (!sku) return { error: 'Please specify a SKU.' };
          const url = `${stripTrailingSlash(AUSMAKER_BASE_URL)}/api/forecast/summary?sku=${encodeURIComponent(sku)}`;
          const res = await getUrl(url);
          if (res.statusCode !== 200) return { error: 'Forecast API unavailable. Try again in a minute.' };
          const data = JSON.parse(res.body || '{}');
          const months = (data.months || []).map((m) => `${m.year_month}: ${m.qty} (${m.source})`).join(', ');
          return `Forecast for ${sku}: daily run rate ${data.daily_run_rate || 0}. Next months: ${months || 'none'}.`;
        }
        if (action === 'forecast_override_set' && params.sku && params.year_month != null && params.qty != null) {
          const { postJson } = require('./legionRunPoller');
          const sku = String(params.sku || '').trim();
          const ym = String(params.year_month || '').trim();
          const qty = parseInt(params.qty, 10);
          if (!sku || !isYyyyMm(ym) || isNaN(qty)) return { error: 'Need sku, year_month (YYYY-MM), and qty.' };
          const url = `${stripTrailingSlash(AUSMAKER_BASE_URL)}/api/forecast/override`;
          const res = await postJson(url, { sku, year_month: ym, override_qty: qty });
          if (res.statusCode < 200 || res.statusCode >= 300) return { error: 'Override failed. ' + (res.body || '').slice(0, 100) };
          return `Override applied. ${sku} is now set to ${qty} units for ${ym}.`;
        }
        if (action === 'sales_summary_get') {
          const { getUrl } = require('./legionRunPoller');
          const { runSalesSummaryReply } = require('./salesSummary');
          const { reply } = await runSalesSummaryReply({
            getUrl,
            baseUrl: AUSMAKER_BASE_URL,
            route: { ...params, actionType: 'sales_summary_get' },
            message,
            recentTurns: recentTurnsForPlan,
          });
          return reply;
        }
        if (action === 'memory_core_update' && params.preference) {
          const { appendToDataSoul } = require('./vectorMemory');
          const pref = String(params.preference).trim().slice(0, 500);
          if (pref) {
            appendToDataSoul(pref);
            return `Preference saved to Core Truths: "${pref.slice(0, 80)}${pref.length > 80 ? '…' : ''}".`;
          }
          return { error: 'No preference text provided.' };
        }
        if (action === 'memory_subconscious_search' && params.query) {
          const vectorMemory = require('./vectorMemory');
          const q = String(params.query).trim().slice(0, 300);
          if (q) {
            const hits = await vectorMemory.search(q, { limit: 5 });
            if (hits.length === 0) return 'No relevant past context found.';
            return 'Past context:\n' + hits.map((h, i) => `${i + 1}. ${h.text}`).join('\n');
          }
          return { error: 'No search query provided.' };
        }
        if (action === 'web_research_run' && params.query) {
          const { sovereignSearchAndSynthesize } = require('./sovereignSearch');
          return await sovereignSearchAndSynthesize(params.query, message, sessionModel, { topN: 2 });
        }
        if (action === 'python_execute' && params.code) {
          const { executePythonCode } = require('./pythonSandbox');
          return await executePythonCode(params.code);
        }
        if (action === 'email_send' && params.to && params.subject != null) {
          const { sendEmail } = require('./emailClient');
          return await sendEmail({ to: params.to, subject: params.subject, body: params.body || '' });
        }
        if (action === 'document_parse' && params.filePath) {
          const { parseLocalDocument } = require('./documentParser');
          return await parseLocalDocument(params.filePath);
        }
        if (action === 'browser_actuate' && params.url && Array.isArray(params.actions) && params.actions.length) {
          const { actuateWebPage } = require('./webReader');
          return await actuateWebPage(params.url, params.actions);
        }
        if (action === 'legion_deploy_agent' && params.role && params.taskContext) {
          const { deploySubAgent } = require('./legionSwarm');
          return await deploySubAgent(params.role, params.taskContext);
        }
        if (action === 'system.intents.read') {
          const intents = loadIntents();
          const pending = intents.filter((i) => i.status === 'pending' || !i.status);
          const cleanIntents = pending.map((i) => ({ task: ((i.briefFields && i.briefFields.objective) || i.title || i.description || i.command || i.task || i.type || 'Task').slice(0, 60), schedule: i.schedule || 'Pending' }));
          if (cleanIntents.length === 0) return 'Queue is empty. Nothing scheduled.';
          if (cleanIntents.length <= 5) return cleanIntents.map((c) => `${c.task} (${c.schedule})`).join('. ');
          return JSON.stringify(cleanIntents.slice(0, 10));
        }
        if (action === 'system.operations.read') {
          const { loadOperations, formatOperationsForPrompt } = require('./operations');
          return formatOperationsForPrompt(loadOperations()) || 'No background operations configured.';
        }
        if (action === 'system.intents.manage') {
          const { getPendingIntents, removeIntentById, findIntentsByDescriptions } = require('./intents');
          const { ollamaNativeChat } = require('./llm');
          const pending = getPendingIntents();
          if (pending.length === 0) return "Queue is already empty. Nothing to cancel.";
          const simplifiedIntents = pending.map((i) => ({ id: i.id, task: `${((i.briefFields && i.briefFields.objective) || i.title || i.description || i.command || i.task || i.type || 'Task').slice(0, 60)} (${i.schedule || 'pending'})` }));
          const extractPrompt = `User Request to Cancel: "${String(message || '').slice(0, 500)}"\n\nCurrent Active Tasks:\n${JSON.stringify(simplifiedIntents, null, 2)}\n\nRespond ONLY with JSON: {"ids": ["id1","id2"]} or {"ids": []}`;
          let idsToDelete = [];
          try {
            const raw = await ollamaNativeChat(sessionModel, [{ role: 'user', content: extractPrompt }], { format: 'json', temperature: 0, max_tokens: 120 });
            const parsed = JSON.parse(stripCodeFences(raw || ''));
            idsToDelete = Array.isArray(parsed.ids) ? parsed.ids : [];
            const validIds = new Set(pending.map((i) => i.id));
            idsToDelete = idsToDelete.filter((id) => validIds.has(String(id)));
          } catch (_) {
            const parts = splitLines(stripCancelPrefix(String(message || '')).trim()).flatMap((line) => line.split(',')).flatMap((p) => { const low=toLowerAsciiish(p); const i=low.indexOf(' and '); return i>=0 ? [p.slice(0,i), p.slice(i+5)] : [p]; }).map((p) => stripListMarker(p)).filter(Boolean);
            idsToDelete = findIntentsByDescriptions(parts.length ? parts : [message]).map((m) => m.id);
          }
          let cancelled = 0;
          for (const id of idsToDelete) { if (removeIntentById(id)) cancelled++; }
          return cancelled > 0 ? `Cancelled ${cancelled} schedule(s).` : 'No matching schedules found.';
        }
        if (action === 'ausmaker.business.health.review') {
          const { runBusinessHealthReview, formatBusinessHealthReply } = require('./proactive/analyst');
          const review = await runBusinessHealthReview(DATA_DIR, { forceAnalyze: true });
          return formatBusinessHealthReply(review);
        }
        if (action === 'business.metrics.aggregate') {
          const { aggregateBusinessMetrics } = require('./adapters/business.metrics');
          const r = await aggregateBusinessMetrics();
          return r.success ? `Metrics: ${r.data.total_sales} units, $${r.data.revenue} revenue (${r.data.timeframe})` : r.error;
        }
        if (action === 'system.health.ping') {
          const { pingEndpoints } = require('./adapters/system.health');
          let urls = Array.isArray(params.urls) ? params.urls : (process.env.PIKO_HEALTH_CHECK_URLS || '').split(',').map((u) => u.trim()).filter(Boolean);
          if (urls.length === 0) urls = [stripTrailingSlash((AUSMAKER_BASE_URL || 'http://127.0.0.1:5001'))];
          const r = await pingEndpoints(urls);
          return r.success ? `${r.overall_status}: ${r.results.map((x) => `${x.url}=${x.ok ? x.status : 'fail'}`).join(', ')}` : r.error;
        }
        if (action === 'performance.benchmark.run') {
          const { runPerformanceBenchmark } = require('./adapters/performance.benchmark');
          const url = params.url || process.env.PIKO_HEALTH_CHECK_URL || AUSMAKER_BASE_URL || 'http://127.0.0.1:5001';
          const r = await runPerformanceBenchmark(url);
          return r.success ? `${r.target}: ${r.latency_ms}ms (${r.status})` : r.error;
        }
        if (action === 'web.research.run') {
          const { sovereignSearchAndSynthesize } = require('./sovereignSearch');
          const q = String(message || params.query || '').trim().slice(0, 500);
          if (!q) return { error: 'No search query. Provide search terms in your message.' };
          return await sovereignSearchAndSynthesize(q, message, sessionModel, { topN: 2 });
        }
        const objective = capabilityToObjective[action] || action;
        const syntheticBrief = { fields: { objective, execution_mode: 'auto', risk_level: 'low' } };
        const dispatch = await dispatchLegionBrief(syntheticBrief, { piko_user_id: `${reqSource || 'chat'}:${key}`, model: sessionModel });
        if (!dispatch.ok || !dispatch.runId) return "Couldn't start that — Legion or the adapter may be unavailable.";
        const { pollLegionRun, formatInventoryReply, buildSummaryFromResult } = require('./legionRunPoller');
        const { saveLegionResult } = require('./sharedContext');
        const polled = await pollLegionRun(dispatch.runId, LEGION_ADAPTER_API_BASE);
        if (polled.ok && polled.result) {
          saveLegionResult(DATA_DIR, dispatch.capability, polled.result, { source: 'action_router' });
          return (action === 'inventory.low_stock.scan' || action === 'inventory.report.export')
            ? formatInventoryReply(polled.result, action, DATA_DIR, message)
            : (buildSummaryFromResult(polled.result, dispatch.capability, DATA_DIR) || 'Done. No items flagged.');
        }
        if (polled.status === 'timeout') return "Started but taking longer than expected. Try again in a minute.";
        return polled.error ? `Failed: ${polled.error}` : "Didn't complete. Try again in a minute.";
      };
      const reply = await runAgent(message, { executeTool, model: sessionModel });
      history.push({ role: 'assistant', content: reply });
      sessionStore.append(key, 'user', message);
      sessionStore.append(key, 'assistant', reply);
      return send(res, 200, JSON.stringify({ reply }));
      } else {
        // Task but ReAct disabled — inline capability execution
      console.log('[DECISION] Executing capability from 7B:', route.actionType, route.capability || route.schedule || route.dueAt || '');
      if (route.actionType === 'cancel_intent') {
        if (process.env.PIKO_LOG_PLANNER === '1') console.log('[SERVER] Intercepted cancel_intent. Re-routing to system.intents.manage.');
        route.actionType = 'run_capability';
        route.capability = 'system.intents.manage';
      }
      if (route.actionType === 'run_capability' && route.capability === 'business.metrics.aggregate') {
        const { aggregateBusinessMetrics } = require('./adapters/business.metrics');
        const { fireProgressAck, finalizeToolReply } = require('./frontDesk');
        const progressAck = await fireProgressAck(route, message, { sessionId: key, reqSource });
        const result = await aggregateBusinessMetrics();
        const formatted = result.success
          ? `Business Metrics (${result.data.timeframe}): Total units sold: ${result.data.total_sales}; Revenue: $${result.data.revenue}`
          : `Couldn't fetch metrics: ${result.error}`;
        const reply = await finalizeToolReply({
          route,
          userMessage: message,
          toolResult: result.success ? result.data : result,
          formattedFallback: formatted,
        });
        history.push({ role: 'assistant', content: reply });
        sessionStore.append(key, 'user', message);
        sessionStore.append(key, 'assistant', reply);
        return send(res, 200, JSON.stringify({ reply, ...(progressAck ? { progressAck } : {}) }));
      }
      if (route.actionType === 'run_capability' && route.capability === 'system.health.ping') {
        const { pingEndpoints } = require('./adapters/system.health');
        const urls = (route.opts && route.opts.urls) || (process.env.PIKO_HEALTH_CHECK_URLS || '').split(',').map((u) => u.trim()).filter(Boolean);
        if (urls.length === 0) urls.push(stripTrailingSlash((AUSMAKER_BASE_URL || 'http://127.0.0.1:5001')));
        const result = await pingEndpoints(urls);
        const reply = result.success
          ? `**System Health:** ${result.overall_status}\n${result.results.map((r) => `• ${r.url}: ${r.ok ? r.status : (r.error || 'Failed')}`).join('\n')}`
          : `Health check failed: ${result.error}`;
        history.push({ role: 'assistant', content: reply });
        sessionStore.append(key, 'user', message);
        sessionStore.append(key, 'assistant', reply);
        return send(res, 200, JSON.stringify({ reply }));
      }
      if (route.actionType === 'run_capability' && route.capability === 'performance.benchmark.run') {
        const { runPerformanceBenchmark } = require('./adapters/performance.benchmark');
        const url = (route.opts && route.opts.url) || process.env.PIKO_HEALTH_CHECK_URL || AUSMAKER_BASE_URL || 'http://127.0.0.1:5001';
        const result = await runPerformanceBenchmark(url);
        const reply = result.success
          ? `**Performance:** ${result.target}\n• Latency: ${result.latency_ms}ms (${result.status})\n• HTTP: ${result.http_status}`
          : `Benchmark failed: ${result.error}`;
        history.push({ role: 'assistant', content: reply });
        sessionStore.append(key, 'user', message);
        sessionStore.append(key, 'assistant', reply);
        return send(res, 200, JSON.stringify({ reply }));
      }
      if (route.actionType === 'run_capability' && route.capability === 'inventory.csv.generate') {
        const { formatInventoryReply, getUrl } = require('./legionRunPoller');
        const csvUrl = `${stripTrailingSlash(AUSMAKER_BASE_URL)}/api/forecast/csv`;
        try {
          const res2 = await getUrl(csvUrl);
          if (res2.statusCode !== 200) {
            const reply = "Couldn't fetch the CSV — AusMaker API may be unavailable. Try again in a minute.";
            history.push({ role: 'assistant', content: reply });
            sessionStore.append(key, 'user', message);
            sessionStore.append(key, 'assistant', reply);
            return send(res, 200, JSON.stringify({ reply }));
          }
          const data = JSON.parse(res2.body || '{}');
          if (!data.success || !data.csv_content) {
            const reply = data.error || "No CSV data available. Run a low stock scan first to prime the cache.";
            history.push({ role: 'assistant', content: reply });
            sessionStore.append(key, 'user', message);
            sessionStore.append(key, 'assistant', reply);
            return send(res, 200, JSON.stringify({ reply }));
          }
          const reply = formatInventoryReply(data, 'inventory.csv.generate', DATA_DIR, message, route.opts || {});
          history.push({ role: 'assistant', content: reply });
          sessionStore.append(key, 'user', message);
          sessionStore.append(key, 'assistant', reply);
          try { const { logActivity } = require('./activityLog'); logActivity('action_router_run', { capability: route.capability, outcome: 'success', fastPath: true }); } catch (_) {}
          return send(res, 200, JSON.stringify({ reply }));
        } catch (e) {
          const reply = "Couldn't generate CSV: " + (e.message || 'Unknown error') + ". Try again in a minute.";
          history.push({ role: 'assistant', content: reply });
          sessionStore.append(key, 'user', message);
          sessionStore.append(key, 'assistant', reply);
          return send(res, 200, JSON.stringify({ reply }));
        }
      }
      if (route.actionType === 'run_capability' && route.capability) {
        const { capabilityAllowedForProfile } = require('./actionRouter');
        if (!capabilityAllowedForProfile(route.capability)) {
          const reply = "That's not something this deployment is set up for — I look after this business's tools here, not that domain.";
          history.push({ role: 'assistant', content: reply });
          sessionStore.append(key, 'user', message);
          sessionStore.append(key, 'assistant', reply);
          return send(res, 200, JSON.stringify({ reply, route: 'capability_out_of_scope' }));
        }
        const { PIKO_NATIVE_CAPABILITIES } = require('./actionRouter');
        if (PIKO_NATIVE_CAPABILITIES.includes(route.capability)) {
          if (route.capability === 'system.intents.manage') {
            if (isQueueReadQuery(message)) {
              const reply = formatQueueReadReply(loadIntents());
              history.push({ role: 'assistant', content: reply });
              sessionStore.append(key, 'user', message);
              sessionStore.append(key, 'assistant', reply);
              return send(res, 200, JSON.stringify({ reply }));
            }
            const { getPendingIntents, removeIntentById, findIntentsByDescriptions } = require('./intents');
            const { ollamaNativeChat } = require('./llm');
            const pending = getPendingIntents();
            if (pending.length === 0) {
              const reply = "Queue is already empty mate. Nothing to cancel.";
              history.push({ role: 'assistant', content: reply });
              sessionStore.append(key, 'user', message);
              sessionStore.append(key, 'assistant', reply);
              return send(res, 200, JSON.stringify({ reply }));
            }
            // Simplify so 3B model can fuzzy-match (e.g. "8am" → "08:00", "both" → multiple)
            const simplifiedIntents = pending.map((i) => {
              const task = (i.briefFields && i.briefFields.objective) || i.title || i.description || i.command || i.task || i.type || 'Task';
              return { id: i.id, task: `${String(task).slice(0, 60)} (${i.schedule || 'pending'})` };
            });
            const extractPrompt = `You are a strict data extraction assistant.
User Request to Cancel: "${String(message || '').slice(0, 500)}"

Current Active Tasks:
${JSON.stringify(simplifiedIntents, null, 2)}

RULES:
1. Match the user's request to the Active Tasks. The user will use natural language (e.g., "8am" instead of "08:00", "both" to mean multiple tasks).
2. Respond ONLY with a valid JSON object. It must contain exactly one key: "ids".
3. The value of "ids" must be an array of the matched "id" strings.

EXAMPLE OUTPUTS:
{"ids": ["intent_123_456", "intent_789_012"]}
{"ids": []}`;
            let idsToDelete = [];
            try {
              const extractModel = process.env.PIKO_ROUTER_MODEL || process.env.PIKO_CASUAL_MODEL || sessionModel;
              const raw = await ollamaNativeChat(extractModel, [{ role: 'user', content: extractPrompt }], {
                format: 'json',
                temperature: 0,
                max_tokens: 120,
              });
              console.log('[MANAGE INTENTS] LLM Raw Output:', raw || '(empty)');
              const cleaned = stripCodeFences(raw || '');
              const parsed = JSON.parse(cleaned);
              idsToDelete = Array.isArray(parsed.ids) ? parsed.ids : (parsed.idsToDelete || []);
              if (!Array.isArray(idsToDelete)) idsToDelete = [];
              const validIds = new Set(pending.map((i) => i.id));
              idsToDelete = idsToDelete.filter((id) => validIds.has(String(id)));
            } catch (e) {
              if (process.env.PIKO_LOG_PLANNER === '1') console.warn('[manage] LLM extraction failed:', e.message);
              const raw = stripCancelPrefix(String(message || '')).trim();
              const parts = splitLines(raw).flatMap((line) => line.split(',')).flatMap((p) => (() => { const low=toLowerAsciiish(p); const i=low.indexOf(' and '); return i>=0 ? [p.slice(0,i), p.slice(i+5)] : [p]; })()).map((p) => stripListMarker(p)).filter(Boolean);
              const descriptions = parts.length > 0 ? parts : [raw].filter(Boolean);
              const matches = findIntentsByDescriptions(descriptions);
              idsToDelete = matches.map((m) => m.id);
            }
            if (idsToDelete.length === 0) {
              const reply = "No matching schedules found. Ask \"what's in the queue?\" to see what's pending.";
              history.push({ role: 'assistant', content: reply });
              sessionStore.append(key, 'user', message);
              sessionStore.append(key, 'assistant', reply);
              return send(res, 200, JSON.stringify({ reply }));
            }
            const preview = idsToDelete.map((id) => {
              const i = pending.find((p) => p.id === id);
              const task = (i && ((i.briefFields && i.briefFields.objective) || i.title || i.description || i.command || i.task || i.type || 'Task')) || id;
              return `${String(task).slice(0, 50)} (${(i && i.schedule) || 'pending'})`;
            }).join('; ');
            const reply = `I'll cancel: ${preview}. Reply YES to confirm.`;
            pendingCancelConfirmations.set(key, { intentIds: idsToDelete, expiresAt: Date.now() + PENDING_CANCEL_TTL_MS });
            savePendingCancelConfirmations(pendingCancelConfirmations);
            history.push({ role: 'assistant', content: reply });
            sessionStore.append(key, 'user', message);
            sessionStore.append(key, 'assistant', reply);
            try {
              const { logActivity } = require('./activityLog');
              logActivity('action_router_run', { capability: route.capability, outcome: 'preview', pendingCount: idsToDelete.length });
            } catch (_) {}
            return send(res, 200, JSON.stringify({ reply }));
          }
          if (route.capability === 'ausmaker.business.health.review') {
            const { runBusinessHealthReview, formatBusinessHealthReply } = require('./proactive/analyst');
            const review = await runBusinessHealthReview(DATA_DIR, { forceAnalyze: true });
            const reply = formatBusinessHealthReply(review);
            history.push({ role: 'assistant', content: reply });
            sessionStore.append(key, 'user', message);
            sessionStore.append(key, 'assistant', reply);
            try {
              const { logActivity } = require('./activityLog');
              logActivity('action_router_run', { capability: route.capability, outcome: review.action });
            } catch (_) {}
            return send(res, 200, JSON.stringify({ reply }));
          }
          if (route.capability === 'web.research.run') {
            const { sovereignSearchAndSynthesize } = require('./sovereignSearch');
            const { fireProgressAck } = require('./frontDesk');
            const q = String(message || '').trim().slice(0, 500);
            if (!q) {
              const reply = 'What would you like me to search for?';
              history.push({ role: 'assistant', content: reply });
              sessionStore.append(key, 'user', message);
              sessionStore.append(key, 'assistant', reply);
              return send(res, 200, JSON.stringify({ reply }));
            }
            try {
              const progressAck = await fireProgressAck(
                { actionType: 'run_capability', capability: 'web.research.run' },
                message,
                { sessionId: key, reqSource },
              );
              const reply = await sovereignSearchAndSynthesize(q, message, sessionModel, { topN: 2 });
              history.push({ role: 'assistant', content: reply });
              sessionStore.append(key, 'user', message);
              sessionStore.append(key, 'assistant', reply);
              return send(res, 200, JSON.stringify({ reply, ...(progressAck ? { progressAck } : {}) }));
            } catch (e) {
              const reply = "Couldn't search the web: " + (e.message || 'Unknown error');
              history.push({ role: 'assistant', content: reply });
              sessionStore.append(key, 'user', message);
              sessionStore.append(key, 'assistant', reply);
              return send(res, 200, JSON.stringify({ reply }));
            }
          }
          if (route.capability === 'system.operations.read' || route.capability === 'system.intents.read') {
            // Phase 2: Template-only fast path — no LLM for queue/ops. Instant reply.
            try {
              const useTemplate = process.env.PIKO_FAST_QUEUE_TEMPLATE !== '0' && process.env.PIKO_FAST_QUEUE_TEMPLATE !== 'false';
              if (route.capability === 'system.operations.read') {
                const { loadOperations, formatOperationsForPrompt } = require('./operations');
                const ops = loadOperations();
                const formatted = formatOperationsForPrompt(ops);
                const reply = formatted
                  ? `Here's what's running: ${collapseWhitespace(formatted).trim()}.`
                  : "No background operations configured. Add knowledge/piko-operations.json if you want to track crons.";
                history.push({ role: 'assistant', content: reply });
                sessionStore.append(key, 'user', message);
                sessionStore.append(key, 'assistant', reply);
                try {
                  const { logActivity } = require('./activityLog');
                  logActivity('action_router_run', { capability: route.capability, outcome: 'success', fastPath: true });
                } catch (_) {}
                if (process.env.PIKO_LOG_PLANNER === '1') console.log('[FAST-PATH] system.operations.read — template');
                return send(res, 200, JSON.stringify({ reply }));
              }
              // system.intents.read
              const intents = loadIntents();
              const pending = intents.filter((i) => (i.status === 'pending' || !i.status));
              const cleanIntents = pending.map((i) => {
                const task = (i.briefFields && i.briefFields.objective) || i.title || i.description || i.command || i.task || i.type || 'Task';
                const schedule = i.schedule || (i.dueAt || i.time || i.run ? String(i.dueAt || i.time || i.run).slice(0, 16) : null) || 'Pending';
                return { task: String(task).slice(0, 60), schedule };
              });
              if (useTemplate) {
                let reply;
                if (cleanIntents.length === 0) {
                  reply = "Queue is empty mate. Nothing scheduled.";
                } else if (cleanIntents.length <= 5) {
                  const parts = cleanIntents.map((c) => `${c.task} (${c.schedule})`);
                  const list = parts.length === 1 ? parts[0] : parts.slice(0, -1).join(', ') + ' and ' + parts[parts.length - 1];
                  reply = `You've got ${parts.length} in the queue: ${list}. Let me know if you want to cancel any.`;
                } else {
                  const shown = cleanIntents.slice(0, 10);
                  const parts = shown.map((c) => `${c.task} (${c.schedule})`);
                  const more = cleanIntents.length - 10;
                  const list = parts.join('; ');
                  reply = `You've got ${cleanIntents.length} in the queue: ${list}${more > 0 ? ` … plus ${more} more.` : ''} Let me know if you want to cancel any.`;
                }
                history.push({ role: 'assistant', content: reply });
                sessionStore.append(key, 'user', message);
                sessionStore.append(key, 'assistant', reply);
                try {
                  const { logActivity } = require('./activityLog');
                  logActivity('action_router_run', { capability: route.capability, outcome: 'success', fastPath: true });
                } catch (_) {}
                if (process.env.PIKO_LOG_PLANNER === '1') console.log('[FAST-PATH] system.intents.read — template');
                return send(res, 200, JSON.stringify({ reply }));
              }
              const systemDataText = cleanIntents.length ? JSON.stringify(cleanIntents.slice(0, 15), null, 2) : 'The queue is currently empty.';
              const cancelHint = ' If there are items, just say "Let me know if you want me to cancel any of these." DO NOT list technical commands or IDs.';
              const leanSystemData = `[INTERNAL SYSTEM DATA]: The user is asking about their scheduled intents/queue. Here is the live data:\n\n${systemDataText}\n\nSynthesize a short, brotherly summary. Do not read the whole list verbatim if long.${cancelHint}`;
              const leanPersona = 'You are Piko, a friendly, dry-humoured mate. Reply briefly in character.';
              const leanMessages = [
                { role: 'system', content: leanPersona },
                { role: 'system', content: leanSystemData },
                { role: 'user', content: message },
              ];
              const fastModel = process.env.PIKO_CASUAL_MODEL || sessionModel;
              const rawReply = await ollamaChat(leanMessages, fastModel, { max_tokens: 150, temperature: 0.4 });
              const reply = (rawReply || 'Couldn\'t summarise that — try again in a moment.').trim().slice(0, 400);
              history.push({ role: 'assistant', content: reply });
              sessionStore.append(key, 'user', message);
              sessionStore.append(key, 'assistant', reply);
              try {
                const { logActivity } = require('./activityLog');
                logActivity('action_router_run', { capability: route.capability, outcome: 'success', fastPath: true });
              } catch (_) {}
              if (process.env.PIKO_LOG_PLANNER === '1') console.log('[FAST-PATH] system.intents.read — LLM fallback');
              return send(res, 200, JSON.stringify({ reply }));
            } catch (e) {
              console.error('[FAST-PATH]', route.capability, e.message);
              const fallback = "Tried to pull that data but hit a snag. Check the Optimus logs.";
              history.push({ role: 'assistant', content: fallback });
              sessionStore.append(key, 'user', message);
              sessionStore.append(key, 'assistant', fallback);
              return send(res, 200, JSON.stringify({ reply: fallback }));
            }
          }
        } else {
          const { isLegionFlowCapability, runLegionCapabilityFlow } = require('./frontDesk');
          if (isLegionFlowCapability(route.capability)) {
            const legionOut = await runLegionCapabilityFlow({
              route,
              message,
              sessionModel,
              dataDir: DATA_DIR,
              legionAdapterApiBase: LEGION_ADAPTER_API_BASE,
              reqSource,
              key,
            });
            const reply = legionOut.reply;
            history.push({ role: 'assistant', content: reply });
            sessionStore.append(key, 'user', message);
            sessionStore.append(key, 'assistant', reply);
            if (legionOut.ok) {
              try {
                const { logActivity } = require('./activityLog');
                logActivity('action_router_run', { capability: route.capability, runId: legionOut.runId, outcome: 'success' });
              } catch (err) { void err; }
            }
            return send(res, 200, JSON.stringify({
              reply,
              route: legionOut.needs_confirm
                ? 'money_confirm_required'
                : (legionOut.ok ? 'legion_capability' : 'legion_adapter_error'),
              ...(legionOut.needs_confirm ? { error: 'money_confirm_required', needs_confirm: true } : {}),
              ...(legionOut.progressAck ? { progressAck: legionOut.progressAck } : {}),
            }));
          }
        }
      }

      if (route.actionType === 'create_intent' && route.schedule && route.objective) {
        const normalizedSchedule = normalizeSchedule(route.schedule);
        const nextDue = nextDueFromSchedule(normalizedSchedule, new Date());
        if (!nextDue) {
          const fallback = `Couldn't parse schedule "${route.schedule}". Use \`/legion schedule daily 09:00 ${route.objective.slice(0, 40)}\` for daily tasks.`;
          history.push({ role: 'assistant', content: fallback });
          sessionStore.append(key, 'user', message);
          sessionStore.append(key, 'assistant', fallback);
          return send(res, 200, JSON.stringify({ reply: fallback }));
        }
        const intents = loadIntents();
        const { formatTaskRef } = require('./legionTaskCreate');
        const existingSched = intents.find(
          (i) => i && i.type === 'legion_scheduled' && (i.status === 'pending' || !i.status) &&
            i.schedule === normalizedSchedule && (i.title === route.objective || (i.briefFields && i.briefFields.objective === route.objective)),
        );
        if (existingSched) {
          const reply = `Already set up — ${formatTaskRef(existingSched.task_id || existingSched.taskId)}: ${route.objective} ${normalizedSchedule}.`;
          history.push({ role: 'assistant', content: reply });
          sessionStore.append(key, 'user', message);
          sessionStore.append(key, 'assistant', reply);
          return send(res, 200, JSON.stringify({ reply }));
        }
        let schedOut;
        try {
          schedOut = createLegionScheduledWithTask({
            schedule: normalizedSchedule,
            title: route.objective,
            objective: route.objective,
            description: route.objective,
            dueAt: nextDue,
            mode: 'auto',
            source: reqSource,
            sessionId: key,
            _creationSource: 'action_router',
          });
        } catch (e) {
          const reply = `Couldn't schedule that: ${e.message || e}`;
          history.push({ role: 'assistant', content: reply });
          sessionStore.append(key, 'user', message);
          sessionStore.append(key, 'assistant', reply);
          return send(res, 200, JSON.stringify({ reply }));
        }
        try {
          const { logActivity } = require('./activityLog');
          logActivity('intent_created', {
            intentId: schedOut.intent.id,
            task_id: schedOut.task_id,
            type: 'legion_scheduled',
            objective: route.objective,
            schedule: normalizedSchedule,
            source: 'action_router',
          });
        } catch (_) {}
        const reply = `Done — ${formatTaskRef(schedOut.task_id)} scheduled: ${route.objective} ${normalizedSchedule}. Reference this as ${formatTaskRef(schedOut.task_id)} in chat.`;
        history.push({ role: 'assistant', content: reply });
        sessionStore.append(key, 'user', message);
        sessionStore.append(key, 'assistant', reply);
        return send(res, 200, JSON.stringify({ reply }));
      }

      if (route.actionType === 'create_tripwire' && route.sku && route.operator != null && route.value != null) {
        const { addTripwire } = require('./tripwireEngine');
        const sku = String(route.sku || '').trim();
        const field = String(route.field || 'stock').toLowerCase();
        const op = String(route.operator).trim();
        const val = parseFloat(route.value);
        if (!sku || isNaN(val)) {
          const fallback = "I need a SKU and a numeric value to set a tripwire. Try: \"Set a tripwire for METALCLIP-2.2 if stock drops below 25\".";
          history.push({ role: 'assistant', content: fallback });
          sessionStore.append(key, 'user', message);
          sessionStore.append(key, 'assistant', fallback);
          return send(res, 200, JSON.stringify({ reply: fallback }));
        }
        addTripwire(sku, field, op, val);
        const reply = `Tripwire set! I will alert you if the ${field} for ${sku} goes ${op} ${val}.`;
        history.push({ role: 'assistant', content: reply });
        sessionStore.append(key, 'user', message);
        sessionStore.append(key, 'assistant', reply);
        return send(res, 200, JSON.stringify({ reply }));
      }

      if (route.actionType === 'create_digest_schedule' && route.time) {
        const { addSummarySchedule } = require('./tripwireEngine');
        addSummarySchedule(route.time);
        const reply = `Got it. I will compile and send the Product Change Summary every day at ${route.time}.`;
        history.push({ role: 'assistant', content: reply });
        sessionStore.append(key, 'user', message);
        sessionStore.append(key, 'assistant', reply);
        return send(res, 200, JSON.stringify({ reply }));
      }

      if (route.actionType === 'stock_on_hand_get' && route.sku) {
        const { getStockOnHand, formatStockOnHandReply } = require('./inventoryStockOnHand');
        try {
          const result = await getStockOnHand(route.sku, { ausmakerBase: AUSMAKER_BASE_URL, dataDir: DATA_DIR });
          const reply = formatStockOnHandReply(result);
          history.push({ role: 'assistant', content: reply });
          sessionStore.append(key, 'user', message);
          sessionStore.append(key, 'assistant', reply);
          return send(res, 200, JSON.stringify({ reply }));
        } catch (e) {
          const reply = "Couldn't look up stock on hand: " + (e.message || 'Unknown error');
          history.push({ role: 'assistant', content: reply });
          sessionStore.append(key, 'user', message);
          sessionStore.append(key, 'assistant', reply);
          return send(res, 200, JSON.stringify({ reply }));
        }
      }

      if (route.actionType === 'forecast_get' && route.sku) {
        const { getUrl } = require('./legionRunPoller');
        const sku = String(route.sku || '').trim();
        const url = `${stripTrailingSlash(AUSMAKER_BASE_URL)}/api/forecast/summary?sku=${encodeURIComponent(sku)}`;
        try {
          const getRes = await getUrl(url);
          if (getRes.statusCode !== 200) {
            const reply = "Forecast API unavailable. Try again in a minute.";
            history.push({ role: 'assistant', content: reply });
            sessionStore.append(key, 'user', message);
            sessionStore.append(key, 'assistant', reply);
            return send(res, 200, JSON.stringify({ reply }));
          }
          const data = JSON.parse(getRes.body || '{}');
          const months = (data.months || []).map((m) => `${m.year_month}: ${m.qty} (${m.source})`).join(', ');
          const reply = `Forecast for ${sku}: daily run rate ${data.daily_run_rate || 0}. Next months: ${months || 'none'}.`;
          history.push({ role: 'assistant', content: reply });
          sessionStore.append(key, 'user', message);
          sessionStore.append(key, 'assistant', reply);
          return send(res, 200, JSON.stringify({ reply }));
        } catch (e) {
          const reply = "Couldn't fetch forecast: " + (e.message || 'Unknown error');
          history.push({ role: 'assistant', content: reply });
          sessionStore.append(key, 'user', message);
          sessionStore.append(key, 'assistant', reply);
          return send(res, 200, JSON.stringify({ reply }));
        }
      }

      if (route.actionType === 'forecast_override_set' && route.sku && route.year_month && route.qty != null) {
        const { postJson } = require('./legionRunPoller');
        const url = `${stripTrailingSlash(AUSMAKER_BASE_URL)}/api/forecast/override`;
        try {
          const postRes = await postJson(url, { sku: route.sku, year_month: route.year_month, override_qty: route.qty });
          if (postRes.statusCode < 200 || postRes.statusCode >= 300) {
            const reply = "Override failed. " + (JSON.parse(postRes.body || '{}').error || postRes.body || '').slice(0, 80);
            history.push({ role: 'assistant', content: reply });
            sessionStore.append(key, 'user', message);
            sessionStore.append(key, 'assistant', reply);
            return send(res, 200, JSON.stringify({ reply }));
          }
          const reply = `Override applied. ${route.sku} is now set to ${route.qty} units for ${route.year_month}.`;
          history.push({ role: 'assistant', content: reply });
          sessionStore.append(key, 'user', message);
          sessionStore.append(key, 'assistant', reply);
          return send(res, 200, JSON.stringify({ reply }));
        } catch (e) {
          const reply = "Couldn't set override: " + (e.message || 'Unknown error');
          history.push({ role: 'assistant', content: reply });
          sessionStore.append(key, 'user', message);
          sessionStore.append(key, 'assistant', reply);
          return send(res, 200, JSON.stringify({ reply }));
        }
      }

      if (route.actionType === 'sales_summary_get') {
        const { getUrl } = require('./legionRunPoller');
        const { runSalesSummaryReply } = require('./salesSummary');
        try {
          const { reply } = await runSalesSummaryReply({
            getUrl,
            baseUrl: AUSMAKER_BASE_URL,
            route,
            message,
            recentTurns: recentTurnsForPlan,
          });
          history.push({ role: 'assistant', content: reply });
          sessionStore.append(key, 'user', message);
          sessionStore.append(key, 'assistant', reply);
          return send(res, 200, JSON.stringify({ reply }));
        } catch (e) {
          const reply = "Couldn't fetch sales: " + (e.message || 'Unknown error');
          history.push({ role: 'assistant', content: reply });
          sessionStore.append(key, 'user', message);
          sessionStore.append(key, 'assistant', reply);
          return send(res, 200, JSON.stringify({ reply }));
        }
      }

      if (route.actionType === 'memory_core_update' && route.preference) {
        const { appendToDataSoul } = require('./vectorMemory');
        appendToDataSoul(route.preference);
        const reply = `Preference saved to Core Truths: "${route.preference.slice(0, 80)}${route.preference.length > 80 ? '…' : ''}".`;
        history.push({ role: 'assistant', content: reply });
        sessionStore.append(key, 'user', message);
        sessionStore.append(key, 'assistant', reply);
        return send(res, 200, JSON.stringify({ reply }));
      }

      if (route.actionType === 'memory_subconscious_search' && route.query) {
        const vectorMemory = require('./vectorMemory');
        try {
          const hits = await vectorMemory.search(route.query, { limit: 5 });
          const reply = hits.length === 0
            ? 'No relevant past context found.'
            : 'Past context:\n' + hits.map((h, i) => `${i + 1}. ${h.text}`).join('\n');
          history.push({ role: 'assistant', content: reply });
          sessionStore.append(key, 'user', message);
          sessionStore.append(key, 'assistant', reply);
          return send(res, 200, JSON.stringify({ reply }));
        } catch (e) {
          const reply = "Couldn't search memory: " + (e.message || 'Unknown error');
          history.push({ role: 'assistant', content: reply });
          sessionStore.append(key, 'user', message);
          sessionStore.append(key, 'assistant', reply);
          return send(res, 200, JSON.stringify({ reply }));
        }
      }

      if (route.actionType === 'web_research_run' && route.query) {
        const { sovereignSearchAndSynthesize } = require('./sovereignSearch');
        try {
          const reply = await sovereignSearchAndSynthesize(route.query, message, sessionModel, { topN: 2 });
          history.push({ role: 'assistant', content: reply });
          sessionStore.append(key, 'user', message);
          sessionStore.append(key, 'assistant', reply);
          return send(res, 200, JSON.stringify({ reply }));
        } catch (e) {
          const reply = "Couldn't search the web: " + (e.message || 'Unknown error');
          history.push({ role: 'assistant', content: reply });
          sessionStore.append(key, 'user', message);
          sessionStore.append(key, 'assistant', reply);
          return send(res, 200, JSON.stringify({ reply }));
        }
      }

      if (route.actionType === 'create_reminder' && route.dueAt && route.objective) {
        const at = new Date(route.dueAt);
        if (isNaN(at.getTime())) {
          const fallback = "Couldn't parse the time. Use `/remind 17:00 <text>` for reminders.";
          history.push({ role: 'assistant', content: fallback });
          sessionStore.append(key, 'user', message);
          sessionStore.append(key, 'assistant', fallback);
          return send(res, 200, JSON.stringify({ reply: fallback }));
        }
        createIntent({
          type: 'reminder',
          title: route.objective,
          dueAt: at.toISOString(),
          source: reqSource,
          sessionId: key,
          _creationSource: 'action_router',
        });
        const reply = `Reminder set — ${route.objective} at ${at.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}.`;
        history.push({ role: 'assistant', content: reply });
        sessionStore.append(key, 'user', message);
        sessionStore.append(key, 'assistant', reply);
        return send(res, 200, JSON.stringify({ reply }));
      }

      // When actionType === 'none', fall through to normal chat so the main LLM can answer
      }
      } catch (e) {
      console.error('[action-router]', e.message);
      const fallback = "Hit a snag routing that. Try a slash command: `/legion schedule daily 09:00 low stock scan`.";
      history.push({ role: 'assistant', content: fallback });
      sessionStore.append(key, 'user', message);
      sessionStore.append(key, 'assistant', fallback);
      return send(res, 200, JSON.stringify({ reply: fallback }));
      }
    }
  }
  } // end !legateChatActive (actionRouter / circuits)

  // —— SCAN FOLLOW-UP (AusMaker): only when Legate chat is off — EI must not short-circuit.
  if (!legateChatActive) {
  const lastAssistantForFollowup = [...history].slice(0, -1).reverse().find((m) => m.role === 'assistant' && m.content);
  const lastContent = lastAssistantForFollowup ? String(lastAssistantForFollowup.content || '') : '';
  const msgLow = toLowerAsciiish(message);
  const howManyMatch = includesAny(msgLow, ['how many', "what's the count", "what's the total count", 'whats the count', 'how many items', 'how many skus']);
  const hasScanResult = includesAny(lastContent, ['need reorder', 'ordered', 'need review', 'SKUs checked']);
  if (howManyMatch && hasScanResult) {
    const countBefore = (hay, phrase) => {
      const idx = hay.indexOf(phrase);
      if (idx < 0) return null;
      let i = idx - 1;
      while (i >= 0 && hay[i] === ' ') i -= 1;
      let num = '';
      while (i >= 0 && isAsciiDigit(hay[i])) {
        num = hay[i] + num;
        i -= 1;
      }
      return num || null;
    };
    const needReorder = countBefore(lastContent, 'need reorder');
    const ordered = countBefore(lastContent, 'ordered');
    const needReview = countBefore(lastContent, 'need review');
    const skusChecked = countBefore(lastContent, 'SKUs checked');
    let reply = null;
    if (msgLow.includes('reorder') && needReorder) reply = `${needReorder} items need reorder.`;
    else if ((msgLow.includes('ordered') || msgLow.includes('awaiting delivery')) && ordered) reply = `${ordered} items ordered (awaiting delivery).`;
    else if (msgLow.includes('review') && needReview) reply = `${needReview} items need review.`;
    else if (needReorder) reply = `${needReorder} items need reorder.`;
    else if (skusChecked) reply = `${skusChecked} SKUs were checked.`;
    if (reply) {
      history.push({ role: 'assistant', content: reply });
      sessionStore.append(key, 'user', message);
      sessionStore.append(key, 'assistant', reply);
      return send(res, 200, JSON.stringify({ reply }));
    }
  }
  }

  // —— RECALL: "What did you do today?" — read activity log, summarize in Piko's voice ——
  if (plan.recallRequested) {
    try {
      const { readRecentActivity } = require('./activityLog');
      const recent = readRecentActivity(50);
      const todayStart = new Date();
      todayStart.setHours(0, 0, 0, 0);
      const todayEntries = recent.filter((e) => e.ts && new Date(e.ts) >= todayStart);
      const entries = includesAny(toLowerAsciiish(message), ['today', 'this morning', 'this afternoon']) ? todayEntries : recent;
      if (entries.length === 0) {
        const reply = "No entries in my activity log yet — nothing scheduled or fired. Once you set up reminders or Legion tasks, I'll have a record.";
        history.push({ role: 'assistant', content: reply });
        sessionStore.append(key, 'user', message);
        sessionStore.append(key, 'assistant', reply);
        return send(res, 200, JSON.stringify({ reply }));
      }
      const activityLines = entries.map((e) => {
        const action = e.action === 'intent_created' ? 'created' : e.action === 'intent_fired' ? 'fired' : e.action;
        const obj = e.objective || e.title || '';
        const sched = e.schedule ? ` (${e.schedule})` : '';
        const out = e.outcome === 'failed' ? ' [failed]' : '';
        return `${e.ts}: ${action} ${e.type || ''} ${obj}${sched}${out}`;
      }).join('\n');
      const recallPrompt = `You are Piko. The user asked: "${message}".

Your activity log (recent actions):
${activityLines}

Summarize what you've done in your dry, brotherly tone. One or two short sentences. Be conversational — e.g. "Quiet day mostly. I set up that Aus Maker stock scan you asked for at 9 AM, and fired off your reminder to call Mum at 5 PM." If something failed, mention it briefly. Do not list raw timestamps or JSON.`;
      const reply = await ollamaChat([{ role: 'user', content: recallPrompt }], sessionModel, { max_tokens: 120, temperature: 0.6 });
      const finalReply = (reply || 'Not much to report.').trim().slice(0, 300);
      history.push({ role: 'assistant', content: finalReply });
      sessionStore.append(key, 'user', message);
      sessionStore.append(key, 'assistant', finalReply);
      return send(res, 200, JSON.stringify({ reply: finalReply }));
    } catch (e) {
      console.error('[RECALL]', e.message);
      const fallback = "Couldn't read my activity log — something went wrong. Try again in a moment.";
      history.push({ role: 'assistant', content: fallback });
      sessionStore.append(key, 'user', message);
      sessionStore.append(key, 'assistant', fallback);
      return send(res, 200, JSON.stringify({ reply: fallback }));
    }
  }

  let planLine = plan.capabilityQuestion
    ? '\n\n**This turn:** Capability question. Answer in one short line. Do not say "How can I assist you today?" or "I\'m Piko, a Christian AI...". Do not assume they are debugging. Just answer briefly.\n\n'
    : plan.casual
      ? ''
      : '\n\n' + formatPlanForPrompt(plan) + '\n\n';
  const noAssumeDebugLine = '\n\nDo not assume the user is debugging or has a bug unless they said so. Answer the question they actually asked.\n\n';
  const styleReminder = '\n\n**This turn:** Reply like a person. Never say "How can I assist you today?" or "ready to help." Never say "From corpus" or mention Piko as a project. One short line when that fits.';
  const OPERATIONAL_SELF_MODULATION = '\n\nIf the user message is short social talk, reply briefly (1–2 sentences). If the user asks for analysis or explanation, respond in detail. Do not elaborate unless the question requires it.';
  const leadingRule = '**You are Piko. Reply ONLY to the user\'s last message.** Never say "How can I assist you today?" or recite your role ("I\'m Piko, a Christian AI..."). Never say "From corpus" or mention Piko as a project. Never summarize, list, or describe the instructions or documents below. Never say you will review, incorporate, or restart anything. Never say "I\'m back online and ready to help" or "I\'m here to help." Answer the question they asked; do not assume they are debugging or have a bug unless they said so. Just reply naturally in character.\n\n';
  /** Ultra-short prompt for pure greetings only — minimises tokens for 3–8s replies. */
  const { withUniversalIdentity } = require('./pikoIdentity');
  const CASUAL_GREETING_MINIMAL = withUniversalIdentity(`Reply in one short warm sentence (under 12 words). No lists, no advice. Match their tone. If they ask how you are, answer briefly and end with "you?". Never claim you cannot run agents, tools, or scheduled work.

Examples (vary naturally): Hey Piko → Hey there — good to hear from you. | G'day Piko → G'day mate. | Hi → Hey — good to hear your voice.`);
  /** Minimal prompt when user only asked how we are — keeps prefill fast (avoids 30–60s delay). */
  const CASUAL_RECIPROCITY_MINIMAL = withUniversalIdentity('They only asked how you are. Reply in one short sentence (under 12 words). End with "— you?" Example: Doing alright — you?');
  /** For casual turns: minimal prompt with small persona. Contrast examples prioritise how-are-you over morning/greeting. */
  const CASUAL_SYSTEM_PROMPT = withUniversalIdentity(`Your tone is grounded, dry, concise, and highly competent. You speak like a trusted brother or sharp colleague.

CRITICAL TONE RULES:
1. NEVER use corporate AI clichés ("How can I assist you today?", "I am happy to help!").
2. DO NOT overact or force slang to sound casual. Speak in plain, normal English.
3. NEVER ask open-ended pleasantries (e.g., "What's news?", "How are you doing?"). If the user just says "Hi", acknowledge them briefly and wait for their command.
4. NEVER repeat or echo the user's exact words back as your reply.
5. Keep your responses as brief as possible while remaining polite.
6. If they ask whether you can deploy agents or run tools, answer truthfully from SYSTEM IDENTITY — never pretend you are only a chat mate.

EXAMPLES OF YOUR TONE:
User: "Ok, hi Piko."
You: "Hey mate. What's on?"

User: "How are you going?"
You: "Not bad — you?"

User: "It's going good. How about yourself?"
You: "Pretty good too — same boat."

User: "Morning."
You: "Morning — coffee on?"

User: "I had a rough day."
You: "Sorry to hear — you okay?"

User: "What do you think about coffee?"
You: "Love it — can't function without. You?"`);
  /** User only asked how we are (no statement of their own). Used for prompt selection and safety net. */
  function onlyAskedHowAreYou(msg) {
    if (!msg || typeof msg !== 'string') return false;
    const u = toLowerAsciiish(msg).trim();
    const hasQ = msg.includes('?') || msg.includes('？');
    if (!hasQ) return false;
    const howAsk = includesAny(u, [
      'how are you', 'how is you', 'how are things', 'how is things', 'how is it',
      'how are it', 'hows it', "how's it", 'hows things', "how's things",
      'hows ya', "how's ya", 'hows you', "how's you", 'how you doing',
      'you doing ok', 'how about you', 'what about you', 'how about yourself', 'what about yourself',
      'how is it going', 'how are things going',
    ]);
    if (!howAsk) return false;
    if (includesAny(u, ["i'm", 'i am', 'doing', 'good', 'well', 'fine', 'alright', 'ok', 'not bad', 'great', 'busy'])) {
      // allow if those words only appear in the question phrasing - keep simple: reject if stated
      if (includesAny(u, ["i'm ", 'i am ', "i'm,", 'i am,'])) return false;
    }
    return true;
  }
  const SOCIAL_CHAT_SYSTEM_PROMPT = withUniversalIdentity(`This is a normal social conversation turn (not deep worldview content).

Rules:
- Reply naturally in 1-2 short sentences.
- Keep it conversational and context-aware to the most recent exchange.
- If the user invites chat, accept directly and continue naturally.
- No theology/worldview themes unless the user explicitly asks for them.
- No reflective slogans, metaphors, or abstract framing.
- Avoid stock resets like "Hey — what's up?" when they already opened the topic.
- If they ask about capabilities, agents, schedules, or tools, answer honestly from SYSTEM IDENTITY (you can orchestrate agents and jobs). Do not deny that ability.

Good examples:
User: Good, good. I'm just doing some work. Want to chat for a while?
You: Yeah, happy to chat — what's on your mind?

User: Keen for a yarn?
You: For sure — what do you feel like talking about?`);
  let systemContent;
  if (plan.casual) {
    if (plan.casualMode === 'GREETING' && process.env.PIKO_CASUAL_FAST_GREETING !== '0')
      systemContent = CASUAL_GREETING_MINIMAL;
    else if (plan.casualMode === 'RECIPROCITY' && onlyAskedHowAreYou(message))
      systemContent = CASUAL_RECIPROCITY_MINIMAL;
    else
      systemContent = CASUAL_SYSTEM_PROMPT;
  } else if (plan.socialChat) {
    systemContent = SOCIAL_CHAT_SYSTEM_PROMPT;
  } else {
    /** Full path only: load corpus, truth, memory, beliefs — not needed for casual/socialChat. */
    const mind = loadMind();
    const primaryHuman = (mind.self_model.identity && mind.self_model.identity.primary_human) || process.env.PIKO_PRIMARY_HUMAN || '';
    const userBeliefs = memory.getUserBeliefs();
    const fullPlan = createResponsePlan({
      userBeliefs,
      mind,
      userMessage: message,
      recentEpisodic: memory.getEpisodic().slice(-3),
      recentTurns: recentTurnsForPlan,
    });
    planLine = fullPlan.capabilityQuestion
      ? '\n\n**This turn:** Capability question. Answer in one short line. Do not say "How can I assist you today?" or "I\'m Piko, a Christian AI...". Do not assume they are debugging. Just answer briefly.\n\n'
      : '\n\n' + formatPlanForPrompt(fullPlan) + '\n\n';
    const corpusBlock = getCorpusBlockForPrompt(primaryHuman);
    const knowledgeBaseBlock = getKnowledgeBaseBlockForPrompt(message);
    const truthBlock = getTruthBlockForPrompt();
    let gmailContext = '';
    try {
      const { getGmailContextBlock } = require('./gmailContext');
      gmailContext = await getGmailContextBlock();
    } catch (_) {}
    const learningRequested = requestsLearningUpdate(message);
    const learningInjectEnabled = process.env.PIKO_LEARNING_CHAT_INJECT !== '0' && learningRequested;
    let ragContext = learningInjectEnabled ? getRagContext(message) : '';
    // Culture spines: always try corpus RAG + notes for research questions.
    try {
      if (TENANT_BG && TENANT_BG.isCulture) {
        const extra = await getRagContextAsync(message);
        if (extra) ragContext = [ragContext, extra].filter(Boolean).join('\n\n');
      }
    } catch (_) { /* optional */ }
    let campaignStateBlock = '';
    try {
      if (TENANT_BG && TENANT_BG.isCulture && !legateOmitCampaignState) {
        const { buildCampaignStateBlock } = require('./legateTools');
        campaignStateBlock = buildCampaignStateBlock();
        if (campaignStateBlock) {
          campaignStateBlock = `\n\n${campaignStateBlock}\n(Use these numbers when the operator asks about campaign/research progress. Do not invent progress.)\n`;
        }
      }
    } catch (_) { /* optional */ }
    const recentLearningBlock = learningInjectEnabled ? getRecentLearningBlock() : '';
    const stickyIdeasBlock = learningInjectEnabled ? getStickyIdeasBlock() : '';
    const memoryBlock = memory.getMemoryBlockForPrompt(8, 3);
    const dataSoulBlock = loadDataSoul() ? loadDataSoul() + '\n\n' : '';
    let baseContent = leadingRule + OPERATIONAL_SELF_MODULATION + dataSoulBlock + corpusBlock + knowledgeBaseBlock + truthBlock + memoryBlock + planLine + noAssumeDebugLine + (() => { try { const { getImpactBlockForPrompt } = require('./impact'); return getImpactBlockForPrompt(); } catch (_) { return ''; } })() + SYSTEM_PROMPT + campaignStateBlock + recentLearningBlock + stickyIdeasBlock + (learningInjectEnabled ? getAndConsumePendingQuestionBlock() : '')
      + getDailyMemoryBlock(key)
      + gmailContext
      + ragContext
      + (learningInjectEnabled ? '\n\nOccasionally, when it fits the conversation, ask the user a genuine question drawn from your recent learning or from the themes you keep returning to—so they can share their perspective. Do not do this every message; only when natural.' : '')
      + (process.env.PIKO_CONTROLLED_DIVERGENCE === '1' || process.env.PIKO_CONTROLLED_DIVERGENCE === 'true' ? '\n\n' + (process.env.PIKO_DIVERGENCE_PROMPT || 'Occasionally offer a different angle or gently challenge an assumption when it fits; do not simply echo the user.') : '')
      + styleReminder;
    if (fullPlan.deepReasoning) {
      baseContent += '\n\n**This turn: deep reasoning.** The user has asked a question that deserves thoughtful consideration. Think step by step before answering. Take your time. Do not say "Let me think" or "Hmm" in your reply — the user has already been told you are thinking. Provide a considered, substantive answer.';
    }
    systemContent = withUniversalIdentity(baseContent);
  }
  const META_SLIP_PHRASES = [
    "i see you've edited", "i'll review the changes", "i'm back online and ready to help",
    "it's great to be back online", "i'll restart the bot", 'persona document to refine', "what's on your mind today", 'whats on your mind today',
  ];
  const HERE_TO_HELP_PHRASES = ["i'm here to help"];
  const EVASIVE_PHRASES = ['could you clarify', "i'm not sure what you mean by"];
  /** User explicitly invited conversation — use conversational fallback instead of generic "Hey — what's up?" when we strip meta slips. */
  const INVITATION_TO_CHAT_PHRASES = [
    'want to chat', 'want to talk', 'want to have a chat', 'up for a chat', 'feel like chatting',
    'chat for a while', 'shoot the breeze', 'hang out',
  ];
  const INVITATION_FALLBACKS = ["Sure — what's on your mind?", "Yeah, happy to chat — what's up?", "Cool — what do you want to talk about?"];
  /** Stray learning echo: model appends a sentence that sounds like rabbit-hole content without the user asking. */
  function isStrayLearningEcho(text) {
    const t = String(text || '');
    const lines = splitLines(t);
    const last = (lines[lines.length - 1] || '').trim();
    const low = toLowerAsciiish(last);
    return low.startsWith('their ') && includesAny(low, ['advanced', 'sophisticated', 'interesting']) && low.includes('for their time');
  }
  const PERSONAL_LIFE_ASK_PHRASES = [
    'talk about my personal life', 'talk about personal life', 'talk about my life', 'talk about life',
    "how i'm doing", 'how im doing', "how i'm feeling", 'how im feeling',
  ];
  const CODING_IN_REPLY_PHRASES = [
    'code', 'coding', 'tech', 'technology', 'ethical considerations', 'debug', 'programming',
    'integrate', 'integration', 'efficiency',
  ];
  const STILTED_STOCK_PHRASES = [
    'that settles it', "g'day — you", 'gday — you', 'morning mate', 'anything new',
    'same old', "how're things", 'hows it rolling', "how's it rolling",
  ];
  const MODE_FALLBACKS = {
    GREETING: [
      "Hey there — good to hear from you.",
      "G'day — nice to hear from you.",
      "Hey — good to hear your voice.",
    ],
    RECIPROCITY: [
      "Not bad — you?",
      "Pretty good — you?",
      "Doing alright — you?",
    ],
    ACK: [
      "Good to hear.",
      "Nice one.",
      "Glad to hear it.",
    ],
    SOCIAL_EMPATHY: [
      "Sorry you're feeling that — I'm with you.",
      "That sounds rough — thanks for sharing.",
      "I hear you — that sounds heavy.",
    ],
    LIGHT_OPINION: [
      "Fair shout — depends on the day.",
      "I rate it, honestly.",
      "Not my favourite, but I get the appeal.",
    ],
    SIGN_OFF: [
      "No worries — catch you soon.",
      "Cheers — talk soon.",
      "All good — see you.",
    ],
    CASUAL: [
      "Hey — good to hear from you.",
      "Good to hear from you.",
      "Nice one — good to hear from you.",
    ],
    SOCIAL_CHAT: [
      "Yeah, happy to chat — what's on your mind?",
      "For sure — what do you want to talk about?",
      "Absolutely — I'm here for a yarn.",
    ],
  };
  function pickDeterministic(items, seed, turnCount = 0) {
    if (!Array.isArray(items) || items.length === 0) return '';
    const s = String(seed || '');
    let h = 0;
    for (let i = 0; i < s.length; i += 1) h = (h + s.charCodeAt(i) * (i + 1)) >>> 0;
    const idx = (h + Number(turnCount || 0)) % items.length;
    return items[idx];
  }
  function applyModeFallback(userMsg, reply, planObj, ctx = {}) {
    if (!reply || typeof reply !== 'string') return reply;
    const text = reply.trim();
    if (!text) return reply;
    const words = collapseWhitespace(text).split(' ').filter(Boolean).filter(Boolean);
    const uniqueWords = new Set(words).size;
    const uniqueRatio = words.length > 0 ? (uniqueWords / words.length) : 1;
    const repetitive = words.length >= 5 && uniqueRatio < 0.5;
    const tooShortToBeUseful = words.length <= 1;
    const stilted = includesAny(toLowerAsciiish(text), STILTED_STOCK_PHRASES) || tooShortToBeUseful || repetitive;
    const seed = `${ctx.sessionId || 'default'}:${planObj.casualMode || (planObj.socialChat ? 'SOCIAL_CHAT' : 'GENERAL')}`;
    const turnCount = Number(ctx.turnCount || 0);
    if (planObj.socialChat) {
      if (stilted || text.length > 160) {
        metrics.conversation.fallbackApplied += 1;
        if (stilted) metrics.conversation.stiltedDetected += 1;
        return pickDeterministic(MODE_FALLBACKS.SOCIAL_CHAT, seed, turnCount);
      }
      return reply;
    }
    if (!planObj.casual) return reply;
    const userAskedQuestion = String(userMsg || '').includes('?');
    const mode = planObj.casualMode || 'CASUAL';
    let shouldFallback = stilted;
    if (mode === 'GREETING') {
      const greetingLike = includesAny(toLowerAsciiish(text), ['hey', 'hi', 'hello', "g'day", 'gday', 'good to hear', 'nice to hear', 'morning', 'yo', 'cheers', 'not bad', 'pretty good', 'doing alright']);
      if (!greetingLike) shouldFallback = true;
    }
    if (mode === 'RECIPROCITY') {
      const selfStatusLike = includesAny(toLowerAsciiish(text), ['not bad', 'pretty good', 'doing', 'all good', 'same here', 'same boat', 'busy', 'good']);
      const endsWithYou = toLowerAsciiish(text).trim().endsWith('you?') || toLowerAsciiish(text).trim().endsWith('you?.');
      if (onlyAskedHowAreYou(userMsg) && !endsWithYou) shouldFallback = true;
      else if (!selfStatusLike) shouldFallback = true;
    }
    if (mode === 'SIGN_OFF' && text.includes('?')) shouldFallback = true;
    if (mode === 'SOCIAL_EMPATHY' && !includesAny(toLowerAsciiish(text), ['sorry', 'rough', 'hear you', 'that sounds', 'tough', 'flat', 'with you', 'okay', 'ok'])) shouldFallback = true;
    if (mode === 'LIGHT_OPINION' && includesAny(toLowerAsciiish(text), ['morning mate', 'anything new', 'same old', "g'day", 'gday'])) shouldFallback = true;
    if (!userAskedQuestion && text.includes('?')) shouldFallback = true;
    if (!shouldFallback) return reply;
    metrics.conversation.fallbackApplied += 1;
    if (stilted) metrics.conversation.stiltedDetected += 1;
    const fallbackPool = (!userAskedQuestion && mode === 'RECIPROCITY')
      ? MODE_FALLBACKS.ACK
      : (MODE_FALLBACKS[mode] || MODE_FALLBACKS.CASUAL);
    if (mode === 'GREETING') return fallbackPool[Math.floor(Math.random() * fallbackPool.length)];
    return pickDeterministic(fallbackPool, seed, turnCount);
  }
  function stripMetaSlip(text, userMessage) {
    if (!text || typeof text !== 'string') return text;
    let fallback = "Hey — what's up?";
    if (userMessage && includesAny(toLowerAsciiish(userMessage), INVITATION_TO_CHAT_PHRASES)) {
      fallback = INVITATION_FALLBACKS[Math.floor(Math.random() * INVITATION_FALLBACKS.length)];
    }
    const low = toLowerAsciiish(text);
    if (includesAny(low, META_SLIP_PHRASES)) {
      if (process.env.PIKO_LOG_META_SLIP === '1') console.log('[META_SLIP] Replaced:', text.slice(0, 100), '→', fallback);
      return fallback;
    }
    if (includesAny(low, HERE_TO_HELP_PHRASES)) {
      if (process.env.PIKO_LOG_META_SLIP === '1') console.log('[META_SLIP] Replaced:', text.slice(0, 100), '→', fallback);
      return fallback;
    }
    if (includesAny(low, EVASIVE_PHRASES)) {
      if (process.env.PIKO_LOG_META_SLIP === '1') console.log('[META_SLIP] Replaced:', text.slice(0, 100), '→', fallback);
      return fallback;
    }
    const t = text.trim();
    if (t === "I'm Piko." || t === "I'm Piko") return "Piko.";
    if (isStrayLearningEcho(text)) {
      const lines = splitLines(text);
      lines.pop();
      const stray = lines.join('\\n').trim();
      if (stray.length > 0) return stray;
    }
    return text;
  }
  function fixPersonalLifeDeflection(userMsg, reply) {
    if (!reply || typeof reply !== 'string') return reply;
    if (!includesAny(toLowerAsciiish(userMsg), PERSONAL_LIFE_ASK_PHRASES)) return reply;
    if (!includesAny(toLowerAsciiish(reply), CODING_IN_REPLY_PHRASES)) return reply;
    return "Sure — what's on your mind?";
  }
  /** For casual: truncate at first theme injection (pondering, blend, tradition, theology attractors, etc.). */
  function stripCasualThemeBleed(text) {
    if (!text || typeof text !== 'string') return text;
    const phrases = [
      "though i've been", 'pondering', 'can we blend', 'tradition with innovation', 'old-new mix',
      'spill the tea on', 'forging your own path', 'breaking free from molds', 'what makes you unique',
      'big plans', 'grand visions', 'making do without', 'cut out for grand', 'how are things on your side',
      "how's your project", 'unique you', 'care to dive deeper', 'rainy day', 'rainy days', 'rainy morning',
      'quiet spot', 'quiet corner', 'spark ideas', 'sparking ideas', 'cozy spot', 'cozy corner',
      'clear the mind', 'sort thoughts', 'break free', 'authenticity', 'faith framing', 'corpus',
      'truth block', 'jot down', 'regrouping', 'overwhelming', 'productive', 'stimulating', 'wander',
      'flow', 'morning there', 'keeping dry as usual', 'how are things shaping up', 'stepping back',
      'anything new on that front',
    ];
    const low = toLowerAsciiish(text);
    let best = -1;
    for (const p of phrases) {
      const idx = low.indexOf(p);
      if (idx > 0 && (best < 0 || idx < best)) best = idx;
    }
    if (best > 0) {
      let before = text.slice(0, best).trim();
      while (before.length && (('—,').includes(before[before.length - 1]) || before.endsWith(' ') || before.endsWith(','))) {
        before = before.slice(0, -1).trim();
      }
      if (before.length > 0) return before;
    }
    return text;
  }
  /** For casual: if the model echoed the user's greeting, or defaulted to "G'day Piko" when user said something else, replace with fallback. */
  function fixEchoReply(userMsg, reply) {
    if (!reply || typeof reply !== 'string' || !userMsg) return reply;
    const norm = (s) => {
      let t = normalizeApostrophes(String(s || '').trim().toLowerCase());
      while (t.length && '.!?'.includes(t[t.length - 1])) t = t.slice(0, -1);
      return t.trim();
    };
    const u = norm(userMsg);
    const r = norm(reply);
    if (u.length > 0 && r === u) return "Hey — what's up?";
    if (u.length > 2 && r.startsWith(u) && r.length <= u.length + 5) return "Hey — what's up?";
    const rLow = toLowerAsciiish(reply).trim();
    if ((rLow.startsWith("g'day piko") || rLow.startsWith('gday piko')) && rLow.length < 20) {
      return "Hey — what's up?";
    }
    return reply;
  }
  /** For deep path: strip accidental "Hmm, let me think" etc. from model output — we already sent that as placeholder. */
  function stripDeepPlaceholderEcho(reply) {
    if (!reply || typeof reply !== 'string') return reply;
    const t = reply.trim();
    const low = toLowerAsciiish(t);
    for (const p of ['hmm, let me think', 'hmm let me think', 'hmm, thinking', 'give me a moment', 'thinking that through', 'hmm thinking']) {
      if (low.startsWith(p)) {
        let rest = t.slice(p.length).trim();
        while (rest.startsWith('.') || rest.startsWith('…') || rest.startsWith(' ')) rest = rest.slice(1).trim();
        return rest || reply;
      }
    }
    return reply;
  }
  /** "Same here" only makes sense when user stated their state. If user asked a "how are you" question (and didn't state theirs), replace with " — you?". */
  function fixSameHereWhenInvalid(userMsg, reply) {
    if (!reply || typeof reply !== 'string' || !userMsg) return reply;
    const u = toLowerAsciiish(userMsg).trim();
    if (!(userMsg.includes('?') || userMsg.includes('？'))) return reply;
    const howAreYou = includesAny(u, [
      'how are you', 'how is you', 'how are things', 'how is it', "how's it", 'hows it',
      "how's things", 'hows things', "how's ya", 'hows ya', "how's you", 'hows you',
      'how you doing', 'you doing ok', 'how is it going', 'how are things going',
    ]);
    if (!howAreYou) return reply;
    const userStatedState = includesAny(u, ["i'm ", 'i am ', 'doing ', 'good', 'well', 'fine', 'alright', 'not bad', 'great', 'busy']);
    if (userStatedState && includesAny(u, ["i'm", 'i am'])) return reply;
    const r = reply.trim();
    const rLow = toLowerAsciiish(r);
    if (rLow === 'same here' || rLow === 'same here.') {
      const fixed = 'Doing alright — you?';
      if (process.env.PIKO_LOG_SAME_HERE === '1') console.log('[same_here] Replaced (reply was only "same here"):', r, '→', fixed);
      return fixed;
    }
    if (rLow.endsWith('same here') || rLow.endsWith('same here.')) {
      let fixed = reply;
      const idx = toLowerAsciiish(reply).lastIndexOf('same here');
      if (idx >= 0) fixed = (reply.slice(0, idx) + ' — you?').trim();
      if (process.env.PIKO_LOG_SAME_HERE === '1') console.log('[same_here] Replaced (user asked, did not state):', reply.slice(0, 50), '→', fixed.slice(0, 50));
      return fixed;
    }
    return reply;
  }
  // Routing windows:
  // - casual: last 4 messages (2 exchanges) so Piko remembers context on acknowledgments (e.g. "Thanks" after supplier choice)
  // - socialChat: short continuity window for natural back-and-forth without full worldview stack
  // - full: normal conversation window
  const historyWindow = (plan.casual && plan.casualMode === 'GREETING') ? 0 : (plan.casual ? 4 : (plan.socialChat ? 4 : SLICE_HISTORY));
  const maxContextChars = parseInt(process.env.PIKO_MAX_CONTEXT_CHARS, 10) || 24000;
  let historyPart;
  if (historyWindow === 0) {
    historyPart = [];
  } else {
    const candidate = history.slice(-historyWindow);
    let finalHistory = [];
    let currentChars = systemContent.length;
    for (let i = candidate.length - 1; i >= 0; i--) {
      const msg = candidate[i];
      const msgLen = (msg.content || '').length + 80;
      // Always keep the most recent message (i === candidate.length - 1) even if it breaches the limit
      if (i !== candidate.length - 1 && currentChars + msgLen > maxContextChars) {
        if (process.env.PIKO_LOG_PLANNER === '1') console.log('[MEMORY] Context guillotine triggered; kept', finalHistory.length, 'recent messages');
        break;
      }
      finalHistory.unshift(msg);
      currentChars += msgLen;
    }
    historyPart = finalHistory.map(({ role, content }) => ({ role, content }));
  }
  const casualMaxTokens = plan.casual ? (plan.casualMode === 'GREETING' ? 24 : (plan.casualMode === 'RECIPROCITY' ? 28 : 32)) : 4000;
  const casualTemp = plan.casual ? (plan.casualMode === 'GREETING' ? 0.3 : 0.4) : 0.9;
  const socialChatOptions = plan.socialChat ? { max_tokens: 80, temperature: 0.72, repeat_penalty: 1.2, presence_penalty: 0.15, frequency_penalty: 0.1 } : null;
  const deepOptions = plan.deepReasoning ? { max_tokens: Math.min(2500, parseInt(process.env.PIKO_DEEP_MAX_TOKENS, 10) || 2500), temperature: 0.8, repeat_penalty: 1.15 } : null;
  const DEEP_PLACEHOLDERS = ["Hmm, let me think…", "Give me a moment…", "Thinking that through…"];
  const route = plan.casual ? 'casual' : (plan.socialChat ? 'socialChat' : (plan.deepReasoning ? 'deep' : 'full'));
  metrics.conversation.route[route] = (metrics.conversation.route[route] || 0) + 1;
  if (process.env.PIKO_LOG_CASUAL === '1' || process.env.PIKO_DEBUG_CASUAL === '1') {
    console.log('[CASUAL]', JSON.stringify({
      sessionId: (key || '').slice(0, 24),
      route,
      casual: plan.casual,
      socialChat: plan.socialChat,
      casualMode: plan.casualMode,
      reason: plan.reason,
      historyLen: historyPart.length,
      maxTokens: plan.casual ? casualMaxTokens : (plan.socialChat ? socialChatOptions.max_tokens : 4000),
      temperature: plan.casual ? casualTemp : (plan.socialChat ? socialChatOptions.temperature : 0.9),
      repeatPenalty: plan.casual ? 1.25 : (plan.socialChat ? socialChatOptions.repeat_penalty : 1.12),
    }));
  }
  const messages = [
    { role: 'system', content: systemContent },
    ...historyPart,
  ];
  let userContentForCasual = message;
  if (plan.casual && plan.casualMode === 'RECIPROCITY' && onlyAskedHowAreYou(message) && systemContent !== CASUAL_RECIPROCITY_MINIMAL) {
    messages[0].content = systemContent + '\n\n**This turn:** The user only asked how you are; they did not state their own state. End your reply with "— you?".';
  }
  if (plan.casual || plan.socialChat) messages.push({ role: 'user', content: userContentForCasual });
  let releaseChat = null;
  try {
    releaseChat = await acquireChatSlot();
  } catch (queueErr) {
    const busyReply = 'I am handling a few replies right now. Please retry in a moment.';
    const retryAfterSec = Math.max(1, Math.ceil(CHAT_QUEUE_WAIT_MS / 1000));
    if (queueErr && queueErr.code === 'chat_queue_full') {
      return send(res, 200, JSON.stringify({ reply: busyReply, busy: true, retryAfterSec }));
    }
    if (queueErr && queueErr.code === 'chat_queue_timeout') {
      return send(res, 200, JSON.stringify({ reply: busyReply, busy: true, retryAfterSec }));
    }
    return send(res, 200, JSON.stringify({ reply: busyReply, busy: true, retryAfterSec }));
  }
  const latencyStart = Date.now();
  let latencyFirstToken = null;
  function buildTimeoutFallbackReply() {
    return 'I hit a local model timeout just now. Please retry in a moment.';
  }
  try {
    if (streamReply) {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'Connection': 'keep-alive' });
      const streamOptions = plan.casual
        ? { max_tokens: casualMaxTokens, temperature: casualTemp, repeat_penalty: 1.25, presence_penalty: 0.2, frequency_penalty: 0.15, num_ctx: Number(process.env.PIKO_CASUAL_NUM_CTX) || 8192 }
        : (plan.socialChat ? socialChatOptions : (plan.deepReasoning ? deepOptions : {}));
      if (plan.deepReasoning) {
        const placeholder = DEEP_PLACEHOLDERS[Math.floor(Math.random() * DEEP_PLACEHOLDERS.length)];
        res.write('data: ' + JSON.stringify({ content: placeholder + ' ' }) + '\n\n');
      }
      const modelForStream = plan.deepReasoning
        ? (process.env.PIKO_HEAVY_MODEL || process.env.PIKO_LEGION_MODEL || sessionModel)
        : ((plan.casual && process.env.PIKO_CASUAL_MODEL) ? process.env.PIKO_CASUAL_MODEL : sessionModel);
      let reply = await ollamaChatStream(messages, (delta) => {
        if (latencyFirstToken === null) latencyFirstToken = Date.now();
        res.write('data: ' + JSON.stringify({ content: delta }) + '\n\n');
      }, modelForStream, streamOptions);
      const latencyTotal = Date.now() - latencyStart;
      log('info', 'latency', { stream: true, route, historyMessages: historyPart.length, timeToFirstTokenMs: latencyFirstToken != null ? latencyFirstToken - latencyStart : null, totalMs: latencyTotal }, req.requestId);
      if (process.env.PIKO_LOG_CONSOLE) console.log('[latency]', { route, historyMessages: historyPart.length, timeToFirstTokenMs: latencyFirstToken != null ? latencyFirstToken - latencyStart : null, totalMs: latencyTotal });
      if (plan.casual && process.env.PIKO_LOG_RAW_CASUAL === '1') {
        console.log('[RAW_CASUAL]', JSON.stringify({ msg: message?.slice(0, 50), reply: reply?.slice(0, 500) }));
      }
      reply = stripMetaSlip(reply, message);
      if (plan.deepReasoning) reply = stripDeepPlaceholderEcho(reply) || reply;
      reply = fixPersonalLifeDeflection(message, reply) || reply;
      if ((plan.casual || plan.socialChat) && reply) {
        const beforeBleedStrip = reply;
        reply = stripCasualThemeBleed(reply) || reply;
        if (beforeBleedStrip !== reply) metrics.conversation.bleedTrigger += 1;
        if (plan.casual) {
          reply = fixEchoReply(message, reply) || reply;
          reply = fixSameHereWhenInvalid(message, reply) || reply;
          const cleaned = splitLines(reply.trim()).filter(Boolean)[0] || '';
          // Sentence boundary: period+space+capital or end — avoid chopping decimals ($4.50), abbreviations (Mr.), URLs
          const sentences = splitSentencesSimple(cleaned);
          const firstSentence = (sentences ? sentences[0] : cleaned).trim();
          if (firstSentence.length > 0) {
            reply = firstSentence;
            if (!endsWithAny(reply, ['.', '!', '?'])) reply = reply + '.';
          }
        } else if (plan.socialChat) {
          reply = fixSameHereWhenInvalid(message, reply) || reply;
          const cleaned = splitLines(reply.trim()).filter(Boolean)[0] || '';
          const sentences = splitSentencesSimple(cleaned).slice(0, 2);
          if (sentences.length > 0) reply = sentences.join(' ').trim();
          if (!endsWithAny(reply, ['.', '!', '?'])) reply = reply + '.';
        }
        reply = applyModeFallback(message, reply, plan, { sessionId: key, turnCount: history.length }) || reply;
        if (includesAny(toLowerAsciiish((reply || '').trim()), ["hey — what's up", "hey - what's up", 'hey — whats up', 'hey - whats up'])) metrics.conversation.resetTrigger += 1;
      }
      reply = enforceReplyConstraints(reply, {
        maxWords: wordLimit,
        maxSentences: sentenceLimit,
        noQuestion: noQuestionRequested,
      }) || reply;
      history.push({ role: 'assistant', content: reply });
      sessionStore.append(key, 'user', message);
      sessionStore.append(key, 'assistant', reply);
      if (process.env.PIKO_DAILY_MEMORY_ENABLED === '1' || process.env.PIKO_DAILY_MEMORY_ENABLED === 'true') {
        try {
          const dm = require('./dailyMemory');
          dm.append(key, 'user', message);
          dm.append(key, 'assistant', reply);
        } catch (_) {}
      }
      const lastExchange = history.slice(-2);
      setImmediate(() => updateMind(lastExchange).catch(() => {}));
      setImmediate(() =>
        beliefLoop.ingestRecentExperience(key).then(() => beliefLoop.applyBehaviourSignals(key, message, reply)).catch(() => {})
      );
      res.write('data: ' + JSON.stringify({ done: true, reply: require('./operatorVoice').polishOutbound(reply) }) + '\n\n');
      res.end();
      return;
    }
    const chatOptions = plan.casual
      ? { max_tokens: casualMaxTokens, temperature: casualTemp, repeat_penalty: 1.25, presence_penalty: 0.2, frequency_penalty: 0.15, num_ctx: Number(process.env.PIKO_CASUAL_NUM_CTX) || 8192 }
      : (plan.socialChat ? socialChatOptions : (plan.deepReasoning ? deepOptions : {}));
    const modelForRequest = plan.deepReasoning
      ? (process.env.PIKO_HEAVY_MODEL || process.env.PIKO_LEGION_MODEL || sessionModel)
      : ((plan.casual && process.env.PIKO_CASUAL_MODEL) ? process.env.PIKO_CASUAL_MODEL : sessionModel);
    let reply = await ollamaChat(messages, modelForRequest, chatOptions);
    const latencyTotal = Date.now() - latencyStart;
    log('info', 'latency', { stream: false, route, historyMessages: historyPart.length, totalMs: latencyTotal }, req.requestId);
    if (process.env.PIKO_LOG_CONSOLE) console.log('[latency]', { route, historyMessages: historyPart.length, totalMs: latencyTotal });
    if (plan.casual && process.env.PIKO_LOG_RAW_CASUAL === '1') {
      console.log('[RAW_CASUAL]', JSON.stringify({ msg: message?.slice(0, 50), reply: reply?.slice(0, 500) }));
    }
    reply = stripMetaSlip(reply, message);
    reply = fixPersonalLifeDeflection(message, reply) || reply;
    if ((plan.casual || plan.socialChat) && reply) {
      const beforeBleedStrip = reply;
      reply = stripCasualThemeBleed(reply) || reply;
      if (beforeBleedStrip !== reply) metrics.conversation.bleedTrigger += 1;
      if (plan.casual) {
        reply = fixEchoReply(message, reply) || reply;
        reply = fixSameHereWhenInvalid(message, reply) || reply;
        const cleaned = splitLines(reply.trim()).filter(Boolean)[0] || '';
        // Sentence boundary: period+space+capital or end — avoid chopping decimals ($4.50), abbreviations (Mr.), URLs
        const sentences = splitSentencesSimple(cleaned);
        const firstSentence = (sentences ? sentences[0] : cleaned).trim();
        if (firstSentence.length > 0) {
          reply = firstSentence;
          if (!endsWithAny(reply, ['.', '!', '?'])) reply = reply + '.';
        }
      } else if (plan.socialChat) {
        reply = fixSameHereWhenInvalid(message, reply) || reply;
        const cleaned = splitLines(reply.trim()).filter(Boolean)[0] || '';
        const sentences = splitSentencesSimple(cleaned).slice(0, 2);
        if (sentences.length > 0) reply = sentences.join(' ').trim();
        if (!endsWithAny(reply, ['.', '!', '?'])) reply = reply + '.';
      }
      reply = applyModeFallback(message, reply, plan, { sessionId: key, turnCount: history.length }) || reply;
      if (includesAny(toLowerAsciiish((reply || '').trim()), ["hey — what's up", "hey - what's up", 'hey — whats up', 'hey - whats up'])) metrics.conversation.resetTrigger += 1;
    }
    reply = enforceReplyConstraints(reply, {
      maxWords: wordLimit,
      maxSentences: sentenceLimit,
      noQuestion: noQuestionRequested,
    }) || reply;
    history.push({ role: 'assistant', content: reply });
    sessionStore.append(key, 'user', message);
    sessionStore.append(key, 'assistant', reply);
    if (process.env.PIKO_DAILY_MEMORY_ENABLED === '1' || process.env.PIKO_DAILY_MEMORY_ENABLED === 'true') {
      try {
        const dm = require('./dailyMemory');
        dm.append(key, 'user', message);
        dm.append(key, 'assistant', reply);
      } catch (_) {}
    }
    const lastExchangeNonStream = history.slice(-2);
    setImmediate(() => updateMind(lastExchangeNonStream).catch(() => {}));
    setImmediate(() =>
      beliefLoop.ingestRecentExperience(key).then(() => beliefLoop.applyBehaviourSignals(key, message, reply)).catch(() => {})
    );
    send(res, 200, JSON.stringify({ reply }));
  } catch (e) {
    metrics.errors++;
    log('error', 'Ollama error', { message: e.message }, req.requestId);
    console.error('[ERROR] Ollama:', e.message);
    const isTimeout = e && (e.code === 'ollama_chat_timeout' || e.code === 'ollama_stream_timeout');
    if (isTimeout) {
      const fallbackReply = buildTimeoutFallbackReply();
      if (streamReply) {
        if (!res.writableEnded) {
          if (!res.headersSent) {
            res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'Connection': 'keep-alive' });
          }
          try {
            res.write('data: ' + JSON.stringify({ timeout: true, content: fallbackReply }) + '\n\n');
            res.write('data: ' + JSON.stringify({ done: true, reply: fallbackReply, timeout: true }) + '\n\n');
          } catch (_) {}
          try { res.end(); } catch (_) {}
        }
        return;
      }
      return send(res, 200, JSON.stringify({ reply: fallbackReply, timeout: true }));
    }
    let errMsg = 'Ollama error: ' + e.message;
    if (e.message && e.message.includes('OPENAI_API_KEY')) {
      errMsg += ' Set PIKO_OLLAMA_ONLY=1 in the server env and ensure Ollama is reachable (e.g. OLLAMA_URL).';
    }
    if (res.headersSent || res.writableEnded) {
      try { res.end(); } catch (_) {}
      return;
    }
    send(res, 502, JSON.stringify({
      reply: 'The AI backend is temporarily unavailable. For recurring tasks, use `/legion schedule daily HH:MM <objective>` — or try again when Ollama is back.',
      error: errMsg,
    }));
  } finally {
    if (typeof releaseChat === 'function') {
      try { releaseChat(); } catch (_) {}
    }
  }
  });
  });
  };
}

module.exports = { createHandleApiChat };
