const test = require("node:test");
const assert = require("node:assert/strict");

function createResponse({ status, payload }) {
	return {
		ok: status >= 200 && status < 300,
		status,
		async text() {
			return JSON.stringify(payload);
		},
	};
}

function setupRuntime({ fetchImpl, token, localStorage }) {
	global.window = {
		PaymentAPI: {
			getApiBaseUrl() {
				return "https://license.test";
			},
			getAuthToken() {
				return token || "";
			},
			setAuthToken() {
				return true;
			},
		},
		...(localStorage ? { localStorage } : {}),
	};
	global.fetch = fetchImpl;
}

function loadAgentChatApi() {
	const modulePath = "./agent-chat.js";
	delete require.cache[require.resolve(modulePath)];
	return require(modulePath);
}

test.afterEach(() => {
	delete global.window;
	delete global.fetch;
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
					"Write generated files under /tmp/qcut-output so the worker can upload them.",
					"yt-dlp and deno are available for authorized video download probes.",
					"For long-running shell commands, stream user-visible stdout with tee -a /tmp/qcut-output/codex-live-stdout.log.",
					"Put temporary tools, caches, and package installs under /tmp/qcut-tools or /tmp, not /tmp/qcut-output.",
					"Write only final user-requested files and small diagnostic summaries/logs under /tmp/qcut-output.",
					"Example: qcut gen image -t 'small blue square icon on a clean white background' -m flux_dev --json -o /tmp/qcut-output",
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
			"Write generated files under /tmp/qcut-output so the worker can upload them.",
			"yt-dlp and deno are available for authorized video download probes.",
			"For long-running shell commands, stream user-visible stdout with tee -a /tmp/qcut-output/codex-live-stdout.log.",
			"Put temporary tools, caches, and package installs under /tmp/qcut-tools or /tmp, not /tmp/qcut-output.",
			"Write only final user-requested files and small diagnostic summaries/logs under /tmp/qcut-output.",
			"Example: qcut gen image -t 'small blue square icon on a clean white background' -m flux_dev --json -o /tmp/qcut-output",
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
	assert.match(
		command,
		/codex exec --skip-git-repo-check --dangerously-bypass-approvals-and-sandbox --output-last-message \/tmp\/qcut-output\/codex-last-message\.md - < \/tmp\/qcut-terminal-prompt\.md/
	);
	assert.match(command, /find \/tmp\/qcut-output/);
});

