const root = document.documentElement;
const state = {
  users: [],
  plans: [],
  overview: null,
  manifest: null
};

const $ = (selector) => document.querySelector(selector);
const nf = new Intl.NumberFormat("zh-CN");

root.dataset.theme = localStorage.getItem("mianclaw-admin-theme") || "mirror";

function toast(message, type = "ok") {
  const el = $("#toast");
  el.textContent = message;
  el.dataset.type = type;
  el.classList.add("show");
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => el.classList.remove("show"), 2600);
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[char]);
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    cache: "no-store",
    ...options
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.success === false) {
    throw new Error(data.error || data.message || `请求失败：${response.status}`);
  }
  return data;
}

function planName(id) {
  return state.plans.find((plan) => plan.id === id)?.name || id || "未分配";
}

function renderOverview() {
  const users = state.users;
  const keyCount = users.filter((user) => user.hasKey).length;
  const totalQuota = users.reduce((sum, user) => sum + Number(user.quota || 0), 0);
  $("#statUsers").textContent = nf.format(users.length);
  $("#statKeys").textContent = nf.format(keyCount);
  $("#statQuota").textContent = nf.format(totalQuota);
}

function renderPlans() {
  const select = $("#planSelect");
  select.innerHTML = state.plans.map((plan) => `<option value="${escapeHtml(plan.id)}">${escapeHtml(plan.name)}</option>`).join("");

  $("#plansList").innerHTML = state.plans.map((plan) => `
    <div class="list-item">
      <div>
        <strong>${escapeHtml(plan.name)}</strong>
        <span>${escapeHtml(plan.id)} · ¥${nf.format(Number(plan.price || 0))} · ${nf.format(Number(plan.quota || 0))} tokens</span>
        <small>${escapeHtml(plan.description || "暂无说明")}</small>
      </div>
      <div class="row-actions">
        <button class="ghost" data-action="edit-plan" data-id="${escapeHtml(plan.id)}" type="button">编辑</button>
        <button class="danger" data-action="delete-plan" data-id="${escapeHtml(plan.id)}" type="button">删除</button>
      </div>
    </div>
  `).join("");
}

function renderUsers() {
  const tbody = $("#usersTable");
  if (!state.users.length) {
    tbody.innerHTML = `<tr><td colspan="6" class="empty">还没有用户，先创建一个本地测试账号。</td></tr>`;
    renderOverview();
    return;
  }
  tbody.innerHTML = state.users.map((user) => `
    <tr>
      <td>
        <strong>${escapeHtml(user.name)}</strong>
        <small>${escapeHtml(user.email || "未填写邮箱")}</small>
      </td>
      <td>${escapeHtml(planName(user.planId))}</td>
      <td>
        <strong>${nf.format(Number(user.quota || 0))}</strong>
        <small>已用 ${nf.format(Number(user.usedQuota || 0))}</small>
      </td>
      <td>${user.hasKey ? `<code>${escapeHtml(user.keyPreview)}</code>` : `<span class="muted">未签发</span>`}</td>
      <td><span class="pill ${user.status === "active" ? "ok" : "muted"}">${escapeHtml(user.status || "active")}</span></td>
      <td>
        <div class="row-actions">
          <button class="ghost" data-action="issue-key" data-id="${escapeHtml(user.id)}" type="button">签发 Key</button>
          <button class="ghost" data-action="quota" data-id="${escapeHtml(user.id)}" type="button">额度</button>
          <button class="danger" data-action="delete-user" data-id="${escapeHtml(user.id)}" type="button">删除</button>
        </div>
      </td>
    </tr>
  `).join("");
  renderOverview();
}

function renderManifest() {
  const manifest = state.manifest || {};
  $("#releaseCard").innerHTML = `
    <strong>${escapeHtml(manifest.version || "0.3.9")}</strong>
    <span>${escapeHtml(manifest.downloadUrl || "暂未配置下载地址")}</span>
    <small>${escapeHtml(manifest.notes || "暂无发布说明")}</small>
  `;
  $("#updateState").textContent = manifest.source || "local";
  const form = $("#updateForm");
  form.version.value = manifest.version || "";
  form.downloadUrl.value = manifest.downloadUrl || "";
  form.notes.value = manifest.notes || "";
}

async function loadLogs() {
  try {
    const data = await api("/api/logs?tailLines=80");
    $("#logs").textContent = data.content || data.lines?.join("\n") || "暂无日志";
  } catch (error) {
    $("#logs").textContent = error.message;
  }
}

async function loadRuntime() {
  try {
    const [health, update] = await Promise.all([
      api("/api/gateway/health"),
      api("/api/update/status")
    ]);
    $("#backendState").textContent = "正常";
    $("#gatewayState").textContent = health.gateway || (health.ok ? "ok" : "unknown");
    $("#statRuntime").textContent = health.gateway === "unreachable" ? "待连接" : "正常";
    $("#runtimeHint").textContent = `Gateway ${health.gateway || "ok"} · ${update.source || "local"}`;
    state.manifest = update.updateInfo || {};
    state.manifest.source = update.source || "local";
    renderManifest();
  } catch (error) {
    $("#backendState").textContent = "异常";
    $("#gatewayState").textContent = "未知";
    $("#statRuntime").textContent = "异常";
    $("#runtimeHint").textContent = error.message;
  }
}

