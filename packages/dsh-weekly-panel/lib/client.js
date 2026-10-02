// dsh-weekly-panel — client half（客户端半，v0.2.0，手写 bundle、无需构建）。
//
// 把《DSH 插件周榜》搬进 DSH（面板化改造）：
//   * **主入口（本轮新增）**：注册进框架 `main` 槽（keyed，key='dsh-weekly'）——
//     中间整列宽度的面板，不再挤在侧边栏的狭长抽屉里
//   * **侧边栏图标行**：注册进 `sidebar.panellist`（id 与 main key 同值，order 15）
//   * **保底入口**：原 `sidebar.footer.action` 按钮保留；点击时优先切到中间面板，
//     切不动（layout face 缺失/抛异常）才回落旧抽屉
//
// 内容：更新时间/插件总数、插件 TOP10（中文名 / owner/repo / 星数 / 较上期涨星）、
// 免费模型可用性（可用 x/y，已下线/地区墙数量）、赞助位（有才显示，且明确标注「赞助」）、
// 两个外链按钮（完整榜单 / 商务合作）。
//
// 不遮挡对话：中间面板是流内布局（max-width 1100 居中，无 fixed/z-index）；
// 只有「保底抽屉 + 侧边栏收起（rail）」这条降级路径才用浮层（z-index 90）。
//
// 数据来自宿主半的只读路由 GET /weekly-panel/data（它自己再缓存 30 分钟）。
// 本文件不 import/export 任何东西；副作用都在 factory 内。

