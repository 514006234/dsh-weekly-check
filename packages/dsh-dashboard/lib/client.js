// dsh-dashboard — client half（客户端半，v0.1.0，手写 bundle、无需构建）。
//
// 形态（与旧的「侧边栏底部抽屉」彻底告别）：
//   * main 槽（kind: keyed, scope: root，key = 'dsh-dashboard'）
//       → 中间整列的仪表盘面板：卡片网格聚合信息，点卡片跳转/打开。
//   * sidebar.panellist 槽（kind: list, scope: root，id = 'dsh-dashboard'）
//       → 侧边栏全局面板图标行。**id 必须与 main 的 key 同值**：
//         官方文档原话「Each list id addresses the matching main panel」。
//         图标行的点击由侧边栏自己负责（selectPanel），这里只自绘图标内容。
//
// 卡片（全部可点，hover 有反馈；数据全部来自真实数据源，不编造）：
//   1. 周榜 TOP 6     —— latest.json 的 plugins 按星数取前 6（中文名 / owner/repo /
//                       星数 99046→99.0k / 较上期涨星：正数绿色、无 delta 或 0 不显示）
//   2. 免费模型状态卡 —— stat.ok/stat.total 大数字 + 已下线/地区墙/上游波动小字
//   3. 最近会话卡     —— useSessions 标准 hook 列最近 3 条（标题 + 工作区名），
//                       点击按 workbench 的优先级打开（uiWorkspace.openSession → sessions.open）
//   4. 快捷动作卡     —— 新会话（createSession(cwd, done) 面）/ 打开工作台 / 打开周榜
//   5. 支持本项目卡   —— 一句话 + 打开赞助页
//
// 数据链路：客户端只 fetch 宿主半的只读路由 GET /dashboard/data（同源、5 分钟内存缓存），
// 宿主半再以 30 分钟缓存去打唯一出站地址 latest.json。本文件不 import/export 任何东西。
//
// 降级总纲：任何路径都不许抛异常 ——
//   * 切面板：typeof ctx?.layout?.selectPanel === 'function' 才调，否则/抛异常时回落 window.open
//   * 打开会话：uiWorkspace.openSession → sessions.open → 都没有则返回 {ok:false}，不抛
//   * 新会话：拿不到 sessions.create / 调用抛错 / Promise 拒绝 → 全部转成 done(err)
//   * latest.json 拉不到 → 卡片区中文失败提示 + 重试按钮；sessions 拿不到 → 会话卡「不可用」占位

