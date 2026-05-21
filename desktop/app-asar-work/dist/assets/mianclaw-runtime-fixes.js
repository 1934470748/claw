(function () {
  var KEY_PAGE = "http://127.0.0.1:3001/clawhouse/key.html";
  var SKILLHUB = "https://clawhub.ai";
  var BRAND_FROM = "ClawHouse";
  var BRAND_TO = "MianClaw";
  var BRAND_FROM_UPPER = "CLAWHOUSE";
  var BRAND_TO_UPPER = "MIANCLAW";

  function addStyle() {
    if (document.getElementById("mianclaw-runtime-style")) return;
    var style = document.createElement("style");
    style.id = "mianclaw-runtime-style";
    style.textContent = [
      ":root{--mc-bg:#070914;--mc-panel:#111827;--mc-panel-soft:#172033;--mc-line:#2b3656;--mc-text:#f9fbff;--mc-muted:#9aa7c4;--mc-rose:#ff2f7d;--mc-orange:#ff7a1a;--mc-gold:#ffd36a;--mc-cyan:#5ce1ff;}",
      ':root[data-mian-theme="mirror"]{--mc-bg:#fbf7ff;--mc-panel:#ffffff;--mc-panel-soft:#fff0f7;--mc-line:#ead8ef;--mc-text:#18111f;--mc-muted:#73637b;--mc-rose:#ff2f7d;--mc-orange:#ff8a24;--mc-gold:#c48b14;--mc-cyan:#2777ff;}',
      ':root[data-mian-theme="deep"]{--mc-bg:#050713;--mc-panel:#0e1427;--mc-panel-soft:#151d34;--mc-line:#263454;--mc-text:#f8fbff;--mc-muted:#92a1c4;--mc-rose:#ff3a92;--mc-orange:#ff7933;--mc-gold:#ffd36a;--mc-cyan:#5ce1ff;}',
      "body,#root{background:radial-gradient(circle at 55% -12%,color-mix(in srgb,var(--mc-rose) 24%,transparent),transparent 34%),radial-gradient(circle at 18% 105%,color-mix(in srgb,var(--mc-cyan) 13%,transparent),transparent 28%),linear-gradient(180deg,var(--mc-bg),#050712 78%)!important;color:var(--mc-text)!important;}",
      "aside,nav,[class*=card],[class*=panel],dialog{border-color:color-mix(in srgb,var(--mc-line) 74%,var(--mc-rose) 18%)!important;}",
      "button,[role=button]{border-radius:10px!important;}",
      "button:not(:disabled),[role=button]:not([aria-disabled=true]){transition:transform .18s ease,border-color .18s ease,background .18s ease,box-shadow .18s ease!important;}",
      "button:not(:disabled):hover,[role=button]:not([aria-disabled=true]):hover{transform:translateY(-1px);}",
      "input,textarea,select{border-color:color-mix(in srgb,var(--mc-rose) 42%,var(--mc-line))!important;}",
      "input:focus,textarea:focus{box-shadow:0 0 0 3px color-mix(in srgb,var(--mc-rose) 25%,transparent)!important;}",
      "#mianclaw-theme-toggle{position:fixed;right:18px;bottom:18px;z-index:2147483647;width:38px;height:38px;border-radius:999px!important;border:1px solid color-mix(in srgb,var(--mc-line) 65%,var(--mc-cyan));background:conic-gradient(from 210deg,var(--mc-cyan),var(--mc-rose),var(--mc-orange),var(--mc-gold),var(--mc-cyan));box-shadow:0 18px 46px rgba(0,0,0,.28);font-size:0;}",
      "#mianclaw-theme-toggle:after{content:'';display:block;width:16px;height:16px;margin:10px;border-radius:999px;background:var(--mc-panel);box-shadow:inset 0 0 0 1px color-mix(in srgb,var(--mc-text) 22%,transparent);}"
    ].join("\n");
    document.head.appendChild(style);
  }

  function addThemeToggle() {
    if (document.getElementById("mianclaw-theme-toggle")) return;
    if (!document.body) return;
    var button = document.createElement("button");
    button.id = "mianclaw-theme-toggle";
    button.type = "button";
    button.title = "切换颜色";
    button.setAttribute("aria-label", "切换颜色");
    button.addEventListener("click", function () {
      var themes = ["deep", "mirror"];
      var current = document.documentElement.getAttribute("data-mian-theme") || "deep";
      var next = themes[(themes.indexOf(current) + 1) % themes.length];
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

  function openUrl(url) {
    if (window.electron && typeof window.electron.openExternal === "function") {
      window.electron.openExternal(url);
      return;
    }
    window.open(url, "_blank", "noopener,noreferrer");
  }

  function bindClickOverrides() {
    if (window.__mianclawClickOverrides) return;
    window.__mianclawClickOverrides = true;
    document.addEventListener("click", function (event) {
      var el = event.target && event.target.closest ? event.target.closest("button,a,[role=button]") : null;
      if (!el) return;
      var text = (el.textContent || "").trim();
      if (/注册账号|前往注册|打开注册页/.test(text)) {
        event.preventDefault();
        event.stopPropagation();
        window.location.href = KEY_PAGE;
        return;
      }
      if (/安装技能/.test(text)) {
        event.preventDefault();
        event.stopPropagation();
        openUrl(SKILLHUB);
      }
    }, true);
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
    if (!document.body) return;
    addStyle();
    addThemeToggle();
    replaceTextNodes();
    bindClickOverrides();
    patchElectronName();
    document.documentElement.setAttribute("data-mian-theme", localStorage.getItem("mianclaw-theme") || "deep");
  }

  var runTimer = null;
  function scheduleRun() {
    if (runTimer) return;
    runTimer = setTimeout(function () {
      runTimer = null;
      run();
    }, 250);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", run);
  } else {
    run();
  }
  var observerTarget = document.documentElement || document;
  new MutationObserver(scheduleRun).observe(observerTarget, { childList: true, subtree: true });
})();
