/* Musashi — App Logic */

const API = "port/8000";

// --- DOM refs ---
const screens = {
  upload: document.getElementById("screen-upload"),
  processing: document.getElementById("screen-processing"),
  results: document.getElementById("screen-results"),
};

const els = {
  uploadZone: document.getElementById("upload-zone"),
  fileInput: document.getElementById("file-input"),
  filePreview: document.getElementById("file-preview"),
  previewVideo: document.getElementById("preview-video"),
  fileName: document.getElementById("file-name"),
  fileSize: document.getElementById("file-size"),
  btnChange: document.getElementById("btn-change"),
  btnAnalyze: document.getElementById("btn-analyze"),
  processingVideo: document.getElementById("processing-video"),
  statusText: document.getElementById("status-text"),
  phaseUpload: document.getElementById("phase-upload"),
  phaseScan: document.getElementById("phase-scan"),
  phaseAnalyze: document.getElementById("phase-analyze"),
  resultsVideo: document.getElementById("results-video"),
  scanSummary: document.getElementById("scan-summary"),
  scanSummaryContent: document.getElementById("scan-summary-content"),
  analysisContent: document.getElementById("analysis-content"),
  btnNew: document.getElementById("btn-new"),
  chatSection: document.getElementById("chat-section"),
  chatMessages: document.getElementById("chat-messages"),
  chatForm: document.getElementById("chat-form"),
  chatInput: document.getElementById("chat-input"),
  chatSend: document.getElementById("chat-send"),
};

let selectedFile = null;
let videoObjectUrl = null;
let currentSessionId = null;
let chatStreaming = false;

// --- Screen management ---
function showScreen(name) {
  Object.entries(screens).forEach(([key, el]) => {
    el.classList.toggle("active", key === name);
  });
}

// --- Theme toggle ---
(function () {
  const toggle = document.querySelector("[data-theme-toggle]");
  const root = document.documentElement;
  let theme = window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  root.setAttribute("data-theme", theme);
  if (toggle) {
    updateToggleIcon(toggle, theme);
    toggle.addEventListener("click", () => {
      theme = theme === "dark" ? "light" : "dark";
      root.setAttribute("data-theme", theme);
      toggle.setAttribute("aria-label", `Switch to ${theme === "dark" ? "light" : "dark"} mode`);
      updateToggleIcon(toggle, theme);
    });
  }
  function updateToggleIcon(btn, t) {
    btn.innerHTML =
      t === "dark"
        ? '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="5"/><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/></svg>'
        : '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>';
  }
})();

// --- File upload handling ---
// The real <input type="file"> overlays the entire upload zone at opacity:0,
// so clicking anywhere on the zone clicks the actual input — most reliable in sandboxed iframes.

// Drag and drop
els.uploadZone.addEventListener("dragover", (e) => {
  e.preventDefault();
  els.uploadZone.classList.add("dragover");
});
els.uploadZone.addEventListener("dragleave", () => {
  els.uploadZone.classList.remove("dragover");
});
els.uploadZone.addEventListener("drop", (e) => {
  e.preventDefault();
  els.uploadZone.classList.remove("dragover");
  const file = e.dataTransfer.files[0];
  if (file && file.type.startsWith("video/")) {
    handleFile(file);
  }
});

els.fileInput.addEventListener("change", (e) => {
  if (e.target.files[0]) handleFile(e.target.files[0]);
});

function handleFile(file) {
  selectedFile = file;
  if (videoObjectUrl) URL.revokeObjectURL(videoObjectUrl);
  videoObjectUrl = URL.createObjectURL(file);

  els.previewVideo.src = videoObjectUrl;
  els.previewVideo.load();
  els.fileName.textContent = file.name;
  els.fileSize.textContent = formatBytes(file.size);

  els.uploadZone.classList.add("hidden");
  els.filePreview.classList.remove("hidden");
}

els.btnChange.addEventListener("click", (e) => {
  e.preventDefault();
  e.stopPropagation();
  resetUpload();
});

function resetUpload() {
  selectedFile = null;
  if (videoObjectUrl) URL.revokeObjectURL(videoObjectUrl);
  videoObjectUrl = null;
  els.fileInput.value = "";
  els.previewVideo.src = "";
  els.uploadZone.classList.remove("hidden");
  els.filePreview.classList.add("hidden");
}

// --- Analyze ---
els.btnAnalyze.addEventListener("click", startAnalysis);

