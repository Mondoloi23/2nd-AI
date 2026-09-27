const el = (id) => document.getElementById(id);

const sidebar = el("sidebar");
const overlay = el("overlay");
const chatList = el("chatList");
const messagesEl = el("messages");
const welcome = el("welcome");
const chatForm = el("chatForm");
const input = el("input");
const sendBtn = el("send");
const chatTitle = el("chatTitle");
const statusEl = el("status");
const voiceBtn = el("voiceBtn");
const settingsDialog = el("settingsDialog");
const modelInput = el("modelInput");
const temperatureInput = el("temperatureInput");
const temperatureValue = el("temperatureValue");

let state = {
  chats: [],
  currentChatId: null,
  settings: {
    model: localStorage.getItem("myai_model") || "openrouter/free",
    temperature: parseFloat(localStorage.getItem("myai_temp") || "0.7"),
  },
  streaming: false,
};

modelInput.value = state.settings.model;
temperatureInput.value = state.settings.temperature;
temperatureValue.textContent = state.settings.temperature;

// ---------- Sidebar (mobile) ----------
el("openSidebar").addEventListener("click", () => {
  sidebar.classList.add("open");
  overlay.classList.add("show");
});
el("closeSidebar").addEventListener("click", closeSidebar);
overlay.addEventListener("click", closeSidebar);
function closeSidebar() {
  sidebar.classList.remove("open");
  overlay.classList.remove("show");
}

// ---------- Settings ----------
el("settingsBtn").addEventListener("click", () => settingsDialog.showModal());
el("closeSettings").addEventListener("click", () => settingsDialog.close());
temperatureInput.addEventListener("input", () => {
  temperatureValue.textContent = temperatureInput.value;
});
el("saveSettings").addEventListener("click", () => {
  state.settings.model = modelInput.value.trim() || "openrouter/free";
  state.settings.temperature = parseFloat(temperatureInput.value);
  localStorage.setItem("myai_model", state.settings.model);
  localStorage.setItem("myai_temp", state.settings.temperature);
  settingsDialog.close();
});

