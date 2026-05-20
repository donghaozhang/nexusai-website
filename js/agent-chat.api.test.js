const test = require("node:test");
const assert = require("node:assert/strict");
const {
	createResponse,
	setupRuntime,
	loadAgentChatApi,
} = require("./agent-chat.test-utils.js");

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

test("createAgentPtyToken retries while the terminal sandbox starts", async () => {
	const requestUrls = [];
	setupRuntime({
		token: "token-abc",
		fetchImpl: async (url) => {
			requestUrls.push(url);
			if (requestUrls.length === 1) {
				return createResponse({
					status: 202,
					payload: { status: "starting", retry_after_ms: 0 },
				});
			}
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
	assert.deepEqual(requestUrls, [
		"https://license.test/api/agent/sessions/agent-session-1/pty-token",
		"https://license.test/api/agent/sessions/agent-session-1/pty-token",
	]);
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

test("getAgentSessionFiles reads uploaded and generated sandbox files", async () => {
	let requestUrl = "";
	setupRuntime({
		token: "token-abc",
		fetchImpl: async (url) => {
			requestUrl = url;
			return createResponse({
				status: 200,
				payload: {
					files: [
						{
							id: "input/source.png",
							sessionId: "agent-session-1",
							meta: { filename: "source.png", folder: "input" },
						},
					],
				},
			});
		},
	});
	const AgentChatAPI = loadAgentChatApi();

	const files = await AgentChatAPI.getAgentSessionFiles({
		sessionId: "agent-session-1",
		path: "/tmp/qcut-output",
	});

	assert.equal(files[0].id, "input/source.png");
	assert.equal(
		requestUrl,
		"https://license.test/api/agent/sessions/agent-session-1/files?path=%2Ftmp%2Fqcut-output"
	);
});

test("uploadAgentSessionFiles posts multipart file data without JSON headers", async () => {
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
					files: [
						{
							id: "input/source.png",
							sessionId: "agent-session-1",
							meta: { filename: "source.png", folder: "input" },
						},
					],
				},
			});
		},
	});
	const AgentChatAPI = loadAgentChatApi();

	const files = await AgentChatAPI.uploadAgentSessionFiles({
		sessionId: "agent-session-1",
		path: "/tmp/qcut-input",
		files: [
			new File([new Uint8Array([1, 2, 3])], "source.png", {
				type: "image/png",
			}),
		],
	});

	assert.equal(files[0].id, "input/source.png");
	assert.equal(
		requestUrl,
		"https://license.test/api/agent/sessions/agent-session-1/files?path=%2Ftmp%2Fqcut-input"
	);
	assert.equal(requestInit.method, "POST");
	assert.equal(requestInit.headers.Authorization, "Bearer token-abc");
	assert.equal(requestInit.headers.Accept, "application/json");
	assert.equal(requestInit.headers["Content-Type"], undefined);
	assert.equal(requestInit.body instanceof FormData, true);
});

test("normalizeSandboxPath keeps absolute sandbox paths safe for URLs", () => {
	const AgentChatAPI = loadAgentChatApi();

	assert.equal(
		AgentChatAPI.normalizeSandboxPath({
			value: "/tmp/qcut-output/",
			fallback: "/",
		}),
		"/tmp/qcut-output"
	);
	assert.equal(
		AgentChatAPI.normalizeSandboxPath({
			value: "/tmp/../secret",
			fallback: "/",
		}),
		"/"
	);
	assert.equal(
		AgentChatAPI.getSandboxParentPath({ path: "/tmp/qcut-output" }),
		"/tmp"
	);
});

test("extractUppyUploadFiles returns real File objects from Uppy queue entries", () => {
	const AgentChatAPI = loadAgentChatApi();
	const queued = [
		{
			name: "source.txt",
			type: "text/plain",
			data: new Blob(["hello"], { type: "text/plain" }),
		},
	];

	const files = AgentChatAPI.extractUppyUploadFiles({
		files: queued,
		FileCtor: File,
	});

	assert.equal(files.length, 1);
	assert.equal(files[0].name, "source.txt");
	assert.ok(files[0].type.startsWith("text/plain"));
	assert.equal(files[0].size, 5);
});

test("formatUploadProgress shows percent when upload progress is available", () => {
	const AgentChatAPI = loadAgentChatApi();

	assert.equal(
		AgentChatAPI.formatUploadProgress({
			loaded: 50,
			total: 100,
			percent: 50,
		}),
		"Uploading to /tmp/qcut-output: 50%"
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