async function startAnalysis() {
  if (!selectedFile) return;

  // Switch to processing screen
  showScreen("processing");
  els.processingVideo.src = videoObjectUrl;
  els.processingVideo.play().catch(() => {});

  // Reset phases
  setPhase("upload");
  els.statusText.textContent = "Uploading video to analysis engine...";

  // Send to API
  const formData = new FormData();
  formData.append("video", selectedFile);

  try {
    const response = await fetch(`${API}/api/analyze`, {
      method: "POST",
      body: formData,
    });

    if (!response.ok) {
      throw new Error(`Server error: ${response.status}`);
    }

    // Process SSE stream
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let fullAnalysis = "";
    let scanData = null;

    // Prepare results screen content
    els.analysisContent.innerHTML = "";
    els.scanSummary.classList.add("hidden");

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      // Parse SSE events from buffer
      const events = buffer.split("\n\n");
      buffer = events.pop() || ""; // Keep incomplete event in buffer

      for (const eventStr of events) {
        if (!eventStr.trim()) continue;

        const lines = eventStr.split("\n");
        let eventType = "";
        let eventData = "";

        for (const line of lines) {
          if (line.startsWith("event: ")) eventType = line.slice(7);
          else if (line.startsWith("data: ")) eventData = line.slice(6);
        }

        if (!eventType || !eventData) continue;

        let data;
        try {
          data = JSON.parse(eventData);
        } catch {
          continue;
        }

        switch (eventType) {
          case "status":
            handleStatus(data);
            break;
          case "scan_complete":
            scanData = data;
            handleScanComplete(data);
            break;
          case "chunk":
            fullAnalysis += data.text || "";
            renderAnalysis(fullAnalysis, true);
            break;
          case "complete":
            fullAnalysis = data.full_text || fullAnalysis;
            renderAnalysis(fullAnalysis, false);
            if (data.session_id) currentSessionId = data.session_id;
            finishAnalysis(scanData);
            break;
          case "error":
            showError(data.message || "Analysis failed");
            return;
        }
      }
    }
  } catch (err) {
    showError(err.message || "Connection failed. Please try again.");
  }
}

function handleStatus(data) {
  els.statusText.textContent = data.message || "";
  if (data.phase === "uploading") setPhase("upload");
  else if (data.phase === "scanning") setPhase("scan");
  else if (data.phase === "analyzing") setPhase("analyze");
}

function setPhase(phase) {
  const phases = ["upload", "scan", "analyze"];
  const phaseEls = [els.phaseUpload, els.phaseScan, els.phaseAnalyze];
  const idx = phases.indexOf(phase);

  phaseEls.forEach((el, i) => {
    el.classList.remove("active", "done");
    if (i < idx) el.classList.add("done");
    else if (i === idx) el.classList.add("active");
  });
}

function handleScanComplete(data) {
  // Show on processing screen briefly
  els.statusText.textContent = "Key moments identified — starting deep analysis...";

  // Prepare scan summary for results
  if (data && !data.raw_scan) {
    let html = "";
    if (data.combat_type) {
      html += `<span class="scan-tag highlight">${data.combat_type}</span>`;
    }
    if (data.fighters) {
      data.fighters.forEach((f) => {
        html += `<span class="scan-tag">${f.description || f.id} (${f.stance || "?"})</span>`;
      });
    }
    if (data.tactical_situation) {
      html += `<p style="margin-top:var(--space-2);font-size:var(--text-xs);color:var(--color-text-muted)">${data.tactical_situation}</p>`;
    }
    els.scanSummaryContent.innerHTML = html;
    els.scanSummary.classList.remove("hidden");
  }
}

function renderAnalysis(text, streaming) {
  // Switch to results screen on first chunk
  if (screens.processing.classList.contains("active")) {
    showScreen("results");
    els.resultsVideo.src = videoObjectUrl;
    els.resultsVideo.load();
  }

  // Convert markdown-ish text to HTML
  let html = markdownToHtml(text);

  if (streaming) {
    html += '<span class="streaming-cursor"></span>';
  }

  els.analysisContent.innerHTML = html;

  // Auto-scroll to bottom during streaming
  if (streaming) {
    const content = els.analysisContent;
    content.scrollTop = content.scrollHeight;
  }
}

function finishAnalysis(scanData) {
  // Remove cursor, final render
  const cursors = els.analysisContent.querySelectorAll(".streaming-cursor");
  cursors.forEach((c) => c.remove());

  // Show chat section
  if (currentSessionId) {
    els.chatSection.classList.remove("hidden");
    els.chatInput.focus();
  }
}

function showError(message) {
  showScreen("upload");
  resetUpload();

  // Show error temporarily
  const errorEl = document.createElement("div");
  errorEl.className = "error-message";
  errorEl.textContent = message;
  document.querySelector(".upload-container").appendChild(errorEl);

  setTimeout(() => errorEl.remove(), 8000);
}

// --- New analysis ---
els.btnNew.addEventListener("click", () => {
  showScreen("upload");
  resetUpload();
  els.analysisContent.innerHTML = "";
  els.scanSummary.classList.add("hidden");
  els.chatSection.classList.add("hidden");
  els.chatMessages.innerHTML = "";
  currentSessionId = null;
});

