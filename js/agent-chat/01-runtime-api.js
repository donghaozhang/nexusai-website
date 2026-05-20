const DEFAULT_LICENSE_SERVER_URL =
	"https://qcut-license-server.zdhpeter.workers.dev";

const MAX_SESSION_UPLOAD_BYTES = 25 * 1024 * 1024;
const TERMINAL_STATUSES = ["succeeded", "failed", "cancelled"];
const CODEX_AGENT_COMMAND = "codex exec --skip-git-repo-check --json -";
const CODEX_TERMINAL_COMMAND =
	"codex exec --skip-git-repo-check --dangerously-bypass-approvals-and-sandbox --output-last-message /tmp/qcut-output/codex-last-message.md -";
const CODEX_LAST_MESSAGE_FILE = "codex-last-message.md";
const AGENT_SESSION_STORAGE_KEY = "qcut_agent_session_id";
const AGENT_PTY_TOKEN_MAX_WAIT_MS = 6 * 60 * 1000;
const AGENT_PTY_TOKEN_DEFAULT_RETRY_MS = 3000;
const DEFAULT_SANDBOX_ARTIFACT_PATH = "/tmp/qcut-output";
const COMMAND_PREVIEW_COLLAPSE_THRESHOLD = 900;
const TEXT_PREVIEW_MAX_BYTES = 1024 * 1024;
const IMAGE_THUMBNAIL_MAX_BYTES = 10 * 1024 * 1024;
const IMAGE_PREVIEW_EXTENSIONS = new Set([
	"gif",
	"jpeg",
	"jpg",
	"png",
	"webp",
]);
const TEXT_PREVIEW_EXTENSIONS = new Set([
	"csv",
	"json",
	"log",
	"markdown",
	"md",
	"txt",
	"yaml",
	"yml",
]);
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
	"The default image model is gpt_image_2_ima. For image generation, do not pass --model/-m unless the user explicitly asks for a specific model.",
	"yt-dlp and deno are available for authorized video download probes.",
	"For long-running shell commands, stream user-visible stdout with tee -a /tmp/qcut-output/codex-live-stdout.log.",
	"Put temporary tools, caches, and package installs under /tmp/qcut-tools or /tmp, not /tmp/qcut-output.",
	"Write only final user-requested files and small diagnostic summaries/logs under /tmp/qcut-output.",
	"Example: qcut gen image -t 'small blue square icon on a clean white background' --json -o /tmp/qcut-output",
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
let currentSandboxPath = DEFAULT_SANDBOX_ARTIFACT_PATH;
let uppyUploader = null;
let artifactContextMenu = null;
let terminalStartupBuffer = "";
let terminalUpdatePromptSkipped = false;
let commandPreviewExpanded = false;
let artifactPreviewObjectUrl = "";
let sandboxThumbnailObjectUrls = [];

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

function waitForAgentTerminalRetry({ retryAfterMs }) {
	return new Promise((resolve) => {
		const win = typeof window === "undefined" ? null : window;
		const scheduleTimeout =
			win && typeof win.setTimeout === "function"
				? win.setTimeout.bind(win)
				: setTimeout;
		scheduleTimeout(resolve, retryAfterMs);
	});
}

