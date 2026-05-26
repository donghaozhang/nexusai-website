function quoteShell({ value }) {
    return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

function getSelectedMode() {
    return document.querySelector(".mini-tab[aria-selected='true']")?.dataset.mode || "image";
}

function buildGenerateCommand() {
    const kind = getSelectedMode();
    const prompt = document.getElementById("generate-prompt")?.value?.trim() || "cinematic image";
    const model = document.getElementById("generate-model")?.value?.trim() || "gpt_image_2_ima";
    const limit = document.getElementById("generate-limit")?.value?.trim() || "5";
    const output = document.getElementById("generate-output")?.value?.trim() || "/tmp/qcut-output";
    if (kind === "portraits") {
        return `qcut flow portraits --text ${quoteShell({ value: prompt })} --max-characters ${limit} --views front --image-model ${quoteShell({ value: model })} -o ${quoteShell({ value: `${output}/portraits` })} --json`;
    }
    if (kind === "storyboard") {
        return `qcut flow storyboard --script ${quoteShell({ value: prompt })} --image-model ${quoteShell({ value: model })} --style cinematic -o ${quoteShell({ value: `${output}/storyboard` })} --json`;
    }
    if (kind === "novel2movie") {
        return `qcut flow novel2movie --novel ${quoteShell({ value: prompt })} --max-images ${limit} --storyboard-only -o ${quoteShell({ value: output })} --json`;
    }
    return `qcut gen image -t ${quoteShell({ value: prompt })} --model ${quoteShell({ value: model })} -o ${quoteShell({ value: output })} --json`;
}

function renderGenerateCommand() {
    const target = document.getElementById("generate-command");
    if (target) {
        target.textContent = buildGenerateCommand();
    }
}

async function copyGenerateCommand() {
    const status = document.getElementById("generate-copy-status");
    try {
        await navigator.clipboard.writeText(buildGenerateCommand());
        if (status) {
            status.textContent = "Command copied. Open Agents and paste it into the terminal.";
        }
    } catch {
        if (status) {
            status.textContent = "Copy failed. Select the command text manually.";
        }
    }
}

function activateWorkspace({ name }) {
    for (const button of document.querySelectorAll("[data-workspace-tab]")) {
        button.setAttribute("aria-selected", button.dataset.workspaceTab === name ? "true" : "false");
    }
    for (const panel of document.querySelectorAll("[data-workspace-panel]")) {
        panel.classList.toggle("is-active", panel.dataset.workspacePanel === name);
    }
    window.dispatchEvent(new Event("resize"));
}

function bindStudioControls() {
    for (const button of document.querySelectorAll("[data-workspace-tab]")) {
        button.addEventListener("click", () => {
            activateWorkspace({ name: button.dataset.workspaceTab || "create" });
        });
    }
    for (const button of document.querySelectorAll(".mini-tab")) {
        button.addEventListener("click", () => {
            for (const item of document.querySelectorAll(".mini-tab")) {
                item.setAttribute("aria-selected", item === button ? "true" : "false");
            }
            renderGenerateCommand();
        });
    }
    for (const id of ["generate-prompt", "generate-model", "generate-limit", "generate-output"]) {
        document.getElementById(id)?.addEventListener("input", renderGenerateCommand);
    }
    document.getElementById("generate-copy-command")?.addEventListener("click", () => {
        void copyGenerateCommand();
    });
    document.getElementById("agent-terminal-connect")?.addEventListener("click", () => {
        activateWorkspace({ name: "agents" });
    });
    document.getElementById("qcut-ui-theme-toggle")?.addEventListener("click", () => {
        toggleTheme();
    });
}

bindStudioControls();
renderGenerateCommand();
