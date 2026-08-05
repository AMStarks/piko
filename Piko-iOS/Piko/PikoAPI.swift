import Foundation

/// Piko chat API client. POST to baseURL/api/chat with message and sessionId.
struct PikoAPI {
    let baseURL: String

    private func serverBase() throws -> String {
        let t = baseURL.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !t.isEmpty else { throw PikoError.missingBaseURL }
        return t
    }

    init(baseURL: String = PikoDefaults.baseURL) {
        var url = PikoDefaults.resolvedBaseURL(from: baseURL)
        if url.hasSuffix("/") { url.removeLast() }
        self.baseURL = url
    }

    /// Only sent when non-empty; server requires it only if `PIKO_YOLO_API_KEY` / `PIKO_HEALTH_API_KEY` is set on the host.
    private var opsApiKey: String? {
        PikoDefaults.resolvedOpsApiKey(from: UserDefaults.standard.string(forKey: "pikoApiKey"))
    }

    private func applyOpsAuth(_ request: inout URLRequest) {
        if let key = opsApiKey {
            request.setValue("Bearer \(key)", forHTTPHeaderField: "Authorization")
        }
    }
    
    struct ChatRequest: Encodable {
        let message: String
        let sessionId: String
    }
    
    struct ChatResponse: Decodable {
        let reply: String?
        let error: String?
    }

    struct HealthResponse: Decodable {
        let ok: Bool?
        let now: String?
        let model: String?
        let error: String?
    }

    struct MobileHeartbeatRequest: Encodable {
        let key: String?
        let deviceId: String
        let platform: String
        let appVersion: String
        let osVersion: String
        let build: String
        let pushTokenState: String
        let pushToken: String?
        let network: String
        let networkExpensive: Bool?
        let networkConstrained: Bool?
        let batteryLevel: Double?
        let appState: String
        let backgroundSync: Bool
        let cadenceReason: String?
        let cadenceUrgency: String?
        let cadenceIntentLoad: Int?
        let cadenceServerHintSec: Int?
        let cadenceDesiredPollSec: Int?
        let cadenceEffectivePollSec: Int?
    }

    struct MobilePushTokenRequest: Encodable {
        let key: String?
        let deviceId: String
        let token: String
        let pushTokenState: String
    }

    struct MobileSummaryResponse: Decodable, Sendable {
        let ok: Bool?
        let now: String?
        let model: String?
        let pollAfterSec: Int?
        let intent: MobileIntentSummary?
        let proactive: MobileProactiveSummary?
    }

    struct MobileIntentSummary: Decodable, Sendable {
        let queueLength: Int?
        let remindersCount: Int?
        let scheduledCount: Int?
    }

    struct MobileProactiveSummary: Decodable, Sendable {
        let mode: String?
        let at: String?
        let drafted: Int?
        let sent: Int?
        let failed: Int?
    }
    
    func send(message: String, sessionId: String = "main") async throws -> String {
        let base = try serverBase()
        let url = URL(string: "\(base)/api/chat")!
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        applyOpsAuth(&request)
        request.httpBody = try JSONEncoder().encode(ChatRequest(message: message, sessionId: sessionId))
        request.timeoutInterval = 120
        
        let (data, response) = try await URLSession.shared.data(for: request)
        
        guard let http = response as? HTTPURLResponse else {
            throw PikoError.notHTTP
        }
        
        let decoded: ChatResponse
        do {
            decoded = try JSONDecoder().decode(ChatResponse.self, from: data)
        } catch {
            throw PikoError.serverError(
                status: http.statusCode,
                message: Self.chatNonJSONMessage(status: http.statusCode, body: data)
            )
        }
        
        if http.statusCode != 200 {
            let replyText = decoded.reply?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
            let message = !replyText.isEmpty
                ? replyText
                : (decoded.error ?? "Request failed (HTTP \(http.statusCode))")
            throw PikoError.serverError(status: http.statusCode, message: message)
        }
        
        return decoded.reply ?? ""
    }

    /// When the proxy or server returns HTML/plain text (e.g. Cloudflare `error code: 502`).
    private static func chatNonJSONMessage(status: Int, body: Data) -> String {
        let snippet = String(data: body, encoding: .utf8)?
            .trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        let preview = snippet.isEmpty
            ? "(empty body)"
            : (snippet.count > 160 ? String(snippet.prefix(160)) + "…" : snippet)
        if status == 502 || preview.lowercased().contains("502") {
            return "Server gateway error (502). Chat may have timed out while waiting for the AI, or Ollama is down. Try `/legion schedule daily 08:00 <task>` for schedules without AI, or retry shortly. Response: \(preview)"
        }
        if status == 504 || preview.lowercased().contains("504") {
            return "Server timed out (504). Try a shorter message or use a slash command. Response: \(preview)"
        }
        return "Server returned non-JSON (HTTP \(status)). Response: \(preview)"
    }

    func fetchHealth() async throws -> HealthResponse {
        let base = try serverBase()
        let url = URL(string: "\(base)/api/health")!
        var request = URLRequest(url: url)
        request.httpMethod = "GET"
        request.timeoutInterval = 8
        let (data, response) = try await URLSession.shared.data(for: request)
        guard let http = response as? HTTPURLResponse else { throw PikoError.notHTTP }
        if http.statusCode != 200 {
            throw PikoError.serverError(status: http.statusCode, message: "Health check failed")
        }
        return try JSONDecoder().decode(HealthResponse.self, from: data)
    }

    struct MobileDiscovery: Decodable {
        let ok: Bool?
        let lanBaseURL: String?
        let publicBaseURL: String?
        let legacyLAN: [String]?

        enum CodingKeys: String, CodingKey {
            case ok
            case lanBaseURL
            case publicBaseURL
            case legacyLAN
        }
    }

