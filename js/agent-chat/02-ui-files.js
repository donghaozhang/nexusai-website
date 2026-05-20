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
	if (segments.some((segment) => segment === "." || segment === "..")) {
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
	hideArtifactContextMenu();
	revokeSandboxThumbnailObjectUrls();
	list.innerHTML = "";
	list.className = "sandbox-file-grid mt-5";
	if (!Array.isArray(artifacts) || artifacts.length === 0) {
		const empty = doc.createElement("p");
		empty.className = "sandbox-file-empty";
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
		row.className = "sandbox-file-tile";
		row.dataset.path = artifactPath;
		row.dataset.kind = isDir ? "folder" : artifact.kind || "file";
		row.tabIndex = 0;
		row.title = artifactPath;
		row.setAttribute("role", "button");
		row.setAttribute(
			"aria-label",
			isDir ? `Open folder ${artifactPath}` : `Download file ${artifactPath}`
		);
		row.addEventListener("contextmenu", (event) => {
			showArtifactContextMenu({ event, artifact, artifactPath, isDir });
		});
		row.addEventListener("click", (event) => {
			if (event.target?.closest?.("button")) {
				return;
			}
			if (isDir) {
				setSandboxPath({ path: artifactPath });
				return;
			}
			if (canPreviewArtifact({ artifact })) {
				void previewArtifactFromTile({ artifact });
			}
		});
		row.addEventListener("keydown", (event) => {
			if (event.key !== "Enter" && event.key !== " ") {
				return;
			}
			event.preventDefault();
			if (isDir) {
				setSandboxPath({ path: artifactPath });
				return;
			}
			if (canPreviewArtifact({ artifact })) {
				void previewArtifactFromTile({ artifact });
				return;
			}
			void downloadArtifactFromContextMenu({ artifact });
		});

		row.appendChild(createSandboxFilePreview({ doc, artifact, isDir }));

		const name = doc.createElement("div");
		name.className = "sandbox-file-name";
		name.textContent = getArtifactFilename({ artifact }) || artifactPath;
		row.appendChild(name);

		const meta = doc.createElement("div");
		meta.className = "sandbox-file-meta";
		meta.textContent = isDir ? "folder" : formatArtifactSize({ artifact });
		row.appendChild(meta);

		const downloadButton = doc.createElement("button");
		downloadButton.type = "button";
		downloadButton.className = "sandbox-tile-action";
		downloadButton.title = isDir ? "Download folder" : "Download file";
		downloadButton.setAttribute(
			"aria-label",
			isDir
				? `Download folder ${artifactPath}`
				: `Download file ${artifactPath}`
		);
		downloadButton.disabled = !canDownloadArtifact({ artifact });
		const downloadIcon = doc.createElement("i");
		downloadIcon.setAttribute("data-lucide", "download");
		downloadIcon.className = "w-3.5 h-3.5";
		downloadButton.appendChild(downloadIcon);
		downloadButton.addEventListener("click", (event) => {
			event.stopPropagation();
			void downloadArtifactFromContextMenu({ artifact });
		});
		row.appendChild(downloadButton);
		list.appendChild(row);
	}
	refreshLucideIcons();
}

function revokeSandboxThumbnailObjectUrls() {
	const win = getRuntimeWindow();
	if (!win?.URL) {
		sandboxThumbnailObjectUrls = [];
		return;
	}
	for (const objectUrl of sandboxThumbnailObjectUrls) {
		win.URL.revokeObjectURL(objectUrl);
	}
	sandboxThumbnailObjectUrls = [];
}

function createSandboxFilePreview({ doc, artifact, isDir }) {
	if (isDir || getArtifactPreviewKind({ artifact }) !== "image") {
		return createSandboxFileIcon({ doc, artifact, isDir });
	}
	const bytes = Number(artifact?.bytes || 0);
	if (Number.isFinite(bytes) && bytes > IMAGE_THUMBNAIL_MAX_BYTES) {
		return createSandboxFileIcon({ doc, artifact, isDir });
	}
	const frame = doc.createElement("div");
	frame.className = "sandbox-image-thumb is-loading";
	const icon = doc.createElement("i");
	icon.setAttribute("data-lucide", "image");
	icon.className = "w-7 h-7";
	frame.appendChild(icon);
	loadSandboxImageThumbnail({ artifact, frame });
	return frame;
}

