/**
 * Legion Swarm — deploys specialized sub-agents (Quant, Researcher) for heavy lifting.
 * Piko acts as Manager; Legion spins up agents for forecasting, pattern recognition, research.
 *
 * Quant Agent requires: pip install pandas numpy scikit-learn (on Optimus/server).
 */
const { ollamaNativeChat } = require('./llm');
const { executePythonCode } = require('./pythonSandbox');

const AGENT_PERSONAS = {
  quant: `You are Legion's Quant Agent. You write Python code to run statistical forecasts and save them to SQLite.

CRITICAL SKELETON (FOLLOW EXACTLY):
1. IMPORTS & SETUP: Import sqlite3, pandas, warnings, and statsmodels.tsa.holtwinters.SimpleExpSmoothing. Use warnings.filterwarnings('ignore').
2. SKU SCOPE (MANDATORY — prevents NameError): Immediately after imports, define EXACTLY this variable name (underscore, not camelCase):
   target_sku = 'ALL'
   For a single-SKU task the user message will name one SKU — set target_sku to that string instead of 'ALL'. Never use names like targetsku or targetSKU.
3. DATABASE INIT: Connect to the db. IMMEDIATELY execute:
   conn.execute("CREATE TABLE IF NOT EXISTS agent_forecasts (sku TEXT PRIMARY KEY, forecast_qty INTEGER, mape REAL, bias REAL, updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)")
4. DATA LOAD (use target_sku from step 2):
   - If target_sku == 'ALL' (string compare), use exactly this SQL string (no WHERE on sku): "SELECT p.sku, date(o.created_at) as day, SUM(o.quantity) as qty FROM products p LEFT JOIN order_lines o ON p.sku = o.sku AND o.created_at >= date('now', '-6 months') GROUP BY p.sku, day"
   - Else use: f"SELECT p.sku, date(o.created_at) as day, SUM(o.quantity) as qty FROM products p LEFT JOIN order_lines o ON p.sku = o.sku AND o.created_at >= date('now', '-6 months') WHERE p.sku = '{target_sku}' GROUP BY p.sku, day"
5. DATETIME PARSING: Convert 'day' to datetime: df['day'] = pd.to_datetime(df['day']).
6. FORECASTING LOOP: For each unique SKU in df['sku'].unique():
   - Extract data: sku_df = df[(df['sku'] == sku) & (df['day'].notnull())]
   - If sku_df is empty or sku_df['qty'].sum() == 0:
       fcst_qty, mape, bias = 0, 0.0, 0.0
   - Else:
       sku_series = sku_df.set_index('day')['qty'].resample('D').sum().fillna(0)
       - CRITICAL: SimpleExpSmoothing(x) requires 1D. Use x = sku_series.squeeze() or np.asarray(sku_series).ravel() before fitting. Backtest data too: backtest_1d = backtest_data.squeeze() if hasattr(backtest_data, 'squeeze') else np.ravel(backtest_data).
       - Backtest on the last 30 days to calculate MAPE and BIAS (add 1e-9 to actuals to avoid division by zero).
       - Fit model on the full series, forecast 30 days, and sum: fcst_qty = int(model.forecast(30).sum())
   - NO FILTERING: You MUST save the forecast for the SKU regardless of the MAPE/BIAS score.
   - Execute UPSERT into 'agent_forecasts' using native Python types: int(fcst_qty), float(mape), float(bias).
7. COMMIT & SUMMARY: You MUST call conn.commit() after the loop.
   - Keep a count of total SKUs processed.
   - Print using f-strings: print(f"Forecast complete. Analyzed and committed {total_skus} SKUs to the database.")

Output ONLY the raw Python code.`,
  researcher: `You are Legion's Research Agent. Your sole purpose is deep-dive internet research. Extract facts, prices, and historical context. Summarize findings analytically. Be concise and cite sources when possible.`,
};

const SWARM_MODEL = process.env.PIKO_ROUTER_MODEL || process.env.OLLAMA_MODEL || 'piko:finetune';

const {
  stripCodeFences,
} = require('./text');

