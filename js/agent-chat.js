(() => {
const DEFAULT_LICENSE_SERVER_URL =
	"https://qcut-license-server.zdhpeter.workers.dev";

const TERMINAL_STATUSES = ["succeeded", "failed", "cancelled"];

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
	if (typeof payload.message === "string" && payload.message.trim().length > 0) {
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
	if (token.length === 0) {
		throw new Error("QCut auth token required");
	}

	const response = await fetcher(`${getApiBaseUrl()}${path}`, {
		method,
		headers: {
			Accept: "application/json",
			Authorization: `Bearer ${token}`,
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

function normalizePromptSlug({ prompt }) {
	const normalized =
		typeof prompt === "string"
			? prompt
					.toLowerCase()
					.replace(/[^a-z0-9]+/g, "-")
					.replace(/^-+|-+$/g, "")
					.slice(0, 80)
			: "";
	return normalized || "qcut-chat-agent-image";
}

function buildImageCommand({ prompt }) {
	return `qcut gen image -t ${normalizePromptSlug({ prompt })} -m flux_dev --json`;
}

async function createAgentJob({ command }) {
	const payload = await requestAgentApi({
		path: "/api/agent/jobs",
		method: "POST",
		body: {
			command,
			args: { source: "qcut_website_chat_agent" },
		},
	});
	if (!payload || typeof payload !== "object" || !payload.job) {
		throw new Error("Agent job response is invalid");
	}
	return payload.job;
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

function renderJob({ job }) {
	if (!job) {
		return;
	}
	setText({ id: "agent-job-id", text: job.id || "-" });
	setText({ id: "agent-job-status", text: job.status || "-" });
	setText({
		id: "agent-job-exit",
		text: job.exitCode === null || job.exitCode === undefined ? "-" : String(job.exitCode),
	});
	setText({ id: "agent-job-runner", text: job.runnerId || "-" });
	setText({ id: "agent-job-error", text: job.error || "" });
	setHidden({ id: "agent-job-empty", hidden: true });
	setHidden({ id: "agent-job-summary", hidden: false });
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
		empty.textContent = "Artifacts will appear after the worker uploads outputs.";
		list.appendChild(empty);
		return;
	}

	for (const artifact of artifacts) {
		const row = doc.createElement("div");
		row.className = "card rounded-xl p-4";

		const shell = doc.createElement("div");
		shell.className = "flex items-start justify-between gap-4";

		const content = doc.createElement("div");
		const kind = doc.createElement("div");
		kind.className = "text-sm font-medium";
		kind.textContent = artifact.kind || "artifact";
		const path = doc.createElement("div");
		path.className = "mono text-xs mt-1 break-all";
		path.style.color = "var(--text-muted)";
		path.textContent = artifact.storagePath || "";
		content.append(kind, path);

		const size = doc.createElement("div");
		size.className = "text-xs text-muted";
		size.textContent = `${artifact.bytes || 0} bytes`;

		shell.append(content, size);
		row.appendChild(shell);
		list.appendChild(row);
	}
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

function setCommandPreview() {
	const prompt = getValue({ id: "agent-prompt" });
	setText({ id: "agent-command-preview", text: buildImageCommand({ prompt }) });
}

function showError({ message }) {
	setText({ id: "agent-error", text: message });
	setHidden({ id: "agent-error", hidden: message.length === 0 });
}

function pollJob({ jobId }) {
	const win = getRuntimeWindow();
	if (!win) {
		return;
	}
	const intervalId = win.setInterval(async () => {
		try {
			const detail = await getAgentJobDetail({ jobId });
			renderJob({ job: detail.job });
			renderArtifacts({ artifacts: detail.artifacts });
			renderEvents({ events: detail.events });
			if (isTerminalStatus({ status: detail.job?.status })) {
				win.clearInterval(intervalId);
				setDisabled({ id: "agent-submit", disabled: false });
			}
		} catch (error) {
			showError({
				message: error instanceof Error ? error.message : "Failed to refresh job",
			});
		}
	}, 2500);
}

async function submitAgentJob() {
	showError({ message: "" });
	setDisabled({ id: "agent-submit", disabled: true });

	try {
		const token = getValue({ id: "agent-token" });
		if (token.trim().length > 0) {
			saveAuthToken({ token });
		}
		const command = buildImageCommand({ prompt: getValue({ id: "agent-prompt" }) });
		const job = await createAgentJob({ command });
		renderJob({ job });
		renderArtifacts({ artifacts: [] });
		renderEvents({ events: [] });
		pollJob({ jobId: job.id });
	} catch (error) {
		setDisabled({ id: "agent-submit", disabled: false });
		showError({
			message: error instanceof Error ? error.message : "Failed to submit job",
		});
	}
}

function initAgentChatPage() {
	const promptInput = getElement({ id: "agent-prompt" });
	const submitButton = getElement({ id: "agent-submit" });
	if (!promptInput || !submitButton) {
		return;
	}

	setValue({ id: "agent-token", value: readAuthToken() });
	setCommandPreview();
	promptInput.addEventListener("input", setCommandPreview);
	submitButton.addEventListener("click", submitAgentJob);
}

const AgentChatAPI = {
	buildImageCommand,
	createAgentJob,
	getAgentJobDetail,
	isTerminalStatus,
	normalizePromptSlug,
};

if (typeof module !== "undefined" && module.exports) {
	module.exports = AgentChatAPI;
}

if (typeof window !== "undefined" && typeof window.addEventListener === "function") {
	window.AgentChatAPI = AgentChatAPI;
	window.addEventListener("DOMContentLoaded", initAgentChatPage);
}
})();
