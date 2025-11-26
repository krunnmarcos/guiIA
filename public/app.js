const API_BASE = window.API_BASE_URL || "https://guiia-33486701312.southamerica-east1.run.app";

const ADMIN_EMAILS = new Set([
  "marcos.irenos@gruporic.com.br",
  "marcos.staichaka@gruporic.com.br"
]);

const els = {
  tabLogin: document.getElementById("tab-login"),
  tabRegister: document.getElementById("tab-register"),
  loginForm: document.getElementById("login-form"),
  registerForm: document.getElementById("register-form"),
  authError: document.getElementById("auth-error"),
  logoutBtn: document.getElementById("logout-btn"),
  userEmail: document.getElementById("user-email"),
  newChat: document.getElementById("new-chat"),
  chatList: document.getElementById("chat-list"),
  chatTitle: document.getElementById("chat-title"),
  chatSubtitle: document.getElementById("chat-subtitle"),
  messages: document.getElementById("messages"),
  messageForm: document.getElementById("message-form"),
  messageInput: document.getElementById("message-input"),
  typing: document.getElementById("typing"),
  status: document.getElementById("connection-status"),
  adminPanel: document.getElementById("admin-panel"),
  reportPanel: document.getElementById("report-panel"),
  exportBtn: document.getElementById("export-btn"),
  refreshReport: document.getElementById("refresh-report"),
  usageChart: document.getElementById("usageChart"),
  topicsChart: document.getElementById("topicsChart")
};

let state = {
  token: null,
  user: null,
  currentChatId: null,
  chatItems: [],
  messageCache: [],
  usageChart: null,
  topicsChart: null
};

const requireCorpEmail = (email) => email && email.toLowerCase().endsWith("@gruporic.com.br");

const setStatus = (text, ok = false) => {
  els.status.textContent = text;
  els.status.style.color = ok ? "#4ade80" : "#94a3b8";
};

const showError = (msg) => {
  els.authError.textContent = msg || "";
};

const switchTab = (tab) => {
  const isLogin = tab === "login";
  els.tabLogin.classList.toggle("active", isLogin);
  els.tabRegister.classList.toggle("active", !isLogin);
  els.loginForm.classList.toggle("visible", isLogin);
  els.registerForm.classList.toggle("visible", !isLogin);
  showError("");
};

const saveSession = (token, user) => {
  state.token = token;
  state.user = user;
  localStorage.setItem("guiia_token", token);
  localStorage.setItem("guiia_user", JSON.stringify(user));
};

const loadSession = () => {
  const token = localStorage.getItem("guiia_token");
  const userRaw = localStorage.getItem("guiia_user");
  if (token && userRaw) {
    state.token = token;
    state.user = JSON.parse(userRaw);
    onLogin();
  }
};

const clearSession = () => {
  localStorage.removeItem("guiia_token");
  localStorage.removeItem("guiia_user");
  state = { token: null, user: null, currentChatId: null, chatItems: [], messageCache: [], usageChart: null, topicsChart: null };
};

const api = async (path, options = {}) => {
  const headers = { "Content-Type": "application/json", ...(options.headers || {}) };
  if (state.token) headers.Authorization = `Bearer ${state.token}`;
  const res = await fetch(`${API_BASE}${path}`, { ...options, headers });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || `Erro ${res.status}`);
  }
  if (res.headers.get("content-type")?.includes("text/csv")) return res.text();
  return res.json();
};

const renderChatList = (items) => {
  state.chatItems = items;
  els.chatList.innerHTML = "";
  items.forEach((item) => {
    const div = document.createElement("div");
    div.className = "chat-item" + (item.id === state.currentChatId ? " active" : "");
    div.textContent = item.title || `Chat ${item.id}`;
    div.onclick = () => selectChat(item.id, item);
    els.chatList.appendChild(div);
  });
};

const loadChats = async () => {
  const chats = await api("/chats");
  renderChatList(chats);
};

const selectChat = async (id, data = {}) => {
  state.currentChatId = id;
  els.chatTitle.textContent = data.title || `Chat ${id}`;
  els.chatSubtitle.textContent = data.owner_email ? `Dono: ${data.owner_email}` : "Histórico salvo no servidor";
  await loadMessages(id);
};

const loadMessages = async (chatId) => {
  const msgs = await api(`/chats/${chatId}/messages`);
  state.messageCache = msgs;
  els.messages.innerHTML = "";
  msgs.forEach((m) => {
    const bubble = document.createElement("div");
    bubble.className = "bubble " + (m.role === "user" ? "user" : "bot");
    bubble.textContent = m.content;
    els.messages.appendChild(bubble);
  });
  els.messages.scrollTop = els.messages.scrollHeight;
};

const createChat = async () => {
  const chat = await api("/chats", { method: "POST", body: JSON.stringify({}) });
  await loadChats();
  await selectChat(chat.id, chat);
};