    func fetchMobileDiscovery() async throws -> MobileDiscovery {
        let base = try serverBase()
        let url = URL(string: "\(base)/api/mobile/discovery")!
        var request = URLRequest(url: url)
        request.httpMethod = "GET"
        request.timeoutInterval = 6
        let (data, response) = try await URLSession.shared.data(for: request)
        guard let http = response as? HTTPURLResponse, http.statusCode == 200 else {
            throw PikoError.notHTTP
        }
        return try JSONDecoder().decode(MobileDiscovery.self, from: data)
    }

    // MARK: - iOS hub (Shortcuts / Share → reminder, notes_capture, inquiry)
    struct HubRequest: Encodable {
        let action: String
        let text: String?
        let due: String?
        let sessionId: String?
        let source: String?
    }
    struct HubResponse: Decodable {
        let ok: Bool?
        let action: String?
        let reply: String?
        let dueAt: String?
        let error: String?
        let type: String?
        let summary: String?
        let actions: [ConversationAction]?
        /// Sovereign HUD hub actions (`sovereign_*`).
        let ran: Bool?
        let output: String?
        let note: String?
        /// `yolo_tool` / enterprise bridge
        let tool: String?
        let pending_approval: Bool?
        let result: String?
    }

    // MARK: - Enterprise tools (Python `yolo_protocol` via HTTP transport)

    struct YoloToolResponse: Decodable {
        let ok: Bool?
        let tool: String?
        let channel: String?
        let pending_approval: Bool?
        let result: String?
        let error: String?
    }

    struct YoloRegistryResponse: Decodable {
        let ok: Bool?
        let tools: [YoloToolEntry]?
        let error: String?
    }

    struct YoloToolEntry: Decodable {
        let name: String?
        let args: [String: String]?
        let dangerous: Bool?
    }

    /// Run one tool from `yolo_protocol` (same registry as Telegram). Dangerous tools return `pending_approval` until `/approve` on Telegram.
    func runYoloTool(name: String, arguments: [String: Any] = [:], channel: String = "ios") async throws -> YoloToolResponse {
        let base = try serverBase()
        let url = URL(string: "\(base)/api/yolo-tool")!
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.timeoutInterval = 180
        applyOpsAuth(&request)
        let payload: [String: Any] = ["name": name, "arguments": arguments, "channel": channel]
        request.httpBody = try JSONSerialization.data(withJSONObject: payload)
        let (data, response) = try await URLSession.shared.data(for: request)
        guard let http = response as? HTTPURLResponse else { throw PikoError.notHTTP }
        let decoded = try JSONDecoder().decode(YoloToolResponse.self, from: data)
        if http.statusCode != 200 {
            throw PikoError.serverError(status: http.statusCode, message: decoded.error ?? "Yolo tool failed")
        }
        return decoded
    }

    struct UploadResponse: Decodable {
        let ok: Bool?
        let path: String?
        let size: Int?
        let filename: String?
        let error: String?
    }

    /// Upload a file to server `PIKO_TOOL_DATA_ROOT/inbox` (base64 JSON). Returns absolute path for tool args.
    func uploadToInbox(filename: String, fileData: Data, subdir: String = "inbox") async throws -> UploadResponse {
        let base = try serverBase()
        let url = URL(string: "\(base)/api/piko/upload")!
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.timeoutInterval = 120
        let payload: [String: Any] = [
            "filename": filename,
            "content_base64": fileData.base64EncodedString(),
            "subdir": subdir,
        ]
        applyOpsAuth(&request)
        request.httpBody = try JSONSerialization.data(withJSONObject: payload)
        let (data, response) = try await URLSession.shared.data(for: request)
        guard let http = response as? HTTPURLResponse else { throw PikoError.notHTTP }
        let decoded = try JSONDecoder().decode(UploadResponse.self, from: data)
        if http.statusCode != 200 {
            throw PikoError.serverError(status: http.statusCode, message: decoded.error ?? "Upload failed")
        }
        return decoded
    }

    /// Optional: list tools exposed to the LLM (`get_yolo_tool_registry`).
    func fetchYoloToolRegistry() async throws -> [YoloToolEntry] {
        let base = try serverBase()
        let url = URL(string: "\(base)/api/yolo-tools/registry")!
        var request = URLRequest(url: url)
        request.httpMethod = "GET"
        request.timeoutInterval = 30
        applyOpsAuth(&request)
        let (data, response) = try await URLSession.shared.data(for: request)
        guard let http = response as? HTTPURLResponse, http.statusCode == 200 else {
            throw PikoError.serverError(status: (response as? HTTPURLResponse)?.statusCode ?? 0, message: "Registry fetch failed")
        }
        let decoded = try JSONDecoder().decode(YoloRegistryResponse.self, from: data)
        return decoded.tools ?? []
    }

    // MARK: - Ops monitor (tool audit + HITL)

    struct ToolAuditEntry: Decodable, Identifiable {
        var id: String { "\(ts ?? "")-\(tool ?? "")-\(ms ?? 0)" }
        let ts: String?
        let tool: String?
        let channel: String?
        let profile: String?
        let ms: Double?
        let ok: Bool?
        let pending: Bool?
        let args_preview: String?
        let raw: String?
    }

    struct ToolAuditResponse: Decodable {
        let ok: Bool?
        let path: String?
        let entries: [ToolAuditEntry]?
        let error: String?
    }

    /// Decodes arbitrary JSON for HITL tool arguments.
    enum HitlJSONValue: Decodable, CustomStringConvertible {
        case string(String)
        case number(Double)
        case bool(Bool)
        case object([String: HitlJSONValue])
        case array([HitlJSONValue])
        case null