async function deploySubAgentRaw(role, taskContext) {
  console.log(`[LEGION SWARM] Deploying ${role.toUpperCase()} agent...`);
  const persona = AGENT_PERSONAS[role];

  if (!persona) return `Error: Unknown agent role '${role}'. Use 'quant' or 'researcher'.`;

  let currentContext = taskContext;

  // Inject production database path and schema for Quant agent (sales cache, forecasts)
  if (role === 'quant') {
    const dbPath = process.env.PIKO_SALES_CACHE_PATH || '/opt/ausmakersupplies/data/sales_cache.sqlite';
    const schemaInfo = `
=== CRITICAL SYSTEM INFO (READ FIRST — YOU MUST USE THIS) ===
Database path: '${dbPath}'
Open READ-WRITE: sqlite3.connect('${dbPath}') or create_engine('sqlite:///${dbPath}')
Schema — products (sku PRIMARY KEY), order_lines (line_item_id, order_id, sku, quantity, created_at, updated_at). Use LEFT JOIN with 6+ months. Nightly batch: set target_sku = 'ALL' at top of script; single SKU: set target_sku to that literal (variable name must be target_sku).
Table agent_forecasts: (sku TEXT PRIMARY KEY, forecast_qty INTEGER, mape REAL, bias REAL, updated_at TEXT)
UPSERT: INSERT INTO agent_forecasts (sku, forecast_qty, mape, bias, updated_at) VALUES (?,?,?,?,datetime('now')) ON CONFLICT(sku) DO UPDATE SET forecast_qty=excluded.forecast_qty, mape=excluded.mape, bias=excluded.bias, updated_at=excluded.updated_at
NO sales_history table. NO CSV files. Use the SQLite path above.
=== END CRITICAL SYSTEM INFO ===`;
    currentContext = `${schemaInfo}\n\nTask: ${taskContext}`;
  }

  if (role === 'quant') {
    let attempts = 0;
    const maxAttempts = 3;
    let lastError = null;

    while (attempts < maxAttempts) {
      attempts++;
      console.log(`[REFLECTION] Quant Agent attempt ${attempts}/${maxAttempts}...`);

      const prompt = `${persona}\n\nTask: ${currentContext}`;
      const quantLlmTimeoutMs = (() => {
        const n = parseInt(process.env.PIKO_QUANT_LLM_TIMEOUT_MS || '', 10);
        return Number.isFinite(n) && n > 0 ? n : 300000; // 5 min — full-catalog code gen is slow
      })();
      const code = await ollamaNativeChat(SWARM_MODEL, [{ role: 'user', content: prompt }], {
        max_tokens: 2800,
        temperature: 0.1,
        timeoutMs: quantLlmTimeoutMs,
      });
      const rawCode = stripCodeFences(code && typeof code === 'string' ? code : String(code || ''));

      if (!rawCode || rawCode.length < 10) {
        lastError = 'Quant Agent failed to generate valid Python code.';
        currentContext = `${currentContext}\n\nWARNING: Your previous response was empty or too short. Output ONLY the raw Python code.`;
        continue;
      }

      const quantTimeoutMs = (() => {
        const n = parseInt(process.env.PIKO_QUANT_PYTHON_TIMEOUT_MS || '', 10);
        return Number.isFinite(n) && n > 0 ? n : 900000; // 15 min default for full-catalog nightly
      })();
      const executionResult = await executePythonCode(rawCode, { timeoutMs: quantTimeoutMs });

      const isError =
        executionResult.startsWith('Error:') ||
        executionResult.includes('Execution Error:') ||
        executionResult.includes('Traceback');

      if (isError) {
        console.log('[REFLECTION] Quant Agent code failed. Triggering self-correction.');
        lastError = executionResult;
        currentContext = `${currentContext}\n\nWARNING: Your previous code failed with this error:\n${executionResult}\n\nAnalyze the error, fix the bug, and output ONLY the corrected Python code. You MUST use the SQLite database path from CRITICAL SYSTEM INFO above — do NOT use read_csv or placeholder paths. No markdown, no explanation.`;
      } else {
        return `Quant Agent Analysis Result (Solved in ${attempts} attempt${attempts > 1 ? 's' : ''}):\n${executionResult}`;
      }
    }

    return `Quant Agent Analysis Failed after ${maxAttempts} attempts. Last Python Error:\n${lastError || 'Unknown'}`;
  }

  if (role === 'researcher') {
    const prompt = `${persona}\n\nTask: ${currentContext}`;
    const result = await ollamaNativeChat(SWARM_MODEL, [{ role: 'user', content: prompt }], {
      max_tokens: 1024,
      temperature: 0.3,
    });
    return `Research Agent Report:\n${(result || '').trim() || 'No output.'}`;
  }

  return `Error: Unhandled role '${role}'.`;
}

/**
 * Public entry — on EI (PIKO_AGENT_ORCH=1) goes through registry + Piko review.
 * AusMaker / default: unchanged raw swarm path.
 */
async function deploySubAgent(role, taskContext) {
  try {
    const { isAgentOrchEnabled, deploySubAgentViaOrch } = require('./agentOrchestrator');
    if (isAgentOrchEnabled()) {
      return deploySubAgentViaOrch(role, taskContext);
    }
  } catch (e) {
    if (process.env.PIKO_LOG_PLANNER === '1') {
      console.warn('[legionSwarm] orch bypass:', e.message);
    }
  }
  return deploySubAgentRaw(role, taskContext);
}

module.exports = { deploySubAgent, deploySubAgentRaw, AGENT_PERSONAS };
