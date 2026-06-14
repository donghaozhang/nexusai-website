const test = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const vm = require("node:vm");
const {
	createResponse,
	setupRuntime,
	loadAgentChatApi,
} = require("./agent-chat.test-utils.js");

test("chat-agent page waits for the split script loader before module setup", () => {
	const html = readFileSync(require.resolve("../chat-agent.html"), "utf8");
	const loaderIndex = html.indexOf('<script src="js/agent-chat.js"></script>');
	const uppyIndex = html.indexOf('<script type="module">');

	assert.ok(loaderIndex > -1);
	assert.ok(loaderIndex < uppyIndex);
	assert.match(html, /await window\.AgentChatReady/);
	assert.match(html, /id="agent-terminal-debug"/);
	assert.match(html, /id="agent-terminal-reconnect"/);
});

test("generate page reuses the split agent-chat loader", () => {
	const html = readFileSync(require.resolve("../generate/index.html"), "utf8");
	const loaderIndex = html.indexOf(
		'<script src="../js/agent-chat.js"></script>'
	);
	const uppyIndex = html.indexOf('<script type="module">');

	assert.ok(loaderIndex > -1);
	assert.ok(loaderIndex < uppyIndex);
	assert.match(html, /id="generate-command"/);
	assert.match(html, /await window\.AgentChatReady/);
});

test("agent-chat browser loader evaluates split parts in one scope", async () => {
	const loaderSource = readFileSync(require.resolve("./agent-chat.js"), "utf8");
	const context = {
		URL,
		console,
		fetch: async (url) => {
			const filename = String(url).split("/").pop();
			return {
				ok: true,
				status: 200,
				text: async () =>
					readFileSync(require.resolve(`./agent-chat/${filename}`), "utf8"),
			};
		},
		document: {
			readyState: "loading",
			currentScript: {
				src: "https://qcut.ai/js/agent-chat.js",
			},
		},
		window: {
			addEventListener() {},
		},
	};

	vm.runInNewContext(loaderSource, context);
	await context.window.AgentChatReady;

	assert.equal(
		typeof context.window.AgentChatAPI?.buildAgentRequest,
		"function"
	);
});

test("agent chat initializes when terminal input is the only prompt surface", () => {
	const listenersById = new Map();
	const textById = new Map();
	const valueById = new Map();
	const createElement = ({ id }) => ({
		id,
		classList: {
			toggle() {},
		},
		setAttribute() {},
		addEventListener(eventName, listener) {
			listenersById.set(`${id}:${eventName}`, listener);
		},
		get textContent() {
			return textById.get(id) || "";
		},
		set textContent(value) {
			textById.set(id, value);
		},
		get value() {
			return valueById.get(id) || "";
		},
		set value(value) {
			valueById.set(id, value);
		},
	});
	const elements = new Map(
		[
			"agent-token",
			"agent-session-status",
			"agent-fs-current-path",
			"agent-new-session",
			"agent-terminal-connect",
			"agent-terminal-reconnect",
			"agent-terminal-disconnect",
			"agent-refresh-artifacts",
			"agent-upload-submit",
			"agent-fs-root",
			"agent-fs-up",
		].map((id) => [id, createElement({ id })])
	);
	const document = {
		readyState: "complete",
		getElementById(id) {
			return elements.get(id) || null;
		},
	};
	global.document = document;
	global.window = {
		document,
		PaymentAPI: {
			getAuthToken() {
				return "token-from-payment";
			},
		},
		addEventListener() {},
	};

	try {
		const AgentChatAPI = loadAgentChatApi();

		assert.equal(typeof AgentChatAPI.buildAgentRequest, "function");
		assert.equal(valueById.get("agent-token"), "token-from-payment");
		assert.equal(textById.get("agent-fs-current-path"), "/tmp/qcut-output");
		assert.equal(
			typeof listenersById.get("agent-terminal-connect:click"),
			"function"
		);
		assert.equal(
			typeof listenersById.get("agent-terminal-reconnect:click"),
			"function"
		);
		assert.equal(
			typeof listenersById.get("agent-refresh-artifacts:click"),
			"function"
		);
		assert.equal(listenersById.has("agent-prompt:input"), false);
		assert.equal(listenersById.has("agent-submit:click"), false);
	} finally {
		delete global.document;
	}
});