        init(from decoder: Decoder) throws {
            let container = try decoder.singleValueContainer()
            if container.decodeNil() {
                self = .null
            } else if let b = try? container.decode(Bool.self) {
                self = .bool(b)
            } else if let n = try? container.decode(Double.self) {
                self = .number(n)
            } else if let s = try? container.decode(String.self) {
                self = .string(s)
            } else if let o = try? container.decode([String: HitlJSONValue].self) {
                self = .object(o)
            } else if let a = try? container.decode([HitlJSONValue].self) {
                self = .array(a)
            } else {
                self = .null
            }
        }

        var description: String {
            switch self {
            case .string(let s): return s
            case .number(let n): return n.truncatingRemainder(dividingBy: 1) == 0 ? String(Int(n)) : String(n)
            case .bool(let b): return b ? "true" : "false"
            case .null: return "null"
            case .array(let a): return "[" + a.map(\.description).joined(separator: ", ") + "]"
            case .object(let o):
                return "{" + o.map { "\($0.key): \($0.value.description)" }.sorted().joined(separator: ", ") + "}"
            }
        }
    }

    struct HitlPendingItem: Decodable, Identifiable {
        let id: String
        let tool_name: String?
        let channel: String?
        let requested_by: String?
        let created_at: String?
        let status: String?
        let arguments: [String: HitlJSONValue]?

        var argumentsDisplay: String? {
            guard let arguments, !arguments.isEmpty else { return nil }
            return arguments
                .map { "  \($0.key): \($0.value.description)" }
                .sorted()
                .joined(separator: "\n")
        }
    }

    struct HitlPendingResponse: Decodable {
        let ok: Bool?
        let pending: [HitlPendingItem]?
        let count: Int?
        let error: String?
    }

    struct HitlActionResponse: Decodable {
        let ok: Bool?
        let action: String?
        let id: String?
        let result: String?
        let error: String?
    }

    struct LegionRunEntry: Decodable, Identifiable {
        var id: String { run_id ?? UUID().uuidString }
        let run_id: String?
        let adapter_id: String?
        let capability: String?
        let status: String?
        let piko_user_id: String?
        let started_at: String?
        let finished_at: String?
        let result_summary: String?
        let error: String?
    }

    struct LegionRunsResponse: Decodable {
        let ok: Bool?
        let runs: [LegionRunEntry]?
        let error: String?
    }

    struct LegionScheduledItem: Decodable, Identifiable {
        let id: String
        let title: String?
        let capability: String?
        let schedule: String?
        let dueAt: String?
        let lastRunId: String?
        let lastRunStatus: String?
        let mode: String?
    }

    struct LegionScheduledResponse: Decodable {
        let ok: Bool?
        let items: [LegionScheduledItem]?
        let error: String?
    }

    func fetchLegionRuns(limit: Int = 15) async throws -> [LegionRunEntry] {
        let base = try serverBase()
        let url = URL(string: "\(base)/api/control/legion-runs?limit=\(max(1, min(limit, 50)))")!
        var request = URLRequest(url: url)
        request.httpMethod = "GET"
        request.timeoutInterval = 20
        applyOpsAuth(&request)
        let (data, response) = try await URLSession.shared.data(for: request)
        guard let http = response as? HTTPURLResponse else { throw PikoError.notHTTP }
        let decoded = try JSONDecoder().decode(LegionRunsResponse.self, from: data)
        if http.statusCode != 200 {
            throw PikoError.serverError(status: http.statusCode, message: decoded.error ?? "Legion runs fetch failed")
        }
        return decoded.runs ?? []
    }

    func fetchLegionScheduled() async throws -> [LegionScheduledItem] {
        let base = try serverBase()
        let url = URL(string: "\(base)/api/control/legion-scheduled")!
        var request = URLRequest(url: url)
        request.httpMethod = "GET"
        request.timeoutInterval = 20
        applyOpsAuth(&request)
        let (data, response) = try await URLSession.shared.data(for: request)
        guard let http = response as? HTTPURLResponse else { throw PikoError.notHTTP }
        let decoded = try JSONDecoder().decode(LegionScheduledResponse.self, from: data)
        if http.statusCode != 200 {
            throw PikoError.serverError(status: http.statusCode, message: decoded.error ?? "Legion scheduled fetch failed")
        }
        return decoded.items ?? []
    }

    func fetchToolAuditRecent(limit: Int = 50) async throws -> [ToolAuditEntry] {
        let base = try serverBase()
        let url = URL(string: "\(base)/api/tool-audit/recent?limit=\(max(1, min(limit, 200)))")!
        var request = URLRequest(url: url)
        request.httpMethod = "GET"
        request.timeoutInterval = 20
        applyOpsAuth(&request)
        let (data, response) = try await URLSession.shared.data(for: request)
        guard let http = response as? HTTPURLResponse else { throw PikoError.notHTTP }
        let decoded = try JSONDecoder().decode(ToolAuditResponse.self, from: data)
        if http.statusCode != 200 {
            throw PikoError.serverError(status: http.statusCode, message: decoded.error ?? "Tool audit fetch failed")
        }
        return decoded.entries ?? []
    }

    func fetchHitlPending() async throws -> [HitlPendingItem] {
        let base = try serverBase()
        let url = URL(string: "\(base)/api/hitl/pending")!
        var request = URLRequest(url: url)
        request.httpMethod = "GET"
        request.timeoutInterval = 30
        applyOpsAuth(&request)
        let (data, response) = try await URLSession.shared.data(for: request)
        guard let http = response as? HTTPURLResponse else { throw PikoError.notHTTP }
        let decoded = try JSONDecoder().decode(HitlPendingResponse.self, from: data)
        if http.statusCode != 200 {
            throw PikoError.serverError(status: http.statusCode, message: decoded.error ?? "HITL fetch failed")
        }
        return decoded.pending ?? []
    }

    func approveHitl(requestId: String) async throws -> String {
        try await hitlAction(path: "approve", requestId: requestId)
    }