test("buildInteractiveCodexInput pastes prompts into the persistent Codex session", () => {
	const AgentChatAPI = loadAgentChatApi();
	const input = AgentChatAPI.buildInteractiveCodexInput({
		prompt: "Generate a small blue icon.",
	});

	assert.equal(input, "\u001b[200~Generate a small blue icon.\u001b[201~\n");
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

test("createAgentJob posts to the license server agent route", async () => {
	let requestUrl = "";
	let requestInit = null;
	setupRuntime({
		token: "token-abc",
		fetchImpl: async (url, init) => {
			requestUrl = url;
			requestInit = init;
			return createResponse({
				status: 201,
				payload: {
					job: {
						id: "job-1",
						status: "queued",
						command: "qcut system doctor --json",
					},
				},
			});
		},
	});
	const AgentChatAPI = loadAgentChatApi();

	const job = await AgentChatAPI.createAgentJob({
		command: "qcut system doctor --json",
		args: { source: "qcut_website_chat_agent" },
	});

	assert.equal(job.id, "job-1");
	assert.equal(requestUrl, "https://license.test/api/agent/jobs");
	assert.equal(requestInit.method, "POST");
	assert.equal(requestInit.headers.Authorization, "Bearer token-abc");
	assert.equal(
		requestInit.body,
		JSON.stringify({
			command: "qcut system doctor --json",
			args: { source: "qcut_website_chat_agent" },
		})
	);
});

test("createAgentJob attaches the active agent session id", async () => {
	let requestInit = null;
	setupRuntime({
		token: "token-abc",
		fetchImpl: async (_url, init) => {
			requestInit = init;
			return createResponse({
				status: 201,
				payload: {
					job: {
						id: "job-1",
						status: "queued",
						sessionId: "agent-session-1",
					},
				},
			});
		},
	});
	const AgentChatAPI = loadAgentChatApi();

	const job = await AgentChatAPI.createAgentJob({
		command: "codex exec --skip-git-repo-check --json -",
		args: {
			source: "qcut_website_chat_agent",
			codexPrompt: "Continue the chat.",
		},
		sessionId: "agent-session-1",
	});

	assert.equal(job.sessionId, "agent-session-1");
	assert.equal(
		requestInit.body,
		JSON.stringify({
			command: "codex exec --skip-git-repo-check --json -",
			args: {
				source: "qcut_website_chat_agent",
				codexPrompt: "Continue the chat.",
			},
			sessionId: "agent-session-1",
		})
	);
});

test("createAgentSession posts to the session route", async () => {
	let requestUrl = "";
	let requestInit = null;
	setupRuntime({
		token: "token-abc",
		fetchImpl: async (url, init) => {
			requestUrl = url;
			requestInit = init;
			return createResponse({
				status: 201,
				payload: {
					session: {
						id: "agent-session-1",
						status: "active",
					},
				},
			});
		},
	});
	const AgentChatAPI = loadAgentChatApi();

	const session = await AgentChatAPI.createAgentSession();

	assert.equal(session.id, "agent-session-1");
	assert.equal(requestUrl, "https://license.test/api/agent/sessions");
	assert.equal(requestInit.method, "POST");
	assert.equal(requestInit.body, JSON.stringify({}));
});

test("createAgentPtyToken posts to the terminal token route", async () => {
	let requestUrl = "";
	let requestInit = null;
	setupRuntime({
		token: "token-abc",
		fetchImpl: async (url, init) => {
			requestUrl = url;
			requestInit = init;
			return createResponse({
				status: 200,
				payload: {
					session: { id: "agent-session-1" },
					ws_url: "wss://relay.test/pty?token=abc",
				},
			});
		},
	});
	const AgentChatAPI = loadAgentChatApi();

	const payload = await AgentChatAPI.createAgentPtyToken({
		sessionId: "agent-session-1",
	});

	assert.equal(payload.ws_url, "wss://relay.test/pty?token=abc");
	assert.equal(
		requestUrl,
		"https://license.test/api/agent/sessions/agent-session-1/pty-token"
	);
	assert.equal(requestInit.method, "POST");
	assert.equal(requestInit.body, JSON.stringify({}));
});

test("getAgentSessionArtifacts reads terminal artifacts", async () => {
	let requestUrl = "";
	setupRuntime({
		token: "token-abc",
		fetchImpl: async (url) => {
			requestUrl = url;
			return createResponse({
				status: 200,
				payload: {
					artifacts: [
						{
							id: "result.png",
							sessionId: "agent-session-1",
							meta: { filename: "result.png" },
						},
					],
				},
			});
		},
	});
	const AgentChatAPI = loadAgentChatApi();

	const artifacts = await AgentChatAPI.getAgentSessionArtifacts({
		sessionId: "agent-session-1",
	});

	assert.equal(artifacts[0].id, "result.png");
	assert.equal(
		requestUrl,
		"https://license.test/api/agent/sessions/agent-session-1/artifacts"
	);
});

test("ensureAgentSession saves the session id for reset controls", async () => {
	const storage = new Map();
	setupRuntime({
		token: "token-abc",
		localStorage: {
			getItem(key) {
				return storage.get(key) || "";
			},
			setItem(key, value) {
				storage.set(key, value);
			},
			removeItem(key) {
				storage.delete(key);
			},
		},
		fetchImpl: async () =>
			createResponse({
				status: 200,
				payload: {
					session: {
						id: "agent-session-1",
						status: "active",
					},
				},
			}),
	});
	const AgentChatAPI = loadAgentChatApi();

	await AgentChatAPI.ensureAgentSession();

	assert.equal(AgentChatAPI.readStoredAgentSessionId(), "agent-session-1");
	AgentChatAPI.clearStoredAgentSessionId();
	assert.equal(AgentChatAPI.readStoredAgentSessionId(), "");
});

test("endAgentSession posts to the session end route", async () => {
	let requestUrl = "";
	let requestInit = null;
	setupRuntime({
		token: "token-abc",
		fetchImpl: async (url, init) => {
			requestUrl = url;
			requestInit = init;
			return createResponse({
				status: 200,
				payload: {
					session: {
						id: "agent-session-1",
						status: "stopping",
					},
				},
			});
		},
	});
	const AgentChatAPI = loadAgentChatApi();

	const session = await AgentChatAPI.endAgentSession({
		sessionId: "agent-session-1",
	});

	assert.equal(session.status, "stopping");
	assert.equal(
		requestUrl,
		"https://license.test/api/agent/sessions/agent-session-1/end"
	);
	assert.equal(requestInit.method, "POST");
	assert.equal(requestInit.body, JSON.stringify({}));
});

test("getAgentArtifactText reads text artifacts from the license server", async () => {
	let requestUrl = "";
	let requestInit = null;
	setupRuntime({
		token: "token-abc",
		fetchImpl: async (url, init) => {
			requestUrl = url;
			requestInit = init;
			return {
				ok: true,
				status: 200,
				async text() {
					return "Hello from Codex.";
				},
			};
		},
	});
	const AgentChatAPI = loadAgentChatApi();

	const text = await AgentChatAPI.getAgentArtifactText({
		jobId: "job-1",
		artifactId: "artifact-1",
	});

	assert.equal(text, "Hello from Codex.");
	assert.equal(
		requestUrl,
		"https://license.test/api/agent/jobs/job-1/artifacts/artifact-1/text"
	);
	assert.equal(requestInit.method, "GET");
	assert.equal(requestInit.headers.Accept, "text/plain");
});

test("downloadAgentArtifact fetches binary artifacts and starts a browser download", async () => {
	let requestUrl = "";
	let requestInit = null;
	let clicked = false;
	let revokedUrl = "";
	const anchor = {
		download: "",
		href: "",
		style: {},
		click() {
			clicked = true;
		},
		remove() {},
	};
	setupRuntime({
		token: "token-abc",
		fetchImpl: async (url, init) => {
			requestUrl = url;
			requestInit = init;
			return {
				ok: true,
				status: 200,
				async blob() {
					return new Blob([new Uint8Array([1, 2, 3])], {
						type: "image/jpeg",
					});
				},
			};
		},
	});
	global.window.document = {
		body: {
			appendChild(node) {
				assert.equal(node, anchor);
			},
		},
		createElement(tagName) {
			assert.equal(tagName, "a");
			return anchor;
		},
	};
	global.window.URL = {
		createObjectURL(blob) {
			assert.equal(blob.type, "image/jpeg");
			return "blob:artifact";
		},
		revokeObjectURL(url) {
			revokedUrl = url;
		},
	};
	global.window.setTimeout = (callback) => {
		callback();
		return 1;
	};
	const AgentChatAPI = loadAgentChatApi();

	await AgentChatAPI.downloadAgentArtifact({
		jobId: "job-1",
		artifact: {
			id: "artifact-1",
			jobId: "job-1",
			meta: { filename: "result.jpg" },
		},
	});

	assert.equal(
		requestUrl,
		"https://license.test/api/agent/jobs/job-1/artifacts/artifact-1/download"
	);
	assert.equal(requestInit.method, "GET");
	assert.equal(requestInit.headers.Authorization, "Bearer token-abc");
	assert.equal(requestInit.headers.Accept, "application/octet-stream");
	assert.equal(anchor.href, "blob:artifact");
	assert.equal(anchor.download, "result.jpg");
	assert.equal(clicked, true);
	assert.equal(revokedUrl, "blob:artifact");
});

test("buildAgentArtifactDownloadPath encodes job and artifact ids", () => {
	const AgentChatAPI = loadAgentChatApi();

	assert.equal(
		AgentChatAPI.buildAgentArtifactDownloadPath({
			jobId: "job / 1",
			artifactId: "artifact / 1",
		}),
		"/api/agent/jobs/job%20%2F%201/artifacts/artifact%20%2F%201/download"
	);
});

test("createAgentJob can use the server-side default agent account", async () => {
	let requestInit = null;
	setupRuntime({
		token: "",
		fetchImpl: async (_url, init) => {
			requestInit = init;
			return createResponse({ status: 201, payload: { job: { id: "job-1" } } });
		},
	});
	const AgentChatAPI = loadAgentChatApi();

	const job = await AgentChatAPI.createAgentJob({
		command: "qcut system doctor --json",
	});

	assert.equal(job.id, "job-1");
	assert.equal(requestInit.headers.Authorization, undefined);
});