function getAgentTerminalRetryDelay({ payload }) {
	if (!payload || typeof payload !== "object") {
		return AGENT_PTY_TOKEN_DEFAULT_RETRY_MS;
	}
	const retryAfterMs = Number(payload.retry_after_ms);
	if (!Number.isFinite(retryAfterMs)) {
		return AGENT_PTY_TOKEN_DEFAULT_RETRY_MS;
	}
	return Math.max(0, Math.min(retryAfterMs, 10_000));
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

async function createAgentPtyToken({ sessionId, startedAtMs }) {
	if (typeof sessionId !== "string" || sessionId.trim().length === 0) {
		throw new Error("Agent session id required");
	}
	const normalizedSessionId = sessionId.trim();
	const startedAt =
		typeof startedAtMs === "number" && Number.isFinite(startedAtMs)
			? startedAtMs
			: Date.now();
	const payload = await requestAgentApi({
		path: `/api/agent/sessions/${encodeURIComponent(
			normalizedSessionId
		)}/pty-token`,
		method: "POST",
		body: {},
	});
	if (
		!payload ||
		typeof payload !== "object" ||
		typeof payload.ws_url !== "string"
	) {
		if (payload?.status !== "starting") {
			throw new Error("Agent terminal response is invalid");
		}
		if (Date.now() - startedAt > AGENT_PTY_TOKEN_MAX_WAIT_MS) {
			throw new Error("Agent terminal did not become ready in time");
		}
		await waitForAgentTerminalRetry({
			retryAfterMs: getAgentTerminalRetryDelay({ payload }),
		});
		return createAgentPtyToken({
			sessionId: normalizedSessionId,
			startedAtMs: startedAt,
		});
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

function buildAgentSessionFilesystemDownloadPath({ sessionId, path, archive }) {
	if (typeof sessionId !== "string" || sessionId.trim().length === 0) {
		throw new Error("Agent session id required");
	}
	const normalizedPath = normalizeSandboxPath({ value: path, fallback: "" });
	if (normalizedPath.length === 0 || normalizedPath === "/") {
		throw new Error("Session file path required");
	}
	const archiveQuery = archive === "tar" ? "&archive=tar" : "";
	return `/api/agent/sessions/${encodeURIComponent(
		sessionId.trim()
	)}/files/download?path=${encodeURIComponent(normalizedPath)}${archiveQuery}`;
}

function buildAgentArtifactDownloadRequest({ jobId, artifact }) {
	const isDir = artifact?.meta?.isDir === true;
	const baseFilename = getArtifactFilename({ artifact }) || "qcut-artifact";
	const filename = isDir ? `${baseFilename}.tar.gz` : baseFilename;
	const folder = artifact?.meta?.folder;
	const filesystemPath =
		typeof artifact?.meta?.path === "string" ? artifact.meta.path : "";
	const isVirtualSessionFile = folder === "input" || folder === "output";
	const isSandboxFilesystemPath = folder === "filesystem";
	const downloadPath =
		typeof artifact?.sessionId === "string" &&
		artifact.sessionId.trim().length > 0
			? isSandboxFilesystemPath
				? buildAgentSessionFilesystemDownloadPath({
						sessionId: artifact.sessionId,
						path: filesystemPath || artifact.storagePath,
						archive: isDir ? "tar" : "",
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
	return { filename, path: downloadPath };
}

function getArtifactExtension({ artifact }) {
	const filename = getArtifactFilename({ artifact }) || artifact?.storagePath || "";
	const dotIndex = filename.lastIndexOf(".");
	if (dotIndex < 0 || dotIndex === filename.length - 1) {
		return "";
	}
	return filename.slice(dotIndex + 1).toLowerCase();
}

function getArtifactPreviewKind({ artifact }) {
	if (!artifact || artifact?.meta?.isDir === true) {
		return "none";
	}
	const extension = getArtifactExtension({ artifact });
	if (IMAGE_PREVIEW_EXTENSIONS.has(extension) || artifact.kind === "image") {
		return "image";
	}
	if (TEXT_PREVIEW_EXTENSIONS.has(extension)) {
		return extension === "json" ? "json" : "text";
	}
	if (artifact.kind === "json") {
		return "json";
	}
	if (artifact.kind === "log") {
		return "text";
	}
	return "none";
}

function canPreviewArtifact({ artifact }) {
	return getArtifactPreviewKind({ artifact }) !== "none";
}

function getArtifactCopyPath({ artifact }) {
	const metaPath = artifact?.meta?.path;
	if (typeof metaPath === "string" && metaPath.length > 0) {
		return metaPath;
	}
	const storagePath = artifact?.storagePath;
	if (typeof storagePath === "string" && storagePath.length > 0) {
		return storagePath;
	}
	const id = artifact?.id;
	return typeof id === "string" ? id : "";
}

function formatPreviewText({ filename, text }) {
	const extension = getArtifactExtension({
		artifact: { meta: { filename } },
	});
	if (extension !== "json") {
		return text;
	}
	try {
		return JSON.stringify(JSON.parse(text), null, 2);
	} catch {
		return text;
	}
}

function assertTextPreviewSize({ artifact }) {
	const bytes = Number(artifact?.bytes || 0);
	if (Number.isFinite(bytes) && bytes > TEXT_PREVIEW_MAX_BYTES) {
		throw new Error(
			`Preview is limited to ${(TEXT_PREVIEW_MAX_BYTES / (1024 * 1024)).toFixed(
				0
			)} MB. Download the file to inspect it.`
		);
	}
}

function escapePreviewHtml({ text }) {
	return String(text)
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;")
		.replaceAll('"', "&quot;")
		.replaceAll("'", "&#39;");
}

function buildStandalonePreviewHtml({ filename, text }) {
	return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapePreviewHtml({ text: filename || "QCut preview" })}</title>
<style>
body{margin:0;background:#faf9f7;color:#18181b;font-family:Inter,ui-sans-serif,system-ui,sans-serif}
header{position:sticky;top:0;border-bottom:1px solid #dedbd5;background:#faf9f7;padding:14px 20px;font-weight:650}
pre{box-sizing:border-box;width:100%;max-width:1120px;margin:0 auto;padding:24px;white-space:pre-wrap;overflow-wrap:anywhere;font:13px/1.6 "JetBrains Mono",ui-monospace,SFMono-Regular,Menlo,monospace}
</style>
</head>
<body>
<header>${escapePreviewHtml({ text: filename || "QCut preview" })}</header>
<pre>${escapePreviewHtml({ text })}</pre>
</body>
</html>`;
}

async function loadAgentArtifactPreview({ jobId, artifact }) {
	const previewKind = getArtifactPreviewKind({ artifact });
	if (previewKind === "none") {
		throw new Error("This file type cannot be previewed");
	}
	if (previewKind === "text" || previewKind === "json") {
		assertTextPreviewSize({ artifact });
	}
	const downloadRequest = buildAgentArtifactDownloadRequest({ jobId, artifact });
	const blob = await requestAgentBlob({ path: downloadRequest.path });
	if (previewKind === "image") {
		return {
			blob,
			filename: downloadRequest.filename,
			kind: previewKind,
		};
	}
	if (blob.size > TEXT_PREVIEW_MAX_BYTES) {
		throw new Error(
			`Preview is limited to ${(TEXT_PREVIEW_MAX_BYTES / (1024 * 1024)).toFixed(
				0
			)} MB. Download the file to inspect it.`
		);
	}
	const rawText = await blob.text();
	return {
		filename: downloadRequest.filename,
		kind: previewKind,
		text: formatPreviewText({
			filename: downloadRequest.filename,
			text: rawText,
		}),
	};
}

async function openAgentArtifactPreviewInNewTab({
	jobId,
	artifact,
	previewWindow,
}) {
	const preview = await loadAgentArtifactPreview({ jobId, artifact });
	const win = getRuntimeWindow();
	if (!win?.URL) {
		throw new Error("Browser new tab APIs are unavailable");
	}
	const targetWindow =
		previewWindow ||
		(typeof win.open === "function" ? win.open("about:blank", "_blank") : null);
	if (!targetWindow) {
		throw new Error("The browser blocked the preview tab");
	}
	try {
		targetWindow.opener = null;
	} catch {
		// Ignore cross-browser opener protections.
	}
	const blob =
		preview.kind === "image"
			? preview.blob
			: new Blob(
					[
						buildStandalonePreviewHtml({
							filename: preview.filename,
							text: preview.text || "",
						}),
					],
					{ type: "text/html" }
				);
	const objectUrl = win.URL.createObjectURL(blob);
	targetWindow.location.href = objectUrl;
	win.setTimeout(() => win.URL.revokeObjectURL(objectUrl), 60_000);
	return objectUrl;
}

async function downloadAgentArtifact({ jobId, artifact }) {
	const downloadRequest = buildAgentArtifactDownloadRequest({ jobId, artifact });
	const blob = await requestAgentBlob({
		path: downloadRequest.path,
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
		anchor.download = downloadRequest.filename;
		anchor.style.display = "none";
		doc.body.appendChild(anchor);
		anchor.click();
		anchor.remove();
	} finally {
		win.setTimeout(() => win.URL.revokeObjectURL(objectUrl), 1000);
	}
}