    func rejectHitl(requestId: String) async throws -> String {
        try await hitlAction(path: "reject", requestId: requestId)
    }

    private func hitlAction(path: String, requestId: String) async throws -> String {
        let base = try serverBase()
        let url = URL(string: "\(base)/api/hitl/\(path)")!
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.timeoutInterval = 180
        applyOpsAuth(&request)
        request.httpBody = try JSONSerialization.data(withJSONObject: ["id": requestId])
        let (data, response) = try await URLSession.shared.data(for: request)
        guard let http = response as? HTTPURLResponse else { throw PikoError.notHTTP }
        let decoded = try JSONDecoder().decode(HitlActionResponse.self, from: data)
        if http.statusCode != 200 {
            throw PikoError.serverError(status: http.statusCode, message: decoded.error ?? "HITL \(path) failed")
        }
        return decoded.result ?? "OK"
    }

    struct ConversationAction: Decodable {
        let title: String?
    }

    // MARK: - Sovereign manifest (`piko_state.json` from `piko_core.generate_app_manifest`)

    struct PikoStateManifest: Decodable {
        let generated_at: String
        let brain: StateBrain
        /// Phase 5.5 — multi-host brain probes + active profile hint (`PIKO_ACTIVE_BRAIN_PROFILE`).
        let neural_grid: StateNeuralGrid?
        let world: StateWorld?
        let legion: StateLegion
        let audit: StateAudit?
        let wiki: StateWiki?
        /// AusMaker telemetry (WebChat data plane → embedded by `piko_core.generate_app_manifest`).
        let ausmaker: StateAusMaker?
        /// Phase 3 — Denarii totals from `generate_app_manifest`.
        let vault: StateVault?
        /// Quality gate row counts (`rejected`, `review_required`) from manifest.
        let quality_gate: StateQualityGate?
        /// Phase 4.1 — host metrics from `get_system_health` embedded in manifest.
        let system: StateSystem?
        /// Phase 4.4 — HTTP RTT probe to brain `GET …/v1/models`.
        let brain_latency: StateBrainLatency?
        /// HUD 2.0 — recent Meta-Bridge handoffs parsed from `wiki/maintenance_log.md`.
        let cortex_pulse: StateCortexPulse?
        /// Suggested iOS Base URL (current LAN IP from host `hostname -I`).
        let mobile: StateMobile?

        struct StateMobile: Decodable {
            let ios_base_url: String?
            let legacy_lan_hosts: [String]?
        }

        struct StateBrain: Decodable {
            let endpoint: String
            let model: String
            let profile: String?
        }

        struct StateAusMaker: Decodable {
            let ok: Bool?
            let error: String?
            let telemetry_url: String?
            let http_status: Int?
            let updated_at: String?
            let health: String?
            let period: String?
            let sync_ts: String?
            let forecast: StateAusMakerForecast?
            let sales: StateAusMakerSalesSummary?
            let sales_periods: StateAusMakerSalesPeriods?
        }

        struct StateAusMakerForecast: Decodable {
            let has_cached: Bool?
            let reorderCount: Int?
            let reviewCount: Int?
            let orderedCount: Int?
        }

        struct StateAusMakerSalesPeriods: Decodable {
            let today: Double?
            let week: Double?
            let month: Double?
        }

        struct StateAusMakerSalesSummary: Decodable {
            let total_units_sold: Double?
            let total_revenue: Double?
            let top_skus: [StateAusMakerTopSku]?
        }

        struct StateAusMakerTopSku: Decodable {
            let sku: String?
            let units: Double?
        }

        struct StateNeuralGrid: Decodable {
            let active_profile: String?
            let status: StateNeuralGridStatus?
            let registry: [String: String]?
        }

        struct StateNeuralGridStatus: Decodable {
            let ok: Bool?
            let checked_at: String?
            let error: String?
            let raw_preview: String?
            let grid: [String: StateNeuralGridHostProbe]?
        }

        struct StateNeuralGridHostProbe: Decodable {
            let ok: Bool?
            let latency_ms: Double?
            let http_status: Int?
            let error: String?
            let endpoint: String?
            let probe_url: String?
        }

        struct StateCortexPulse: Decodable {
            let meta_bridge_handoffs: [StateMetaBridgeHandoff]?
        }

        struct StateMetaBridgeHandoff: Decodable {
            let workflow_id: String?
            let exit_code: Int?
            let note: String?
            let status: String?
            let headline: String?
        }

        struct StateWorld: Decodable {
            let boss: String?
            let current_focus: String?
            let philosophy: String?
        }

        struct StateLegion: Decodable {
            let counts_by_status: [String: Int]?
            let total_tasks: Int
            /// Distinct ``business_unit`` labels on tasks (manifest enrichment + optional DB column).
            let business_units: [String]?
            let tasks_sample: [StateLegionTask]
            /// HUD 2.0 — capped full ledger for Legion Tree (`PIKO_MANIFEST_TASK_LIMIT`, default 500).
            let tasks_all: [StateLegionTask]?
            let tasks_all_truncated: Bool?
            /// Phase 3.5 — counts from `generate_app_manifest` (`child_tasks`, `parents_with_children`, `delegated_missions`).
            let hierarchy: StateLegionHierarchy?
        }

        struct StateLegionHierarchy: Decodable {
            let child_tasks: Int?
            let parents_with_children: Int?
            let delegated_missions: Int?
            /// Phase 3.7 — delegated parents whose children are all terminal (manifest snapshot before/after audit).
            let ready_to_close: Int?
            /// Phase 3.7 — delegated parents with at least one stale non-terminal child.
            let at_risk_missions: Int?
        }

        struct StateLegionTask: Decodable {
            let id: Int?
            let title: String?
            let status: String?
            let assignee: Int?
            let updated_at: String?
            let denarii: Int?
            /// Phase 6.1 — actual consumption recorded by backend (`denarii_spent`).
            let denarii_spent: Int?
            let parent_id: Int?
            /// From manifest: ``piko_core`` sets AusMaker vs General from title/description unless DB supplies ``business_unit``.
            let business_unit: String?
        }

