(function () {
  "use strict";

  var KEY_PAGE = "http://127.0.0.1:3001/mianclaw/key.html";
  var SKILLHUB = "https://clawhub.ai";
  var BRAND_FROM = "MianClaw";
  var BRAND_TO = "MianClaw";
  var BRAND_FROM_UPPER = "MIANCLAW";
  var BRAND_TO_UPPER = "MIANCLAW";

  window.__mianclawRuntimeLoaded = true;

  function textContains(text, needle) {
    return String(text || "").indexOf(needle) >= 0;
  }

  function openUrl(url) {
    if (window.electron && typeof window.electron.openExternal === "function") {
      window.electron.openExternal(url);
      return;
    }
    window.location.href = url;
  }

  function bindClickOverrides() {
    if (window.__mianclawClickOverrides) return;
    window.__mianclawClickOverrides = true;
    document.addEventListener("click", function (event) {
      var el = event.target && event.target.closest ? event.target.closest("button,a,[role=button]") : null;
      if (!el) return;
      var text = (el.textContent || "").trim();
      var isRegister =
        textContains(text, "\u6ce8\u518c\u8d26\u53f7") ||
        textContains(text, "\u524d\u5f80\u6ce8\u518c") ||
        textContains(text, "\u6253\u5f00\u6ce8\u518c\u9875");
      var isInstallSkill = textContains(text, "\u5b89\u88c5\u6280\u80fd");
      if (!isRegister && !isInstallSkill) return;
      event.preventDefault();
      event.stopPropagation();
      openUrl(isRegister ? KEY_PAGE : SKILLHUB);
    }, true);
  }

  function addStyle() {
    if (document.getElementById("mianclaw-runtime-style")) return;
    var style = document.createElement("style");
    style.id = "mianclaw-runtime-style";
    style.textContent = [
      ':root{--mc-bg:#f4f4f5;--mc-panel:#ffffff;--mc-panel-2:#fafafa;--mc-line:#e4e4e7;--mc-line-2:#d4d4d8;--mc-text:#18181b;--mc-muted:#71717a;--mc-primary:#18181b;--mc-primary-text:#ffffff;--mc-accent:#365314;--mc-good:#16a34a;--mc-warn:#d97706;--mc-shadow:0 18px 50px rgba(24,24,27,.08);}',
      ':root[data-mian-theme="deep"]{--mc-bg:#09090b;--mc-panel:#18181b;--mc-panel-2:#27272a;--mc-line:#27272a;--mc-line-2:#3f3f46;--mc-text:#fafafa;--mc-muted:#a1a1aa;--mc-primary:#fafafa;--mc-primary-text:#18181b;--mc-accent:#bef264;--mc-good:#22c55e;--mc-warn:#f59e0b;--mc-shadow:0 20px 60px rgba(0,0,0,.35);}',
      'body,#root{background:var(--mc-bg)!important;color:var(--mc-text)!important;font-family:Inter,"PingFang SC","Microsoft YaHei",system-ui,sans-serif!important;}',
      'body *{letter-spacing:0!important;}',
      'aside,nav,[class*=sidebar],[class*=panel],[class*=card],[class*=modal],[class*=dialog]{border-color:var(--mc-line)!important;}',
      '[class*=card],[class*=panel],[class*=modal],[class*=dialog]{background:var(--mc-panel)!important;box-shadow:var(--mc-shadow)!important;border-radius:16px!important;}',
      'button,[role=button],a[class*=button]{border-radius:12px!important;transition:transform .16s ease,background .16s ease,border-color .16s ease!important;}',
      'button:not(:disabled):hover,[role=button]:not([aria-disabled=true]):hover{transform:translateY(-1px);}',
      'input,textarea,select{background:var(--mc-panel)!important;color:var(--mc-text)!important;border-color:var(--mc-line)!important;border-radius:12px!important;box-shadow:none!important;}',
      'input:focus,textarea:focus,select:focus{border-color:var(--mc-primary)!important;box-shadow:0 0 0 3px color-mix(in srgb,var(--mc-primary) 10%,transparent)!important;}',
      '[class*=active],[aria-current=page]{border-color:var(--mc-line-2)!important;}',
      '#mianclaw-theme-toggle{position:fixed;right:18px;bottom:18px;z-index:2147483647;width:40px;height:40px;border-radius:999px!important;border:1px solid var(--mc-line);background:var(--mc-panel);box-shadow:var(--mc-shadow);font-size:0;}',
      '#mianclaw-theme-toggle:after{content:"";display:block;width:18px;height:18px;margin:10px;border-radius:999px;background:conic-gradient(from 160deg,#bef264,#18181b,#a78bfa,#22c55e,#bef264);}'
    ].join("\n");
    document.head.appendChild(style);
  }

  function addThemeToggle() {
    if (document.getElementById("mianclaw-theme-toggle") || !document.body) return;
    var button = document.createElement("button");
    button.id = "mianclaw-theme-toggle";
    button.type = "button";
    button.title = "\u5207\u6362\u989c\u8272";
    button.setAttribute("aria-label", "\u5207\u6362\u989c\u8272");
    button.addEventListener("click", function () {
      var current = document.documentElement.getAttribute("data-mian-theme") || "mirror";
      var next = current === "deep" ? "mirror" : "deep";
      document.documentElement.setAttribute("data-mian-theme", next);
      localStorage.setItem("mianclaw-theme", next);
    });
    document.body.appendChild(button);
  }

  function replaceTextNodes() {
    if (!document.body) return;
    document.title = document.title.replace(BRAND_FROM, BRAND_TO);
    var walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
      acceptNode: function (node) {
        var value = node.nodeValue || "";
        return value.indexOf(BRAND_FROM) >= 0 || value.indexOf(BRAND_FROM_UPPER) >= 0
          ? NodeFilter.FILTER_ACCEPT
          : NodeFilter.FILTER_SKIP;
      }
    });
    var nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    nodes.forEach(function (node) {
      node.nodeValue = node.nodeValue
        .replaceAll(BRAND_FROM_UPPER, BRAND_TO_UPPER)
        .replaceAll(BRAND_FROM, BRAND_TO);
    });
  }

  function patchElectronName() {
    if (!window.electron || !window.electron.ipcRenderer || window.__mianclawIpcPatched) return;
    var originalInvoke = window.electron.ipcRenderer.invoke && window.electron.ipcRenderer.invoke.bind(window.electron.ipcRenderer);
    if (!originalInvoke) return;
    window.__mianclawIpcPatched = true;
    window.electron.ipcRenderer.invoke = function (channel) {
      if (channel === "app:name") return Promise.resolve(BRAND_TO);
      return originalInvoke.apply(null, arguments);
    };
  }

  function run() {
    bindClickOverrides();
    if (!document.body) return;
    addStyle();
    addThemeToggle();
    replaceTextNodes();
    patchElectronName();
    document.documentElement.setAttribute("data-mian-theme", localStorage.getItem("mianclaw-theme") || "mirror");
  }

  var runTimer = null;
  function scheduleRun() {
    if (runTimer) return;
    runTimer = setTimeout(function () {
      runTimer = null;
      run();
    }, 250);
  }

  run();
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", run);
  new MutationObserver(scheduleRun).observe(document.documentElement || document, { childList: true, subtree: true });
})();
