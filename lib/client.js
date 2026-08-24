/**
 * dsh-my-combo — client half.
 *
 * 兼容层三块:
 *  1. 列容器 shim —— 移植自 @linxin666/dsh-web-ui-all (Apache-2.0)，
 *     给 sidebarCol/centerCol/detailsCol 打 data-pane / data-dsh-frame 属性，
 *     供依赖这些属性的插件/样式稳定命中外壳布局。
 *  2. footer shim —— 给侧边栏底部 footerActions 容器打 data-dsh-footer 属性，
 *     让布局 CSS 不依赖每次构建都会变的 hash class。
 *  3. 布局 CSS —— 把 footer 里的余额卡片 / 远程控制入口排成规整纵向布局，
 *     wide 与折叠 rail 两态分别处理。
 */
window.__ModuleLoader__.load({
  id: 'dsh-my-combo',
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;

    // ── 列容器 shim（移植自 web-ui-all，Apache-2.0）──
    var COLUMN_SHIMS = [
      ['[class*="sidebarCol"]', 'data-pane="sidebar"'],
      ['[class*="centerCol"]', 'data-pane="conversation"'],
      ['[class*="detailsCol"]', 'data-pane="details"']
    ];

    function applyShims() {
      var changed = false;
      for (var i = 0; i < COLUMN_SHIMS.length; i++) {
        var pair = COLUMN_SHIMS[i];
        var el = document.querySelector(pair[0]);
        var eq = pair[1].indexOf('=');
        var name = pair[1].slice(0, eq);
        var value = pair[1].slice(eq + 1).replace(/^"|"$/g, '');
        if (el !== null && el.getAttribute(name) !== value) {
          el.setAttribute(name, value);
          changed = true;
        }
      }
      var frame = document.querySelector('[class*="sidebarCol"]') !== null
        ? document.querySelector('[class*="sidebarCol"]').parentElement
        : null;
      if (frame !== null && frame.getAttribute('data-dsh-frame') !== '') {
        frame.setAttribute('data-dsh-frame', '');
        changed = true;
      }
      // footer 容器
      var foot = document.querySelector('[class*="footerActions"]');
      if (foot !== null && !foot.hasAttribute('data-dsh-footer')) {
        foot.setAttribute('data-dsh-footer', '1');
        changed = true;
      }
      return changed;
    }

    var shimScheduled = false;
    function schedulePass() {
      if (shimScheduled) return;
      shimScheduled = true;
      requestAnimationFrame(function () {
        shimScheduled = false;
        applyShims();
      });
    }

    var inject = [];

    function apply(ctx) {
      // 注：webUiSettings 设置表单由 @linxin666/dsh-client-ui-web-ui-settings
      // 提供（官方 unavailable 时走 /api/dsh-web-ui-settings 桥接）。它必须在
      // aionui-panel / task-board / remote-web-ui / community-plugins 之前
      // apply（见 aggregate.json 的行顺序约束），否则消费插件
      // ctx.get("webUiSettings") 拿到 undefined → 卡片 notExposed。
      // ── DOM shim ──
      ctx.effect(function () {
        applyShims();
        var observer = new MutationObserver(schedulePass);
        observer.observe(document.body, { childList: true, subtree: true });
        return function () {
          observer.disconnect();
          shimScheduled = false;
        };
      }, 'dsh-my-combo: dom shim');

      // ── 布局 CSS ──
      ctx.effect(function () {
        if (typeof document === 'undefined') return function () {};
        var existing = document.querySelector('style[data-plugin-css="dsh-my-combo/layout.css"]');
        if (existing !== null) return function () {};
        var tag = document.createElement('style');
        tag.dataset.pluginCss = 'dsh-my-combo/layout.css';
        tag.textContent = [
          // footer 容器：纵向堆叠（余额卡片 / 远程控制入口）
          '[data-dsh-footer]{display:flex!important;flex-direction:column;align-items:stretch;gap:6px;padding:4px 2px}',
          '[data-dsh-footer]>*{min-width:0}',
          '[data-dsh-footer] .cm-footer-stack{width:100%}',
          '[data-dsh-footer] [class*="entryRow"]{flex:none}',
          // 折叠成图标条时：纵向堆叠，避免元素横向挤压
          '[class*="collapsed"] [data-dsh-footer]{display:flex!important;flex-direction:column;justify-content:center;align-items:center;gap:6px;padding:2px}',
          '[class*="collapsed"] [data-dsh-footer] .cm-footer-stack{width:100%;max-width:40px}',
          '[class*="collapsed"] [data-dsh-footer] [class*="entryRow"]{width:36px}'
        ].join('\n');
        document.head.appendChild(tag);
        return function () { tag.remove(); };
      }, 'dsh-my-combo: layout css');

    }

    module.exports = { apply: apply, inject: inject };
    return module.exports;
  }
});