        struct StateVault: Decodable {
            let currency: String?
            let total_invested: Int?
            let tasks_with_nonzero_cost: Int?
            let total_spent: Int?
            let tasks_with_nonzero_spent: Int?
        }

        struct StateQualityGate: Decodable {
            let rejected: Int?
            let review_required: Int?
        }

        struct StateSystem: Decodable {
            let ok: Bool?
            let health_light: String?
            let disk_path: String?
            let disk_used_pct: Double?
            let disk_free_gb: Double?
            let disk_total_gb: Double?
            let cpu_pct: Double?
            let memory_pct: Double?
            let memory_available_gb: Double?
            let checked_at: String?
            let error: String?
            let hint: String?
            let gpu: StateGpuInfo?
        }

        struct StateGpuInfo: Decodable {
            let available: Bool?
            let summary: String?
            let name: String?
            let utilization_gpu_pct: String?
            let temperature_c: String?
        }

        struct StateBrainLatency: Decodable {
            let ok: Bool?
            let latency_ms: Double?
            let probe_url: String?
            let http_status: Int?
            let model_configured: String?
            let checked_at: String?
            let error: String?
        }

        struct StateAudit: Decodable {
            let generated_at: String?
            let total_tasks: Int?
            let flags: StateAuditFlags?
        }

        struct StateAuditFlags: Decodable {
            let missing_assignee: StateAuditSlice?
            let needs_starkers: StateAuditSlice?
            let stale: StateAuditStale?
            let stagnant_capital: StateStagnantCapital?
        }

        struct StateStagnantCapital: Decodable {
            let count: Int?
            let min_denarii: Int?
            let tasks: [StateLegionTask]?
        }

        struct StateAuditSlice: Decodable {
            let count: Int?
        }

        struct StateAuditStale: Decodable {
            let count: Int?
            let cutoff_hours: Int?
        }

        struct StateWiki: Decodable {
            let dir: String?
            let recent: [StateWikiItem]?
        }

        struct StateWikiItem: Decodable {
            let filename: String
            let title: String?
            let mtime: Double?
        }
    }

    /// GET `…/piko_state.json` (served by webchat-piko when manifest exists on host).
    func fetchPikoStateManifest() async throws -> PikoStateManifest {
        let base = try serverBase()
        let url = URL(string: "\(base)/piko_state.json")!
        var request = URLRequest(url: url)
        request.httpMethod = "GET"
        request.timeoutInterval = 12
        let (data, response) = try await URLSession.shared.data(for: request)
        guard let http = response as? HTTPURLResponse else { throw PikoError.notHTTP }
        guard http.statusCode == 200 else {
            throw PikoError.serverError(status: http.statusCode, message: "Manifest unavailable (HTTP \(http.statusCode))")
        }
        do {
            return try JSONDecoder().decode(PikoStateManifest.self, from: data)
        } catch {
            throw PikoError.serverError(status: http.statusCode, message: "Manifest JSON decode failed: \(error.localizedDescription)")
        }
    }

    /// POST `/api/ios-hub` with sovereign_* actions (see server `PIKO_SOV_CMD_*` env).
    func postIosHubSovereign(action: String) async throws -> HubResponse {
        let base = try serverBase()
        let url = URL(string: "\(base)/api/ios-hub")!
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        applyOpsAuth(&request)
        let body = HubRequest(action: action, text: nil, due: nil, sessionId: "main", source: "ios")
        request.httpBody = try JSONEncoder().encode(body)
        request.timeoutInterval = 130
        let (data, response) = try await URLSession.shared.data(for: request)
        guard let http = response as? HTTPURLResponse else { throw PikoError.notHTTP }
        let decoded = try JSONDecoder().decode(HubResponse.self, from: data)
        if http.statusCode != 200 {
            throw PikoError.serverError(status: http.statusCode, message: decoded.error ?? "Hub request failed")
        }
        return decoded
    }

    struct DashboardResponse: Decodable {
        let learning: LearningSummary?
        let nextReminder: ReminderSummary?
        let moltbookLast: MoltbookSummary?
        let contextHint: String?
        let freeSlot: String?
        let rabbitHole: RabbitHoleSummary?
        let researchTopics: [String]?
        let gpuTemps: [GPUTemp]?
        struct GPUTemp: Decodable {
            let index: Int?
            let name: String?
            let temp: Int?
        }
        struct LearningSummary: Decodable {
            let tensionsCount: Int?
            let firstTension: String?
            let stickyCount: Int?
            let firstSticky: String?
        }
        struct ReminderSummary: Decodable {
            let text: String?
            let dueAt: String?
        }
        struct MoltbookSummary: Decodable {
            let title: String?
            let upvotes: Int?
        }
        struct RabbitHoleSummary: Decodable {
            let notesLast7Days: Int?
            let lastNoteDate: String?
            let lastNoteTitle: String?
            let lastNoteExcerpt: String?
        }
    }

    struct FilesRecentResponse: Decodable {
        let ok: Bool?
        let suggestedTopics: [String]?
    }

    func hubFilesRecent(fileNames: [String]) async throws -> FilesRecentResponse {
        let base = try serverBase()
        let url = URL(string: "\(base)/api/ios-hub")!
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        applyOpsAuth(&request)
        let body: [String: Any] = ["action": "files_recent", "fileNames": fileNames, "source": "ios"]
        request.httpBody = try JSONSerialization.data(withJSONObject: body)
        request.timeoutInterval = 30
        let (data, response) = try await URLSession.shared.data(for: request)
        guard let http = response as? HTTPURLResponse else { throw PikoError.notHTTP }
        let decoded = try JSONDecoder().decode(FilesRecentResponse.self, from: data)
        if http.statusCode != 200 {
            throw PikoError.serverError(status: http.statusCode, message: "files_recent failed")
        }
        return decoded
    }

