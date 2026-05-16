(() => {
const DEFAULT_LICENSE_SERVER_URL =
	"https://qcut-license-server.zdhpeter.workers.dev";

const TERMINAL_STATUSES = ["succeeded", "failed", "cancelled"];
const CODEX_AGENT_COMMAND = "codex exec --skip-git-repo-check --json -";
const CODEX_TERMINAL_COMMAND =
	"codex exec --skip-git-repo-check --dangerously-bypass-approvals-and-sandbox --output-last-message /tmp/qcut-output/codex-last-message.md -";
const CODEX_LAST_MESSAGE_FILE = "codex-last-message.md";
const AGENT_SESSION_STORAGE_KEY = "qcut_agent_session_id";
const CODEX_AGENT_SYSTEM_PROMPT = [
	"You are running inside QCut's Daytona CLI image.",
	"The QCut native CLI skill is available at /home/qcut/qcut/.claude/skills/native-cli/SKILL.md.",
	"Read that skill before running nontrivial QCut CLI workflows or when command syntax is unclear.",
	"Use shell commands when the user asks you to inspect or run QCut.",
	"For image generation requests, run the QCut CLI rather than any external image tool.",
	"Write generated files under /tmp/qcut-output so the worker can upload them.",
	"yt-dlp and deno are available for authorized video download probes.",
	"For long-running shell commands, stream user-visible stdout with tee -a /tmp/qcut-output/codex-live-stdout.log.",
	"Put temporary tools, caches, and package installs under /tmp/qcut-tools or /tmp, not /tmp/qcut-output.",
	"Write only final user-requested files and small diagnostic summaries/logs under /tmp/qcut-output.",
	"Example: qcut gen image -t 'small blue square icon on a clean white background' -m flux_dev --json -o /tmp/qcut-output",
	"Report the command you ran and the resulting artifact paths.",
].join("\n");
const chatMessages = [];
let activeJobPollIntervalId = null;
let terminalSocket = null;
let terminalInstance = null;
let terminalFitAddon = null;
let terminalArtifactPollIntervalId = null;
let activeTerminalSessionId = "";
let terminalResizeListenerBound = false;

function getRuntimeGlobal() {
	try {
		if (typeof globalThis !== "undefined") {
			return globalThis;
		}
		return undefined;
	} catch {
		return undefined;
	}
}

function getRuntimeWindow() {
	try {
		const runtime = getRuntimeGlobal();
		return runtime?.window;
	} catch {
		return undefined;
	}
}

function getPaymentApi() {
	try {
		const runtime = getRuntimeGlobal();
		const win = getRuntimeWindow();
		return win?.PaymentAPI || runtime?.PaymentAPI || null;
	} catch {
		return null;
	}
}

function getFetch() {
	try {
		const runtime = getRuntimeGlobal();
		if (typeof runtime?.fetch === "function") {
			return runtime.fetch.bind(runtime);
		}
		return null;
	} catch {
		return null;
	}
}

function normalizeBaseUrl({ value }) {
	if (typeof value !== "string") {
		return "";
	}
	const trimmed = value.trim();
	if (trimmed.length === 0) {
		return "";
	}
	if (trimmed.endsWith("/")) {
		return trimmed.slice(0, -1);
	}
	return trimmed;
}

function getApiBaseUrl() {
	try {
		const paymentApi = getPaymentApi();
		const value =
			typeof paymentApi?.getApiBaseUrl === "function"
				? paymentApi.getApiBaseUrl()
				: DEFAULT_LICENSE_SERVER_URL;
		return normalizeBaseUrl({ value }) || DEFAULT_LICENSE_SERVER_URL;
	} catch {
		return DEFAULT_LICENSE_SERVER_URL;
	}
}

function readAuthToken() {
	try {
		const paymentApi = getPaymentApi();
		if (typeof paymentApi?.getAuthToken !== "function") {
			return "";
		}
		const token = paymentApi.getAuthToken();
		return typeof token === "string" ? token.trim() : "";
	} catch {
		return "";
	}
}

function saveAuthToken({ token }) {
	try {
		const trimmed = typeof token === "string" ? token.trim() : "";
		if (trimmed.length === 0) {
			return false;
		}
		const paymentApi = getPaymentApi();
		if (typeof paymentApi?.setAuthToken !== "function") {
			return false;
		}
		return paymentApi.setAuthToken({ token: trimmed });
	} catch {
		return false;
	}
}

function getLocalStorage() {
	try {
		return getRuntimeWindow()?.localStorage || null;
	} catch {
		return null;
	}
}

function readStoredAgentSessionId() {
	try {
		const value = getLocalStorage()?.getItem(AGENT_SESSION_STORAGE_KEY) || "";
		return typeof value === "string" ? value.trim() : "";
	} catch {
		return "";
	}
}

function saveStoredAgentSessionId({ sessionId }) {
	try {
		const value = typeof sessionId === "string" ? sessionId.trim() : "";
		if (value.length === 0) {
			return false;
		}
		getLocalStorage()?.setItem(AGENT_SESSION_STORAGE_KEY, value);
		return true;
	} catch {
		return false;
	}
}

function clearStoredAgentSessionId() {
	try {
		getLocalStorage()?.removeItem(AGENT_SESSION_STORAGE_KEY);
	} catch {
		return;
	}
}

async function parsePayload({ response }) {
	const rawText = await response.text();
	if (rawText.length === 0) {
		return null;
	}
	try {
		return JSON.parse(rawText);
	} catch {
		return { message: rawText };
	}
}

function getPayloadError({ payload }) {
	if (!payload || typeof payload !== "object") {
		return "";
	}
	if (typeof payload.error === "string" && payload.error.trim().length > 0) {
		return payload.error.trim();
	}
	if (
		typeof payload.message === "string" &&
		payload.message.trim().length > 0
	) {
		return payload.message.trim();
	}
	return "";
}

async function requestAgentApi({ path, method, body }) {
	const fetcher = getFetch();
	if (!fetcher) {
		throw new Error("Fetch API is unavailable");
	}

	const token = readAuthToken();
	const authHeaders =
		token.length === 0 ? {} : { Authorization: `Bearer ${token}` };

	const response = await fetcher(`${getApiBaseUrl()}${path}`, {
		method,
		headers: {
			Accept: "application/json",
			...authHeaders,
			...(body === undefined ? {} : { "Content-Type": "application/json" }),
		},
		body: body === undefined ? undefined : JSON.stringify(body),
	});
	const payload = await parsePayload({ response });
	if (!response.ok) {
		const error = getPayloadError({ payload });
		throw new Error(error || `Request failed (${response.status})`);
	}
	return payload;
}

async function requestAgentText({ path }) {
	const fetcher = getFetch();
	if (!fetcher) {
		throw new Error("Fetch API is unavailable");
	}

	const token = readAuthToken();
	const authHeaders =
		token.length === 0 ? {} : { Authorization: `Bearer ${token}` };

	const response = await fetcher(`${getApiBaseUrl()}${path}`, {
		method: "GET",
		headers: {
			Accept: "text/plain",
			...authHeaders,
		},
	});
	const rawText = await response.text();
	if (!response.ok) {
		let message = rawText;
		try {
			const payload = JSON.parse(rawText);
			message = getPayloadError({ payload }) || rawText;
		} catch {
			message = rawText;
		}
		throw new Error(message || `Request failed (${response.status})`);
	}
	return rawText;
}

async function requestAgentBlob({ path }) {
	const fetcher = getFetch();
	if (!fetcher) {
		throw new Error("Fetch API is unavailable");
	}

	const token = readAuthToken();
	const authHeaders =
		token.length === 0 ? {} : { Authorization: `Bearer ${token}` };

	const response = await fetcher(`${getApiBaseUrl()}${path}`, {
		method: "GET",
		headers: {
			Accept: "application/octet-stream",
			...authHeaders,
		},
	});
	if (!response.ok) {
		const rawText = await response.text();
		let message = rawText;
		try {
			const payload = JSON.parse(rawText);
			message = getPayloadError({ payload }) || rawText;
		} catch {
			message = rawText;
		}
		throw new Error(message || `Request failed (${response.status})`);
	}
	return response.blob();
}

function buildCodexCommand() {
	return CODEX_AGENT_COMMAND;
}

function createTerminalPromptMarker() {
	return `QCUT_CODEX_PROMPT_${Date.now().toString(36)}_${Math.random()
		.toString(36)
		.slice(2)}`;
}

function buildTerminalPromptCommand({ prompt, messages, marker }) {
	const promptMarker =
		typeof marker === "string" && marker.trim().length > 0
			? marker.trim()
			: createTerminalPromptMarker();
	return (
		[
			"mkdir -p /tmp/qcut-output",
			`cat > /tmp/qcut-terminal-prompt.md <<'${promptMarker}'`,
			buildCodexChatPrompt({ messages, prompt }),
			promptMarker,
			`${CODEX_TERMINAL_COMMAND} < /tmp/qcut-terminal-prompt.md`,
			"printf '\\n[artifacts]\\n'",
			`find /tmp/qcut-output -maxdepth 1 -type f -printf '%f (%s bytes)\\n' 2>/dev/null | sort`,
		].join("\n") + "\n"
	);
}

function buildCodexChatPrompt({ messages, prompt }) {
	const currentPrompt =
		typeof prompt === "string" && prompt.trim().length > 0
			? prompt.trim()
			: "Summarize the current QCut agent status.";
	const priorMessages = Array.isArray(messages)
		? messages.filter(
				(message) =>
					message &&
					(message.role === "user" || message.role === "assistant") &&
					typeof message.content === "string" &&
					message.content.trim().length > 0 &&
					message.status !== "pending"
			)
		: [];
	if (priorMessages.length === 0) {
		return [
			CODEX_AGENT_SYSTEM_PROMPT,
			"",
			"Latest user message:",
			currentPrompt,
		].join("\n");
	}
	const transcript = priorMessages
		.map((message) => {
			const role = message.role === "assistant" ? "Assistant" : "User";
			return `${role}: ${message.content.trim()}`;
		})
		.join("\n\n");
	return [
		CODEX_AGENT_SYSTEM_PROMPT,
		"",
		"Continue this QCut website chat. Answer the latest user message.",
		"",
		"Conversation so far:",
		transcript,
		"",
		"Latest user message:",
		currentPrompt,
	].join("\n");
}

function buildAgentRequest({ prompt, messages }) {
	return {
		command: buildCodexCommand(),
		args: {
			source: "qcut_website_chat_agent",
			codexPrompt: buildCodexChatPrompt({ messages, prompt }),
		},
	};
}

async function createAgentJob({ command, args, sessionId }) {
	const trimmedSessionId =
		typeof sessionId === "string" && sessionId.trim().length > 0
			? sessionId.trim()
			: "";
	const payload = await requestAgentApi({
		path: "/api/agent/jobs",
		method: "POST",
		body: {
			command,
			args: args || { source: "qcut_website_chat_agent" },
			...(trimmedSessionId.length > 0 ? { sessionId: trimmedSessionId } : {}),
		},
	});
	if (!payload || typeof payload !== "object" || !payload.job) {
		throw new Error("Agent job response is invalid");
	}
	return payload.job;
}

async function createAgentSession() {
	const payload = await requestAgentApi({
		path: "/api/agent/sessions",
		method: "POST",
		body: {},
	});
	if (!payload || typeof payload !== "object" || !payload.session) {
		throw new Error("Agent session response is invalid");
	}
	return payload.session;
}

async function createAgentPtyToken({ sessionId }) {
	if (typeof sessionId !== "string" || sessionId.trim().length === 0) {
		throw new Error("Agent session id required");
	}
	const payload = await requestAgentApi({
		path: `/api/agent/sessions/${encodeURIComponent(
			sessionId.trim()
		)}/pty-token`,
		method: "POST",
		body: {},
	});
	if (
		!payload ||
		typeof payload !== "object" ||
		typeof payload.ws_url !== "string"
	) {
		throw new Error("Agent terminal response is invalid");
	}
	return payload;
}

async function getAgentSessionArtifacts({ sessionId }) {
	if (typeof sessionId !== "string" || sessionId.trim().length === 0) {
		throw new Error("Agent session id required");
	}
	const payload = await requestAgentApi({
		path: `/api/agent/sessions/${encodeURIComponent(
			sessionId.trim()
		)}/artifacts`,
		method: "GET",
	});
	return Array.isArray(payload?.artifacts) ? payload.artifacts : [];
}

async function endAgentSession({ sessionId }) {
	const value = typeof sessionId === "string" ? sessionId.trim() : "";
	if (value.length === 0) {
		return null;
	}
	const payload = await requestAgentApi({
		path: `/api/agent/sessions/${encodeURIComponent(value)}/end`,
		method: "POST",
		body: {},
	});
	return payload?.session || null;
}

async function getAgentJobDetail({ jobId }) {
	if (typeof jobId !== "string" || jobId.trim().length === 0) {
		throw new Error("Job id required");
	}
	return requestAgentApi({
		path: `/api/agent/jobs/${encodeURIComponent(jobId.trim())}`,
		method: "GET",
	});
}

async function getAgentArtifactText({ jobId, artifactId }) {
	if (typeof jobId !== "string" || jobId.trim().length === 0) {
		throw new Error("Job id required");
	}
	if (typeof artifactId !== "string" || artifactId.trim().length === 0) {
		throw new Error("Artifact id required");
	}
	return requestAgentText({
		path: `/api/agent/jobs/${encodeURIComponent(
			jobId.trim()
		)}/artifacts/${encodeURIComponent(artifactId.trim())}/text`,
	});
}

function buildAgentArtifactDownloadPath({ jobId, artifactId }) {
	if (typeof jobId !== "string" || jobId.trim().length === 0) {
		throw new Error("Job id required");
	}
	if (typeof artifactId !== "string" || artifactId.trim().length === 0) {
		throw new Error("Artifact id required");
	}
	return `/api/agent/jobs/${encodeURIComponent(
		jobId.trim()
	)}/artifacts/${encodeURIComponent(artifactId.trim())}/download`;
}

function buildAgentSessionArtifactDownloadPath({ sessionId, filename }) {
	if (typeof sessionId !== "string" || sessionId.trim().length === 0) {
		throw new Error("Agent session id required");
	}
	if (typeof filename !== "string" || filename.trim().length === 0) {
		throw new Error("Artifact filename required");
	}
	return `/api/agent/sessions/${encodeURIComponent(
		sessionId.trim()
	)}/artifacts/${encodeURIComponent(filename.trim())}/download`;
}

async function downloadAgentArtifact({ jobId, artifact }) {
	const filename = getArtifactFilename({ artifact }) || "qcut-artifact";
	const downloadPath =
		typeof artifact?.sessionId === "string" &&
		artifact.sessionId.trim().length > 0
			? buildAgentSessionArtifactDownloadPath({
					sessionId: artifact.sessionId,
					filename,
				})
			: buildAgentArtifactDownloadPath({
					jobId,
					artifactId: artifact?.id,
				});
	const blob = await requestAgentBlob({
		path: downloadPath,
	});
	const win = getRuntimeWindow();
	const doc = win?.document;
	if (!win?.URL || !doc) {
		throw new Error("Browser download APIs are unavailable");
	}

	const objectUrl = win.URL.createObjectURL(blob);
	try {
		const anchor = doc.createElement("a");
		anchor.href = objectUrl;
		anchor.download = filename;
		anchor.style.display = "none";
		doc.body.appendChild(anchor);
		anchor.click();
		anchor.remove();
	} finally {
		win.setTimeout(() => win.URL.revokeObjectURL(objectUrl), 1000);
	}
}

function isTerminalStatus({ status }) {
	return TERMINAL_STATUSES.includes(status);
}

function getElement({ id }) {
	const win = getRuntimeWindow();
	return win?.document?.getElementById(id) || null;
}

function setText({ id, text }) {
	const element = getElement({ id });
	if (element) {
		element.textContent = text;
	}
}

function setValue({ id, value }) {
	const element = getElement({ id });
	if (element && "value" in element) {
		element.value = value;
	}
}

function getValue({ id }) {
	const element = getElement({ id });
	if (element && typeof element.value === "string") {
		return element.value;
	}
	return "";
}

function setHidden({ id, hidden }) {
	const element = getElement({ id });
	if (element) {
		element.classList.toggle("hidden", hidden);
	}
}

function setDisabled({ id, disabled }) {
	const element = getElement({ id });
	if (element) {
		element.disabled = disabled;
	}
}

function renderAgentSession({ session }) {
	const status = getElement({ id: "agent-session-status" });
	if (!status) {
		return;
	}
	if (!session) {
		const storedSessionId = readStoredAgentSessionId();
		status.textContent =
			storedSessionId.length > 0 ? `saved ${storedSessionId}` : "none";
		return;
	}
	const sessionId = typeof session.id === "string" ? session.id : "";
	const sessionStatus =
		typeof session.status === "string" ? session.status : "active";
	status.textContent =
		sessionId.length > 0 ? `${sessionStatus} ${sessionId}` : sessionStatus;
}

async function ensureAgentSession() {
	const session = await createAgentSession();
	if (typeof session?.id === "string" && session.id.trim().length > 0) {
		saveStoredAgentSessionId({ sessionId: session.id });
	}
	renderAgentSession({ session });
	return session;
}

async function resetAgentSession() {
	showError({ message: "" });
	disconnectAgentTerminal();
	const sessionId = readStoredAgentSessionId();
	setDisabled({ id: "agent-new-session", disabled: true });
	try {
		if (sessionId.length > 0) {
			await endAgentSession({ sessionId });
		}
		clearStoredAgentSessionId();
		chatMessages.length = 0;
		renderChatMessages();
		resetJobState();
		renderAgentSession({ session: null });
	} catch (error) {
		showError({
			message:
				error instanceof Error
					? `Failed to reset session: ${error.message}`
					: "Failed to reset session",
		});
	} finally {
		setDisabled({ id: "agent-new-session", disabled: false });
	}
}

function appendChatMessage({ role, content, status }) {
	const id = `${Date.now()}-${chatMessages.length}`;
	chatMessages.push({ id, role, content, status: status || "ready" });
	renderChatMessages();
	return id;
}

function updateChatMessage({ id, content, status }) {
	const message = chatMessages.find((item) => item.id === id);
	if (!message) {
		return;
	}
	message.content = content;
	message.status = status || "ready";
	renderChatMessages();
}

function renderChatMessages() {
	const list = getElement({ id: "agent-chat-log" });
	const doc = getRuntimeWindow()?.document;
	if (!list || !doc) {
		return;
	}
	list.innerHTML = "";
	if (chatMessages.length === 0) {
		const empty = doc.createElement("p");
		empty.className = "text-sm text-muted";
		empty.textContent = "Codex replies will appear here after each run.";
		list.appendChild(empty);
		return;
	}

	for (const message of chatMessages) {
		const row = doc.createElement("div");
		row.className = `agent-chat-message ${message.role === "user" ? "agent-chat-user" : "agent-chat-assistant"}`;

		const label = doc.createElement("div");
		label.className = "text-xs font-medium uppercase tracking-wider";
		label.textContent = message.role === "user" ? "You" : "Codex";

		const body = doc.createElement("div");
		body.className = "mt-2 whitespace-pre-wrap";
		body.textContent = message.content;

		if (message.status === "pending") {
			row.classList.add("agent-chat-pending");
		}
		row.append(label, body);
		list.appendChild(row);
	}
	list.scrollTop = list.scrollHeight;
}

function renderJob({ job }) {
	if (!job) {
		return;
	}
	setText({ id: "agent-job-id", text: job.id || "-" });
	setText({ id: "agent-job-status", text: job.status || "-" });
	setText({
		id: "agent-job-exit",
		text:
			job.exitCode === null || job.exitCode === undefined
				? "-"
				: String(job.exitCode),
	});
	setText({ id: "agent-job-runner", text: job.runnerId || "-" });
	setText({ id: "agent-job-error", text: job.error || "" });
	setHidden({ id: "agent-job-empty", hidden: true });
	setHidden({ id: "agent-job-summary", hidden: false });
}

function clearActiveJobPoll() {
	const win = getRuntimeWindow();
	if (!win || activeJobPollIntervalId === null) {
		return;
	}
	win.clearInterval(activeJobPollIntervalId);
	activeJobPollIntervalId = null;
}

function resetJobState() {
	clearActiveJobPoll();
	setText({ id: "agent-job-status", text: "idle" });
	setText({ id: "agent-job-id", text: "-" });
	setText({ id: "agent-job-exit", text: "-" });
	setText({ id: "agent-job-runner", text: "-" });
	setText({ id: "agent-job-error", text: "" });
	setHidden({ id: "agent-job-empty", hidden: false });
	setHidden({ id: "agent-job-summary", hidden: true });
	renderArtifacts({ artifacts: [] });
	renderEvents({ events: [] });
}

function getArtifactFilename({ artifact }) {
	const filename = artifact?.meta?.filename;
	if (typeof filename === "string" && filename.length > 0) {
		return filename;
	}
	const storagePath =
		typeof artifact?.storagePath === "string" ? artifact.storagePath : "";
	const parts = storagePath.split("/");
	return parts[parts.length - 1] || "";
}

function formatArtifactSize({ artifact }) {
	const bytes = Number(artifact?.bytes || 0);
	if (!Number.isFinite(bytes) || bytes <= 0) {
		return "0 bytes";
	}
	if (bytes < 1024) {
		return `${bytes} bytes`;
	}
	if (bytes < 1024 * 1024) {
		return `${(bytes / 1024).toFixed(1)} KB`;
	}
	return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function findCodexLastMessageArtifact({ artifacts }) {
	if (!Array.isArray(artifacts)) {
		return null;
	}
	return (
		artifacts.find(
			(artifact) =>
				getArtifactFilename({ artifact }) === CODEX_LAST_MESSAGE_FILE
		) || null
	);
}

function getEventPayloadMessage({ payload }) {
	if (!payload || typeof payload !== "object") {
		return "";
	}
	if (
		payload.item &&
		typeof payload.item === "object" &&
		payload.item.type === "agent_message" &&
		typeof payload.item.text === "string" &&
		payload.item.text.trim().length > 0
	) {
		return payload.item.text.trim();
	}
	if (
		typeof payload.message === "string" &&
		payload.message.trim().length > 0
	) {
		return payload.message.trim();
	}
	if (typeof payload.type === "string" && payload.type.trim().length > 0) {
		const status =
			typeof payload.status === "string" && payload.status.trim().length > 0
				? ` ${payload.status.trim()}`
				: "";
		return `${payload.type.trim()}${status}`;
	}
	try {
		return JSON.stringify(payload);
	} catch {
		return "";
	}
}

function formatEventPreview({ event }) {
	const kind =
		typeof event?.kind === "string" && event.kind.trim().length > 0
			? event.kind.trim()
			: "event";
	const message = getEventPayloadMessage({ payload: event?.payload });
	const preview = message.length > 0 ? `${kind}: ${message}` : kind;
	return preview.length > 180 ? `${preview.slice(0, 177)}...` : preview;
}

function getLatestCodexAgentMessage({ events }) {
	if (!Array.isArray(events)) {
		return "";
	}
	const chronological = events.slice().sort((left, right) => {
		const leftTime = Date.parse(left?.createdAt || "");
		const rightTime = Date.parse(right?.createdAt || "");
		return (
			(Number.isNaN(leftTime) ? 0 : leftTime) -
			(Number.isNaN(rightTime) ? 0 : rightTime)
		);
	});
	for (let index = chronological.length - 1; index >= 0; index -= 1) {
		const payload = chronological[index]?.payload;
		if (!payload || typeof payload !== "object") {
			continue;
		}
		const item =
			payload.item && typeof payload.item === "object" ? payload.item : null;
		if (
			item?.type === "agent_message" &&
			typeof item.text === "string" &&
			item.text.trim().length > 0
		) {
			return item.text.trim();
		}
	}
	return "";
}

function buildLiveCodexStatus({ events }) {
	const base = "Running Codex in the Daytona sandbox...";
	const latestAgentMessage = getLatestCodexAgentMessage({ events });
	if (latestAgentMessage.length > 0) {
		return latestAgentMessage;
	}
	if (!Array.isArray(events) || events.length === 0) {
		return base;
	}
	const chronological = events
		.slice()
		.sort((left, right) => {
			const leftTime = Date.parse(left?.createdAt || "");
			const rightTime = Date.parse(right?.createdAt || "");
			return (
				(Number.isNaN(leftTime) ? 0 : leftTime) -
				(Number.isNaN(rightTime) ? 0 : rightTime)
			);
		})
		.slice(-4)
		.map((event) => formatEventPreview({ event }))
		.filter((line) => line.length > 0);
	if (chronological.length === 0) {
		return base;
	}
	return [base, "", ...chronological].join("\n");
}

function renderArtifacts({ artifacts }) {
	const list = getElement({ id: "agent-artifacts" });
	const doc = getRuntimeWindow()?.document;
	if (!list) {
		return;
	}
	list.innerHTML = "";
	if (!Array.isArray(artifacts) || artifacts.length === 0) {
		const empty = doc.createElement("p");
		empty.className = "text-sm text-muted";
		empty.textContent =
			"Artifacts will appear after Codex writes files under /tmp/qcut-output.";
		list.appendChild(empty);
		return;
	}

	for (const artifact of artifacts) {
		const row = doc.createElement("div");
		row.className = "card rounded-xl p-4";

		const shell = doc.createElement("div");
		shell.className =
			"flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between";

		const content = doc.createElement("div");
		const kind = doc.createElement("div");
		kind.className = "text-sm font-medium";
		kind.textContent = artifact.kind || "artifact";
		const path = doc.createElement("div");
		path.className = "mono text-xs mt-1 break-all";
		path.style.color = "var(--text-muted)";
		path.textContent = artifact.storagePath || "";
		content.append(kind, path);

		const actions = doc.createElement("div");
		actions.className = "flex shrink-0 items-center gap-3";

		const size = doc.createElement("div");
		size.className = "text-xs text-muted";
		size.textContent = formatArtifactSize({ artifact });

		const downloadButton = doc.createElement("button");
		downloadButton.type = "button";
		downloadButton.className =
			"btn-outline px-4 py-2 rounded-full text-xs font-medium";
		downloadButton.textContent = "Download";
		downloadButton.disabled = !canDownloadArtifact({ artifact });
		downloadButton.addEventListener("click", async () => {
			const originalText = downloadButton.textContent;
			downloadButton.disabled = true;
			downloadButton.textContent = "Downloading";
			showError({ message: "" });
			try {
				await downloadAgentArtifact({
					jobId: artifact.jobId,
					artifact,
				});
			} catch (error) {
				showError({
					message:
						error instanceof Error
							? `Artifact download failed: ${error.message}`
							: "Artifact download failed",
				});
			} finally {
				downloadButton.disabled = !canDownloadArtifact({ artifact });
				downloadButton.textContent = originalText;
			}
		});

		actions.append(size, downloadButton);
		shell.append(content, actions);
		row.appendChild(shell);
		list.appendChild(row);
	}
}

function canDownloadArtifact({ artifact }) {
	return Boolean(
		artifact?.id &&
			(artifact.jobId ||
				(typeof artifact.sessionId === "string" &&
					artifact.sessionId.trim().length > 0))
	);
}

function renderEvents({ events }) {
	const list = getElement({ id: "agent-events" });
	const doc = getRuntimeWindow()?.document;
	if (!list) {
		return;
	}
	list.innerHTML = "";
	if (!Array.isArray(events) || events.length === 0) {
		const empty = doc.createElement("p");
		empty.className = "text-sm text-muted";
		empty.textContent = "Worker events will appear as the job runs.";
		list.appendChild(empty);
		return;
	}

	for (const event of events) {
		const row = doc.createElement("div");
		row.className = "card rounded-xl p-4";

		const header = doc.createElement("div");
		header.className = "flex items-center justify-between gap-4";
		const kind = doc.createElement("div");
		kind.className = "text-sm font-medium";
		kind.textContent = event.kind || "event";
		const time = doc.createElement("div");
		time.className = "text-xs text-muted";
		time.textContent = event.createdAt
			? new Date(event.createdAt).toLocaleTimeString()
			: "";
		header.append(kind, time);

		const payload = doc.createElement("pre");
		payload.className = "cmd-code mt-3 p-3 whitespace-pre-wrap";
		payload.textContent = JSON.stringify(event.payload || {}, null, 2);

		row.append(header, payload);
		list.appendChild(row);
	}
}

function getWebSocketConstructor() {
	return (
		getRuntimeWindow()?.WebSocket || getRuntimeGlobal()?.WebSocket || null
	);
}

function getTextDecoder() {
	return (
		getRuntimeWindow()?.TextDecoder || getRuntimeGlobal()?.TextDecoder || null
	);
}

function setTerminalStatus({ text }) {
	setText({ id: "agent-terminal-status", text });
}

function getTerminalStatus() {
	if (!terminalSocket) {
		return "disconnected";
	}
	if (terminalSocket.readyState === 1) {
		return "connected";
	}
	if (terminalSocket.readyState === 0) {
		return "connecting";
	}
	return "disconnected";
}

function clearTerminalArtifactPoll() {
	const win = getRuntimeWindow();
	if (!win || terminalArtifactPollIntervalId === null) {
		return;
	}
	win.clearInterval(terminalArtifactPollIntervalId);
	terminalArtifactPollIntervalId = null;
}

function startTerminalArtifactPoll() {
	const win = getRuntimeWindow();
	if (!win || terminalArtifactPollIntervalId !== null) {
		return;
	}
	terminalArtifactPollIntervalId = win.setInterval(() => {
		void refreshSessionArtifacts();
	}, 5000);
}

function getTerminalGlobal() {
	return getRuntimeWindow()?.Terminal || getRuntimeGlobal()?.Terminal || null;
}

function getFitAddonGlobal() {
	const win = getRuntimeWindow();
	const runtime = getRuntimeGlobal();
	return win?.FitAddon?.FitAddon || runtime?.FitAddon?.FitAddon || null;
}

function fitTerminalNow() {
	try {
		terminalFitAddon?.fit();
		if (terminalInstance?.rows) {
			terminalInstance.refresh(0, terminalInstance.rows - 1);
		}
	} catch {
		return;
	}
}

function scheduleTerminalFit() {
	const win = getRuntimeWindow();
	if (!win || typeof win.requestAnimationFrame !== "function") {
		fitTerminalNow();
		return;
	}
	win.requestAnimationFrame(() => {
		fitTerminalNow();
		win.requestAnimationFrame(fitTerminalNow);
	});
}

function bindTerminalResizeListener() {
	const win = getRuntimeWindow();
	if (!win || terminalResizeListenerBound) {
		return;
	}
	win.addEventListener("resize", () => {
		scheduleTerminalFit();
		sendTerminalResize();
	});
	terminalResizeListenerBound = true;
}

function fitTerminalAfterFontsLoad() {
	const doc = getRuntimeWindow()?.document;
	const fontsReady = doc?.fonts?.ready;
	if (!fontsReady || typeof fontsReady.then !== "function") {
		return;
	}
	fontsReady.then(() => {
		scheduleTerminalFit();
		sendTerminalResize();
	});
}

function ensureTerminalRenderer() {
	const target = getElement({ id: "agent-terminal" });
	if (!target || terminalInstance) {
		return terminalInstance;
	}
	const fallback = getElement({ id: "agent-terminal-fallback" });
	const Terminal = getTerminalGlobal();
	if (!Terminal) {
		if (fallback) {
			fallback.textContent =
				"xterm.js did not load. The terminal websocket can still be tested by refreshing the page.";
		}
		return null;
	}
	target.innerHTML = "";
	terminalInstance = new Terminal({
		convertEol: true,
		cursorBlink: true,
		fontFamily: '"JetBrains Mono", "SFMono-Regular", Consolas, monospace',
		fontSize: 13,
		letterSpacing: 0,
		lineHeight: 1.18,
		scrollback: 5000,
		theme: {
			background: "#0f0f12",
			foreground: "#f4f4f5",
			cursor: "#f97316",
		},
	});
	const FitAddon = getFitAddonGlobal();
	if (FitAddon) {
		terminalFitAddon = new FitAddon();
		terminalInstance.loadAddon(terminalFitAddon);
	}
	terminalInstance.open(target);
	scheduleTerminalFit();
	bindTerminalResizeListener();
	fitTerminalAfterFontsLoad();
	terminalInstance.onData((data) => sendTerminalInput({ text: data }));
	return terminalInstance;
}

function writeTerminal({ text }) {
	const terminal = ensureTerminalRenderer();
	if (terminal) {
		terminal.write(text);
		return;
	}
	const fallback = getElement({ id: "agent-terminal-fallback" });
	if (fallback) {
		fallback.textContent += text;
	}
}

function sendTerminalResize() {
	if (!terminalSocket || terminalSocket.readyState !== 1) {
		return;
	}
	fitTerminalNow();
	const cols = Number(terminalInstance?.cols || 100);
	const rows = Number(terminalInstance?.rows || 30);
	terminalSocket.send(JSON.stringify({ kind: "resize", cols, rows }));
}

function sendTerminalInput({ text }) {
	if (!terminalSocket || terminalSocket.readyState !== 1) {
		return false;
	}
	terminalSocket.send(text);
	return true;
}

async function connectAgentTerminal() {
	if (terminalSocket && terminalSocket.readyState <= 1) {
		return terminalSocket;
	}
	setTerminalStatus({ text: "connecting" });
	showError({ message: "" });
	const WebSocketCtor = getWebSocketConstructor();
	if (!WebSocketCtor) {
		throw new Error("WebSocket API is unavailable");
	}
	const token = getValue({ id: "agent-token" });
	if (token.trim().length > 0) {
		saveAuthToken({ token });
	}
	const session = await ensureAgentSession();
	activeTerminalSessionId = session?.id || "";
	const payload = await createAgentPtyToken({
		sessionId: activeTerminalSessionId,
	});
	ensureTerminalRenderer();
	terminalSocket = new WebSocketCtor(payload.ws_url);
	terminalSocket.binaryType = "arraybuffer";
	terminalSocket.addEventListener("open", () => {
		setTerminalStatus({ text: "connected" });
		setText({ id: "agent-job-status", text: "terminal" });
		sendTerminalResize();
		startTerminalArtifactPoll();
	});
	terminalSocket.addEventListener("message", (event) => {
		const Decoder = getTextDecoder();
		if (!Decoder) {
			return;
		}
		if (typeof event.data === "string") {
			writeTerminal({ text: event.data });
			return;
		}
		writeTerminal({ text: new Decoder().decode(event.data) });
	});
	terminalSocket.addEventListener("close", () => {
		setTerminalStatus({ text: "disconnected" });
		clearTerminalArtifactPoll();
	});
	terminalSocket.addEventListener("error", () => {
		setTerminalStatus({ text: "error" });
	});
	return terminalSocket;
}

function disconnectAgentTerminal() {
	if (terminalSocket && terminalSocket.readyState <= 1) {
		terminalSocket.close(1000, "user_disconnect");
	}
	terminalSocket = null;
	clearTerminalArtifactPoll();
	setTerminalStatus({ text: "disconnected" });
}

function autoConnectAgentTerminal() {
	const win = getRuntimeWindow();
	const connect = () => {
		void connectAgentTerminal().catch((error) => {
			showError({
				message:
					error instanceof Error
						? `Terminal auto-connect failed: ${error.message}`
						: "Terminal auto-connect failed",
			});
		});
	};
	if (win && typeof win.setTimeout === "function") {
		win.setTimeout(connect, 0);
		return;
	}
	connect();
}

async function refreshSessionArtifacts() {
	const sessionId = activeTerminalSessionId || readStoredAgentSessionId();
	if (sessionId.length === 0) {
		return;
	}
	try {
		const artifacts = await getAgentSessionArtifacts({ sessionId });
		renderArtifacts({ artifacts });
	} catch (error) {
		showError({
			message:
				error instanceof Error
					? `Artifact refresh failed: ${error.message}`
					: "Artifact refresh failed",
		});
	}
}

function setCommandPreview() {
	const prompt = getValue({ id: "agent-prompt" });
	setText({
		id: "agent-command-preview",
		text: buildTerminalPromptCommand({
			prompt,
			messages: chatMessages,
			marker: "QCUT_CODEX_PROMPT",
		}),
	});
}

function showError({ message }) {
	setText({ id: "agent-error", text: message });
	setHidden({ id: "agent-error", hidden: message.length === 0 });
}

async function resolveCodexChatReply({ detail, assistantMessageId }) {
	if (detail.job?.status !== "succeeded") {
		updateChatMessage({
			id: assistantMessageId,
			content:
				detail.job?.error || "Codex job failed before returning a reply.",
			status: "error",
		});
		return;
	}
	const artifact = findCodexLastMessageArtifact({
		artifacts: detail.artifacts,
	});
	if (!artifact?.id) {
		updateChatMessage({
			id: assistantMessageId,
			content: "Codex finished, but no final message artifact was uploaded.",
			status: "error",
		});
		return;
	}
	try {
		const text = await getAgentArtifactText({
			jobId: detail.job.id,
			artifactId: artifact.id,
		});
		updateChatMessage({
			id: assistantMessageId,
			content:
				typeof text === "string" && text.trim().length > 0
					? text.trim()
					: "(empty response)",
			status: "ready",
		});
	} catch (error) {
		updateChatMessage({
			id: assistantMessageId,
			content:
				error instanceof Error
					? `Codex replied, but the website could not load it: ${error.message}`
					: "Codex replied, but the website could not load it.",
			status: "error",
		});
	}
}

function pollJob({ jobId, assistantMessageId }) {
	const win = getRuntimeWindow();
	if (!win) {
		return;
	}
	clearActiveJobPoll();
	const intervalId = win.setInterval(async () => {
		try {
			const detail = await getAgentJobDetail({ jobId });
			renderJob({ job: detail.job });
			renderArtifacts({ artifacts: detail.artifacts });
			renderEvents({ events: detail.events });
			const isTerminal = isTerminalStatus({ status: detail.job?.status });
			if (assistantMessageId && !isTerminal) {
				updateChatMessage({
					id: assistantMessageId,
					content: buildLiveCodexStatus({ events: detail.events }),
					status: "pending",
				});
			}
			if (isTerminal) {
				win.clearInterval(intervalId);
				activeJobPollIntervalId = null;
				setDisabled({ id: "agent-submit", disabled: false });
				if (assistantMessageId) {
					await resolveCodexChatReply({ detail, assistantMessageId });
				}
			}
		} catch (error) {
			showError({
				message:
					error instanceof Error ? error.message : "Failed to refresh job",
			});
		}
	}, 2500);
	activeJobPollIntervalId = intervalId;
}

async function submitAgentJob() {
	showError({ message: "" });
	setDisabled({ id: "agent-submit", disabled: true });

	try {
		const prompt = getValue({ id: "agent-prompt" });
		const visiblePrompt =
			typeof prompt === "string" && prompt.trim().length > 0
				? prompt.trim()
				: "Summarize the current QCut agent status.";
		await connectAgentTerminal();
		const command = buildTerminalPromptCommand({
			prompt,
			messages: chatMessages,
		});
		const sent = sendTerminalInput({ text: command });
		if (!sent) {
			throw new Error(`Terminal is ${getTerminalStatus()}`);
		}
		appendChatMessage({
			role: "user",
			content: visiblePrompt,
		});
		appendChatMessage({
			role: "assistant",
			content:
				"Sent to the Daytona terminal. Watch the live Codex output above.",
		});
		setText({ id: "agent-job-status", text: "running" });
		startTerminalArtifactPoll();
	} catch (error) {
		showError({
			message:
				error instanceof Error ? error.message : "Failed to submit job",
		});
	} finally {
		setDisabled({ id: "agent-submit", disabled: false });
	}
}

function initAgentChatPage() {
	const promptInput = getElement({ id: "agent-prompt" });
	const submitButton = getElement({ id: "agent-submit" });
	const newSessionButton = getElement({ id: "agent-new-session" });
	const terminalConnectButton = getElement({ id: "agent-terminal-connect" });
	const terminalDisconnectButton = getElement({
		id: "agent-terminal-disconnect",
	});
	const refreshArtifactsButton = getElement({
		id: "agent-refresh-artifacts",
	});
	if (!promptInput || !submitButton) {
		return;
	}

	setValue({ id: "agent-token", value: readAuthToken() });
	renderAgentSession({ session: null });
	setCommandPreview();
	promptInput.addEventListener("input", setCommandPreview);
	submitButton.addEventListener("click", submitAgentJob);
	if (newSessionButton) {
		newSessionButton.addEventListener("click", resetAgentSession);
	}
	if (terminalConnectButton) {
		terminalConnectButton.addEventListener("click", () => {
			void connectAgentTerminal().catch((error) => {
				showError({
					message:
						error instanceof Error
							? `Terminal connect failed: ${error.message}`
							: "Terminal connect failed",
				});
			});
		});
	}
	if (terminalDisconnectButton) {
		terminalDisconnectButton.addEventListener(
			"click",
			disconnectAgentTerminal
		);
	}
	if (refreshArtifactsButton) {
		refreshArtifactsButton.addEventListener("click", () => {
			void refreshSessionArtifacts();
		});
	}
	autoConnectAgentTerminal();
}

const AgentChatAPI = {
	buildLiveCodexStatus,
	buildAgentArtifactDownloadPath,
	buildAgentSessionArtifactDownloadPath,
	buildAgentRequest,
	buildCodexChatPrompt,
	buildCodexCommand,
	buildTerminalPromptCommand,
	CODEX_AGENT_COMMAND,
	CODEX_TERMINAL_COMMAND,
	autoConnectAgentTerminal,
	clearStoredAgentSessionId,
	createAgentJob,
	createAgentPtyToken,
	createAgentSession,
	downloadAgentArtifact,
	endAgentSession,
	ensureAgentSession,
	findCodexLastMessageArtifact,
	formatArtifactSize,
	getArtifactFilename,
	getAgentArtifactText,
	getAgentJobDetail,
	getAgentSessionArtifacts,
	getLatestCodexAgentMessage,
	isTerminalStatus,
	readStoredAgentSessionId,
	saveStoredAgentSessionId,
};

if (typeof module !== "undefined" && module.exports) {
	module.exports = AgentChatAPI;
}

if (
	typeof window !== "undefined" &&
	typeof window.addEventListener === "function"
) {
	window.AgentChatAPI = AgentChatAPI;
	window.addEventListener("DOMContentLoaded", initAgentChatPage);
}
})();
