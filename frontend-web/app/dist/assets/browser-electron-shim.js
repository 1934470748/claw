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
    return Promise.resolve({ status: "not-available", available: false, progress: null, updateInfo: null });
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

  window.electron = {
    platform: "browser",
    isDev: true,
    openExternal: function (url) {
      window.open(url, "_blank", "noopener,noreferrer");
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
        if (channel === "app:name") return Promise.resolve("ClawHouse");
        if (channel === "app:platform") return Promise.resolve("browser");
        if (channel === "app:request") return unsupported("app:request");
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
              name: "ClawHouse",
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
})();
