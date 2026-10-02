window.__ModuleLoader__.load({ id: "dsh-memory", factory: (require) => {
var __modules = {};
// ── API 层 ────────────────────────────────────────────────────
__modules["api.js"] = function (require, module, exports) {
"use strict";
var BASE = "/memory-editor";
var key = null;
function call(method, body) {
  var opt = { method: method, headers: {} };
  if (key) opt.headers["x-memory-key"] = key;
  if (body) { opt.headers["Content-Type"] = "application/json"; opt.body = JSON.stringify(body); }
  return fetch(BASE + "/api", opt).then(function (r) {
    return r.json().then(function (j) {
      if (!r.ok || j.error) throw new Error(j.error || ("HTTP " + r.status));
      return j;
    });
  });
}
// 密钥只存在于页面 HTML 里：拿一次即可（同源回环）。
function ensureKey() {
  if (key) return Promise.resolve(key);
  return fetch(BASE + "/editor").then(function (r) { return r.text(); }).then(function (html) {
    var m = /KEY = "([a-f0-9]{20,})"/.exec(html);
    if (!m) throw new Error("无法取得编辑密钥");
    key = m[1];
    return key;
  });
}
exports.list = function () { return ensureKey().then(function () { return call("GET"); }); };
exports.save = function (p) { return ensureKey().then(function () { return call("POST", Object.assign({ action: "save" }, p)); }); };
exports.update = function (p) { return ensureKey().then(function () { return call("POST", Object.assign({ action: "update" }, p)); }); };
exports.forget = function (id) { return ensureKey().then(function () { return call("POST", { action: "forget", id: id }); }); };
};
// ── 面板（React 组件）─────────────────────────────────────────
__modules["panel.js"] = function (require, module, exports) {
"use strict";
var React = require("react");
var api = require("./api.js");
var h = React.createElement;
var CSS_ID = "dsh-memory-css";
var CSS = [
  ".dm-veil{position:fixed;inset:0;background:var(--dsw-alias-bg-mask-1,#000000b0);z-index:9998;display:flex;align-items:center;justify-content:center;overscroll-behavior:contain;padding:calc(10px + env(safe-area-inset-top)) 10px calc(10px + env(safe-area-inset-bottom))}",
  ".dm-panel{background:var(--dsw-alias-bg-layer-2,#1c1c20);color:var(--dsw-alias-label-primary,#ececec);width:100%;max-width:520px;height:auto;max-height:82vh;max-height:min(72dvh,600px);display:flex;flex-direction:column;border-radius:var(--dsw-radius-panel,14px);overflow:hidden;font:15px/1.55 system-ui,-apple-system,'Noto Sans CJK SC',sans-serif;box-shadow:var(--dsw-elevation-prominent,0 12px 44px #0009)}",
  ".dm-head{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:10px 10px 10px 16px;border-bottom:1px solid var(--dsw-alias-border-l2,#ffffff1a);flex:none}.dm-title{font-size:15px;font-weight:600;margin:0}.dm-head-actions{display:flex;align-items:center;gap:8px;flex:none}.dm-new{font:inherit;font-size:13px;padding:4px 11px;border-radius:8px;border:1px solid var(--dsw-alias-border-l3,#ffffff2e);background:var(--dsw-alias-interactive-bg-hover,#ffffff10);color:inherit;opacity:.9;cursor:pointer}.dm-new:hover{background:var(--dsw-alias-interactive-bg-active,#ffffff1c)}.dm-close{display:inline-flex;align-items:center;justify-content:center;box-sizing:border-box;width:38px;height:38px;padding:0;border:1px solid var(--dsw-alias-border-l3,#ffffff26);border-radius:10px;background:var(--dsw-alias-interactive-bg-hover,#ffffff12);color:inherit;opacity:.9;cursor:pointer;-webkit-tap-highlight-color:transparent}.dm-close:active{opacity:1;background:var(--dsw-alias-interactive-bg-active,#ffffff1c)}.dm-close:focus{outline:none}.dm-close svg{width:26px;height:26px;display:block}.dm-scroll{flex:1 1 auto;min-height:0;overflow-y:auto;overscroll-behavior:contain;-webkit-overflow-scrolling:touch;padding:12px 14px 18px}.dm-inline{max-height:none;height:auto;box-shadow:none;background:transparent;border-radius:0}.dm-inline .dm-head{padding-left:0;padding-right:0}.dm-inline .dm-scroll{overflow:visible;padding:0;margin-top:8px}",
  ".dm-dim{color:var(--dsw-alias-label-tertiary,#9a9a9a);font-size:12px;word-break:break-all}",
  ".dm-card{border:1px solid var(--dsw-alias-border-l3,#ffffff22);border-radius:12px;padding:10px 12px;margin:9px 0}",
  ".dm-badge{display:inline-block;font-size:11px;padding:1px 7px;border:1px solid var(--dsw-alias-border-l4,#ffffff33);border-radius:999px;margin-right:5px}",
  ".dm-body{white-space:pre-wrap;word-break:break-word;margin:6px 0 8px}",
  ".dm-row{display:flex;gap:8px;flex-wrap:wrap;align-items:center}",
  ".dm-row>*{flex:1;min-width:0}",
  ".dm-row>button{flex:0 0 auto;min-width:auto}",
  ".dm-panel textarea,.dm-panel input,.dm-panel select{width:100%;box-sizing:border-box;font:inherit;padding:8px 10px;border:1px solid var(--dsw-alias-border-l4,#ffffff33);border-radius:9px;background:var(--dsw-alias-bg-layer-3,#ffffff0d);color:var(--dsw-alias-label-primary,inherit)}",
  ".dm-panel textarea{min-height:70px;resize:vertical}",
  ".dm-panel button{font:inherit;padding:7px 13px;border-radius:9px;border:1px solid var(--dsw-alias-border-l4,#ffffff33);background:var(--dsw-alias-interactive-bg-hover,#ffffff12);color:inherit}",
  ".dm-panel button.dm-primary{background:var(--dsw-alias-button-primary-fill,#3b82f6);border-color:var(--dsw-alias-button-primary-fill,#3b82f6);color:var(--dsw-alias-label-primary-foreground,#fff);font-weight:600}",
  ".dm-panel button.dm-danger{color:var(--dsw-alias-label-error,#ff8085);border-color:var(--dsw-alias-state-error-primary,#ff808555)}",
  ".dm-icon{-webkit-appearance:none;appearance:none;display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;padding:0;border:none;border-radius:8px;background:transparent;color:inherit;opacity:.85;cursor:pointer;line-height:1;margin-left:-10px;-webkit-tap-highlight-color:transparent;-webkit-touch-callout:none}.dm-icon:active{opacity:1}.dm-icon:focus{outline:none}.dm-icon svg{width:16px;height:16px;display:block}",
  ".dm-toast{position:fixed;left:50%;bottom:100px;transform:translateX(-50%);background:var(--dsw-alias-toast-bg,#000d);color:var(--dsw-alias-toast-label,#fff);padding:8px 14px;border-radius:999px;font-size:13px;z-index:9999}"
].join("");
function injectCss() {
  if (typeof document === "undefined") return;
  var s = document.getElementById(CSS_ID);
  if (!s) {
    s = document.createElement("style");
    s.id = CSS_ID;
    (document.head || document.documentElement).appendChild(s);
  }
  // 关键：热更新换掉 JS 后旧样式元素还在，必须用新 CSS 覆盖它。
  if (s.textContent !== CSS) s.textContent = CSS;
}
function fmt(s) {
  if (!s) return "";
  var d = new Date(s); if (isNaN(d)) return s;
  var p = function (n) { return String(n).padStart(2, "0"); };
  return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate()) + " " + p(d.getHours()) + ":" + p(d.getMinutes());
}
function Panel(props) {
  var onClose = props.onClose || function () {};
  var form = React.useState(false), formOpen = form[0], setFormOpen = form[1];
  var st = React.useState({ items: [], total: 0, err: "", loading: true });
  var view = st[0], setView = st[1];
  var e = React.useState(null), editing = e[0], setEditing = e[1];
  var t = React.useState(""), toast = t[0], setToast = t[1];
  var qs = React.useState(""), q = qs[0], setQ = qs[1];
  var kindS = React.useState("note"), kind = kindS[0], setKind = kindS[1];
  var tagsS = React.useState(""), tags = tagsS[0], setTags = tagsS[1];
  var textS = React.useState(""), text = textS[0], setText = textS[1];
  var timer = React.useRef(null);

  var say = function (m) {
    setToast(m);
    clearTimeout(timer.current);
    timer.current = setTimeout(function () { setToast(""); }, 1900);
  };
  var load = React.useCallback(function () {
    api.list().then(function (j) {
      setView({ items: j.memories || [], total: j.total || 0, err: "", loading: false });
    }).catch(function (err) { setView({ items: [], total: 0, err: err.message, loading: false }); });
  }, []);
  React.useEffect(function () { injectCss(); load(); }, [load]);
  React.useEffect(function () {
    var onKey = function (ev) { if (ev.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return function () { document.removeEventListener("keydown", onKey); clearTimeout(timer.current); };
  }, [onClose]);

  var terms = q.trim() ? q.trim().toLowerCase().split(/\s+/) : [];
  var shown = view.items.filter(function (m) {
    var hay = (m.text + " " + (m.tags || []).join(" ")).toLowerCase();
    return terms.every(function (x) { return hay.indexOf(x) >= 0; });
  }).slice().reverse();

  var card = function (m) {
    var top = h("div", null,
      h("span", { className: "dm-badge" }, m.kind || "note"),
      h("span", { className: "dm-dim" }, fmt(m.updatedAt || m.createdAt)));
    if (editing && editing.id === m.id) {
      return h("div", { className: "dm-card", key: m.id }, top,
        h("textarea", { value: editing.text, onChange: function (ev) { setEditing({ id: m.id, text: ev.target.value, tags: editing.tags, kind: editing.kind }); } }),
        h("div", { className: "dm-row", style: { marginTop: 8 } },
          h("input", { value: editing.tags, onChange: function (ev) { setEditing({ id: m.id, text: editing.text, tags: ev.target.value, kind: editing.kind }); } }),
          h("select", { value: editing.kind, onChange: function (ev) { setEditing({ id: m.id, text: editing.text, tags: editing.tags, kind: ev.target.value }); } },
            ["fact", "preference", "rule", "note"].map(function (k) { return h("option", { key: k, value: k }, k); })),
          h("button", {
            className: "dm-primary",
            onClick: function () {
              api.update({ id: m.id, text: editing.text, tags: editing.tags, kind: editing.kind })
                .then(function () { setEditing(null); say("已保存"); load(); })
                .catch(function (err) { say("保存失败：" + err.message); });
            }
          }, "保存"),
          h("button", { onClick: function () { setEditing(null); } }, "取消")),
        h("div", { className: "dm-dim" }, m.id));
    }
    return h("div", { className: "dm-card", key: m.id }, top,
      h("div", { className: "dm-body" }, m.text),
      (m.tags && m.tags.length) ? h("div", null, m.tags.map(function (x) { return h("span", { className: "dm-badge", key: x }, "#" + x); })) : null,
      h("div", { className: "dm-row", style: { marginTop: 8 } },
        h("button", { onClick: function () { setEditing({ id: m.id, text: m.text, tags: (m.tags || []).join(","), kind: m.kind || "note" }); } }, "编辑"),
        h("button", {
          className: "dm-danger",
          onClick: function () {
            if (!window.confirm("删除这条记忆？\n\n" + m.text)) return;
            api.forget(m.id).then(function () { say("已删除"); load(); }).catch(function (err) { say("删除失败：" + err.message); });
          }
        }, "删除")),
      h("div", { className: "dm-dim" }, m.id));
  };

  var content = h("div", { className: "dm-panel" + (props.inline ? " dm-inline" : "") },
      h("div", { className: "dm-head" },
        h("span", { className: "dm-title" }, "记忆库"),
        h("div", { className: "dm-head-actions" },
          h("button", { className: "dm-new", type: "button", onClick: function () { setFormOpen(!formOpen); } },
            formOpen ? "收起" : "写一条"),
          props.inline ? null : h("button", {
      className: "dm-close", title: "关闭", "aria-label": "关闭", onClick: onClose,
      style: {
        WebkitAppearance: "none", appearance: "none",
        background: "var(--dsw-alias-interactive-bg-hover,#ffffff12)",
        border: "1px solid var(--dsw-alias-border-l3,#ffffff26)",
        boxSizing: "border-box", borderRadius: "10px", padding: "0",
        width: "38px", height: "38px", minWidth: "38px", minHeight: "38px",
        display: "inline-flex", alignItems: "center", justifyContent: "center",
        color: "inherit", cursor: "pointer", WebkitTapHighlightColor: "transparent"
      }
    },
            h("svg", { viewBox: "0 0 24 24", width: 26, height: 26, style: { width: "26px", height: "26px", display: "block" }, fill: "none", stroke: "currentColor", strokeWidth: 2.4, strokeLinecap: "round" },
              h("path", { d: "M3.5 3.5l17 17M20.5 3.5l-17 17" }))))),
      h("div", { className: "dm-scroll" },
      h("div", { className: "dm-dim" },
        view.loading ? "加载中…" : (view.err ? "读取失败：" + view.err
          : "共 " + view.total + " 条" + (terms.length ? "，匹配 " + shown.length + " 条" : "") + " · 保存即生效")),
      formOpen ? h("div", { className: "dm-card" },
        h("div", { className: "dm-row" },
          h("select", { value: kind, onChange: function (ev) { setKind(ev.target.value); } },
            [["fact", "fact 事实"], ["preference", "preference 偏好"], ["rule", "rule 规则"], ["note", "note 备注"]].map(function (k) {
              return h("option", { key: k[0], value: k[0] }, k[1]);
            })),
          h("input", { placeholder: "标签，逗号分隔（可空）", value: tags, onChange: function (ev) { setTags(ev.target.value); } })),
        h("textarea", { placeholder: "要长期记住的内容，一句话一条", value: text, onChange: function (ev) { setText(ev.target.value); } }),
        h("div", { className: "dm-row", style: { marginTop: 8 } },
          h("button", {
            className: "dm-primary",
            onClick: function () {
              if (!text.trim()) { say("内容不能为空"); return; }
              api.save({ text: text, tags: tags, kind: kind })
                .then(function (r) { setText(""); say(r.saved === false ? "内容重复，已更新时间" : "已保存"); load(); })
                .catch(function (err) { say("保存失败：" + err.message); });
            }
          }, "保存新记忆"),
          h("button", { onClick: load }, "刷新"))) : null,
      h("input", { placeholder: "搜索记忆…（空格分隔多词，全部命中）", value: q, onChange: function (ev) { setQ(ev.target.value); } }),
      shown.length
        ? shown.map(card)
        : h("p", { className: "dm-dim" }, view.loading ? "" : (view.items.length ? "没有匹配的记忆。" : "记忆库还是空的，上面写第一条吧。")),
      toast ? h("div", { className: "dm-toast" }, toast) : null));
  if (props.inline) return content;
  return h("div", { className: "dm-veil", onClick: function (ev) { if (ev.target === ev.currentTarget) onClose(); } }, content);
}
exports.Panel = Panel;
};
// ── 图标按钮 + 插件入口 ───────────────────────────────────────
__modules["index.js"] = function (require, module, exports) {
"use strict";
var React = require("react");
var panel = require("./panel.js");
var h = React.createElement;
// react-dom 由宿主提供（官方插件同款）；取不到就退回原地渲染，不因此失败。
var ReactDOM = null;
try { ReactDOM = require("react-dom"); } catch (e) { ReactDOM = null; }
function MemoryButton() {
  var open = React.useState(false), isOpen = open[0], setOpen = open[1];
  var node = isOpen ? h(panel.Panel, { onClose: function () { setOpen(false); } }) : null;
  // Portal 到 body：输入框那排若有 transform 祖先，position:fixed 会被困在那一小块区域，
  // 面板就会「贴在最下面且内容被切」。挂到 body 后 fixed 正常相对屏幕。
  var overlay = node;
  if (node && ReactDOM && ReactDOM.createPortal && typeof document !== "undefined" && document.body) {
    try { overlay = ReactDOM.createPortal(node, document.body); } catch (e) { overlay = node; }
  }
  return h(React.Fragment, null,
    h("button", {
      className: "dm-icon", type: "button", title: "记忆库", "aria-label": "记忆库",
      // 外观与几何内联：样式表万一没生效（旧缓存/加载顺序），也不会退化成
      // 浏览器默认按钮 —— 那个灰底方框就是这么来的。
      style: {
        WebkitAppearance: "none", appearance: "none", background: "transparent",
        border: "none", borderRadius: "8px", padding: "0", margin: "0 0 0 -10px",
        width: "28px", height: "28px", minWidth: "28px", minHeight: "28px",
        display: "inline-flex", alignItems: "center", justifyContent: "center",
        color: "inherit", cursor: "pointer", lineHeight: "1",
        WebkitTapHighlightColor: "transparent"
      },
      onClick: function (ev) { ev.preventDefault(); ev.stopPropagation(); setOpen(!isOpen); }
    },
      h("svg", { viewBox: "0 0 24 24", width: 16, height: 16, style: { width: "16px", height: "16px", display: "block" }, fill: "none", stroke: "currentColor", strokeWidth: 1.6, strokeLinecap: "round", strokeLinejoin: "round" },
        h("path", { d: "M12 5a3 3 0 1 0-5.997.125 4 4 0 0 0-2.526 5.77 4 4 0 0 0 .556 6.588A4 4 0 1 0 12 18Z" }),
        h("path", { d: "M12 5a3 3 0 1 1 5.997.125 4 4 0 0 1 2.526 5.77 4 4 0 0 1-.556 6.588A4 4 0 1 1 12 18Z" }),
        h("path", { d: "M15 13a4.5 4.5 0 0 1-3-4 4.5 4.5 0 0 1-3 4" }))),
    overlay);
}
function MemorySettings() {
  return h(panel.Panel, { inline: true });
}
function apply(ctx) {
  try { injectCss(); } catch (e) { /* 非浏览器环境忽略 */ }
  var slots = ctx.slots;
  if (!slots) return;
  var rows = [
    ["conversation.input.left", "memory-composer", 20]
  ];
  for (var i = 0; i < rows.length; i++) {
    (function (row) {
      // 与 dsh-web-mobile 同款：先等插槽就位再注册，避免插槽尚未渲染时报错。
      try {
        if (typeof slots.inject === "function") {
          slots.inject(row[0], function () {
            return slots.register({ name: row[0], id: row[1], order: row[2] }, MemoryButton);
          });
          return;
        }
        ctx.effect(function () {
          return slots.register({ name: row[0], id: row[1], order: row[2] }, MemoryButton);
        }, "dsh-memory:" + row[1]);
      } catch (e) { /* 该插槽在本次布局里可能不存在，静默跳过 */ }
    })(rows[i]);
  }
  // 设置页里的「记忆插件」页（settings.section：id 必需，label 可为纯字符串）
  try {
    if (typeof slots.inject === "function") {
      slots.inject("settings.section", function () {
        return slots.register({ name: "settings.section", id: "dsh-memory", order: 60, label: "记忆插件" }, MemorySettings);
      });
    }
  } catch (e) { /* 设置页插槽不存在时静默跳过 */ }
}
exports.apply = apply;
exports.inject = ["slots"];
};

var __cache = {};
function __localRequire(id) {
  if (id.charCodeAt(0) !== 46) return require(id);
  id = id.slice(2);
  var cached = __cache[id];
  if (cached) return cached.exports;
  var module = { exports: {} };
  __cache[id] = module;
  __modules[id](__localRequire, module, module.exports);
  return module.exports;
}
var module = { exports: {} };
__modules["index.js"](__localRequire, module, module.exports);
return module.exports; } });


