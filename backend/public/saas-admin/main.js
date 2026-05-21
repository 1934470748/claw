async function load() {
  const status = document.getElementById("status");
  try {
    const [providers, usage] = await Promise.all([
      fetch("/api/providers").then((r) => r.json()).catch(() => ({})),
      fetch("/api/usage/recent-token-history?limit=100").then((r) => r.json()).catch(() => ({}))
    ]);
    const providerList = providers.providers || providers.items || [];
    const entries = usage.entries || [];
    document.getElementById("users").textContent = "本地";
    document.getElementById("keys").textContent = providerList.length || 0;
    document.getElementById("tokens").textContent = usage.total || 0;
    status.textContent = "正常";
    const rows = document.getElementById("keyRows");
    rows.innerHTML = "";
    (providerList.length ? providerList : [{ name: "等待接入 NewAPI 管理员接口", type: "planning" }]).slice(0, 5).forEach((item) => {
      const row = document.createElement("div");
      row.className = "row";
      row.innerHTML = `<span>${item.name || item.id || "Provider"}</span><span>${item.type || "api_key"}</span>`;
      rows.appendChild(row);
    });
  } catch (error) {
    status.textContent = "异常";
  }
}

document.getElementById("refresh").addEventListener("click", load);
load();