function loadSandboxImageThumbnail({ artifact, frame }) {
	void (async () => {
		try {
			const request = buildAgentArtifactDownloadRequest({
				jobId: artifact?.jobId,
				artifact,
			});
			const blob = await requestAgentBlob({ path: request.path });
			const win = getRuntimeWindow();
			const doc = win?.document;
			if (!win?.URL || !doc || !frame.isConnected) {
				return;
			}
			const objectUrl = win.URL.createObjectURL(blob);
			sandboxThumbnailObjectUrls.push(objectUrl);
			const image = doc.createElement("img");
			image.alt = getArtifactFilename({ artifact }) || "Preview image";
			image.loading = "lazy";
			image.src = objectUrl;
			frame.replaceChildren(image);
			frame.classList.remove("is-loading");
		} catch {
			const doc = frame.ownerDocument;
			frame.replaceChildren(
				createSandboxFileIcon({ doc, artifact, isDir: false })
			);
			frame.classList.remove("is-loading");
		}
	})();
}

function createSandboxFileIcon({ doc, artifact, isDir }) {
	if (isDir) {
		const icon = doc.createElement("div");
		icon.className = "sandbox-folder-icon";
		return icon;
	}
	const kind = artifact?.kind || "file";
	const icon = doc.createElement("div");
	icon.className = "sandbox-file-icon";
	icon.dataset.kind = kind;
	const glyph = doc.createElement("i");
	glyph.setAttribute("data-lucide", getSandboxFileIconName({ kind }));
	glyph.className = "w-7 h-7";
	icon.appendChild(glyph);
	return icon;
}

function getSandboxFileIconName({ kind }) {
	if (kind === "image") {
		return "image";
	}
	if (kind === "video") {
		return "film";
	}
	if (kind === "audio") {
		return "music";
	}
	if (kind === "json") {
		return "braces";
	}
	return "file-text";
}

function refreshLucideIcons() {
	const runtime = getRuntimeGlobal();
	if (typeof runtime?.lucide?.createIcons === "function") {
		runtime.lucide.createIcons();
	}
}

function hideArtifactContextMenu() {
	if (artifactContextMenu?.parentNode) {
		artifactContextMenu.parentNode.removeChild(artifactContextMenu);
	}
	artifactContextMenu = null;
}

function showArtifactContextMenu({ event, artifact, artifactPath, isDir }) {
	event.preventDefault();
	hideArtifactContextMenu();
	const doc = getRuntimeWindow()?.document;
	if (!doc) {
		return;
	}
	const menu = doc.createElement("div");
	menu.className = "sandbox-context-menu";
	menu.style.left = `${event.clientX}px`;
	menu.style.top = `${event.clientY}px`;

	if (isDir) {
		menu.appendChild(
			createArtifactContextMenuButton({
				label: "Open folder",
				onSelect: () => setSandboxPath({ path: artifactPath }),
			})
		);
		menu.appendChild(createArtifactContextMenuSeparator());
	}
	if (!isDir && canPreviewArtifact({ artifact })) {
		menu.appendChild(
			createArtifactContextMenuButton({
				label: "Preview",
				onSelect: () => {
					void previewArtifactFromTile({ artifact });
				},
			})
		);
		menu.appendChild(
			createArtifactContextMenuButton({
				label: "Open preview in new tab",
				onSelect: () => {
					void openArtifactPreviewFromContextMenu({ artifact });
				},
			})
		);
		menu.appendChild(createArtifactContextMenuSeparator());
	}
	menu.appendChild(
		createArtifactContextMenuButton({
			label: isDir ? "Download folder to local" : "Download to local",
			onSelect: () => {
				void downloadArtifactFromContextMenu({ artifact });
			},
		})
	);
	menu.appendChild(createArtifactContextMenuSeparator());
	menu.appendChild(
		createArtifactContextMenuButton({
			label: "Copy path",
			onSelect: () => {
				void copyArtifactValueFromContextMenu({
					label: "path",
					value: getArtifactCopyPath({ artifact }),
				});
			},
		})
	);
	menu.appendChild(
		createArtifactContextMenuButton({
			label: isDir ? "Copy folder name" : "Copy filename",
			onSelect: () => {
				void copyArtifactValueFromContextMenu({
					label: isDir ? "folder name" : "filename",
					value: getArtifactFilename({ artifact }),
				});
			},
		})
	);

	doc.body.appendChild(menu);
	artifactContextMenu = menu;
	const closeMenu = () => hideArtifactContextMenu();
	const win = getRuntimeWindow();
	win?.setTimeout(() => {
		doc.addEventListener("click", closeMenu, { once: true });
		doc.addEventListener("keydown", closeMenu, { once: true });
	}, 0);
}

