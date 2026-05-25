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
	return getRuntimeWindow()?.WebSocket || getRuntimeGlobal()?.WebSocket || null;
}

function getTextDecoder() {
	return (
		getRuntimeWindow()?.TextDecoder || getRuntimeGlobal()?.TextDecoder || null
	);
}

function setTerminalStatus({ text }) {
	const status = String(text || "disconnected").toLowerCase();
	const element = getElement({ id: "agent-terminal-status" });
	if (!element) {
		return;
	}
	element.textContent = status;
	element.dataset.status = status;
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

function handleTerminalOutput({ text }) {
	writeTerminal({ text });
	maybeSkipCodexUpdatePrompt({ text });
}

function maybeSkipCodexUpdatePrompt({ text }) {
	if (terminalUpdatePromptSkipped || typeof text !== "string") {
		return;
	}
	terminalStartupBuffer = `${terminalStartupBuffer}${text}`.slice(-4000);
	if (
		terminalStartupBuffer.includes("Update available") &&
		terminalStartupBuffer.includes("Press enter to continue")
	) {
		terminalUpdatePromptSkipped = true;
		sendTerminalInput({ text: "\r" });
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
	terminalStartupBuffer = "";
	terminalUpdatePromptSkipped = false;
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
			handleTerminalOutput({ text: event.data });
			return;
		}
		handleTerminalOutput({ text: new Decoder().decode(event.data) });
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

function showError({ message }) {
	setText({ id: "agent-error", text: message });
	setHidden({ id: "agent-error", hidden: message.length === 0 });
}