    func hubReminder(text: String, due: String? = nil) async throws -> HubResponse {
        try await hub(action: "reminder", text: text, due: due)
    }

    func hubNotesCapture(text: String) async throws -> HubResponse {
        try await hub(action: "notes_capture", text: text, due: nil)
    }

    /// Use for Share → Piko when content may be a conversation (returns type/summary/actions if detected).
    func hubFileCapture(text: String) async throws -> HubResponse {
        try await hub(action: "file_capture", text: text, due: nil)
    }

    func hubInquiry(text: String) async throws -> String {
        let r = try await hub(action: "inquiry", text: text, due: nil)
        return r.reply ?? r.error ?? ""
    }

    func dashboard() async throws -> DashboardResponse {
        let base = try serverBase()
        let url = URL(string: "\(base)/api/ios-dashboard")!
        var request = URLRequest(url: url)
        request.httpMethod = "GET"
        request.timeoutInterval = 15
        let (data, response) = try await URLSession.shared.data(for: request)
        guard let http = response as? HTTPURLResponse else { throw PikoError.notHTTP }
        guard http.statusCode == 200 else { throw PikoError.serverError(status: http.statusCode, message: "Dashboard failed") }
        return try JSONDecoder().decode(DashboardResponse.self, from: data)
    }

    /// Append a research topic for Piko's rabbit-hole learning. POST /api/control/learning/topics
    func addResearchTopic(_ topic: String) async throws {
        struct Body: Encodable { let topic: String }
        let base = try serverBase()
        let url = URL(string: "\(base)/api/control/learning/topics")!
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONEncoder().encode(Body(topic: topic.trimmingCharacters(in: .whitespacesAndNewlines)))
        request.timeoutInterval = 10
        let (_, response) = try await URLSession.shared.data(for: request)
        guard let http = response as? HTTPURLResponse else { throw PikoError.notHTTP }
        guard http.statusCode == 200 else { throw PikoError.serverError(status: http.statusCode, message: "Add topic failed") }
    }

    func hubCalendarSnapshot(events: [[String: String]]) async throws -> HubResponse {
        let base = try serverBase()
        let url = URL(string: "\(base)/api/ios-hub")!
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        applyOpsAuth(&request)
        let body: [String: Any] = ["action": "calendar_snapshot", "events": events, "source": "ios"]
        request.httpBody = try JSONSerialization.data(withJSONObject: body)
        request.timeoutInterval = 30
        let (data, response) = try await URLSession.shared.data(for: request)
        guard let http = response as? HTTPURLResponse else { throw PikoError.notHTTP }
        let decoded = try JSONDecoder().decode(HubResponse.self, from: data)
        if http.statusCode != 200 {
            throw PikoError.serverError(status: http.statusCode, message: decoded.error ?? "Hub request failed")
        }
        return decoded
    }

    func sendMobileHeartbeat(
        key: String? = nil,
        deviceId: String,
        platform: String = "ios",
        appVersion: String,
        osVersion: String,
        build: String,
        pushTokenState: String,
        pushToken: String? = nil,
        network: String = "unknown",
        networkExpensive: Bool? = nil,
        networkConstrained: Bool? = nil,
        batteryLevel: Double? = nil,
        appState: String,
        backgroundSync: Bool = false,
        cadenceReason: String? = nil,
        cadenceUrgency: String? = nil,
        cadenceIntentLoad: Int? = nil,
        cadenceServerHintSec: Int? = nil,
        cadenceDesiredPollSec: Int? = nil,
        cadenceEffectivePollSec: Int? = nil
    ) async throws {
        let base = try serverBase()
        let url = URL(string: "\(base)/api/mobile/device-heartbeat")!
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        let body = MobileHeartbeatRequest(
            key: key,
            deviceId: deviceId,
            platform: platform,
            appVersion: appVersion,
            osVersion: osVersion,
            build: build,
            pushTokenState: pushTokenState,
            pushToken: pushToken,
            network: network,
            networkExpensive: networkExpensive,
            networkConstrained: networkConstrained,
            batteryLevel: batteryLevel,
            appState: appState,
            backgroundSync: backgroundSync,
            cadenceReason: cadenceReason,
            cadenceUrgency: cadenceUrgency,
            cadenceIntentLoad: cadenceIntentLoad,
            cadenceServerHintSec: cadenceServerHintSec,
            cadenceDesiredPollSec: cadenceDesiredPollSec,
            cadenceEffectivePollSec: cadenceEffectivePollSec
        )
        request.httpBody = try JSONEncoder().encode(body)
        request.timeoutInterval = 12
        let (_, response) = try await URLSession.shared.data(for: request)
        guard let http = response as? HTTPURLResponse else { throw PikoError.notHTTP }
        guard http.statusCode == 200 else { throw PikoError.serverError(status: http.statusCode, message: "Heartbeat failed") }
    }

    func sendMobilePushToken(
        key: String? = nil,
        deviceId: String,
        token: String,
        pushTokenState: String = "registered"
    ) async throws {
        let base = try serverBase()
        let url = URL(string: "\(base)/api/mobile/push-token")!
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        let body = MobilePushTokenRequest(key: key, deviceId: deviceId, token: token, pushTokenState: pushTokenState)
        request.httpBody = try JSONEncoder().encode(body)
        request.timeoutInterval = 12
        let (_, response) = try await URLSession.shared.data(for: request)
        guard let http = response as? HTTPURLResponse else { throw PikoError.notHTTP }
        guard http.statusCode == 200 else { throw PikoError.serverError(status: http.statusCode, message: "Push token registration failed") }
    }

