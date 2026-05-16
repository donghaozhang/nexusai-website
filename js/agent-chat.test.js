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

function setupRuntime({ fetchImpl, token }) {
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

test("buildImageCommand normalizes prompt into worker-safe tokens", () => {
	const AgentChatAPI = loadAgentChatApi();
	assert.equal(
		AgentChatAPI.buildImageCommand({
			prompt: "Small blue square icon on white background!",
		}),
		"qcut gen image -t small-blue-square-icon-on-white-background -m flux_dev --json"
	);
});

test("buildAgentRequest keeps codex prompts out of the shell command", () => {
	const AgentChatAPI = loadAgentChatApi();
	assert.deepEqual(
		AgentChatAPI.buildAgentRequest({
			mode: "codex",
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