// ---------- API helpers ----------
async function api(path, options = {}) {
  const res = await fetch(path, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  if (!res.ok) throw new Error(`Request failed: ${res.status}`);
  return res.json();
}

// ---------- Chat list ----------
async function loadChats() {
  state.chats = await api("/api/chats");
  renderChatList();
  if (!state.currentChatId && state.chats.length) {
    selectChat(state.chats[0].id);
  } else if (!state.chats.length) {
    showWelcome();
  }
}

function renderChatList() {
  chatList.innerHTML = "";
  state.chats.forEach((chat) => {
    const item = document.createElement("div");
    item.className = "chat-item" + (chat.id === state.currentChatId ? " active" : "");
    item.innerHTML = `
      <span class="title">${escapeHtml(chat.title)}</span>
      <button class="menu-btn" data-id="${chat.id}">⋯</button>
    `;
    item.querySelector(".title").addEventListener("click", () => {
      selectChat(chat.id);
      closeSidebar();
    });
    item.querySelector(".menu-btn").addEventListener("click", (e) => {
      e.stopPropagation();
      openChatMenu(chat, item);
    });
    chatList.appendChild(item);
  });
}

function openChatMenu(chat, anchorEl) {
  document.querySelectorAll(".chat-menu").forEach((m) => m.remove());
  const menu = document.createElement("div");
  menu.className = "chat-menu";
  menu.innerHTML = `
    <button data-action="rename">Rename</button>
    <button data-action="delete" class="danger">Delete</button>
  `;
  menu.querySelector('[data-action="rename"]').addEventListener("click", async (e) => {
    e.stopPropagation();
    const newTitle = prompt("New chat name:", chat.title);
    if (newTitle && newTitle.trim()) {
      await api(`/api/chats/${chat.id}`, {
        method: "PATCH",
        body: JSON.stringify({ title: newTitle.trim() }),
      });
      await loadChats();
    }
    menu.remove();
  });
  menu.querySelector('[data-action="delete"]').addEventListener("click", async (e) => {
    e.stopPropagation();
    if (confirm(`Delete "${chat.title}"?`)) {
      await api(`/api/chats/${chat.id}`, { method: "DELETE" });
      if (state.currentChatId === chat.id) state.currentChatId = null;
      await loadChats();
    }
    menu.remove();
  });
  anchorEl.appendChild(menu);
  setTimeout(() => {
    document.addEventListener("click", function handler() {
      menu.remove();
      document.removeEventListener("click", handler);
    });
  }, 0);
}

el("newChat").addEventListener("click", async () => {
  const chat = await api("/api/chats", {
    method: "POST",
    body: JSON.stringify({ title: "New chat" }),
  });
  await loadChats();
  selectChat(chat.id);
  closeSidebar();
});

el("clearChat").addEventListener("click", async () => {
  if (!state.currentChatId) return;
  if (confirm("Delete this chat's messages and start over?")) {
    await api(`/api/chats/${state.currentChatId}`, { method: "DELETE" });
    state.currentChatId = null;
    await loadChats();
  }
});

async function selectChat(chatId) {
  state.currentChatId = chatId;
  renderChatList();
  const data = await api(`/api/chats/${chatId}/messages`);
  chatTitle.textContent = data.chat.title;
  renderMessages(data.messages);
}

function showWelcome() {
  chatTitle.textContent = "New chat";
  messagesEl.innerHTML = "";
  messagesEl.appendChild(welcome);
}

// ---------- Messages ----------
function renderMessages(messages) {
  messagesEl.innerHTML = "";
  if (!messages.length) {
    messagesEl.appendChild(welcome);
    return;
  }
  messages.forEach((m) => appendMessage(m.role, m.content));
  scrollToBottom();
}

function appendMessage(role, content) {
  if (welcome.parentElement) welcome.remove();
  const row = document.createElement("div");
  row.className = `message-row ${role}`;
  row.innerHTML = `
    <div class="avatar">${role === "user" ? "You" : "AI"}</div>
    <div class="bubble">${renderMarkdown(content)}</div>
  `;
  messagesEl.appendChild(row);
  attachCopyButtons(row);
  return row;
}

function scrollToBottom() {
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

// ---------- Sending ----------
chatForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const text = input.value.trim();
  if (!text || state.streaming) return;

  if (!state.currentChatId) {
    const chat = await api("/api/chats", {
      method: "POST",
      body: JSON.stringify({ title: "New chat" }),
    });
    await loadChats();
    state.currentChatId = chat.id;
  }

  input.value = "";
  input.style.height = "auto";
  await api(`/api/chats/${state.currentChatId}/messages`, {
    method: "POST",
    body: JSON.stringify({ role: "user", content: text }),
  });
  appendMessage("user", text);
  scrollToBottom();
  await loadChats(); // refresh title/order

  await streamAssistantReply();
});

input.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    chatForm.requestSubmit();
  }
});

input.addEventListener("input", () => {
  input.style.height = "auto";
  input.style.height = Math.min(input.scrollHeight, 160) + "px";
});

el("suggestions") // guard if suggestions container ever renamed
document.querySelectorAll(".suggestions button").forEach((btn) => {
  btn.addEventListener("click", () => {
    input.value = btn.dataset.prompt;
    chatForm.requestSubmit();
  });
});