    func fetchMobileSummary(key: String? = nil) async throws -> MobileSummaryResponse {
        let base = try serverBase()
        var endpoint = "\(base)/api/mobile/summary"
        if let key, !key.isEmpty {
            endpoint += "?key=\(key.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? key)"
        }
        let url = URL(string: endpoint)!
        var request = URLRequest(url: url)
        request.httpMethod = "GET"
        request.timeoutInterval = 12
        let (data, response) = try await URLSession.shared.data(for: request)
        guard let http = response as? HTTPURLResponse else { throw PikoError.notHTTP }
        guard http.statusCode == 200 else { throw PikoError.serverError(status: http.statusCode, message: "Mobile summary failed") }
        return try JSONDecoder().decode(MobileSummaryResponse.self, from: data)
    }

    /// POST `/api/ios-hub` with `legion_task_create` — ``piko_core.create_legion_task_atomic`` (dispatch + wiki + manifest).
    func postIosHubLegionTaskCreate(
        title: String,
        description: String = "",
        denarii: Int = 0,
        parentId: Int = 0,
        businessUnit: String? = nil
    ) async throws -> Int {
        let base = try serverBase()
        let url = URL(string: "\(base)/api/ios-hub")!
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        applyOpsAuth(&request)
        var body: [String: Any] = [
            "action": "legion_task_create",
            "title": title.trimmingCharacters(in: .whitespacesAndNewlines),
            "description": description.trimmingCharacters(in: .whitespacesAndNewlines),
            "denarii": max(0, denarii),
            "parent_id": max(0, parentId),
            "source": "ios",
            "sessionId": "ios-legion-create",
        ]
           bu.caseInsensitiveCompare("All") != .orderedSame
        {
            body["business_unit"] = bu
        }
        request.httpBody = try JSONSerialization.data(withJSONObject: body)
        request.timeoutInterval = 90
        let (data, response) = try await URLSession.shared.data(for: request)
        guard let http = response as? HTTPURLResponse else { throw PikoError.notHTTP }
        let decoded = try JSONDecoder().decode(LegionTaskCreateHubResponse.self, from: data)
        guard http.statusCode == 200, decoded.ok == true else {
            let msg = decoded.error ?? String(data: data, encoding: .utf8) ?? "Legion create failed"
            throw PikoError.serverError(status: http.statusCode, message: msg)
        }
        if let tid = decoded.task_id, tid > 0 { return tid }
        if let inner = decoded.result?.dispatch?.id, inner > 0 { return inner }
        return 0
    }

    private struct LegionTaskCreateHubResponse: Decodable {
        let ok: Bool?
        let error: String?
        let task_id: Int?
        let result: LegionTaskCreateInner?
    }

    private struct LegionTaskCreateInner: Decodable {
        let ok: Bool?
        let dispatch: LegionTaskCreateDispatch?
        let manifest: String?
        let warning: String?
    }

    private struct LegionTaskCreateDispatch: Decodable {
        let id: Int?
    }

    /// POST `/api/ios-hub` with `legion_task_propose` — drafts a task (no DB write) for confirmation.
    func postIosHubLegionTaskPropose(text: String, businessUnit: String? = nil) async throws -> LegionTaskDraft {
        let base = try serverBase()
        let url = URL(string: "\(base)/api/ios-hub")!
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        applyOpsAuth(&request)
        var body: [String: Any] = [
            "action": "legion_task_propose",
            "text": text.trimmingCharacters(in: .whitespacesAndNewlines),
            "source": "ios",
            "sessionId": "ios-legion-propose",
        ]
        if let bu = businessUnit?.trimmingCharacters(in: .whitespacesAndNewlines), !bu.isEmpty,
           bu.caseInsensitiveCompare("All") != .orderedSame
        {
        }
        request.httpBody = try JSONSerialization.data(withJSONObject: body)
        request.timeoutInterval = 90
        let (data, response) = try await URLSession.shared.data(for: request)
        guard let http = response as? HTTPURLResponse else { throw PikoError.notHTTP }
        let decoded = try JSONDecoder().decode(LegionTaskProposeHubResponse.self, from: data)
        guard http.statusCode == 200, decoded.ok == true, let d = decoded.draft else {
            let msg = decoded.error ?? String(data: data, encoding: .utf8) ?? "Legion propose failed"
            throw PikoError.serverError(status: http.statusCode, message: msg)
        }
        return d
    }

    struct LegionTaskDraft: Decodable {
        let title: String
        let description: String?
        let denarii: Int?
        let parent_id: Int?
        let business_unit: String?
    }

    private struct LegionTaskProposeHubResponse: Decodable {
        let ok: Bool?
        let error: String?
        let message: String?
        let draft: LegionTaskDraft?
    }

    /// POST `/api/ios-hub` with `legion_task_update` — updates Legion SQLite via `yolo_protocol.update_legion_task` on the server host.
    func postIosHubLegionTaskUpdate(taskId: Int, newStatus: String) async throws {
        let base = try serverBase()
        let url = URL(string: "\(base)/api/ios-hub")!
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        applyOpsAuth(&request)
        let body: [String: Any] = [
            "action": "legion_task_update",
            "task_id": taskId,
            "new_status": newStatus,
            "source": "ios",
            "sessionId": "ios-legion-detail",
        ]
        request.httpBody = try JSONSerialization.data(withJSONObject: body)
        request.timeoutInterval = 60
        let (data, response) = try await URLSession.shared.data(for: request)
        guard let http = response as? HTTPURLResponse else { throw PikoError.notHTTP }
        struct LegionHubAck: Decodable { let ok: Bool?; let error: String? }
        let decoded = try? JSONDecoder().decode(LegionHubAck.self, from: data)
        guard http.statusCode == 200, decoded?.ok == true else {
            let msg = decoded?.error ?? String(data: data, encoding: .utf8) ?? "Legion update failed"
            throw PikoError.serverError(status: http.statusCode, message: msg)
        }
    }

