(function () {
  if (window.electron) return;

  var API_BASE = "http://127.0.0.1:3001";

  async function request(path, options) {
    var response = await fetch(API_BASE + path, {
      method: (options && options.method) || "GET",
      headers: Object.assign({ "Content-Type": "application/json" }, (options && options.headers) || {}),
      body: options && options.body === undefined ? undefined : options && options.body
    });
    var text = await response.text();
    var data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch (_error) {
      data = text;
    }
    return { response: response, data: data };
  }

  async function hostFetch(payload) {
    var path = (payload && payload.path) || "/";
    var body = payload && payload.body;
    if (body && typeof body !== "string") body = JSON.stringify(body);
    var result = await request(path, {
      method: (payload && payload.method) || "GET",
      headers: (payload && payload.headers) || {},
      body: body
    });
    return {
      ok: result.response.ok,
      data: {
        status: result.response.status,
        json: result.data,
        text: typeof result.data === "string" ? result.data : undefined
      }
    };
  }

  function unsupported(channel) {
    return Promise.reject(new Error("Invalid IPC channel: " + channel));
  }

  function gatewayRpc(method, params) {
    return request("/api/gateway/rpc", {
      method: "POST",
      body: JSON.stringify({ method: method, params: params || {} })
    }).then(function (result) {
      if (!result.response.ok) {
        return { success: false, error: result.data && result.data.error || "Gateway RPC failed" };
      }
      return result.data;
    }).catch(function (error) {
      return { success: false, error: error && error.message ? error.message : String(error) };
    });
  }

  function updateStatus() {
    return request("/api/update/status").then(function (result) {
      return result.data || { status: "not-configured", available: false, progress: null, updateInfo: null };
    }).catch(function () {
      return { status: "not-configured", available: false, progress: null, updateInfo: null };
    });
  }

  function hasConfiguredProvider() {
    return request("/api/providers/clawhouse/has-api-key").then(function (result) {
      return !!(result.data && result.data.hasKey);
    }).catch(function () { return false; });
  }

  function getOnboardingCompleted() {
    return request("/api/settings/onboardingCompleted").then(function (result) {
      return !!(result.data && result.data.value);
    }).catch(function () { return false; });
  }

  function markOnboardingCompleted() {
    return request("/api/settings/onboardingCompleted", {
      method: "PUT",
      body: JSON.stringify({ value: true })
    }).then(function () { return { ok: true }; });
  }

  function isRegisterUrl(url) {
    var value = String(url || "");
    return value.indexOf("sign-up") >= 0 ||
      value.indexOf("dashboard/key") >= 0 ||
      value.indexOf("api.ovov.fun") >= 0 ||
      value.indexOf("124.220.216.160") >= 0;
  }

  function injectBranding() {
    var logoUrl = "./assets/clawhouse-logo.png";
    var style = document.createElement("style");
    style.id = "clawhouse-brand-style";
    style.textContent = [
      ":root{--ch-bg:#070b18;--ch-panel:#101a31;--ch-panel-2:#172441;--ch-text:#f8fbff;--ch-muted:#91a5c4;--ch-line:#243557;--ch-accent:#ff4f8b;--ch-accent-2:#ff7a1a;--ch-cyan:#31e6ff;}",
      ':root[data-claw-theme="ocean"]{--ch-bg:#061a24;--ch-panel:#0d2b3b;--ch-panel-2:#123c52;--ch-accent:#17d6c2;--ch-accent-2:#4aa7ff;--ch-cyan:#f9d26a;}',
      ':root[data-claw-theme="light"]{--ch-bg:#f8fbff;--ch-panel:#ffffff;--ch-panel-2:#edf3ff;--ch-text:#101726;--ch-muted:#53627a;--ch-line:#d8e2f2;--ch-accent:#ff2f7d;--ch-accent-2:#ff7a1a;--ch-cyan:#2378ff;}',
      "body,#root{background:radial-gradient(circle at 62% -10%,color-mix(in srgb,var(--ch-accent) 20%,transparent),transparent 34%),linear-gradient(180deg,var(--ch-bg),#050814 70%)!important;color:var(--ch-text)!important;}",
      "button,[role=button]{border-radius:10px!important;}",
      "button:not(:disabled),[role=button]:not([aria-disabled=true]){transition:background .18s ease,border-color .18s ease,transform .18s ease;}",
      "button:not(:disabled):hover,[role=button]:not([aria-disabled=true]):hover{transform:translateY(-1px);}",
      "input,textarea,select{border-color:color-mix(in srgb,var(--ch-accent) 42%,var(--ch-line))!important;box-shadow:none!important;}",
      "input:focus,textarea:focus{box-shadow:0 0 0 3px color-mix(in srgb,var(--ch-accent) 26%,transparent)!important;}",
      "[class*=card],[class*=panel],aside,nav{border-color:color-mix(in srgb,var(--ch-line) 72%,var(--ch-accent) 18%)!important;}",
      ".clawhouse-brand-logo{width:26px;height:26px;border-radius:8px;object-fit:cover;box-shadow:0 0 22px color-mix(in srgb,var(--ch-accent) 45%,transparent);margin-right:8px;vertical-align:middle;}",
      ".clawhouse-hero-logo{width:82px;height:82px;border-radius:24px;object-fit:cover;box-shadow:0 24px 60px color-mix(in srgb,var(--ch-accent) 36%,transparent);}",
      "#clawhouse-theme-toggle{position:fixed;right:18px;bottom:18px;z-index:2147483647;width:38px;height:38px;border:1px solid color-mix(in srgb,var(--ch-line) 70%,var(--ch-cyan));border-radius:999px!important;background:linear-gradient(135deg,var(--ch-accent),var(--ch-accent-2));color:white;font-size:0;box-shadow:0 12px 30px rgba(0,0,0,.24);}",
      "#clawhouse-theme-toggle:before{content:'';display:block;width:16px;height:16px;margin:10px;border-radius:50%;background:radial-gradient(circle at 35% 35%,#fff 0 22%,transparent 24%),conic-gradient(var(--ch-cyan),var(--ch-accent),var(--ch-accent-2),var(--ch-cyan));}",
      ':root[data-claw-theme="light"] #clawhouse-theme-toggle{color:#111;background:linear-gradient(135deg,#fff,var(--ch-panel-2));}'
    ].join("\n");
    if (!document.getElementById(style.id)) document.head.appendChild(style);

    var savedTheme = localStorage.getItem("clawhouse-theme") || "aurora";
    document.documentElement.setAttribute("data-claw-theme", savedTheme);

    function addToggle() {
      if (document.getElementById("clawhouse-theme-toggle")) return;
      if (!document.body) return;
      var button = document.createElement("button");
      button.id = "clawhouse-theme-toggle";
      button.type = "button";
      button.title = "切换颜色";
      button.setAttribute("aria-label", "切换颜色");
      button.addEventListener("click", function () {
        var themes = ["aurora", "ocean", "light"];
        var current = document.documentElement.getAttribute("data-claw-theme") || "aurora";
        var next = themes[(themes.indexOf(current) + 1) % themes.length];
        document.documentElement.setAttribute("data-claw-theme", next);
        localStorage.setItem("clawhouse-theme", next);
      });
      document.body.appendChild(button);
    }

    function applyLogo() {
      if (!document.body) return;
      addToggle();
      var textNodes = Array.prototype.slice.call(document.querySelectorAll("span,div,h1,h2,strong,p"));
      textNodes.forEach(function (el) {
        if ((el.textContent || "").trim() !== "ClawHouse") return;
        var parent = el.parentElement || el;
        if (parent.querySelector(".clawhouse-brand-logo")) return;
        var img = document.createElement("img");
        img.src = logoUrl;
        img.alt = "ClawHouse";
        img.className = "clawhouse-brand-logo";
        parent.insertBefore(img, parent.firstChild);
      });

      var welcome = Array.prototype.find.call(document.querySelectorAll("div,section,main"), function (el) {
        return (el.textContent || "").indexOf("WELCOME TO CLAWHOUSE") >= 0;
      });
      if (welcome && !welcome.querySelector(".clawhouse-hero-logo")) {
        var hero = document.createElement("img");
        hero.src = logoUrl;
        hero.alt = "ClawHouse";
        hero.className = "clawhouse-hero-logo";
        welcome.insertBefore(hero, welcome.firstChild);
      }
    }

    var applyTimer = null;
    function scheduleApplyLogo() {
      if (applyTimer) return;
      applyTimer = setTimeout(function () {
        applyTimer = null;
        applyLogo();
      }, 300);
    }
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", applyLogo);
    } else {
      applyLogo();
    }
    new MutationObserver(scheduleApplyLogo).observe(document.documentElement || document, { childList: true, subtree: true });
  }

  window.electron = {
    platform: "browser",
    isDev: true,
    openExternal: function (url) {
      if (isRegisterUrl(url)) {
        window.location.href = "http://127.0.0.1:3001/clawhouse/key.html";
      } else {
        window.open(url, "_blank", "noopener,noreferrer");
      }
      return Promise.resolve();
    },
    ipcRenderer: {
      invoke: function (channel) {
        var args = Array.prototype.slice.call(arguments, 1);
        if (channel === "hostapi:token") return Promise.resolve("dev-token");
        if (channel === "hostapi:fetch") return hostFetch(args[0]).catch(function (error) {
          return { ok: false, error: error && error.message ? error.message : String(error) };
        });
        if (channel === "gateway:rpc") return gatewayRpc(args[0], args[1]);
        if (channel === "gateway:httpProxy") {
          var payload = args[0] || {};
          if (payload.path === "/rpc" && payload.body) {
            return request("/api/gateway/rpc", {
              method: "POST",
              body: JSON.stringify({ method: payload.body.method, params: payload.body.params || {} })
            }).then(function (result) {
              return {
                success: true,
                ok: result.response.ok,
                data: { status: result.response.status, json: result.data }
              };
            });
          }
          return hostFetch(payload);
        }
        if (channel === "gateway:status") {
          return request("/api/gateway/status").then(function (result) { return result.data; });
        }
        if (channel === "gateway:getControlUiUrl") {
          return request("/api/gateway/control-ui").then(function (result) { return result.data; });
        }
        if (channel === "update:check" || channel === "update:status" || channel === "updater:check" || channel === "updater:get-status") return updateStatus();
        if (channel === "update:setAutoDownload" || channel === "update:cancelAutoInstall") return Promise.resolve({ success: true });
        if (channel === "app:version") return Promise.resolve("0.3.9");
        if (channel === "app:name") return Promise.resolve("MianClaw");
        if (channel === "app:platform") return Promise.resolve("browser");
        if (channel === "app:request") return unsupported("app:request");
        if (channel === "openclaw:getSkillsDir") return Promise.resolve({ ok: true, dir: "" });
        if (channel === "openclaw:openSkillsDir") return Promise.resolve({ ok: false });
        if (channel === "openclaw:reloadSkills") return Promise.resolve({ ok: true });
        if (channel === "lobster:onboarding:mark-completed") {
          return markOnboardingCompleted();
        }
        return unsupported(channel);
      },
      on: function () { return function () {}; },
      once: function () {},
      off: function () {}
    },
    lobster: {
      listModels: function () {
        return Promise.resolve({
          ok: true,
          catalog: {
            families: [
              {
                key: "default",
                label: "Default",
                models: [{ ref: "mock-model", label: "Mock Model", description: "Local compatible model" }]
              }
            ]
          }
        });
      },
      getCurrentModel: function () { return Promise.resolve({ ok: true, current: "mock-model" }); },
      switchModel: function (model) {
        return request("/api/model/switch", {
          method: "POST",
          body: JSON.stringify({ modelRef: model })
        }).then(function () { return { ok: true, confirmed: model }; });
      },
      onboardingIsCompleted: function () {
        return Promise.all([getOnboardingCompleted(), hasConfiguredProvider()]).then(function (values) {
          var completed = values[0] || values[1];
          return { ok: true, completed: completed, result: { completed: completed } };
        });
      },
      onboardingNeeded: function () {
        return Promise.all([getOnboardingCompleted(), hasConfiguredProvider()]).then(function (values) {
          var needed = !(values[0] || values[1]);
          return { ok: true, needed: needed, result: { needed: needed } };
        });
      },
      onboardingMarkCompleted: function () {
        return markOnboardingCompleted();
      },
      onboardingReset: function () { return Promise.resolve({ ok: true }); },
      onModelChanged: function () { return function () {}; },
      getRuntimeInfo: function () { return request("/api/runtime/info").then(function (result) { return { ok: true, info: result.data }; }); }
    },
    clawhouse: {
      configureProvider: function (apiKey) {
        return request("/api/providers", {
          method: "POST",
          body: JSON.stringify({
            apiKey: apiKey,
            config: {
              id: "clawhouse",
              name: "MianClaw",
              type: "openai",
              enabled: true
            }
          })
        }).then(function (result) {
          if (!result.response.ok || result.data && result.data.success === false) {
            return { ok: false, error: result.data && result.data.error || "save failed" };
          }
          return markOnboardingCompleted().then(function () {
            return request("/api/gateway/control-ui").then(function (gatewayResult) {
              return {
                ok: true,
                provider: result.data && result.data.provider,
                gateway: gatewayResult.data
              };
            });
          });
        });
      },
      getCurrentApiKey: function () {
        return request("/api/providers/clawhouse/has-api-key").then(function (result) {
          return { ok: true, hasKey: !!(result.data && result.data.hasKey), maskedKey: result.data && result.data.hasKey ? "sk-****" : null };
        });
      },
      copyCurrentApiKey: function () { return Promise.resolve({ ok: true, copied: false }); },
      getTokenBalance: function () { return Promise.resolve({ ok: true, balance: null }); },
      getAccount: function () { return Promise.resolve({ ok: true, account: null }); },
      createShopSession: function () { return Promise.resolve({ ok: false, error: "browser mode" }); }
    }
  };

  injectBranding();
})();