function createArtifactContextMenuButton({ label, onSelect }) {
	const doc = getRuntimeWindow()?.document;
	const button = doc.createElement("button");
	button.type = "button";
	button.textContent = label;
	button.addEventListener("click", () => {
		hideArtifactContextMenu();
		onSelect();
	});
	return button;
}

function createArtifactContextMenuSeparator() {
	const doc = getRuntimeWindow()?.document;
	const separator = doc.createElement("div");
	separator.className = "sandbox-context-menu-separator";
	separator.setAttribute("role", "separator");
	return separator;
}

async function copyArtifactValueFromContextMenu({ label, value }) {
	showError({ message: "" });
	try {
		await copyTextToClipboard({ text: value });
		setText({
			id: "agent-upload-status",
			text: `Copied ${label}: ${value}`,
		});
	} catch (error) {
		showError({
			message:
				error instanceof Error
					? `Copy failed: ${error.message}`
					: "Copy failed",
		});
	}
}

async function copyTextToClipboard({ text }) {
	const value = typeof text === "string" ? text : "";
	if (value.length === 0) {
		throw new Error("Nothing to copy");
	}
	const win = getRuntimeWindow();
	const clipboard = win?.navigator?.clipboard;
	if (clipboard && typeof clipboard.writeText === "function") {
		await clipboard.writeText(value);
		return;
	}
	const doc = win?.document;
	if (!doc || typeof doc.execCommand !== "function") {
		throw new Error("Clipboard API is unavailable");
	}
	const textarea = doc.createElement("textarea");
	textarea.value = value;
	textarea.setAttribute("readonly", "");
	textarea.style.position = "fixed";
	textarea.style.left = "-9999px";
	doc.body.appendChild(textarea);
	textarea.select();
	const copied = doc.execCommand("copy");
	textarea.remove();
	if (!copied) {
		throw new Error("Clipboard copy was rejected");
	}
}

async function previewArtifactFromTile({ artifact }) {
	showError({ message: "" });
	try {
		const preview = await loadAgentArtifactPreview({
			jobId: artifact?.jobId,
			artifact,
		});
		showArtifactPreview({ preview });
	} catch (error) {
		showError({
			message:
				error instanceof Error
					? `Artifact preview failed: ${error.message}`
					: "Artifact preview failed",
		});
	}
}

async function openArtifactPreviewFromContextMenu({ artifact }) {
	showError({ message: "" });
	const win = getRuntimeWindow();
	const previewWindow =
		typeof win?.open === "function" ? win.open("about:blank", "_blank") : null;
	try {
		await openAgentArtifactPreviewInNewTab({
			jobId: artifact?.jobId,
			artifact,
			previewWindow,
		});
	} catch (error) {
		if (previewWindow && typeof previewWindow.close === "function") {
			previewWindow.close();
		}
		showError({
			message:
				error instanceof Error
					? `Open preview failed: ${error.message}`
					: "Open preview failed",
		});
	}
}

function closeArtifactPreview() {
	const modal = getElement({ id: "sandbox-preview-modal" });
	if (modal) {
		modal.classList.add("hidden");
	}
	const win = getRuntimeWindow();
	if (artifactPreviewObjectUrl.length > 0 && win?.URL) {
		win.URL.revokeObjectURL(artifactPreviewObjectUrl);
	}
	artifactPreviewObjectUrl = "";
}