async function loadAll() {
  try {
    const [overview, users, plans, manifest] = await Promise.all([
      api("/api/admin/overview"),
      api("/api/admin/users"),
      api("/api/admin/plans"),
      api("/api/admin/update/manifest")
    ]);
    state.overview = overview.overview;
    state.users = users.users || [];
    state.plans = plans.plans || [];
    state.manifest = manifest.manifest || {};
    renderPlans();
    renderUsers();
    renderManifest();
    await Promise.all([loadRuntime(), loadLogs()]);
  } catch (error) {
    toast(error.message, "error");
  }
}

$("#themeToggle").addEventListener("click", () => {
  const next = root.dataset.theme === "mirror" ? "dark" : "mirror";
  root.dataset.theme = next;
  localStorage.setItem("mianclaw-admin-theme", next);
});

$("#refresh").addEventListener("click", () => {
  loadAll();
  toast("数据已刷新");
});

$("#reloadLogs").addEventListener("click", () => {
  loadLogs();
  toast("已重新读取日志");
});

$("#userForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const body = Object.fromEntries(new FormData(form).entries());
  body.quota = Number(body.quota || 0);
  try {
    await api("/api/admin/users", { method: "POST", body: JSON.stringify(body) });
    form.reset();
    form.quota.value = 1000000;
    await loadAll();
    toast("用户已创建");
  } catch (error) {
    toast(error.message, "error");
  }
});

$("#seedUser").addEventListener("click", async () => {
  const stamp = Date.now().toString().slice(-4);
  try {
    await api("/api/admin/users", {
      method: "POST",
      body: JSON.stringify({
        name: `演示客户 ${stamp}`,
        email: `demo${stamp}@mianclaw.local`,
        planId: "starter",
        quota: 1000000,
        notes: "本地演示账号"
      })
    });
    await loadAll();
    toast("示例用户已创建");
  } catch (error) {
    toast(error.message, "error");
  }
});

$("#planForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const body = Object.fromEntries(new FormData(form).entries());
  body.price = Number(body.price || 0);
  body.quota = Number(body.quota || 0);
  try {
    await api(`/api/admin/plans${state.plans.some((plan) => plan.id === body.id) ? `/${encodeURIComponent(body.id)}` : ""}`, {
      method: state.plans.some((plan) => plan.id === body.id) ? "PUT" : "POST",
      body: JSON.stringify(body)
    });
    form.reset();
    await loadAll();
    toast("套餐已保存");
  } catch (error) {
    toast(error.message, "error");
  }
});

$("#updateForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const body = Object.fromEntries(new FormData(event.currentTarget).entries());
  try {
    await api("/api/admin/update/manifest", { method: "POST", body: JSON.stringify(body) });
    await loadAll();
    toast("发布配置已保存");
  } catch (error) {
    toast(error.message, "error");
  }
});

document.addEventListener("click", async (event) => {
  const button = event.target.closest("[data-action]");
  if (!button) return;
  const action = button.dataset.action;
  const id = button.dataset.id;
  try {
    if (action === "issue-key") {
      const data = await api(`/api/admin/users/${encodeURIComponent(id)}/issue-key`, { method: "POST" });
      await navigator.clipboard?.writeText(data.apiKey).catch(() => {});
      toast("Key 已签发，已尝试复制到剪贴板");
    }
    if (action === "quota") {
      const user = state.users.find((item) => item.id === id);
      const value = window.prompt("输入新的总额度", user?.quota ?? 0);
      if (value === null) return;
      await api(`/api/admin/users/${encodeURIComponent(id)}/quota`, {
        method: "POST",
        body: JSON.stringify({ quota: Number(value || 0) })
      });
      toast("额度已更新");
    }
    if (action === "delete-user") {
      if (!window.confirm("确认删除这个用户？")) return;
      await api(`/api/admin/users/${encodeURIComponent(id)}`, { method: "DELETE" });
      toast("用户已删除");
    }
    if (action === "edit-plan") {
      const plan = state.plans.find((item) => item.id === id);
      const form = $("#planForm");
      form.id.value = plan.id;
      form.name.value = plan.name;
      form.price.value = plan.price;
      form.quota.value = plan.quota;
      form.description.value = plan.description || "";
      form.scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }
    if (action === "delete-plan") {
      if (!window.confirm("确认删除这个套餐？")) return;
      await api(`/api/admin/plans/${encodeURIComponent(id)}`, { method: "DELETE" });
      toast("套餐已删除");
    }
    await loadAll();
  } catch (error) {
    toast(error.message, "error");
  }
});

document.querySelectorAll("nav a").forEach((link) => {
  link.addEventListener("click", () => {
    document.querySelectorAll("nav a").forEach((item) => item.classList.toggle("active", item === link));
  });
});

loadAll();
