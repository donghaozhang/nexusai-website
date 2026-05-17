(() => {
const DEFAULT_LICENSE_SERVER_URL =
	"https://qcut-license-server.zdhpeter.workers.dev";

const MAX_SESSION_UPLOAD_BYTES = 25 * 1024 * 1024;
const TERMINAL_STATUSES = ["succeeded", "failed", "cancelled"];
const CODEX_AGENT_COMMAND = "codex exec --skip-git-repo-check --json -";
const CODEX_TERMINAL_COMMAND =
	"codex exec --skip-git-repo-check --dangerously-bypass-approvals-and-sandbox --output-last-message /tmp/qcut-output/codex-last-message.md -";
const CODEX_LAST_MESSAGE_FILE = "codex-last-message.md";
const AGENT_SESSION_STORAGE_KEY = "qcut_agent_session_id";
const BRACKETED_PASTE_START = "\u001b[200~";
const BRACKETED_PASTE_END = "\u001b[201~";
const CODEX_AGENT_SYSTEM_PROMPT = [
	"You are running inside QCut's Daytona CLI image.",
	"The QCut native CLI skill is available at /home/qcut/qcut/.claude/skills/native-cli/SKILL.md.",
	"Read that skill before running nontrivial QCut CLI workflows or when command syntax is unclear.",
	"Use shell commands when the user asks you to inspect or run QCut.",
	"For image generation requests, run the QCut CLI rather than any external image tool.",
	"Uploaded user files are available under /tmp/qcut-input.",
	"When the user mentions an uploaded file or image, inspect /tmp/qcut-input first.",
	"Write generated files under /tmp/qcut-output so the website can list and download them.",
	"The QCut CLI default output directory is QCUT_OUTPUT_DIR=/tmp/qcut-output in this sandbox.",
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
let currentSandboxPath = "/";
let uppyUploader = null;

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
	return parsePayloadText({ rawText });
}

function parsePayloadText({ rawText }) {
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

async function requestAgentMultipart({ path, method, formData }) {
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
		},
		body: formData,
	});
	const payload = await parsePayload({ response });
	if (!response.ok) {
		const error = getPayloadError({ payload });
		throw new Error(error || `Request failed (${response.status})`);
	}
	return payload;
}

function getXMLHttpRequestConstructor() {
	return (
		getRuntimeWindow()?.XMLHttpRequest ||
		getRuntimeGlobal()?.XMLHttpRequest ||
		null
	);
}

function requestAgentMultipartWithProgress({
	path,
	method,
	formData,
	onProgress,
}) {
	const XMLHttpRequestCtor = getXMLHttpRequestConstructor();
	if (!XMLHttpRequestCtor) {
		return requestAgentMultipart({ path, method, formData });
	}
	return new Promise((resolve, reject) => {
		const xhr = new XMLHttpRequestCtor();
		xhr.open(method, `${getApiBaseUrl()}${path}`);
		xhr.setRequestHeader("Accept", "application/json");
		const token = readAuthToken();
		if (token.length > 0) {
			xhr.setRequestHeader("Authorization", `Bearer ${token}`);
		}
		if (xhr.upload && typeof onProgress === "function") {
			xhr.upload.addEventListener("progress", (event) => {
				const total =
					event.lengthComputable && event.total > 0 ? event.total : 0;
				onProgress({
					loaded: event.loaded,
					total,
					percent: total > 0 ? Math.round((event.loaded / total) * 100) : null,
				});
			});
		}
		xhr.addEventListener("load", () => {
			const payload = parsePayloadText({ rawText: xhr.responseText || "" });
			if (xhr.status < 200 || xhr.status >= 300) {
				const error = getPayloadError({ payload });
				reject(new Error(error || `Request failed (${xhr.status})`));
				return;
			}
			resolve(payload);
		});
		xhr.addEventListener("error", () => {
			reject(new Error("Upload request failed"));
		});
		xhr.addEventListener("abort", () => {
			reject(new Error("Upload cancelled"));
		});
		xhr.send(formData);
	});
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
			"mkdir -p /tmp/qcut-input /tmp/qcut-output",
			`cat > /tmp/qcut-terminal-prompt.md <<'${promptMarker}'`,
			buildCodexChatPrompt({ messages, prompt }),
			promptMarker,
			`${CODEX_TERMINAL_COMMAND} < /tmp/qcut-terminal-prompt.md`,
			"printf '\\n[input files]\\n'",
			`find /tmp/qcut-input -maxdepth 1 -type f -printf '%f (%s bytes)\\n' 2>/dev/null | sort`,
			"printf '\\n[output files]\\n'",
			`find /tmp/qcut-output -maxdepth 1 -type f -printf '%f (%s bytes)\\n' 2>/dev/null | sort`,
		].join("\n") + "\n"
	);
}