// --- Chat ---
els.chatInput.addEventListener("input", () => {
  els.chatSend.disabled = !els.chatInput.value.trim() || chatStreaming;
});

els.chatForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const message = els.chatInput.value.trim();
  if (!message || !currentSessionId || chatStreaming) return;

  // Add user message to chat
  addChatMessage("user", message);
  els.chatInput.value = "";
  els.chatSend.disabled = true;
  chatStreaming = true;

  // Add thinking indicator
  const thinkingEl = document.createElement("div");
  thinkingEl.className = "chat-msg thinking";
  thinkingEl.innerHTML = '<div class="dots"><span></span><span></span><span></span></div>';
  els.chatMessages.appendChild(thinkingEl);
  scrollChatToBottom();

  try {
    const formData = new FormData();
    formData.append("session_id", currentSessionId);
    formData.append("message", message);

    const response = await fetch(`${API}/api/chat`, {
      method: "POST",
      body: formData,
    });

    if (!response.ok) throw new Error(`Server error: ${response.status}`);

    // Remove thinking indicator
    thinkingEl.remove();

    // Create assistant message bubble
    const msgEl = document.createElement("div");
    msgEl.className = "chat-msg assistant";
    els.chatMessages.appendChild(msgEl);

    // Process SSE stream
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let fullText = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const events = buffer.split("\n\n");
      buffer = events.pop() || "";

      for (const eventStr of events) {
        if (!eventStr.trim()) continue;
        const lines = eventStr.split("\n");
        let eventType = "";
        let eventData = "";

        for (const line of lines) {
          if (line.startsWith("event: ")) eventType = line.slice(7);
          else if (line.startsWith("data: ")) eventData = line.slice(6);
        }

        if (!eventType || !eventData) continue;
        let data;
        try { data = JSON.parse(eventData); } catch { continue; }

        if (eventType === "chunk" && data.text) {
          fullText += data.text;
          msgEl.innerHTML = markdownToHtml(fullText) + '<span class="streaming-cursor"></span>';
          scrollChatToBottom();
        } else if (eventType === "complete") {
          fullText = data.full_text || fullText;
          msgEl.innerHTML = markdownToHtml(fullText);
          scrollChatToBottom();
        } else if (eventType === "error") {
          msgEl.innerHTML = `<span style="color:var(--color-error)">${data.message || "Something went wrong"}</span>`;
        }
      }
    }
  } catch (err) {
    thinkingEl.remove();
    addChatMessage("assistant", `<span style="color:var(--color-error)">Connection error. Please try again.</span>`);
  } finally {
    chatStreaming = false;
    els.chatSend.disabled = !els.chatInput.value.trim();
    els.chatInput.focus();
  }
});

function addChatMessage(role, content) {
  const el = document.createElement("div");
  el.className = `chat-msg ${role}`;
  el.innerHTML = role === "user" ? escapeHtml(content) : content;
  els.chatMessages.appendChild(el);
  scrollChatToBottom();
}

function scrollChatToBottom() {
  els.chatMessages.scrollTop = els.chatMessages.scrollHeight;
}

function escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

// --- Markdown to HTML (simple) ---
function markdownToHtml(md) {
  let html = md
    // Headers
    .replace(/^### (.+)$/gm, "<h3>$1</h3>")
    .replace(/^## (.+)$/gm, "<h3>$1</h3>")
    // Bold
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    // Italic
    .replace(/\*(.+?)\*/g, "<em>$1</em>")
    // Unordered lists
    .replace(/^- (.+)$/gm, "<li>$1</li>")
    // Ordered lists
    .replace(/^\d+\. (.+)$/gm, "<li>$1</li>")
    // Paragraphs (double newline)
    .replace(/\n\n/g, "</p><p>")
    // Single newlines within paragraphs
    .replace(/\n/g, "<br>");

  // Wrap consecutive <li> in <ul>
  html = html.replace(/((?:<li>.*?<\/li>\s*(?:<br>)?)+)/g, "<ul>$1</ul>");
  // Clean up <br> inside <ul>
  html = html.replace(/<ul>([\s\S]*?)<\/ul>/g, (match) =>
    match.replace(/<br>/g, "")
  );

  // Wrap in paragraph if not starting with a block element
  if (!html.startsWith("<h") && !html.startsWith("<ul") && !html.startsWith("<p")) {
    html = "<p>" + html + "</p>";
  }

  return html;
}


// --- Utils ---
function formatBytes(bytes) {
  if (bytes < 1024) return bytes + " B";
  if (bytes < 1048576) return (bytes / 1024).toFixed(1) + " KB";
  return (bytes / 1048576).toFixed(1) + " MB";
}
