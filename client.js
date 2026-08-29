/* approval-notify client bundle — module-loader format (see built-in bundles). */
window.__ModuleLoader__.load({
  id: "approval-notify",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
    const React = require("react");
    const { defineStore } = require("@deepseek-ai/dsh-client-runtime/client");

    const NS = "approval-notify";
    const LOCALE_NS = "settings.approvalNotify";

    const zh = {
      "row.title": "审批通知：点击通知后唤起",
      "row.app": "桌面应用",
      "row.browser": "浏览器",
      "row.hint": "切换即时生效，无需重启"
    };
    const en = {
      "row.title": "Approval notification: open on click",
      "row.app": "Desktop app",
      "row.browser": "Browser",
      "row.hint": "Applies immediately, no restart needed"
    };

    function createLaunchRowStore() {
      return defineStore({
        init: () => ({ launch: "app" }),
        actions: { sync: (d, launch) => { d.launch = launch; } }
      });
    }

    function LaunchRow({ t, setLaunch, useStore }) {
      const launch = useStore((s) => s.launch);
      const button = (value, label) => React.createElement("button", {
        type: "button",
        key: value,
        onClick: () => setLaunch(value),
        style: {
          marginRight: 8,
          padding: "4px 14px",
          borderRadius: 6,
          border: launch === value ? "1px solid var(--dsw-static-deepseek-500)" : "1px solid var(--dsw-alias-border-l2)",
          background: launch === value ? "var(--dsw-alias-interactive-bg-hover)" : "transparent",
          color: "var(--dsw-alias-label-primary)",
          cursor: "pointer",
          font: "inherit"
        }
      }, t(label));
      return React.createElement("div", { style: { display: "flex", flexDirection: "column", gap: 8, padding: "12px 0", borderBottom: "1px solid var(--dsw-alias-border-l2)" } },
        React.createElement("div", { style: { color: "var(--dsw-alias-label-primary)", fontSize: 14, lineHeight: "22px" } }, t("row.title")),
        React.createElement("div", null, button("app", "row.app"), button("browser", "row.browser")),
        React.createElement("div", { style: { color: "var(--dsw-alias-label-tertiary)", fontSize: 12 } }, t("row.hint"))
      );
    }

    const inject = ["slots", "locale", "connection", "remote", "settingsScope"];

    function apply(ctx) {
      const scope = ctx.settingsScope.bind({ namespace: NS });
      const store = createLaunchRowStore();
      let bound;
      const sync = (snap) => {
        if (snap.status === "ready" && typeof snap.value === "object" && snap.value !== null) {
          bound?.sync(snap.value.launch === "browser" ? "browser" : "app");
        }
      };
      scope.subscribe(() => sync(scope.getSnapshot()));
      const injected = (actions) => {
        bound = actions;
        sync(scope.getSnapshot());
        return { setLaunch: (value) => { void scope.set("launch", value); } };
      };
      ctx.effect(() => ctx.locale.register(LOCALE_NS, { zh, en }), "approval-notify: settings row dictionaries");
      ctx.slots.inject("settings.general.item", () => ctx.slots.register({
        name: "settings.general.item",
        id: "approval-notify-launch",
        order: 30,
        store,
        locale: LOCALE_NS,
        inject: injected
      }, LaunchRow));
    }

    exports.apply = apply;
    exports.inject = inject;
    return module.exports;
  }
});