window.__ModuleLoader__.load({
  id: 'dsh-weekly-panel',
  factory: function (require) {
    var module = { exports: {} };
    var exports = module.exports;
    var React = require('react');
    var h = React.createElement;

    /* ===================================================================
     * 契约区：DSH 版本敏感的东西集中在这里。
     * =================================================================== */
    var SLOT = 'sidebar.footer.action';   // 侧边栏底部的加法槽位（list / root）——保底入口，保留
    var ENTRY_ID = 'dsh-weekly-panel';
    var ENTRY_ORDER = 20;                 // 排在 dsh-workbench-lite（15）之后，不冲突
    var ENTRY_LABEL = '📊 周榜';
    // 面板化（v0.2.0）：中间主列的 key + 侧边栏图标行的 id（两者必须同值）
    var MAIN_SLOT = 'main';               // 框架 keyed 槽：中间主列（已占用 key 只有 conversation）
    var PANEL_SLOT = 'sidebar.panellist'; // 框架 list 槽：侧边栏全局面板图标行
    var PANEL_KEY = 'dsh-weekly';
    var PANEL_ORDER = 15;                 // 图标行排序（周榜在工作台 20 之前）
    var STORE_KEY = 'dsh.weekly-panel.v1';// localStorage：只存抽屉展开态
    var DATA_ROUTE = '/weekly-panel/data';
    var SITE_URL = 'https://514006234.github.io/dsh-weekly-check/';
    var SPONSOR_URL = 'https://514006234.github.io/dsh-weekly-check/sponsor/';
    var TOP_N = 10;
    var CLIENT_TTL_MS = 5 * 60 * 1000;    // 客户端内存缓存 5 分钟（服务端另有 30 分钟缓存）
    var STYLE_MARK = 'dsh-weekly-panel';

    var COLORS = { up: '#22c55e', down: '#f97316', dim: '#94a3b8' };

    /* ============================ 样式 ============================ */
    var CSS = [
      '.dwp-entry{--dwp-surface:rgba(255,255,255,.92);--dwp-card:rgba(255,255,255,.62);--dwp-ink:#0f1115;--dwp-dim:#61666b;--dwp-border:rgba(0,0,0,.10);--dwp-border-strong:rgba(0,0,0,.22);--dwp-hover:rgba(0,0,0,.05);--dwp-accent:#3b82f6;--dwp-shadow:0 14px 34px rgba(0,0,0,.16);}',
      'body[data-ds-dark-theme] .dwp-entry{--dwp-surface:rgba(24,24,27,.86);--dwp-card:rgba(255,255,255,.045);--dwp-ink:#f9fafb;--dwp-dim:#adb2b8;--dwp-border:rgba(255,255,255,.10);--dwp-border-strong:rgba(255,255,255,.26);--dwp-hover:rgba(255,255,255,.07);--dwp-accent:#60a5fa;--dwp-shadow:0 16px 38px rgba(0,0,0,.5);}',
      '.dwp-entry{width:100%;min-width:0;display:flex;flex-direction:column;gap:8px;color:var(--dwp-ink);font-size:13px;}',
      '.dwp-entry *{box-sizing:border-box;}',
      '.dwp-entry.is-rail{width:auto;}',
      /* 入口按钮 */
      '.dwp-btn{width:100%;display:flex;align-items:center;gap:8px;padding:8px 10px;border-radius:10px;cursor:pointer;font:inherit;font-size:12.5px;font-weight:600;',
      'color:inherit;background:transparent;border:1px solid transparent;transition:background .12s ease,border-color .12s ease;}',
      '.dwp-btn:hover{background:var(--dwp-hover);border-color:var(--dwp-border);}',
      '.dwp-btn.is-open{background:var(--dwp-card);border-color:var(--dwp-border-strong);}',
      '.dwp-entry.is-rail .dwp-btn{width:34px;height:34px;justify-content:center;padding:0;border-radius:10px;}',
      '.dwp-btn-label{flex:1;min-width:0;text-align:left;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}',
      // 角标必须 flex:0 0 auto，否则会被标签压变形（workbench 上踩过一次）
      '.dwp-badge{flex:0 0 auto;min-width:18px;height:18px;padding:0 5px;border-radius:9px;display:inline-flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;background:var(--dwp-accent);color:#fff;}',
      '.dwp-badge.is-empty{background:transparent;color:var(--dwp-dim);border:1px solid var(--dwp-border);}',
      /* 抽屉：在流内（不吃 position:fixed），带 max-height + 滚动，只把上方列表挤上去 */
      '.dwp-panel{display:flex;flex-direction:column;gap:8px;padding:10px;border-radius:14px;border:1px solid var(--dwp-border);',
      'background:var(--dwp-surface);backdrop-filter:blur(18px) saturate(150%);-webkit-backdrop-filter:blur(18px) saturate(150%);box-shadow:var(--dwp-shadow);',
      'max-height:min(46vh,440px);overflow:auto;}',
      // 面板是带 max-height 的 flex 列：子项默认 flex-shrink:1 会先被压扁再滚动，必须禁止收缩
      '.dwp-panel>*{flex:0 0 auto;}',
      // 唯一一处浮层定位：仅侧边栏收起（rail）时启用；z-index 取 90，低于宿主弹窗层级，不覆盖对话
      '.dwp-entry.is-float .dwp-panel{position:fixed;left:64px;bottom:64px;width:300px;max-height:min(60vh,560px);z-index:90;}',
      '.dwp-head{display:flex;align-items:center;gap:8px;padding:0 2px 2px;}',
      '.dwp-title{font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--dwp-dim);}',
      '.dwp-hint{margin-left:auto;font-size:10.5px;color:var(--dwp-dim);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}',
      '.dwp-summary{display:flex;flex-wrap:wrap;align-items:center;gap:6px;padding:9px 10px;border-radius:12px;border:1px solid var(--dwp-border-strong);',
      'background:linear-gradient(158deg,rgba(59,130,246,.16),rgba(59,130,246,.04) 46%,transparent 78%),var(--dwp-card);}',
      '.dwp-summary b{font-size:13px;font-weight:700;}',
      '.dwp-summary span{font-size:10.5px;color:var(--dwp-dim);}',
      '.dwp-section{display:flex;flex-direction:column;gap:6px;}',
      '.dwp-section-title{font-size:10.5px;font-weight:700;letter-spacing:.06em;color:var(--dwp-dim);}',
      '.dwp-warn{padding:6px 8px;border-radius:9px;border:1px solid rgba(234,179,8,.5);background:rgba(234,179,8,.12);font-size:10.5px;color:var(--dwp-dim);}',
      /* TOP 10 行 */
      '.dwp-row{display:flex;align-items:center;gap:8px;padding:6px 8px;border-radius:10px;border:1px solid var(--dwp-border);background:var(--dwp-card);}',
      '.dwp-rank{flex:0 0 auto;width:16px;font-size:10.5px;font-weight:700;color:var(--dwp-dim);text-align:right;}',
      '.dwp-row-main{flex:1;min-width:0;display:flex;flex-direction:column;gap:1px;}',
      '.dwp-name{font-size:12px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}',
      '.dwp-repo{font-size:10px;color:var(--dwp-dim);text-decoration:none;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}',
      '.dwp-repo:hover{color:var(--dwp-accent);text-decoration:underline;}',
      '.dwp-row-side{flex:0 0 auto;display:flex;flex-direction:column;align-items:flex-end;gap:1px;}',
      '.dwp-star{font-size:11.5px;font-weight:700;}',
      '.dwp-delta{font-size:10px;font-weight:700;color:var(--dwp-dim);}',
      // 「较上期涨星」正数绿色
      '.dwp-delta.is-up{color:#22c55e;}',
      '.dwp-delta.is-down{color:#f97316;}',
      /* 免费模型 chips */
      '.dwp-models{display:flex;flex-wrap:wrap;gap:6px;}',
      '.dwp-chip{display:inline-flex;align-items:center;gap:4px;padding:2px 7px;border-radius:999px;border:1px solid var(--dwp-border);font-size:10.5px;color:var(--dwp-dim);}',
      '.dwp-chip b{font-weight:700;color:var(--dwp-ink);}',
      '.dwp-chip.is-ok{border-color:rgba(34,197,94,.5);}',
      '.dwp-chip.is-warn{border-color:rgba(249,115,22,.5);}',
      /* 赞助位：必须一眼看出是「赞助」 */
      '.dwp-section-sponsor{border:1px solid rgba(59,130,246,.5);border-radius:12px;padding:8px;background:linear-gradient(158deg,rgba(59,130,246,.12),transparent 70%),var(--dwp-card);}',
      '.dwp-sponsor{display:flex;flex-direction:column;gap:2px;padding:6px 8px;border-radius:10px;border:1px dashed var(--dwp-border-strong);}',
      '.dwp-sponsor-top{display:flex;align-items:center;gap:6px;}',
      '.dwp-sponsor-badge{flex:0 0 auto;padding:0 5px;border-radius:999px;background:var(--dwp-accent);color:#fff;font-size:9.5px;line-height:15px;font-weight:700;}',
      '.dwp-sponsor-name{font-size:12px;font-weight:700;}',
      '.dwp-sponsor-cn{font-size:10.5px;color:var(--dwp-dim);line-height:1.6;}',
      '.dwp-sponsor-tier{font-size:9.5px;color:var(--dwp-dim);}',
      /* 链接 */
      '.dwp-links{display:flex;gap:8px;}',
      '.dwp-link{flex:1;min-width:0;text-align:center;padding:7px 8px;border-radius:10px;border:1px solid var(--dwp-border-strong);',
      'color:var(--dwp-ink);text-decoration:none;font-size:11px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}',
      '.dwp-link:hover{background:var(--dwp-hover);}',
      /* 空 / 失败态 */
      '.dwp-empty{padding:14px 8px;text-align:center;font-size:11.5px;line-height:1.7;color:var(--dwp-dim);}',
      '.dwp-empty-title{font-weight:700;color:var(--dwp-ink);margin-bottom:4px;}',
      '.dwp-empty-reason{font-size:10.5px;word-break:break-word;}',
      '.dwp-retry{margin-top:8px;padding:6px 12px;border-radius:999px;border:1px solid var(--dwp-border-strong);background:transparent;color:inherit;font:inherit;font-size:11px;cursor:pointer;}',
      '.dwp-retry:hover{background:var(--dwp-hover);}',
      /* 中间主列模式：整列宽度、居中限宽、去浮层化；TOP 行在宽屏折成网格 */
      '.dwp-main{width:100%;max-width:1100px;margin:0 auto;padding:24px 28px 40px;overflow:auto;}',
      '.dwp-main .dwp-panel{max-height:none;overflow:visible;border:none;background:transparent;backdrop-filter:none;-webkit-backdrop-filter:none;box-shadow:none;padding:0;gap:14px;}',
      '.dwp-main .dwp-head{padding-bottom:4px;}',
      '.dwp-main .dwp-head .dwp-title{font-size:13px;letter-spacing:.04em;}',
      '.dwp-main .dwp-section{display:grid;grid-template-columns:repeat(auto-fill,minmax(320px,1fr));gap:8px;}',
      '.dwp-main .dwp-section-title{grid-column:1/-1;}',
      '.dwp-main .dwp-empty{grid-column:1/-1;padding:20px 12px;border:1px dashed var(--dwp-border);border-radius:12px;}',
      '@media (max-width:720px){.dwp-main{padding:16px 14px 32px;}}',
      '@media (prefers-reduced-motion: reduce){.dwp-btn{transition:none;}}',
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
    function readOpen() {
      try {
        var raw = window.localStorage.getItem(STORE_KEY);
        if (!raw) return false;
        var parsed = JSON.parse(raw);
        return !!(parsed && parsed.open === true);
      } catch (err) {
        return false;
      }
    }

    function writeOpen(open) {
      try {
        window.localStorage.setItem(STORE_KEY, JSON.stringify({ open: open === true }));
      } catch (err) {
        /* localStorage 不可用时静默降级 */
      }
    }

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

    function githubUrl(repo) {
      return repo === '' ? '' : 'https://github.com/' + repo;
    }

    function dateOf(data) {
      var date = textOf2(data && data.date, '');
      if (date !== '') return date;
      var stamp = textOf2(data && data.generatedAt, '');
      return stamp.length >= 10 ? stamp.slice(0, 10) : '—';
    }

    /** 星数：≥1000 显示 1.2k，避免长数字挤爆行宽。 */
    function starText(value) {
      var n = numOf(value);
      if (n === null) return '—';
      if (n >= 1000) return (n / 1000).toFixed(1) + 'k';
      return String(n);
    }

    /** 较上期涨星：没数据时返回 null（不显示 0，避免"其实是没数据"被当成"持平"）。 */
    function deltaOf(row) {
      var n = numOf(row && row.delta);
      return n === null ? null : n;
    }

    function deltaText(delta) {
      return delta > 0 ? '+' + delta : String(delta);
    }

    function deltaClass(delta) {
      if (delta > 0) return 'dwp-delta is-up';
      if (delta < 0) return 'dwp-delta is-down';
      return 'dwp-delta';
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

    /* ============================ 组件 ============================ */
    function TopRow(props) {
      var row = props.row;
      var repo = repoOf(row);
      var delta = deltaOf(row);
      return h('div', { className: 'dwp-row' },
        h('span', { className: 'dwp-rank' }, String(props.index + 1)),
        h('span', { className: 'dwp-row-main' },
          h('span', { className: 'dwp-name', title: nameOf(row) }, nameOf(row)),
          repo === ''
            ? null
            : h('a', {
                className: 'dwp-repo',
                href: githubUrl(repo),
                target: '_blank',
                rel: 'noopener noreferrer',
                title: githubUrl(repo),
              }, repo),
        ),
        h('span', { className: 'dwp-row-side' },
          h('span', { className: 'dwp-star' }, starText(row && row.stars)),
          delta === null ? null : h('span', { className: deltaClass(delta) }, deltaText(delta)),
        ),
      );
    }

    function SponsorCard(props) {
      var s = props.sponsor;
      var repo = repoOf(s);
      var cn = textOf2(s && s.cn, '');
      var tier = textOf2(s && s.tier, '');
      return h('div', { className: 'dwp-sponsor' },
        h('div', { className: 'dwp-sponsor-top' },
          h('span', { className: 'dwp-sponsor-badge' }, '赞助'),
          h('span', { className: 'dwp-sponsor-name' }, nameOf(s)),
          repo === ''
            ? null
            : h('a', { className: 'dwp-repo', href: githubUrl(repo), target: '_blank', rel: 'noopener noreferrer', title: githubUrl(repo) }, repo),
        ),
        cn === '' ? null : h('div', { className: 'dwp-sponsor-cn' }, cn),
        tier === '' ? null : h('div', { className: 'dwp-sponsor-tier' }, tier),
      );
    }

    function WeeklyPanel(props) {
      var mainMode = props.main === true;
      var openPair = React.useState(readOpen);
      var open = mainMode ? true : openPair[0];
      var setOpen = openPair[1];
      var tickPair = React.useState(0);
      var tick = tickPair[0];
      var bump = tickPair[1];
      void tick;

      React.useEffect(function () { ensureStyle(); }, []);
      // 挂载即取一次（宿主半有 30 分钟缓存，很便宜），这样角标不用展开就能显示插件数
      React.useEffect(function () { refresh(); }, []);

      function afterLoad() {
        bump(function (v) { return v + 1; });
      }

      /** 按 TTL 校验一次：没过期就不发请求（多次开合不会反复打宿主半路由）。 */
      function refresh() {
        requestData(afterLoad);
      }

      /** 强制重取：只给「重试」按钮用。 */
      function retry() {
        requestData(afterLoad, { force: true });
      }

      function toggleOpen() {
        // 面板化：能切到中间面板就切，切不动（layout face 不可用/抛异常）才回落旧抽屉
        if (selectPanel(CTX, PANEL_KEY)) return;
        var next = !open;
        writeOpen(next);
        setOpen(next);
        // 展开时顺手按 TTL 校验一次（过期才真的发请求）
        if (next) refresh();
      }

      var data = isObject(CACHE.data) ? CACHE.data : null;
      var phase = CACHE.phase;
      var plugins = asList(data && data.plugins);
      var sorted = plugins.slice().sort(function (a, b) { return (numOf(b && b.stars) || 0) - (numOf(a && a.stars) || 0); });
      var top = sorted.slice(0, TOP_N);
      var stat = isObject(data && data.stat) ? data.stat : null;
      var sponsors = asList(data && data.sponsors);
      var wide = props.wide !== false;

      var badge = phase === 'loading' || phase === 'idle'
        ? '…'
        : (data === null ? '!' : String(plugins.length));
      var known = phase === 'ok' || data !== null;

      var button = h('button', {
        type: 'button',
        className: 'dwp-btn' + (open ? ' is-open' : ''),
        title: wide ? 'DSH 插件周榜（侧边栏底部）' : 'DSH 插件周榜',
        'aria-expanded': open ? 'true' : 'false',
        onClick: toggleOpen,
      },
        h('span', { className: 'dwp-btn-label' }, wide ? ENTRY_LABEL : '📊'),
        h('span', { className: 'dwp-badge' + (known ? '' : ' is-empty') }, badge),
      );

      if (!open) return h('div', { className: 'dwp-entry' + (wide ? '' : ' is-rail') }, button);

      var body = [];
      if (data === null) {
        if (phase === 'error') {
          body.push(h('div', { className: 'dwp-empty', key: 'fail' },
            h('div', { className: 'dwp-empty-title' }, '暂时拿不到周报数据'),
            CACHE.reason === '' ? null : h('div', { className: 'dwp-empty-reason' }, CACHE.reason),
            h('button', { type: 'button', className: 'dwp-retry', onClick: retry }, '重试'),
          ));
        } else {
          body.push(h('div', { className: 'dwp-empty', key: 'loading' }, '正在读取周报…'));
        }
      } else {
        body.push(h('div', { className: 'dwp-summary', key: 'summary' },
          h('b', null, plugins.length + ' 个插件'),
          h('span', null, '更新 ' + dateOf(data)),
          h('span', null, '·'),
          h('span', null, '只读数据'),
        ));
        if (phase === 'error') {
          body.push(h('div', { className: 'dwp-warn', key: 'warn' },
            '刷新失败，先显示上次数据' + (CACHE.reason === '' ? '' : '（' + CACHE.reason + '）')));
        }
        body.push(h('div', { className: 'dwp-section', key: 'top' },
          h('div', { className: 'dwp-section-title' }, '插件 TOP ' + TOP_N),
          top.length === 0
            ? h('div', { className: 'dwp-empty' }, '本期还没有插件数据')
            : top.map(function (row, index) {
                return h(TopRow, { key: repoOf(row) || nameOf(row), index: index, row: row });
              }),
        ));
        body.push(h('div', { className: 'dwp-section', key: 'models' },
          h('div', { className: 'dwp-section-title' }, '免费模型'),
          stat === null
            ? h('div', { className: 'dwp-empty' }, '免费模型数据暂缺')
            : h('div', { className: 'dwp-models' },
                h('span', { className: 'dwp-chip is-ok' }, '可用 ', h('b', null, (numOf(stat.ok) || 0) + '/' + (numOf(stat.total) || 0))),
                h('span', { className: 'dwp-chip is-warn' }, '已下线 ', h('b', null, String(numOf(stat.gone) || 0))),
                h('span', { className: 'dwp-chip is-warn' }, '地区墙 ', h('b', null, String(numOf(stat.region) || 0))),
                (numOf(stat.limited) || 0) > 0
                  ? h('span', { className: 'dwp-chip' }, '限流 ', h('b', null, String(numOf(stat.limited) || 0)))
                  : null,
                (numOf(stat.flaky) || 0) > 0
                  ? h('span', { className: 'dwp-chip' }, '上游波动 ', h('b', null, String(numOf(stat.flaky) || 0)))
                  : null,
              ),
        ));
        if (sponsors.length > 0) {
          body.push(h('div', { className: 'dwp-section dwp-section-sponsor', key: 'sponsors' },
            h('div', { className: 'dwp-section-title' }, '本期推荐（赞助）'),
            sponsors.map(function (s) {
              return h(SponsorCard, { key: repoOf(s) || nameOf(s), sponsor: s });
            }),
          ));
        }
      }

      var panel = h('div', { className: 'dwp-panel', role: 'dialog', 'aria-label': 'DSH 插件周榜' },
        h('div', { className: 'dwp-head' },
          h('span', { className: 'dwp-title' }, 'DSH 插件周榜'),
          h('span', { className: 'dwp-hint' }, data === null ? '只读 · 数据来自 GitHub Pages' : '只读 · 不遮挡对话'),
        ),
        body,
        h('div', { className: 'dwp-links' },
          h('a', { className: 'dwp-link', href: SITE_URL, target: '_blank', rel: 'noopener noreferrer', title: SITE_URL }, '打开完整榜单'),
          h('a', { className: 'dwp-link', href: SPONSOR_URL, target: '_blank', rel: 'noopener noreferrer', title: SPONSOR_URL }, '商务合作'),
        ),
      );

      // 中间主列模式：只要内容、不要按钮、不要浮层（流内布局，天然不遮挡对话）
      if (mainMode) return h('div', { className: 'dwp-entry dwp-main' }, panel);

      return h('div', { className: 'dwp-entry' + (wide ? '' : ' is-rail is-float') }, panel, button);
    }

    /* ============================ 插件体 ============================ */
    /**
     * 取一个 Cordis 服务，尽量不失败。
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
     * 切到自己的中间面板。任何异常都吞掉并返回 false——
     * 调用方据 true/false 分岔：false 时回落到旧抽屉（降级路径）。
     */
    function selectPanel(ctx, key) {
      try {
        if (typeof (ctx && ctx.layout && ctx.layout.selectPanel) === 'function') {
          ctx.layout.selectPanel(key);
          return true;
        }
      } catch (err) { /* 降级 */ }
      return false;
    }

    /** 中间主列里的内容：同一套 WeeklyPanel，强制展开态、去掉按钮与浮层样式。 */
    function MainContent() {
      return h(WeeklyPanel, { main: true });
    }

    /** 侧边栏图标行的格子：size/active 由宿主给，点击双保险（宿主会切，我们再切一次）。 */
    function PanelIcon(props) {
      var size = (props && props.size) || 28;
      var active = !!(props && props.active);
      return h('button', {
        type: 'button',
        title: '周榜' + (active ? '（当前面板）' : ''),
        'aria-label': 'DSH 插件周榜',
        onClick: function () { selectPanel(CTX, PANEL_KEY); },
        style: {
          width: size + 'px', height: size + 'px', display: 'inline-flex', alignItems: 'center',
          justifyContent: 'center', borderRadius: '8px', cursor: 'pointer', fontSize: Math.round(size * 0.55) + 'px',
          lineHeight: 1, padding: 0, fontFamily: 'inherit',
          border: '1px solid ' + (active ? 'var(--dwp-accent,#3b82f6)' : 'transparent'),
          background: active ? 'rgba(59,130,246,.16)' : 'transparent',
          color: 'inherit', transition: 'background .12s ease,border-color .12s ease',
        },
      }, '📊');
    }

    /** apply 里捕获的插件 ctx（图标点击要拿它切面板）。 */
    var CTX = null;

    function apply(ctx) {
      try {
        var slots = resolveService(ctx, 'slots');
        if (slots === undefined || slots === null) return;
        ensureStyle();
        CTX = ctx;

        // 1) 保底入口：侧边栏底部按钮（点击时优先切中间面板，切不动才开抽屉）
        slots.inject(SLOT, function () {
          return slots.register(
            { name: SLOT, id: ENTRY_ID, order: ENTRY_ORDER, label: '周榜' },
            WeeklyPanel,
          );
        });

        // 2) 中间主列面板（框架 keyed 槽；key 与图标行 id 同值）
        slots.inject(MAIN_SLOT, function () {
          return slots.register(
            { name: MAIN_SLOT, key: PANEL_KEY },
            MainContent,
          );
        });

        // 3) 侧边栏图标行（list 槽；id 必须等于 main 的 key，"Each list id addresses the matching main panel"）
        slots.inject(PANEL_SLOT, function () {
          return slots.register(
            { name: PANEL_SLOT, id: PANEL_KEY, order: PANEL_ORDER, label: ENTRY_LABEL },
            PanelIcon,
          );
        });
      } catch (err) {
        var logger = ctx && ctx.logger;
        var sink = (logger && logger.warn) || (typeof console !== 'undefined' ? console.warn : null);
        if (sink) sink.call(logger || console, '[dsh-weekly-panel] 注册失败，已跳过：', err);
      }
    }

    exports.name = 'dsh-weekly-panel';
    exports.inject = ['slots'];
    exports.apply = apply;
    return module.exports;
  },
});