function buildInteractiveCodexInput({ prompt }) {
	const currentPrompt =
		typeof prompt === "string" && prompt.trim().length > 0
			? prompt.trim()
			: "Summarize the current QCut agent status.";
	return `${BRACKETED_PASTE_START}${sanitizeTerminalPaste({
		text: currentPrompt,
	})}${BRACKETED_PASTE_END}\r`;
}

function sanitizeTerminalPaste({ text }) {
	return String(text)
		.replaceAll(BRACKETED_PASTE_START, "")
		.replaceAll(BRACKETED_PASTE_END, "");
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

async function getAgentSessionFiles({ sessionId, path: sandboxPath }) {
	if (typeof sessionId !== "string" || sessionId.trim().length === 0) {
		throw new Error("Agent session id required");
	}
	const path = normalizeSandboxPath({
		value: sandboxPath,
		fallback: "",
	});
	const query = path.length > 0 ? `?path=${encodeURIComponent(path)}` : "";
	const payload = await requestAgentApi({
		path: `/api/agent/sessions/${encodeURIComponent(
			sessionId.trim()
		)}/files${query}`,
		method: "GET",
	});
	return Array.isArray(payload?.files) ? payload.files : [];
}

async function uploadAgentSessionFiles({
	sessionId,
	files,
	path: sandboxPath,
	onProgress,
}) {
	if (typeof sessionId !== "string" || sessionId.trim().length === 0) {
		throw new Error("Agent session id required");
	}
	const uploads = Array.from(files || []).filter(Boolean);
	if (uploads.length === 0) {
		throw new Error("Choose at least one file to upload");
	}
	const path = normalizeSandboxPath({
		value: sandboxPath,
		fallback: "",
	});
	const query = path.length > 0 ? `?path=${encodeURIComponent(path)}` : "";
	const FormDataCtor =
		getRuntimeWindow()?.FormData || getRuntimeGlobal()?.FormData || null;
	if (!FormDataCtor) {
		throw new Error("FormData API is unavailable");
	}
	const formData = new FormDataCtor();
	for (const file of uploads) {
		formData.append("file", file);
	}
	const requestMultipart =
		typeof onProgress === "function"
			? requestAgentMultipartWithProgress
			: requestAgentMultipart;
	const payload = await requestMultipart({
		path: `/api/agent/sessions/${encodeURIComponent(
			sessionId.trim()
		)}/files${query}`,
		method: "POST",
		formData,
		onProgress,
	});
	return Array.isArray(payload?.files) ? payload.files : [];
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

function buildAgentSessionFileDownloadPath({ sessionId, folder, filename }) {
	if (typeof sessionId !== "string" || sessionId.trim().length === 0) {
		throw new Error("Agent session id required");
	}
	if (folder !== "input" && folder !== "output") {
		throw new Error("Session file folder required");
	}
	if (typeof filename !== "string" || filename.trim().length === 0) {
		throw new Error("Session file filename required");
	}
	return `/api/agent/sessions/${encodeURIComponent(
		sessionId.trim()
	)}/files/${encodeURIComponent(folder)}/${encodeURIComponent(
		filename.trim()
	)}/download`;
}

function buildAgentSessionFilesystemDownloadPath({ sessionId, path }) {
	if (typeof sessionId !== "string" || sessionId.trim().length === 0) {
		throw new Error("Agent session id required");
	}
	const normalizedPath = normalizeSandboxPath({ value: path, fallback: "" });
	if (normalizedPath.length === 0 || normalizedPath === "/") {
		throw new Error("Session file path required");
	}
	return `/api/agent/sessions/${encodeURIComponent(
		sessionId.trim()
	)}/files/download?path=${encodeURIComponent(normalizedPath)}`;
}

async function downloadAgentArtifact({ jobId, artifact }) {
	const filename = getArtifactFilename({ artifact }) || "qcut-artifact";
	const folder = artifact?.meta?.folder;
	const filesystemPath =
		typeof artifact?.meta?.path === "string" ? artifact.meta.path : "";
	const isVirtualSessionFile = folder === "input" || folder === "output";
	const isSandboxFilesystemFile =
		folder === "filesystem" && artifact?.meta?.isDir !== true;
	const downloadPath =
		typeof artifact?.sessionId === "string" &&
		artifact.sessionId.trim().length > 0
			? isSandboxFilesystemFile
				? buildAgentSessionFilesystemDownloadPath({
						sessionId: artifact.sessionId,
						path: filesystemPath || artifact.storagePath,
					})
				: isVirtualSessionFile
				? buildAgentSessionFileDownloadPath({
						sessionId: artifact.sessionId,
						folder,
						filename,
					})
				: buildAgentSessionArtifactDownloadPath({
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
	setText({ id: "agent-upload-status", text: "" });
	renderEvents({ events: [] });
}

function normalizeSandboxPath({ value, fallback }) {
	const defaultValue = typeof fallback === "string" ? fallback : "/";
	if (typeof value !== "string") {
		return defaultValue;
	}
	const trimmed = value.trim();
	if (
		trimmed.length === 0 ||
		!trimmed.startsWith("/") ||
		trimmed.includes("\\") ||
		trimmed.includes("\0")
	) {
		return defaultValue;
	}
	const segments = trimmed.split("/").filter((segment) => segment.length > 0);
	if (
		segments.some((segment) => segment === "." || segment === "..")
	) {
		return defaultValue;
	}
	return `/${segments.join("/")}`;
}

function getSandboxParentPath({ path }) {
	const normalizedPath = normalizeSandboxPath({ value: path, fallback: "/" });
	if (normalizedPath === "/") {
		return "/";
	}
	const segments = normalizedPath
		.split("/")
		.filter((segment) => segment.length > 0);
	if (segments.length <= 1) {
		return "/";
	}
	return `/${segments.slice(0, -1).join("/")}`;
}

function setSandboxPath({ path }) {
	currentSandboxPath = normalizeSandboxPath({ value: path, fallback: "/" });
	renderSandboxPath();
	refreshUploadSelectionStatus();
	void refreshSessionArtifacts();
}

function extractUppyUploadFiles({ files, FileCtor }) {
	const UploadFileCtor =
		FileCtor || getRuntimeWindow()?.File || getRuntimeGlobal()?.File || null;
	return Array.from(files || []).flatMap((file) => {
		const data = file?.data;
		if (!data || typeof file?.name !== "string" || file.name.length === 0) {
			return [];
		}
		if (typeof data.name === "string" && data.name.length > 0) {
			return [data];
		}
		if (
			UploadFileCtor &&
			typeof data.arrayBuffer === "function" &&
			typeof data.size === "number"
		) {
			return [
				new UploadFileCtor([data], file.name, {
					type:
						typeof file.type === "string"
							? file.type
							: typeof data.type === "string"
								? data.type
								: "",
				}),
			];
		}
		return [];
	});
}

function getSelectedUploadFiles({ input }) {
	const uppyFiles =
		uppyUploader && typeof uppyUploader.getFiles === "function"
			? extractUppyUploadFiles({ files: uppyUploader.getFiles() })
			: [];
	if (uppyFiles.length > 0) {
		return uppyFiles;
	}
	return Array.from(input?.files || []).filter(Boolean);
}

function clearSelectedUploadFiles({ input }) {
	if (uppyUploader) {
		if (typeof uppyUploader.clear === "function") {
			uppyUploader.clear();
		} else if (typeof uppyUploader.cancelAll === "function") {
			uppyUploader.cancelAll();
		}
	}
	if (input && "value" in input) {
		input.value = "";
	}
}

function formatUploadSelectionStatus({ count }) {
	if (!Number.isFinite(count) || count <= 0) {
		return `Files and images upload into ${currentSandboxPath}.`;
	}
	return `${count} file${count === 1 ? "" : "s"} queued for ${currentSandboxPath}.`;
}

function formatUploadProgress({ loaded, total, percent }) {
	if (Number.isFinite(percent)) {
		return `Uploading to ${currentSandboxPath}: ${percent}%`;
	}
	if (Number.isFinite(loaded) && Number.isFinite(total) && total > 0) {
		return `Uploading to ${currentSandboxPath}: ${Math.round(
			(loaded / total) * 100
		)}%`;
	}
	return `Uploading to ${currentSandboxPath}...`;
}

function getQueuedUppyUploadCount() {
	return typeof uppyUploader?.getFiles === "function"
		? uppyUploader.getFiles().length
		: 0;
}

function refreshUploadSelectionStatus() {
	if (!uppyUploader) {
		return;
	}
	setText({
		id: "agent-upload-status",
		text: formatUploadSelectionStatus({ count: getQueuedUppyUploadCount() }),
	});
}

function initUppyUploader({ Uppy, Dashboard }) {
	const target = getElement({ id: "agent-uppy-dashboard" });
	if (!target || typeof Uppy !== "function" || !Dashboard) {
		return false;
	}
	if (uppyUploader && typeof uppyUploader.close === "function") {
		uppyUploader.close();
	}
	uppyUploader = new Uppy({
		autoProceed: false,
		restrictions: {
			maxFileSize: MAX_SESSION_UPLOAD_BYTES,
			maxNumberOfFiles: 20,
		},
	});
	uppyUploader.use(Dashboard, {
		target,
		inline: true,
		height: 220,
		disableStatusBar: true,
		proudlyDisplayPoweredByUppy: false,
		note: "Files upload into the current sandbox folder selected below.",
		theme: "auto",
	});
	uppyUploader.on("file-added", refreshUploadSelectionStatus);
	uppyUploader.on("file-removed", refreshUploadSelectionStatus);
	uppyUploader.on("restriction-failed", (file, error) => {
		const name =
			typeof file?.name === "string" && file.name.length > 0
				? `${file.name}: `
				: "";
		setText({
			id: "agent-upload-status",
			text:
				error instanceof Error
					? `Upload selection failed: ${name}${error.message}`
					: "Upload selection failed.",
		});
	});
	setHidden({ id: "agent-upload-fallback", hidden: true });
	refreshUploadSelectionStatus();
	return true;
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
		empty.textContent = `No files in ${currentSandboxPath}.`;
		list.appendChild(empty);
		return;
	}

	for (const artifact of artifacts) {
		const isDir = artifact?.meta?.isDir === true;
		const artifactPath =
			typeof artifact?.meta?.path === "string" && artifact.meta.path.length > 0
				? artifact.meta.path
				: artifact.storagePath || "";
		const row = doc.createElement("div");
		row.className = "card rounded-xl p-4";
		row.dataset.path = artifactPath;
		row.dataset.kind = isDir ? "folder" : artifact.kind || "file";

		const shell = doc.createElement("div");
		shell.className =
			"flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between";

		const content = doc.createElement("div");
		const folder = artifact?.meta?.folder;
		const kind = doc.createElement("div");
		kind.className = "text-sm font-medium";
		kind.textContent = isDir
			? `folder / ${getArtifactFilename({ artifact })}`
			: folder
				? `${folder} / ${artifact.kind || "file"}`
				: artifact.kind || "artifact";
		const path = doc.createElement("div");
		path.className = "mono text-xs mt-1 break-all";
		path.style.color = "var(--text-muted)";
		path.textContent = artifactPath;
		content.append(kind, path);

		const actions = doc.createElement("div");
		actions.className = "flex shrink-0 items-center gap-3";

		const size = doc.createElement("div");
		size.className = "text-xs text-muted";
		size.textContent = isDir ? "folder" : formatArtifactSize({ artifact });

		const downloadButton = doc.createElement("button");
		downloadButton.type = "button";
		downloadButton.className =
			"btn-outline px-4 py-2 rounded-full text-xs font-medium";
		downloadButton.textContent = isDir ? "Open" : "Download";
		downloadButton.setAttribute(
			"aria-label",
			isDir ? `Open ${artifactPath}` : `Download ${artifactPath}`
		);
		downloadButton.disabled = !canDownloadArtifact({ artifact });
		downloadButton.addEventListener("click", async () => {
			if (isDir) {
				setSandboxPath({ path: artifactPath });
				return;
			}
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

function renderSandboxPath() {
	const path = normalizeSandboxPath({
		value: currentSandboxPath,
		fallback: "/",
	});
	setText({ id: "agent-fs-current-path", text: path });
	const breadcrumb = getElement({ id: "agent-fs-breadcrumb" });
	const doc = getRuntimeWindow()?.document;
	if (!breadcrumb || !doc) {
		return;
	}
	breadcrumb.innerHTML = "";
	const rootButton = doc.createElement("button");
	rootButton.type = "button";
	rootButton.className = "text-xs mono hover:underline";
	rootButton.textContent = "/";
	rootButton.addEventListener("click", () => setSandboxPath({ path: "/" }));
	breadcrumb.appendChild(rootButton);
	const segments = path.split("/").filter((segment) => segment.length > 0);
	let partialPath = "";
	for (const segment of segments) {
		partialPath = `${partialPath}/${segment}`;
		const separator = doc.createElement("span");
		separator.className = "text-xs text-muted";
		separator.textContent = " / ";
		const button = doc.createElement("button");
		button.type = "button";
		button.className = "text-xs mono hover:underline";
		button.textContent = segment;
		const targetPath = partialPath;
		button.addEventListener("click", () =>
			setSandboxPath({ path: targetPath })
		);
		breadcrumb.append(separator, button);
	}
}

function canDownloadArtifact({ artifact }) {
	if (artifact?.meta?.isDir === true) {
		return true;
	}
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

function resetTerminalOutput({ message }) {
	const text = typeof message === "string" ? message : "";
	if (terminalInstance) {
		terminalInstance.reset();
		if (text.length > 0) {
			terminalInstance.write(text);
		}
		scheduleTerminalFit();
		return;
	}
	const fallback = getElement({ id: "agent-terminal-fallback" });
	if (fallback) {
		fallback.textContent = text;
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

function waitForTerminalSocketOpen({ socket }) {
	if (socket.readyState === 1) {
		return Promise.resolve(socket);
	}
	if (socket.readyState !== 0) {
		return Promise.reject(new Error("Terminal socket is closed"));
	}
	const win = getRuntimeWindow();
	return new Promise((resolve, reject) => {
		let timeoutId = null;
		const cleanup = () => {
			socket.removeEventListener("open", handleOpen);
			socket.removeEventListener("close", handleClose);
			socket.removeEventListener("error", handleError);
			if (win && timeoutId !== null) {
				win.clearTimeout(timeoutId);
			}
		};
		const handleOpen = () => {
			cleanup();
			resolve(socket);
		};
		const handleClose = () => {
			cleanup();
			reject(new Error("Terminal socket closed before connecting"));
		};
		const handleError = () => {
			cleanup();
			reject(new Error("Terminal socket failed to connect"));
		};
		socket.addEventListener("open", handleOpen);
		socket.addEventListener("close", handleClose);
		socket.addEventListener("error", handleError);
		if (win && typeof win.setTimeout === "function") {
			timeoutId = win.setTimeout(() => {
				cleanup();
				reject(new Error("Terminal connect timed out"));
			}, 90_000);
		}
	});
}

async function connectAgentTerminal() {
	if (terminalSocket?.readyState === 1) {
		return terminalSocket;
	}
	if (terminalSocket?.readyState === 0) {
		return waitForTerminalSocketOpen({ socket: terminalSocket });
	}
	terminalSocket = null;
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
	resetTerminalOutput({ message: "Connecting to Daytona Codex...\r\n" });
	const socket = new WebSocketCtor(payload.ws_url);
	terminalSocket = socket;
	socket.binaryType = "arraybuffer";
	socket.addEventListener("open", () => {
		setTerminalStatus({ text: "connected" });
		setText({ id: "agent-job-status", text: "terminal" });
		sendTerminalResize();
		startTerminalArtifactPoll();
	});
	socket.addEventListener("message", (event) => {
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
	socket.addEventListener("close", () => {
		if (terminalSocket !== socket) {
			return;
		}
		terminalSocket = null;
		setTerminalStatus({ text: "disconnected" });
		clearTerminalArtifactPoll();
	});
	socket.addEventListener("error", () => {
		if (terminalSocket !== socket) {
			return;
		}
		setTerminalStatus({ text: "error" });
	});
	return waitForTerminalSocketOpen({ socket });
}

function disconnectAgentTerminal() {
	if (terminalSocket && terminalSocket.readyState <= 1) {
		terminalSocket.close(1000, "user_disconnect");
	}
	terminalSocket = null;
	clearTerminalArtifactPoll();
	setTerminalStatus({ text: "disconnected" });
	setText({ id: "agent-job-status", text: "idle" });
	resetTerminalOutput({ message: "Connect to open a real terminal." });
}

async function refreshSessionArtifacts() {
	const sessionId = activeTerminalSessionId || readStoredAgentSessionId();
	if (sessionId.length === 0) {
		renderSandboxPath();
		return;
	}
	try {
		renderSandboxPath();
		const artifacts = await getAgentSessionFiles({
			sessionId,
			path: currentSandboxPath,
		});
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

async function uploadSelectedAgentFiles() {
	showError({ message: "" });
	const input = getElement({ id: "agent-upload-files" });
	const files = getSelectedUploadFiles({ input });
	if (files.length === 0) {
		setText({ id: "agent-upload-status", text: "Choose a file first." });
		return;
	}
	setDisabled({ id: "agent-upload-submit", disabled: true });
	setText({ id: "agent-upload-status", text: "Connecting sandbox..." });
	try {
		await connectAgentTerminal();
		const sessionId = activeTerminalSessionId || readStoredAgentSessionId();
		setText({ id: "agent-upload-status", text: "Uploading..." });
		const uploaded = await uploadAgentSessionFiles({
			sessionId,
			files,
			path: currentSandboxPath,
			onProgress: (progress) => {
				setText({
					id: "agent-upload-status",
					text: formatUploadProgress(progress),
				});
			},
		});
		const names = uploaded
			.map((file) => getArtifactFilename({ artifact: file }))
			.filter((name) => name.length > 0);
		clearSelectedUploadFiles({ input });
		setText({
			id: "agent-upload-status",
			text:
				names.length > 0
					? `Uploaded to ${currentSandboxPath}: ${names.join(", ")}`
					: "Upload finished.",
		});
		await refreshSessionArtifacts();
	} catch (error) {
		const message =
			error instanceof Error ? error.message : "File upload failed";
		setText({ id: "agent-upload-status", text: "" });
		showError({ message: `File upload failed: ${message}` });
	} finally {
		setDisabled({ id: "agent-upload-submit", disabled: false });
	}
}

function setCommandPreview() {
	const prompt = getValue({ id: "agent-prompt" });
	setText({
		id: "agent-command-preview",
		text: `Interactive Codex input:\n${sanitizeTerminalPaste({
			text:
				typeof prompt === "string" && prompt.trim().length > 0
					? prompt.trim()
					: "Summarize the current QCut agent status.",
		})}`,
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
		const command = buildInteractiveCodexInput({
			prompt,
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
				"Sent to the persistent Codex session. Watch the live output above.",
		});
		setText({ id: "agent-job-status", text: "terminal" });
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
	const uploadFilesButton = getElement({ id: "agent-upload-submit" });
	const fsRootButton = getElement({ id: "agent-fs-root" });
	const fsUpButton = getElement({ id: "agent-fs-up" });
	if (!promptInput || !submitButton) {
		return;
	}

	setValue({ id: "agent-token", value: readAuthToken() });
	renderAgentSession({ session: null });
	renderSandboxPath();
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
	if (uploadFilesButton) {
		uploadFilesButton.addEventListener("click", () => {
			void uploadSelectedAgentFiles();
		});
	}
	if (fsRootButton) {
		fsRootButton.addEventListener("click", () => {
			setSandboxPath({ path: "/" });
		});
	}
	if (fsUpButton) {
		fsUpButton.addEventListener("click", () => {
			setSandboxPath({
				path: getSandboxParentPath({ path: currentSandboxPath }),
			});
		});
	}
}

const AgentChatAPI = {
	buildLiveCodexStatus,
	buildAgentArtifactDownloadPath,
	buildAgentSessionFilesystemDownloadPath,
	buildAgentSessionFileDownloadPath,
	buildAgentSessionArtifactDownloadPath,
	buildAgentRequest,
	buildCodexChatPrompt,
	buildCodexCommand,
	buildInteractiveCodexInput,
	buildTerminalPromptCommand,
	CODEX_AGENT_COMMAND,
	CODEX_TERMINAL_COMMAND,
	clearStoredAgentSessionId,
	createAgentJob,
	createAgentPtyToken,
	createAgentSession,
	downloadAgentArtifact,
	endAgentSession,
	ensureAgentSession,
	findCodexLastMessageArtifact,
	formatArtifactSize,
	formatUploadProgress,
	formatUploadSelectionStatus,
	getArtifactFilename,
	getAgentArtifactText,
	getAgentJobDetail,
	getAgentSessionArtifacts,
	getAgentSessionFiles,
	getLatestCodexAgentMessage,
	getSandboxParentPath,
	initUppyUploader,
	isTerminalStatus,
	normalizeSandboxPath,
	extractUppyUploadFiles,
	readStoredAgentSessionId,
	saveStoredAgentSessionId,
	uploadAgentSessionFiles,
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