function ensureArtifactPreviewModal() {
	const existing = getElement({ id: "sandbox-preview-modal" });
	if (existing) {
		return existing;
	}
	const doc = getRuntimeWindow()?.document;
	if (!doc) {
		return null;
	}
	const modal = doc.createElement("div");
	modal.id = "sandbox-preview-modal";
	modal.className = "sandbox-preview-modal hidden";
	modal.setAttribute("role", "dialog");
	modal.setAttribute("aria-modal", "true");

	const panel = doc.createElement("div");
	panel.className = "sandbox-preview-panel";
	const header = doc.createElement("div");
	header.className = "sandbox-preview-header";
	const title = doc.createElement("div");
	title.id = "sandbox-preview-title";
	title.className = "sandbox-preview-title";
	const closeButton = doc.createElement("button");
	closeButton.type = "button";
	closeButton.className = "sandbox-preview-close";
	closeButton.title = "Close preview";
	closeButton.setAttribute("aria-label", "Close preview");
	const closeIcon = doc.createElement("i");
	closeIcon.setAttribute("data-lucide", "x");
	closeIcon.className = "w-5 h-5";
	closeButton.appendChild(closeIcon);
	closeButton.addEventListener("click", closeArtifactPreview);
	header.append(title, closeButton);

	const body = doc.createElement("div");
	body.id = "sandbox-preview-body";
	body.className = "sandbox-preview-body";
	panel.append(header, body);
	modal.appendChild(panel);
	modal.addEventListener("click", (event) => {
		if (event.target === modal) {
			closeArtifactPreview();
		}
	});
	doc.addEventListener("keydown", (event) => {
		if (event.key === "Escape") {
			closeArtifactPreview();
		}
	});
	doc.body.appendChild(modal);
	return modal;
}

function showArtifactPreview({ preview }) {
	const modal = ensureArtifactPreviewModal();
	const doc = getRuntimeWindow()?.document;
	const win = getRuntimeWindow();
	if (!modal || !doc) {
		return;
	}
	closeArtifactPreview();
	const title = modal.querySelector("#sandbox-preview-title");
	const body = modal.querySelector("#sandbox-preview-body");
	if (!title || !body) {
		return;
	}
	title.textContent = preview.filename || "Preview";
	body.innerHTML = "";
	if (preview.kind === "image") {
		if (!win?.URL) {
			throw new Error("Browser preview APIs are unavailable");
		}
		artifactPreviewObjectUrl = win.URL.createObjectURL(preview.blob);
		const image = doc.createElement("img");
		image.className = "sandbox-preview-image";
		image.alt = preview.filename || "Preview image";
		image.src = artifactPreviewObjectUrl;
		body.appendChild(image);
	} else if (preview.kind === "json") {
		renderCodePreview({ doc, body, text: preview.text || "" });
	} else {
		renderTextPreview({
			doc,
			body,
			filename: preview.filename || "",
			text: preview.text || "",
		});
	}
	modal.classList.remove("hidden");
	refreshLucideIcons();
}

function renderTextPreview({ doc, body, filename, text }) {
	const lowerFilename = filename.toLowerCase();
	if (lowerFilename.endsWith(".md") || lowerFilename.endsWith(".markdown")) {
		renderMarkdownPreview({ doc, body, text });
		return;
	}
	renderCodePreview({ doc, body, text });
}

function renderMarkdownPreview({ doc, body, text }) {
	const container = doc.createElement("div");
	container.className = "sandbox-preview-markdown";
	const lines = String(text).split(/\r?\n/);
	let codeBlock = null;
	for (const line of lines) {
		if (line.trimStart().startsWith("```")) {
			if (codeBlock) {
				container.appendChild(codeBlock);
				codeBlock = null;
			} else {
				codeBlock = doc.createElement("pre");
			}
			continue;
		}
		if (codeBlock) {
			codeBlock.textContent += `${line}\n`;
			continue;
		}
		const headingMatch = line.match(/^(#{1,3})\s+(.+)$/);
		if (headingMatch) {
			const heading = doc.createElement(`h${headingMatch[1].length + 1}`);
			heading.textContent = headingMatch[2];
			container.appendChild(heading);
			continue;
		}
		const bulletMatch = line.match(/^[-*]\s+(.+)$/);
		if (bulletMatch) {
			const paragraph = doc.createElement("p");
			paragraph.className = "sandbox-preview-bullet";
			paragraph.textContent = `• ${bulletMatch[1]}`;
			container.appendChild(paragraph);
			continue;
		}
		const paragraph = doc.createElement("p");
		paragraph.textContent = line.length > 0 ? line : " ";
		container.appendChild(paragraph);
	}
	if (codeBlock) {
		container.appendChild(codeBlock);
	}
	body.appendChild(container);
}

function renderCodePreview({ doc, body, text }) {
	const pre = doc.createElement("pre");
	pre.className = "sandbox-preview-code";
	pre.textContent = text;
	body.appendChild(pre);
}

async function downloadArtifactFromContextMenu({ artifact }) {
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