window.__ModuleLoader__.load({
  id: 'dsh-dashboard',
  factory: function (require) {
    var module = { exports: {} };
    var exports = module.exports;
    var React = require('react');
    var h = React.createElement;

    /* ===================================================================
     * 契约区：DSH 版本敏感的东西集中在这里（静态门禁逐条核对）。
     * =================================================================== */
    var MAIN_SLOT = 'main';                 // 中间主列（kind: keyed, scope: root）
    var MAIN_KEY = 'dsh-dashboard';          // keyDomain：已被占用的只有 conversation
    var LIST_SLOT = 'sidebar.panellist';     // 侧边栏全局面板图标行（kind: list, scope: root）
    var LIST_ID = 'dsh-dashboard';           // 必须与 MAIN_KEY 同值（id 寻址同名 main 面板）
    var LIST_ORDER = 100;                    // 升序排列，排在自带条目之后
    var LIST_LABEL = '仪表盘';                // 显示名（sidebar 从 list 元数据解析）
    var DATA_ROUTE = '/dashboard/data';      // 宿主半唯一只读路由
    var SITE_URL = 'https://514006234.github.io/dsh-weekly-check/';
    var SPONSOR_URL = 'https://514006234.github.io/dsh-weekly-check/sponsor/';
    var WEEKLY_KEY = 'dsh-weekly';           // 周榜面板若以 main 槽注册，用这个 key 寻址
    var WORKBENCH_KEY = 'dsh-workbench';     // 工作台面板若以 main 槽注册，用这个 key 寻址
    var TOP_N = 6;
    var RECENT_N = 3;
    var CLIENT_TTL_MS = 5 * 60 * 1000;       // 客户端内存缓存 5 分钟（服务端另有 30 分钟）
    var STYLE_MARK = 'dsh-dashboard';

    /* ============================ 样式 ============================ */
    var CSS = [
      '.dd-root{--dd-surface:rgba(255,255,255,.92);--dd-card:rgba(255,255,255,.62);--dd-ink:#0f1115;--dd-dim:#61666b;--dd-border:rgba(0,0,0,.10);--dd-border-strong:rgba(0,0,0,.22);--dd-hover:rgba(0,0,0,.05);--dd-accent:#3b82f6;--dd-shadow:0 14px 34px rgba(0,0,0,.14);}',
      'body[data-ds-dark-theme] .dd-root{--dd-surface:rgba(24,24,27,.86);--dd-card:rgba(255,255,255,.045);--dd-ink:#f9fafb;--dd-dim:#adb2b8;--dd-border:rgba(255,255,255,.10);--dd-border-strong:rgba(255,255,255,.26);--dd-hover:rgba(255,255,255,.07);--dd-accent:#60a5fa;--dd-shadow:0 16px 38px rgba(0,0,0,.5);}',
      /* 面板根：占满中间主列，自带滚动（内容多时不裁切） */
      '.dd-root{width:100%;height:100%;overflow:auto;padding:16px;box-sizing:border-box;color:var(--dd-ink);font-size:13px;}',
      '.dd-root *{box-sizing:border-box;}',
      '.dd-wrap{max-width:1000px;margin:0 auto;display:flex;flex-direction:column;gap:12px;}',
      '.dd-head{display:flex;align-items:baseline;gap:10px;flex-wrap:wrap;}',
      '.dd-title{font-size:16px;font-weight:800;}',
      '.dd-subtitle{font-size:11px;color:var(--dd-dim);}',
      /* 卡片网格：auto-fit 自适应列数，窄屏自动折行 */
      '.dd-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(268px,1fr));gap:12px;align-items:start;}',
      '.dd-card{display:flex;flex-direction:column;gap:8px;padding:12px;border-radius:14px;border:1px solid var(--dd-border);',
      'background:var(--dd-card);backdrop-filter:blur(18px) saturate(150%);-webkit-backdrop-filter:blur(18px) saturate(150%);box-shadow:var(--dd-shadow);',
      'transition:transform .12s ease,box-shadow .12s ease,border-color .12s ease;}',
      '.dd-card.is-wide{grid-column:1 / -1;}',
      '.dd-card.is-click{cursor:pointer;}',
      '.dd-card.is-click:hover{transform:translateY(-2px);border-color:var(--dd-border-strong);box-shadow:0 16px 30px rgba(0,0,0,.18);}',
      '.dd-card:focus-visible{outline:2px solid var(--dd-accent);outline-offset:2px;}',
      '.dd-card-head{display:flex;align-items:center;gap:8px;}',
      '.dd-card-title{font-size:11px;font-weight:700;letter-spacing:.06em;color:var(--dd-dim);}',
      '.dd-card-hint{margin-left:auto;font-size:10.5px;color:var(--dd-dim);}',
      /* 周榜行（可点） */
      '.dd-rows{display:flex;flex-direction:column;gap:6px;}',
      '.dd-row{display:flex;align-items:center;gap:8px;padding:7px 8px;border-radius:10px;border:1px solid var(--dd-border);',
      'background:var(--dd-surface);cursor:pointer;transition:background .12s ease,border-color .12s ease,transform .12s ease;}',
      '.dd-row:hover{background:var(--dd-hover);border-color:var(--dd-border-strong);transform:translateX(2px);}',
      '.dd-row:focus-visible{outline:2px solid var(--dd-accent);outline-offset:1px;}',
      '.dd-rank{flex:0 0 auto;width:16px;font-size:10.5px;font-weight:700;color:var(--dd-dim);text-align:right;}',
      '.dd-row-main{flex:1;min-width:0;display:flex;flex-direction:column;gap:1px;}',
      '.dd-name{font-size:12.5px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}',
      '.dd-repo{font-size:10.5px;color:var(--dd-dim);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}',
      '.dd-row-side{flex:0 0 auto;display:flex;flex-direction:column;align-items:flex-end;gap:1px;}',
      '.dd-star{font-size:11.5px;font-weight:700;}',
      '.dd-delta{font-size:10px;font-weight:700;color:var(--dd-dim);}',
      '.dd-delta.is-up{color:#22c55e;}',
      '.dd-delta.is-down{color:#f97316;}',
      /* 免费模型卡 */
      '.dd-models{display:flex;flex-direction:column;gap:3px;}',
      '.dd-big{font-size:30px;font-weight:800;line-height:1.1;}',
      '.dd-sub{font-size:11px;color:var(--dd-dim);}',
      '.dd-sub2{font-size:10px;color:var(--dd-dim);}',
      /* 会话行（可点） */
      '.dd-ws{flex:0 0 auto;font-size:10px;padding:2px 6px;border-radius:999px;border:1px solid var(--dd-border);color:var(--dd-dim);',
      'overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:45%;}',
      /* 快捷动作 */
      '.dd-actions{display:flex;flex-direction:column;gap:8px;}',
      '.dd-act{width:100%;padding:9px 10px;border-radius:10px;border:1px solid var(--dd-border-strong);background:var(--dd-surface);',
      'color:var(--dd-ink);font:inherit;font-size:12px;font-weight:600;cursor:pointer;transition:background .12s ease,transform .12s ease;}',
      '.dd-act:hover{background:var(--dd-hover);transform:translateY(-1px);}',
      '.dd-act:focus-visible{outline:2px solid var(--dd-accent);outline-offset:1px;}',
      /* 小卡（支持本项目） */
      '.dd-mini-desc{font-size:11.5px;line-height:1.7;color:var(--dd-dim);}',
      /* 空 / 失败 / 提示 */
      '.dd-empty{padding:10px 6px;text-align:center;font-size:11.5px;line-height:1.7;color:var(--dd-dim);}',
      '.dd-fail{border-color:rgba(234,179,8,.5);background:linear-gradient(158deg,rgba(234,179,8,.12),transparent 70%),var(--dd-card);}',
      '.dd-fail-title{font-size:12.5px;font-weight:700;}',
      '.dd-reason{font-size:10.5px;color:var(--dd-dim);word-break:break-word;}',
      '.dd-retry{align-self:flex-start;padding:6px 14px;border-radius:999px;border:1px solid var(--dd-border-strong);',
      'background:transparent;color:inherit;font:inherit;font-size:11px;cursor:pointer;}',
      '.dd-retry:hover{background:var(--dd-hover);}',
      '.dd-warn{padding:6px 8px;border-radius:9px;border:1px solid rgba(234,179,8,.5);background:rgba(234,179,8,.12);font-size:10.5px;color:var(--dd-dim);}',
      '.dd-note{font-size:10.5px;color:var(--dd-dim);min-height:14px;padding:0 2px;}',
      /* 侧边栏图标行内容（不依赖 .dd-root 的变量，图标行在面板之外也要能着色） */
      '.dd-ico{--dd-ico-dim:#61666b;--dd-ico-accent:#3b82f6;display:flex;align-items:center;justify-content:center;',
      'border-radius:8px;color:var(--dd-ico-dim);transition:color .12s ease,background .12s ease;}',
      'body[data-ds-dark-theme] .dd-ico{--dd-ico-dim:#adb2b8;--dd-ico-accent:#60a5fa;}',
      '.dd-ico.is-active{color:var(--dd-ico-accent);background:rgba(59,130,246,.14);}',
      '@media (prefers-reduced-motion: reduce){.dd-row,.dd-card,.dd-act{transition:none;}.dd-row:hover,.dd-card.is-click:hover,.dd-act:hover{transform:none;}}',
    ].join('');

    function ensureStyle() {
      if (typeof document === 'undefined' || !document.head) return;
      if (document.querySelector('style[data-plugin="' + STYLE_MARK + '"]')) return;
      var el = document.createElement('style');
      el.setAttribute('data-plugin', STYLE_MARK);
      el.textContent = CSS;
      document.head.appendChild(el);
    }

    /* ========================= 纯函数工具 ========================= */
    function asList(value) {
      return Array.isArray(value) ? value : [];
    }

    function isObject(value) {
      return !!value && typeof value === 'object' && !Array.isArray(value);
    }

    function numOf(value) {
      var n = Number(value);
      return isFinite(n) ? n : null;
    }

    function textOf2(value, fallback) {
      if (typeof value === 'string' && value.trim() !== '') return value.trim();
      if (typeof value === 'number' && isFinite(value)) return String(value);
      return fallback;
    }

    function nameOf(row) {
      return textOf2(row && row.name, textOf2(row && row.repo, '未命名'));
    }

    function repoOf(row) {
      return textOf2(row && row.repo, '');
    }

    function dateOf(data) {
      var date = textOf2(data && data.date, '');
      if (date !== '') return date;
      var stamp = textOf2(data && data.generatedAt, '');
      return stamp.length >= 10 ? stamp.slice(0, 10) : '—';
    }

    /** 星数：≥1000 显示 99.0k（99046 → 99.0k），避免长数字挤爆行宽。 */
    function starText(value) {
      var n = numOf(value);
      if (n === null) return '—';
      if (n >= 1000) return (n / 1000).toFixed(1) + 'k';
      return String(n);
    }

    /** 较上期涨星：没有 delta 或正好是 0 时返回 null（不显示 0，避免把「没数据」当「持平」）。 */
    function deltaOf(row) {
      var n = numOf(row && row.delta);
      if (n === null || n === 0) return null;
      return n;
    }

    function deltaText(delta) {
      return delta > 0 ? '+' + delta : String(delta);
    }

    /** 正数绿色 is-up，负数橙色 is-down；为 null 的行根本不渲染 delta。 */
    function deltaClass(delta) {
      if (delta > 0) return 'dd-delta is-up';
      if (delta < 0) return 'dd-delta is-down';
      return 'dd-delta';
    }

    /** 路径归一（Windows 不区分大小写、斜杠混用）。 */
    function pathKey(p) {
      return String(p || '').replace(/[\\/]+$/, '').replace(/\//g, '\\').toLowerCase();
    }

    function baseName(p) {
      if (typeof p !== 'string' || p === '') return '';
      var s = p.replace(/[\\/]+$/, '');
      var parts = s.split(/[\\/]/);
      return parts[parts.length - 1] || s;
    }

    function sessionTitle(row) {
      var t = (row && (row.displayTitle || row.title));
      if (typeof t === 'string' && t.trim() !== '') return t.trim();
      return String((row && row.id) || '').slice(0, 8);
    }

    /** 会话行：去掉草稿与子 agent（与 dsh-workbench-lite 的 visibleSessions 一致）。 */
    function visibleSessions(list) {
      var ids = list && list.ids ? list.ids : [];
      var byId = list && list.byId ? list.byId : {};
      var rows = [];
      for (var i = 0; i < ids.length; i++) {
        var row = byId[ids[i]];
        if (!row) continue;
        if (row.origin === 'subagent') continue;
        if (row.blank === true) continue;
        rows.push(row);
      }
      // 「最近」= updatedAt 降序（缺失时间的排最后，不参与比较优势）
      rows.sort(function (a, b) { return (b.updatedAt || 0) - (a.updatedAt || 0); });
      return rows;
    }

    /** 会话的工作区名：cwd 精确命中工作区路径 → 工作区标题；否则「工作区外」。 */
    function workspaceTitleOf(row, workspaces) {
      var cwd = row && typeof row.cwd === 'string' ? row.cwd : '';
      if (cwd === '') return '工作区外';
      var items = workspaces && workspaces.items ? workspaces.items : [];
      var key = pathKey(cwd);
      for (var i = 0; i < items.length; i++) {
        var item = items[i];
        if (item && pathKey(item.path) === key) return textOf2(item.title, baseName(cwd) || '工作区');
      }
      return '工作区外';
    }

    /* ======================= 数据（宿主半只读路由） ======================= */
    var CACHE = { phase: 'idle', data: null, reason: '', at: 0 };
    var INFLIGHT = false;

    /**
     * 取周报数据。任何失败都转成 phase:'error' + 中文 reason，绝不抛给渲染。
     * 有旧数据时失败不清空（继续显示旧数据 + 提示），没有旧数据才显示失败态。
     */
    function requestData(done, opts) {
      var force = !!(opts && opts.force);
      if (typeof fetch !== 'function') {
        CACHE = { phase: 'error', data: CACHE.data, reason: '当前环境不支持 fetch', at: CACHE.at };
        if (typeof done === 'function') done();
        return;
      }
      if (INFLIGHT) return;
      if (!force && CACHE.phase === 'ok' && (Date.now() - CACHE.at) < CLIENT_TTL_MS) return;

      INFLIGHT = true;
      CACHE = { phase: 'loading', data: CACHE.data, reason: '', at: CACHE.at };

      var finish = function () {
        INFLIGHT = false;
        if (typeof done === 'function') done();
      };

      try {
        fetch(DATA_ROUTE, { credentials: 'same-origin', headers: { accept: 'application/json' } })
          .then(function (res) {
            if (!res || res.ok !== true || typeof res.json !== 'function') {
              throw new Error('宿主半返回 HTTP ' + (res && res.status ? res.status : '?'));
            }
            return res.json();
          })
          .then(function (body) {
            if (body && body.ok === true && isObject(body.data)) {
              CACHE = { phase: 'ok', data: body.data, reason: '', at: Date.now() };
              return;
            }
            CACHE = { phase: 'error', data: CACHE.data, reason: textOf2(body && body.reason, '宿主半没有返回可用数据'), at: CACHE.at };
          })
          .catch(function (err) {
            CACHE = {
              phase: 'error',
              data: CACHE.data,
              reason: err && err.message ? String(err.message) : '请求失败',
              at: CACHE.at,
            };
          })
          .then(finish, finish);
      } catch (err) {
        CACHE = { phase: 'error', data: CACHE.data, reason: err && err.message ? String(err.message) : '请求失败', at: CACHE.at };
        finish();
      }
    }

    /* ============== 跨面板跳转与服务面（全部带降级，绝不抛） ============== */

    /**
     * 取一个 Cordis 服务，尽量不失败（与 dsh-workbench-lite 相同的三级兜底）。
     *
     * ctx.get(name) 默认 strict：提供该服务的 fiber 未 active 时**静默返回 undefined**，
     * 写成 `if (svc && ...)` 会把功能悄悄吃掉。依次尝试：strict → 非 strict → 属性访问。
     */
    function resolveService(ctx, name) {
      var value;
      try { value = ctx.get(name); } catch (err) { value = undefined; }
      if (value === undefined || value === null) {
        try { value = ctx.get(name, false); } catch (err2) { value = undefined; }
      }
      if (value === undefined || value === null) {
        try { value = ctx[name]; } catch (err3) { value = undefined; }
      }
      return value === null ? undefined : value;
    }

    /**
     * 切到某个中间主列面板（官方 ILayout 面）。
     * 必须降级：函数不存在（老版本/面没接上）→ 返回 false；
     * key 未注册等情况下官方实现会**抛异常** → 吞掉并返回 false。任何路径不抛。
     */
    function selectPanel(ctx, key) {
      try {
        if (typeof ctx?.layout?.selectPanel === 'function') { ctx.layout.selectPanel(key); return true; }
      } catch { /* 面没注册等情况：调用方回落到 window.open */ }
      return false;
    }

    /** 打开一个网页。唯一一处 window.open；没有 window/被拦都静默返回 false。 */
    function openUrl(url) {
      if (typeof url !== 'string' || url === '') return false;
      try {
        if (typeof window !== 'undefined' && typeof window.open === 'function') { window.open(url); return true; }
      } catch { /* 弹窗被拦等：静默 */ }
      return false;
    }

    /** 先切面板；切不动（面缺失/key 未注册/抛异常）就回落打开网页。绝不抛。 */
    function jumpTo(ctx, key, fallbackUrl) {
      if (selectPanel(ctx, key)) return true;
      openUrl(fallbackUrl);
      return false;
    }

    /**
     * 打开一条会话（照抄 dsh-workbench-lite 的优先级：uiWorkspace.openSession → sessions.open）。
     * 两者都拿不到或调用抛错 → { ok:false, reason }，绝不把异常抛给点击处理器。
     */
    function openSessionFace(ctx, sessionId) {
      try {
        var uiWorkspace = resolveService(ctx, 'uiWorkspace');
        if (uiWorkspace && typeof uiWorkspace.openSession === 'function') {
          uiWorkspace.openSession(sessionId);
          return { ok: true, via: 'uiWorkspace' };
        }
        var sessions = resolveService(ctx, 'sessions');
        if (sessions && typeof sessions.open === 'function') {
          sessions.open(sessionId);
          return { ok: true, via: 'sessions' };
        }
        return { ok: false, reason: '拿不到 uiWorkspace/sessions 服务' };
      } catch (err) {
        return { ok: false, reason: err && err.message ? String(err.message) : String(err) };
      }
    }

    /**
     * 把任意抛出物归一成「带 message 的错误」。
     * 不用 instanceof：跨 realm（iframe / vm 沙箱 / 反序列化）的 Error 不是本 realm 的实例，
     * 会把 '上游拒绝' 错包成 'Error: 上游拒绝' 这种二次前缀，note 里就很难看。
     */
    function asError(value) {
      if (value && typeof value === 'object' && typeof value.message === 'string') return value;
      return new Error(String(value));
    }

    /**
     * 新建一条会话（createSession(cwd, done) 面，与 dsh-workbench-lite 一致）。
     * 拿不到 cwd 就传空：不带 cwd 字段，由 sessions.create 按自己的语义降级（默认目录）。
     * 同步抛错 / Promise 拒绝 / 根本没有 create —— 全部转成 done(err)，不抛。
     */
    function createSessionFace(ctx, cwd, done) {
      var finish = function (err, sessionId) {
        if (typeof done !== 'function') return;
        try { done(err || null, sessionId); } catch { /* 回调里的异常也不外抛 */ }
      };
      try {
        var sessions = resolveService(ctx, 'sessions');
        if (!sessions || typeof sessions.create !== 'function') {
          finish(new Error('拿不到 sessions.create'));
          return;
        }
        var input = {};
        if (typeof cwd === 'string' && cwd.trim() !== '') input.cwd = cwd.trim();
        var task = sessions.create(input);
        if (task && typeof task.then === 'function') {
          task.then(
            function (sessionId) { finish(null, sessionId); },
            function (err) { finish(asError(err)); },
          );
        } else {
          finish(null, task);
        }
      } catch (err) {
        finish(asError(err));
      }
    }

    /* ============================ 组件 ============================ */

    /** 侧边栏图标行内容：size = 图标边长（等尺寸自绘），active = 当前是否被选中。 */
    function PanelIcon(props) {
      var raw = numOf(props.size);
      var size = raw !== null && raw > 0 ? Math.round(raw) : 24;
      var active = props.active === true;
      React.useEffect(function () { ensureStyle(); }, []);
      return h('div', {
        className: 'dd-ico' + (active ? ' is-active' : ''),
        style: { width: size + 'px', height: size + 'px' },
        title: LIST_LABEL,
        'aria-hidden': 'true',
      },
        // 纯内联 SVG 画的四格仪表盘：不引外部字体/图片
        h('svg', {
          width: String(size), height: String(size), viewBox: '0 0 24 24',
          fill: 'currentColor', 'aria-hidden': 'true', focusable: 'false',
        },
          h('rect', { x: '3', y: '3', width: '8', height: '8', rx: '2' }),
          h('rect', { x: '13', y: '3', width: '8', height: '8', rx: '2' }),
          h('rect', { x: '3', y: '13', width: '8', height: '8', rx: '2' }),
          h('rect', { x: '13', y: '13', width: '8', height: '8', rx: '2' }),
        ),
      );
    }

    /** 周榜一行：中文名 + owner/repo + 星数 + 涨星；整行可点，点了切周榜面板（或开网页）。 */
    function TopRow(props) {
      var row = props.row;
      var repo = repoOf(row);
      var delta = deltaOf(row);
      var fire = function () { props.onJump(row); };
      return h('div', {
        className: 'dd-row',
        role: 'button',
        tabIndex: 0,
        title: nameOf(row) + (repo === '' ? '' : '（' + repo + '）') + ' · 点击打开周榜',
        onClick: fire,
        onKeyDown: function (ev) {
          if (ev && (ev.key === 'Enter' || ev.key === ' ')) { ev.preventDefault(); fire(); }
        },
      },
        h('span', { className: 'dd-rank' }, String(props.index + 1)),
        h('span', { className: 'dd-row-main' },
          h('span', { className: 'dd-name' }, nameOf(row)),
          repo === '' ? null : h('span', { className: 'dd-repo' }, repo),
        ),
        h('span', { className: 'dd-row-side' },
          h('span', { className: 'dd-star' }, starText(row && row.stars)),
          delta === null ? null : h('span', { className: deltaClass(delta) }, deltaText(delta)),
        ),
      );
    }

    /** 最近会话一行：标题 + 工作区名；点击打开该会话。 */
    function SessionRow(props) {
      var row = props.row;
      var fire = function () { props.onOpen(row); };
      return h('div', {
        className: 'dd-row',
        role: 'button',
        tabIndex: 0,
        title: sessionTitle(row) + (row && row.cwd ? '\n' + row.cwd : '') + '\n点击打开该会话',
        onClick: fire,
        onKeyDown: function (ev) {
          if (ev && (ev.key === 'Enter' || ev.key === ' ')) { ev.preventDefault(); fire(); }
        },
      },
        h('span', { className: 'dd-row-main' },
          h('span', { className: 'dd-name' }, sessionTitle(row)),
          h('span', { className: 'dd-repo' }, '最近活动'),
        ),
        h('span', { className: 'dd-ws', title: row && row.cwd ? row.cwd : '' }, props.workspaceTitle),
      );
    }

    /** 中间整列的仪表盘面板（注册进 main 槽，key = dsh-dashboard）。 */
    function DashboardPanel(props) {
      var tickPair = React.useState(0);
      var tick = tickPair[0];
      var bump = tickPair[1];
      void tick;
      var notePair = React.useState('');
      var note = notePair[0];
      var setNote = notePair[1];

      React.useEffect(function () { ensureStyle(); }, []);
      // 挂载即取一次（宿主半有 30 分钟缓存，很便宜）
      React.useEffect(function () { requestData(afterLoad); }, []);

      function afterLoad() {
        bump(function (v) { return v + 1; });
      }

      /** 重试按钮：强制重取。 */
      function retry() {
        requestData(afterLoad, { force: true });
      }

      // —— 会话数据（框架标准 hook；拿不到就占位，其它卡不受影响）——
      var list = null;
      var sessionsOk = false;
      if (typeof props.useSessions === 'function') {
        try {
          list = props.useSessions(function (s) { return s; });
          sessionsOk = list !== null && list !== undefined;
        } catch (err) {
          sessionsOk = false;
        }
      }
      var workspaces = null;
      if (typeof props.useWorkspaces === 'function') {
        try { workspaces = props.useWorkspaces(function (s) { return s; }); } catch (err2) { workspaces = null; }
      }
      var recent = sessionsOk ? visibleSessions(list).slice(0, RECENT_N) : [];

      // —— 跳转入口：注入面在就用注入面（带 ctx），缺了就纯开网页 ——
      var jump = typeof props.dashJump === 'function'
        ? props.dashJump
        : function (key, url) { return openUrl(url); };

      function jumpWeekly() { jump(WEEKLY_KEY, SITE_URL); }

      function openSessionRow(row) {
        if (typeof props.dashOpenSession !== 'function') {
          setNote('打开会话失败：缺少会话服务');
          return;
        }
        var res = props.dashOpenSession(row.id);
        if (res && res.ok === false) {
          setNote('打开会话失败：' + textOf2(res.reason, '会话服务不可用'));
        } else {
          setNote('已打开：' + sessionTitle(row));
        }
      }

      /** 新会话：默认沿用最近一条会话的工作目录；拿不到 cwd 就传空按其语义降级。 */
      function newSession() {
        if (typeof props.dashCreateSession !== 'function') {
          setNote('新建失败：缺少会话服务');
          return;
        }
        var cwd = recent.length > 0 && typeof recent[0].cwd === 'string' ? recent[0].cwd : '';
        setNote('正在新建会话…');
        props.dashCreateSession(cwd, function (err, sessionId) {
          if (err) {
            setNote('新建失败：' + textOf2(err.message, String(err)));
            return;
          }
          setNote('已新建会话');
          if (sessionId && typeof props.dashOpenSession === 'function') {
            var res = props.dashOpenSession(sessionId);
            if (res && res.ok === false) setNote('已新建会话，但打开失败：' + textOf2(res.reason, ''));
          }
        });
      }

      // —— 周报数据（latest.json 经宿主半只读路由回来）——
      var data = isObject(CACHE.data) ? CACHE.data : null;
      var phase = CACHE.phase;
      var plugins = asList(data && data.plugins);
      var sorted = plugins.slice().sort(function (a, b) { return (numOf(b && b.stars) || 0) - (numOf(a && a.stars) || 0); });
      var top = sorted.slice(0, TOP_N);
      var stat = isObject(data && data.stat) ? data.stat : null;

      var cards = [];
      if (data === null) {
        if (phase === 'error') {
          // 失败态照抄 dsh-weekly-panel：中文标题 + 具体原因 + 重试按钮
          cards.push(h('div', { className: 'dd-card dd-fail is-wide', key: 'fail' },
            h('div', { className: 'dd-card-head' },
              h('span', { className: 'dd-fail-title' }, '暂时拿不到周报数据'),
            ),
            CACHE.reason === '' ? null : h('div', { className: 'dd-reason' }, CACHE.reason),
            h('button', { type: 'button', className: 'dd-retry', onClick: retry }, '重试'),
          ));
        } else {
          cards.push(h('div', { className: 'dd-card is-wide', key: 'loading' },
            h('div', { className: 'dd-card-head' },
              h('span', { className: 'dd-card-title' }, '正在读取周报…'),
            ),
          ));
        }
      } else {
        cards.push(h('div', { className: 'dd-card is-wide', key: 'top' },
          h('div', { className: 'dd-card-head' },
            h('span', { className: 'dd-card-title' }, '周榜 TOP ' + TOP_N),
            h('span', { className: 'dd-card-hint' }, '更新 ' + dateOf(data) + ' · 点行打开完整周榜'),
          ),
          top.length === 0
            ? h('div', { className: 'dd-empty' }, '本期还没有插件数据')
            : h('div', { className: 'dd-rows' },
                top.map(function (row, index) {
                  return h(TopRow, { key: repoOf(row) || nameOf(row), index: index, row: row, onJump: jumpWeekly });
                }),
              ),
        ));
        if (phase === 'error') {
          cards.push(h('div', { className: 'dd-card is-wide', key: 'warn' },
            h('div', { className: 'dd-warn' }, '刷新失败，先显示上次数据' + (CACHE.reason === '' ? '' : '（' + CACHE.reason + '）')),
          ));
        }
        cards.push(h('div', {
          className: 'dd-card is-click', key: 'models',
          role: 'button', tabIndex: 0,
          title: '点击查看完整周榜',
          onClick: jumpWeekly,
          onKeyDown: function (ev) {
            if (ev && (ev.key === 'Enter' || ev.key === ' ')) { ev.preventDefault(); jumpWeekly(); }
          },
        },
          h('div', { className: 'dd-card-head' },
            h('span', { className: 'dd-card-title' }, '免费模型'),
            h('span', { className: 'dd-card-hint' }, '完整榜单 →'),
          ),
          stat === null
            ? h('div', { className: 'dd-empty' }, '免费模型数据暂缺')
            : h('div', { className: 'dd-models' },
                h('div', { className: 'dd-big' }, (numOf(stat.ok) || 0) + '/' + (numOf(stat.total) || 0)),
                h('div', { className: 'dd-sub' },
                  '已下线 ' + (numOf(stat.gone) || 0) + ' · 地区墙 ' + (numOf(stat.region) || 0) + ' · 上游波动 ' + (numOf(stat.flaky) || 0),
                ),
                h('div', { className: 'dd-sub2' }, '可用 / 免费模型总数'),
              ),
        ));
      }

      // —— 最近会话卡（数据独立：sessions 拿不到只占位，不影响其它卡）——
      var sessionsBody;
      if (!sessionsOk) {
        sessionsBody = h('div', { className: 'dd-empty' }, '会话列表不可用（拿不到会话服务）');
      } else if (recent.length === 0) {
        sessionsBody = h('div', { className: 'dd-empty' }, '暂无会话');
      } else {
        sessionsBody = h('div', { className: 'dd-rows' },
          recent.map(function (row) {
            return h(SessionRow, {
              key: String(row.id),
              row: row,
              workspaceTitle: workspaceTitleOf(row, workspaces),
              onOpen: openSessionRow,
            });
          }),
        );
      }

      return h('div', { className: 'dd-root' },
        h('div', { className: 'dd-wrap' },
          h('div', { className: 'dd-head' },
            h('span', { className: 'dd-title' }, 'DSH 仪表盘'),
            h('span', { className: 'dd-subtitle' }, '聚合视图 · 数据只读 · 点卡片或行即可跳转'),
          ),
          h('div', { className: 'dd-grid' },
            cards,
            h('div', { className: 'dd-card', key: 'sessions' },
              h('div', { className: 'dd-card-head' },
                h('span', { className: 'dd-card-title' }, '最近会话'),
                h('span', { className: 'dd-card-hint' }, '最近 ' + RECENT_N + ' 条'),
              ),
              sessionsBody,
            ),
            h('div', { className: 'dd-card', key: 'actions' },
              h('div', { className: 'dd-card-head' },
                h('span', { className: 'dd-card-title' }, '快捷动作'),
              ),
              h('div', { className: 'dd-actions' },
                h('button', { type: 'button', className: 'dd-act', onClick: newSession }, '＋ 新会话'),
                h('button', {
                  type: 'button', className: 'dd-act',
                  onClick: function () { jump(WORKBENCH_KEY, SITE_URL); },
                }, '打开工作台'),
                h('button', {
                  type: 'button', className: 'dd-act',
                  onClick: jumpWeekly,
                }, '打开周榜'),
              ),
            ),
            h('div', {
              className: 'dd-card is-click', key: 'support',
              role: 'button', tabIndex: 0,
              title: SPONSOR_URL,
              onClick: function () { openUrl(SPONSOR_URL); },
              onKeyDown: function (ev) {
                if (ev && (ev.key === 'Enter' || ev.key === ' ')) { ev.preventDefault(); openUrl(SPONSOR_URL); }
              },
            },
              h('div', { className: 'dd-card-head' },
                h('span', { className: 'dd-card-title' }, '支持本项目'),
              ),
              h('div', { className: 'dd-mini-desc' }, '周榜与仪表盘完全免费、只读、零依赖。若它帮你省了时间，请考虑请作者喝杯咖啡 ☕'),
              h('div', { className: 'dd-sub2' }, '点击前往赞助页 →'),
            ),
          ),
          h('div', { className: 'dd-note' }, note || '只读聚合 · 不写任何本地数据'),
        ),
      );
    }

    /* ============================ 插件体 ============================ */
    function warn(ctx, err) {
      var logger = ctx && ctx.logger;
      var sink = (logger && logger.warn) || (typeof console !== 'undefined' ? console.warn : null);
      if (sink) {
        try { sink.call(logger || console, '[dsh-dashboard] 注册失败，已跳过：', err); } catch { /* 日志失败也不影响加载 */ }
      }
    }

    /**
     * 两个注册（官方范式）：
     *   ctx.slots.inject('main', () => ctx.slots.register({ name:'main', key:'dsh-dashboard' }, DashboardPanel))
     *   ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({ name:'sidebar.panellist', id:'dsh-dashboard', order:100, label:'仪表盘' }, PanelIcon))
     * 拿不到 slots 服务时安静跳过；任何注册异常都不外抛。
     */
    function apply(ctx) {
      try {
        var slots = resolveService(ctx, 'slots');
        if (slots === undefined || slots === null) return;
        ensureStyle();

        slots.inject(MAIN_SLOT, function () {
          return slots.register(
            {
              name: MAIN_SLOT,
              key: MAIN_KEY,
              // 注入面（与 dsh-workbench-lite 同一机制）：把带 ctx 的降级服务面交给面板 props
              inject: function () {
                return {
                  dashJump: function (key, url) { return jumpTo(ctx, key, url); },
                  dashOpenSession: function (sessionId) { return openSessionFace(ctx, sessionId); },
                  dashCreateSession: function (cwd, done) { return createSessionFace(ctx, cwd, done); },
                };
              },
            },
            DashboardPanel,
          );
        });

        slots.inject(LIST_SLOT, function () {
          return slots.register(
            { name: LIST_SLOT, id: LIST_ID, order: LIST_ORDER, label: LIST_LABEL },
            PanelIcon,
          );
        });
      } catch (err) {
        warn(ctx, err);
      }
    }

    exports.name = 'dsh-dashboard';
    exports.inject = ['slots'];
    exports.apply = apply;
    return module.exports;
  },
});