    // MARK: - Legion mission schedules (legion_scheduled intents)

    struct LegionScheduleItem: Decodable, Identifiable {
        let id: String
        let task_id: Int?
        let title: String?
        let schedule: String?
        let dueAt: String?
        let lastFiredAt: String?
        let mode: String?
        let business_unit: String?
    }

    struct LegionScheduleListResponse: Decodable {
        let ok: Bool?
        let error: String?
        let items: [LegionScheduleItem]?
    }

    struct LegionScheduleCreateResponse: Decodable {
        let ok: Bool?
        let error: String?
        let duplicate: Bool?
        let intent: LegionScheduleCreatedIntent?
    }

    struct LegionScheduleCreatedIntent: Decodable {
        let id: String?
        let task_id: Int?
        let schedule: String?
        let dueAt: String?
        let mode: String?
        let business_unit: String?
    }

    /// List pending mission activation schedules (`legion_schedule_list` on ios-hub).
    func fetchLegionSchedules(taskId: Int? = nil) async throws -> [LegionScheduleItem] {
        let base = try serverBase()
        let url = URL(string: "\(base)/api/ios-hub")!
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        applyOpsAuth(&request)
        var body: [String: Any] = [
            "action": "legion_schedule_list",
            "source": "ios",
            "sessionId": "ios-legion-schedules",
        ]
        if let taskId, taskId > 0 { body["task_id"] = taskId }
        request.httpBody = try JSONSerialization.data(withJSONObject: body)
        request.timeoutInterval = 30
        let (data, response) = try await URLSession.shared.data(for: request)
        guard let http = response as? HTTPURLResponse else { throw PikoError.notHTTP }
        let decoded = try JSONDecoder().decode(LegionScheduleListResponse.self, from: data)
        guard http.statusCode == 200, decoded.ok == true else {
            throw PikoError.serverError(status: http.statusCode, message: decoded.error ?? "Schedule list failed")
        }
        return decoded.items ?? []
    }

    /// Register when a mission MUST activate (`legion_schedule_create`).
    func postIosHubLegionScheduleCreate(
        taskId: Int,
        schedule: String,
        title: String,
        mode: String,
        businessUnit: String? = nil
    ) async throws -> LegionScheduleCreateResponse {
        let base = try serverBase()
        let url = URL(string: "\(base)/api/ios-hub")!
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        applyOpsAuth(&request)
        var body: [String: Any] = [
            "action": "legion_schedule_create",
            "task_id": taskId,
            "schedule": schedule.trimmingCharacters(in: .whitespacesAndNewlines),
            "title": title.trimmingCharacters(in: .whitespacesAndNewlines),
            "objective": title.trimmingCharacters(in: .whitespacesAndNewlines),
            "mode": mode,
            "source": "ios",
            "sessionId": "ios-legion-schedule",
        if let bu = businessUnit?.trimmingCharacters(in: .whitespacesAndNewlines), !bu.isEmpty {
            body["business_unit"] = bu
        }
        request.httpBody = try JSONSerialization.data(withJSONObject: body)
        request.timeoutInterval = 45
        let (data, response) = try await URLSession.shared.data(for: request)
        guard let http = response as? HTTPURLResponse else { throw PikoError.notHTTP }
        let decoded = try JSONDecoder().decode(LegionScheduleCreateResponse.self, from: data)
        guard http.statusCode == 200, decoded.ok == true else {
            throw PikoError.serverError(status: http.statusCode, message: decoded.error ?? "Schedule create failed")
        }
        return decoded
    }

    func postIosHubLegionScheduleCancel(intentId: String) async throws {
        let base = try serverBase()
        let url = URL(string: "\(base)/api/ios-hub")!
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        applyOpsAuth(&request)
        let body: [String: Any] = [
            "action": "legion_schedule_cancel",
            "intent_id": intentId,
            "source": "ios",
            "sessionId": "ios-legion-schedules",
        ]
        request.httpBody = try JSONSerialization.data(withJSONObject: body)
        request.timeoutInterval = 30
        let (data, response) = try await URLSession.shared.data(for: request)
        guard let http = response as? HTTPURLResponse else { throw PikoError.notHTTP }
        struct Ack: Decodable { let ok: Bool?; let error: String? }
        let decoded = try? JSONDecoder().decode(Ack.self, from: data)
        guard http.statusCode == 200, decoded?.ok == true else {
            throw PikoError.serverError(status: http.statusCode, message: decoded?.error ?? "Schedule cancel failed")
        }
    }

    private func hub(action: String, text: String, due: String?) async throws -> HubResponse {
        let base = try serverBase()
        let url = URL(string: "\(base)/api/ios-hub")!
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        applyOpsAuth(&request)
        let body = HubRequest(action: action, text: text, due: due, sessionId: "main", source: "ios")
        request.httpBody = try JSONEncoder().encode(body)
        request.timeoutInterval = 65
        let (data, response) = try await URLSession.shared.data(for: request)
        guard let http = response as? HTTPURLResponse else { throw PikoError.notHTTP }
        let decoded = try JSONDecoder().decode(HubResponse.self, from: data)
        if http.statusCode != 200 {
            throw PikoError.serverError(status: http.statusCode, message: decoded.error ?? "Hub request failed")
        }
        return decoded
    }
}

enum PikoError: LocalizedError {
    case notHTTP
    case missingBaseURL
    case serverError(status: Int, message: String)

    var errorDescription: String? {
        switch self {
        case .notHTTP: return "Invalid response"
        case .missingBaseURL:
            return "Set your Piko server URL in Settings (gear). Use your current webchat base URL (e.g. https://… or http://192.168.x.x:3000)."
        case .serverError(let status, let message): return "\(message) (HTTP \(status))"
        }
    }
}