async function streamAssistantReply() {
  state.streaming = true;
  sendBtn.disabled = true;
  statusEl.textContent = "Thinking...";

  const row = document.createElement("div");
  row.className = "message-row assistant";
  row.innerHTML = `
    <div class="avatar">AI</div>
    <div class="bubble"><span class="typing-dots"><span></span><span></span><span></span></span></div>
  `;
  messagesEl.appendChild(row);
  scrollToBottom();
  const bubble = row.querySelector(".bubble");

  let fullText = "";
  try {
    const res = await fetch(`/api/chats/${state.currentChatId}/stream`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(state.settings),
    });
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const parts = buffer.split("\n\n");
      buffer = parts.pop();
      for (const part of parts) {
        const line = part.trim();
        if (!line.startsWith("data:")) continue;
        const payload = line.slice(5).trim();
        if (payload === "[DONE]") continue;
        try {
          const parsed = JSON.parse(payload);
          if (parsed.error) {
            fullText += `\n\n**Error:** ${parsed.error}`;
          } else if (parsed.content) {
            fullText += parsed.content;
          }
          bubble.innerHTML = renderMarkdown(fullText);
          attachCopyButtons(row);
          scrollToBottom();
        } catch (_) {
          // ignore malformed chunk
        }
      }
    }
  } catch (err) {
    fullText += `\n\n**Error:** ${err.message}`;
    bubble.innerHTML = renderMarkdown(fullText);
  }

  if (fullText.trim()) {
    await api(`/api/chats/${state.currentChatId}/messages`, {
      method: "POST",
      body: JSON.stringify({ role: "assistant", content: fullText }),
    });
  }

  state.streaming = false;
  sendBtn.disabled = false;
  statusEl.textContent = "Ready";
}

// ---------- Voice input ----------
const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
let recognizer = null;
let recording = false;

if (SpeechRecognition) {
  recognizer = new SpeechRecognition();
  recognizer.continuous = false;
  recognizer.interimResults = true;
  recognizer.lang = "en-US";

  recognizer.onresult = (event) => {
    let transcript = "";
    for (let i = 0; i < event.results.length; i++) {
      transcript += event.results[i][0].transcript;
    }
    input.value = transcript;
  };
  recognizer.onend = () => {
    recording = false;
    voiceBtn.classList.remove("recording");
  };
} else {
  voiceBtn.disabled = true;
  voiceBtn.title = "Voice input not supported in this browser";
}

voiceBtn.addEventListener("click", () => {
  if (!recognizer) return;
  if (recording) {
    recognizer.stop();
    recording = false;
    voiceBtn.classList.remove("recording");
  } else {
    recognizer.start();
    recording = true;
    voiceBtn.classList.add("recording");
  }
});

// ---------- Minimal Markdown rendering ----------
function escapeHtml(str) {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function renderMarkdown(text) {
  let escaped = escapeHtml(text);

  // Fenced code blocks ```lang\ncode```
  escaped = escaped.replace(/```(\w*)\n([\s\S]*?)```/g, (_, lang, code) => {
    return `<pre><button class="code-copy">Copy</button><code data-lang="${lang}">${code.trim()}</code></pre>`;
  });

  // Inline code
  escaped = escaped.replace(/`([^`]+)`/g, "<code>$1</code>");

  // Bold / italic
  escaped = escaped.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  escaped = escaped.replace(/(?<!\*)\*([^*]+)\*(?!\*)/g, "<em>$1</em>");

  // Paragraph breaks (skip inside <pre> blocks by splitting on them)
  const segments = escaped.split(/(<pre>[\s\S]*?<\/pre>)/g);
  const withParagraphs = segments
    .map((seg) => {
      if (seg.startsWith("<pre>")) return seg;
      return seg
        .split(/\n{2,}/)
        .filter((p) => p.trim())
        .map((p) => `<p>${p.replace(/\n/g, "<br>")}</p>`)
        .join("");
    })
    .join("");

  return withParagraphs;
}

function attachCopyButtons(scope) {
  scope.querySelectorAll(".code-copy").forEach((btn) => {
    if (btn.dataset.bound) return;
    btn.dataset.bound = "true";
    btn.addEventListener("click", () => {
      const code = btn.nextElementSibling.textContent;
      navigator.clipboard.writeText(code).then(() => {
        btn.textContent = "Copied!";
        setTimeout(() => (btn.textContent = "Copy"), 1500);
      });
    });
  });
}

// ---------- Init ----------
loadChats().catch((err) => {
  statusEl.textContent = "Error";
  console.error(err);
});