const sendMessage = async (evt) => {
  evt.preventDefault();
  if (!state.currentChatId) {
    showError("Crie um chat antes de enviar.");
    return;
  }
  const value = els.messageInput.value.trim();
  if (!value) return;
  els.messageInput.value = "";
  els.typing.classList.remove("hidden");
  try {
    const userBubble = document.createElement("div");
    userBubble.className = "bubble user";
    userBubble.textContent = value;
    els.messages.appendChild(userBubble);
    els.messages.scrollTop = els.messages.scrollHeight;

    const data = await api(`/chats/${state.currentChatId}/messages`, {
      method: "POST",
      body: JSON.stringify({ content: value })
    });
    const replyBubble = document.createElement("div");
    replyBubble.className = "bubble bot";
    replyBubble.textContent = data.reply || "Sem resposta";
    els.messages.appendChild(replyBubble);
    els.messages.scrollTop = els.messages.scrollHeight;
  } catch (err) {
    showError(err.message);
  } finally {
    els.typing.classList.add("hidden");
  }
};

const handleLogin = async (evt) => {
  evt.preventDefault();
  const data = new FormData(els.loginForm);
  const email = data.get("email");
  const password = data.get("password");
  try {
    showError("");
    const res = await api("/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password })
    });
    saveSession(res.token, res.user);
    onLogin();
  } catch (err) {
    showError(err.message);
  }
};

const handleRegister = async (evt) => {
  evt.preventDefault();
  const data = new FormData(els.registerForm);
  const email = (data.get("email") || "").toLowerCase();
  const password = data.get("password");
  const first = data.get("firstName") || "";
  const last = data.get("lastName") || "";
  if (!requireCorpEmail(email)) {
    showError("Use apenas email @gruporic.com.br");
    return;
  }
  try {
    showError("");
    const res = await api("/auth/register", {
      method: "POST",
      body: JSON.stringify({ email, password, firstName: first, lastName: last })
    });
    saveSession(res.token, res.user);
    onLogin();
  } catch (err) {
    showError(err.message);
  }
};

const handleLogout = () => {
  clearSession();
  els.messages.innerHTML = "";
  els.chatList.innerHTML = "";
  els.userEmail.textContent = "";
  els.adminPanel.classList.add("hidden");
  els.reportPanel.classList.add("hidden");
  els.messageInput.disabled = true;
  els.messageForm.querySelector("button").disabled = true;
  setStatus("Offline");
};

const onLogin = async () => {
  els.userEmail.textContent = state.user?.email || "";
  els.messageInput.disabled = false;
  els.messageForm.querySelector("button").disabled = false;
  setStatus("Online", true);
  const admin = ADMIN_EMAILS.has((state.user?.email || "").toLowerCase());
  els.adminPanel.classList.toggle("hidden", !admin);
  els.reportPanel.classList.toggle("hidden", !admin);
  await loadChats();
};

const exportCsv = async () => {
  if (!state.user || !ADMIN_EMAILS.has((state.user.email || "").toLowerCase())) {
    showError("Somente admins podem exportar.");
    return;
  }
  try {
    const csv = await api("/admin/export");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "adsim_chats.csv";
    a.click();
    URL.revokeObjectURL(url);
  } catch (err) {
    showError(err.message);
  }
};

const buildChart = (ctx, label, data) => {
  const labels = Object.keys(data);
  const values = Object.values(data);
  if (!ctx) return;
  const existing = ctx.dataset.chartInstance;
  if (existing) existing.destroy();
  const instance = new Chart(ctx, {
    type: "bar",
    data: {
      labels,
      datasets: [{
        label,
        data: values,
        backgroundColor: ["#4ade80", "#60a5fa", "#a78bfa", "#f59e0b"]
      }]
    },
    options: {
      responsive: true,
      plugins: { legend: { display: false } }
    }
  });
  ctx.dataset.chartInstance = instance;
};

const loadReports = async () => {
  if (!state.user || !ADMIN_EMAILS.has((state.user.email || "").toLowerCase())) return;
  try {
    const data = await api("/admin/report");
    const usageObj = {};
    data.usage.forEach((row) => { usageObj[row.email] = Number(row.total); });
    const topicsObj = {};
    data.topics.forEach((row) => { topicsObj[row.term] = Number(row.total); });
    buildChart(els.usageChart, "Uso por email", usageObj);
    buildChart(els.topicsChart, "Termos frequentes", topicsObj);
  } catch (err) {
    showError(err.message);
  }
};

const bootstrap = () => {
  els.tabLogin.onclick = () => switchTab("login");
  els.tabRegister.onclick = () => switchTab("register");
  els.loginForm.addEventListener("submit", handleLogin);
  els.registerForm.addEventListener("submit", handleRegister);
  els.logoutBtn.onclick = handleLogout;
  els.newChat.onclick = createChat;
  els.messageForm.addEventListener("submit", sendMessage);
  els.exportBtn.onclick = exportCsv;
  els.refreshReport.onclick = loadReports;
  els.messageInput.disabled = true;
  els.messageForm.querySelector("button").disabled = true;
  loadSession();
};

bootstrap();