test("terminal reconnect reuses the saved session and handles relay control acks", async () => {
	const listenersById = new Map();
	const textById = new Map();
	const valueById = new Map();
	const fetchPaths = [];
	const sockets = [];
	const createElement = ({ id }) => ({
		id,
		dataset: {},
		innerHTML: "",
		classList: {
			toggle() {},
		},
		setAttribute() {},
		addEventListener(eventName, listener) {
			listenersById.set(`${id}:${eventName}`, listener);
		},
		get textContent() {
			return textById.get(id) || "";
		},
		set textContent(value) {
			textById.set(id, value);
		},
		get value() {
			return valueById.get(id) || "";
		},
		set value(value) {
			valueById.set(id, value);
		},
	});
	const elements = new Map(
		[
			"agent-token",
			"agent-session-status",
			"agent-job-status",
			"agent-terminal-status",
			"agent-terminal",
			"agent-terminal-fallback",
			"agent-terminal-debug",
			"agent-fs-current-path",
			"agent-new-session",
			"agent-terminal-connect",
			"agent-terminal-reconnect",
			"agent-terminal-disconnect",
			"agent-refresh-artifacts",
			"agent-upload-submit",
			"agent-fs-root",
			"agent-fs-up",
		].map((id) => [id, createElement({ id })])
	);
	const document = {
		readyState: "complete",
		getElementById(id) {
			return elements.get(id) || null;
		},
	};
	class FakeWebSocket {
		static instances = sockets;

		constructor(url) {
			this.url = url;
			this.readyState = 0;
			this.binaryType = "";
			this.listeners = new Map();
			FakeWebSocket.instances.push(this);
			queueMicrotask(() => {
				this.readyState = 1;
				this.dispatch({ type: "open" });
			});
		}

		addEventListener(eventName, listener) {
			const listeners = this.listeners.get(eventName) || [];
			listeners.push(listener);
			this.listeners.set(eventName, listeners);
		}

		removeEventListener(eventName, listener) {
			const listeners = this.listeners.get(eventName) || [];
			this.listeners.set(
				eventName,
				listeners.filter((item) => item !== listener)
			);
		}

		send() {}

		close() {
			this.readyState = 3;
			this.dispatch({ type: "close" });
		}

		dispatch(event) {
			for (const listener of this.listeners.get(event.type) || []) {
				listener(event);
			}
		}
	}
	const localStorage = {
		getItem(key) {
			return key === "qcut_agent_session_id" ? "saved-session" : "";
		},
		setItem() {},
		removeItem() {},
	};
	const fetchImpl = async (url, options) => {
		const parsed = new URL(url);
		fetchPaths.push(parsed.pathname);
		assert.equal(options.method, "POST");
		if (parsed.pathname === "/api/agent/sessions/saved-session/pty-token") {
			return createResponse({
				status: 200,
				payload: { ws_url: "wss://relay.test/pty?token=test" },
			});
		}
		throw new Error(`unexpected fetch ${parsed.pathname}`);
	};
	global.document = document;
	global.window = {
		document,
		WebSocket: FakeWebSocket,
		TextDecoder,
		TextEncoder,
		setTimeout,
		clearTimeout,
		setInterval() {
			return 1;
		},
		clearInterval() {},
		localStorage,
		PaymentAPI: {
			getApiBaseUrl() {
				return "https://license.test";
			},
			getAuthToken() {
				return "token-from-payment";
			},
			setAuthToken() {
				return true;
			},
		},
		addEventListener() {},
	};
	global.fetch = fetchImpl;

	try {
		const AgentChatAPI = loadAgentChatApi();
		await AgentChatAPI.reconnectAgentTerminal();

		assert.deepEqual(fetchPaths, [
			"/api/agent/sessions/saved-session/pty-token",
		]);
		assert.equal(sockets.length, 1);
		assert.equal(textById.get("agent-session-status"), "active saved-session");

		sockets[0].dispatch({
			type: "message",
			data: JSON.stringify({
				kind: "pty_input_ack",
				messageIndex: 1,
				bytes: 1,
				elapsedMs: 3,
			}),
		});

		assert.match(textById.get("agent-terminal-debug"), /ack #1 1 bytes/);
		assert.doesNotMatch(
			textById.get("agent-terminal-fallback"),
			/pty_input_ack/
		);
		assert.equal(
			typeof listenersById.get("agent-terminal-reconnect:click"),
			"function"
		);
	} finally {
		delete global.document;
	}
});

test("buildAgentRequest keeps codex prompts out of the shell command", () => {
	const AgentChatAPI = loadAgentChatApi();
	assert.deepEqual(
		AgentChatAPI.buildAgentRequest({
			prompt: "Explain how the Daytona worker runs qcut.",
		}),
		{
			command: "codex exec --skip-git-repo-check --json -",
			args: {
				source: "qcut_website_chat_agent",
				codexPrompt: [
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
					"",
					"Latest user message:",
					"Explain how the Daytona worker runs qcut.",
				].join("\n"),
			},
		}
	);
});

test("buildCodexChatPrompt includes prior turns for follow-up messages", () => {
	const AgentChatAPI = loadAgentChatApi();
	assert.equal(
		AgentChatAPI.buildCodexChatPrompt({
			messages: [
				{ role: "user", content: "What changed in the worker?" },
				{ role: "assistant", content: "It now runs Codex in Daytona." },
			],
			prompt: "What should we test next?",
		}),
		[
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
			"",
			"Continue this QCut website chat. Answer the latest user message.",
			"",
			"Conversation so far:",
			"User: What changed in the worker?",
			"",
			"Assistant: It now runs Codex in Daytona.",
			"",
			"Latest user message:",
			"What should we test next?",
		].join("\n")
	);
});

test("buildTerminalPromptCommand wraps prompts for visible PTY Codex runs", () => {
	const AgentChatAPI = loadAgentChatApi();
	const command = AgentChatAPI.buildTerminalPromptCommand({
		prompt: "Generate a small blue icon.",
		messages: [],
		marker: "TEST_MARKER",
	});

	assert.match(
		command,
		/cat > \/tmp\/qcut-terminal-prompt\.md <<'TEST_MARKER'/
	);
	assert.match(command, /Generate a small blue icon\./);
	assert.match(command, /mkdir -p \/tmp\/qcut-input \/tmp\/qcut-output/);
	assert.match(
		command,
		/codex exec --skip-git-repo-check --dangerously-bypass-approvals-and-sandbox --dangerously-bypass-hook-trust --output-last-message \/tmp\/qcut-output\/codex-last-message\.md - < \/tmp\/qcut-terminal-prompt\.md/
	);
	assert.match(command, /find \/tmp\/qcut-input/);
	assert.match(command, /find \/tmp\/qcut-output/);
});

test("findCodexLastMessageArtifact selects the Codex final response", () => {
	const AgentChatAPI = loadAgentChatApi();
	assert.deepEqual(
		AgentChatAPI.findCodexLastMessageArtifact({
			artifacts: [
				{ id: "events", meta: { filename: "codex-events.jsonl" } },
				{ id: "last", meta: { filename: "codex-last-message.md" } },
			],
		}),
		{ id: "last", meta: { filename: "codex-last-message.md" } }
	);
});

test("buildLiveCodexStatus summarizes recent worker events", () => {
	const AgentChatAPI = loadAgentChatApi();

	assert.equal(
		AgentChatAPI.buildLiveCodexStatus({
			events: [
				{
					kind: "daytona_command_started",
					createdAt: "2026-05-15T00:00:02.000Z",
					payload: { sessionId: "session-1" },
				},
				{
					kind: "daytona_sandbox_ready",
					createdAt: "2026-05-15T00:00:01.000Z",
					payload: { message: "sandbox ready" },
				},
			],
		}),
		[
			"Running Codex in the Daytona sandbox...",
			"",
			"daytona_sandbox_ready: sandbox ready",
			'daytona_command_started: {"sessionId":"session-1"}',
		].join("\n")
	);
});

test("buildLiveCodexStatus surfaces streamed Codex stdout lines", () => {
	const AgentChatAPI = loadAgentChatApi();

	assert.equal(
		AgentChatAPI.buildLiveCodexStatus({
			events: [
				{
					kind: "codex_stdout",
					createdAt: "2026-05-15T00:00:03.000Z",
					payload: { message: "STREAM_STEP_1" },
				},
			],
		}),
		[
			"Running Codex in the Daytona sandbox...",
			"",
			"codex_stdout: STREAM_STEP_1",
		].join("\n")
	);
});

test("buildLiveCodexStatus shows real Codex agent messages as soon as event arrives", () => {
	const AgentChatAPI = loadAgentChatApi();

	assert.equal(
		AgentChatAPI.buildLiveCodexStatus({
			events: [
				{
					kind: "codex_stdout",
					createdAt: "2026-05-15T00:00:03.000Z",
					payload: { message: "still working" },
				},
				{
					kind: "codex_event",
					createdAt: "2026-05-15T00:00:04.000Z",
					payload: {
						type: "item.completed",
						item: {
							type: "agent_message",
							text: "This is the real Codex answer.",
						},
					},
				},
			],
		}),
		"This is the real Codex answer."
	);
});
