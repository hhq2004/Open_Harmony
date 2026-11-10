import { AppVisitCollector, DEMO_PAGES } from '/dist/application/visit-collector.js';
import { AppVisitIntegration } from '/dist/application/visit-integration.js';
import { createPredictionEngine } from '/dist/prediction/index.js';
import { DataPreloadScheduler, PredictionPreloadController } from '/dist/preload/index.js';

const descriptions = {
  home: ['首页', '从首页浏览热点内容，再进入详情。'],
  detail: ['详情页', '查看内容详情，决定返回或加入清单。'],
  cart: ['清单页', '模拟用户查看已收藏的内容。'],
  profile: ['个人页', '只展示固定页面；不读取任何真实账户资料。'],
};

const toggle = document.querySelector('#collection-toggle');
const clearButton = document.querySelector('#clear-history');
const nav = document.querySelector('#page-nav');
const title = document.querySelector('#page-title');
const description = document.querySelector('#page-description');
const status = document.querySelector('#prediction-status');
const predictions = document.querySelector('#predictions');
const preloadStatus = document.querySelector('#preload-status');
const traceList = document.querySelector('#visit-trace');

let currentPage = 'home';
let currentDescription = descriptions.home[1];
let lastDecision = null;
let preloadText = '数据预取未启用';
let trace = [];
let idleGeneration = 0;

try {
  const response = await fetch('/config/prediction.json');
  if (!response.ok) throw new Error('配置加载失败');
  const profile = await response.json();
  const engine = createPredictionEngine(DEMO_PAGES, profile);
  const collector = new AppVisitCollector(engine.session, {
    allowedPages: DEMO_PAGES,
    createSessionId: () => `s-${crypto.randomUUID().replaceAll('-', '')}`,
  });
  const fetcher = {
    start(request) {
      const [label, body] = descriptions[request.pageId];
      return {
        result: Promise.resolve({
          value: { label, body },
          byteLength: new TextEncoder().encode(body).byteLength,
          dispose() {},
        }),
        cancel() {},
      };
    },
  };
  const runtime = {
    now: () => performance.now(),
    schedule(callback, delayMs) {
      const handle = setTimeout(callback, delayMs);
      return () => clearTimeout(handle);
    },
  };
  const scheduler = new DataPreloadScheduler(fetcher, runtime, {
    maxTasks: 4, maxBytes: 4096, ttlMs: 5000,
  });
  const controller = new PredictionPreloadController(scheduler);
  const app = new AppVisitIntegration(collector, controller, scheduler,
    pageId => DEMO_PAGES.includes(pageId) ? { pageId, dataKey: pageId } : undefined);

  scheduler.subscribe(task => {
    if (!app.getState().enabled) return;
    if (task.state === 'data-ready') preloadStatus.textContent = `${preloadText}；已准备${descriptions[task.request.pageId][0]}的静态数据`;
    if (task.state === 'cancelled') preloadStatus.textContent = `${preloadText}；上一轮预取已取消`;
    if (task.state === 'failed') preloadStatus.textContent = `${preloadText}；预取失败，页面仍可正常加载`;
  });

  function scheduleIdle() {
    const generation = ++idleGeneration;
    if (typeof requestIdleCallback !== 'function') {
      preloadStatus.textContent = '浏览器未提供空闲回调，当前不会启动预取';
      return;
    }
    requestIdleCallback(() => {
      if (generation !== idleGeneration || document.hidden || !app.getState().enabled) return;
      app.setEnvironment({ idle: true, foregroundBusy: false, memoryPressure: false });
    });
  }

  function recordPage() {
    const result = app.visit(currentPage, performance.now());
    lastDecision = result.decision;
    currentDescription = descriptions[currentPage][1];
    if (result.prepared) {
      currentDescription = result.prepared.data.value.body;
      preloadText = `已复用${descriptions[currentPage][0]}的预取数据`;
      result.prepared.dispose();
    } else {
      preloadText = lastDecision?.candidates.length ? '候选数据等待浏览器空闲时准备' : '本次页面正常加载';
    }
    if (lastDecision?.status === 'accepted') {
      trace.unshift(`${currentPage} · ${lastDecision.boundary === 'consecutive' ? '连续访问' : '新路径起点'}`);
      trace = trace.slice(0, 20);
    }
  }

  function render() {
    title.textContent = descriptions[currentPage][0];
    description.textContent = currentDescription;
    nav.replaceChildren();
    for (const page of DEMO_PAGES) {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = descriptions[page][0];
      button.className = page === currentPage ? 'active' : '';
      button.setAttribute('aria-current', page === currentPage ? 'page' : 'false');
      button.addEventListener('click', () => {
        if (page === currentPage) return;
        currentPage = page;
        if (app.getState().enabled) recordPage();
        else currentDescription = descriptions[page][1];
        render();
        if (app.getState().enabled) scheduleIdle();
      });
      nav.append(button);
    }
    status.textContent = !app.getState().enabled ? '采集未启用' :
      lastDecision?.candidates.length ? '当前候选' : '暂无足够历史，暂不预测';
    predictions.replaceChildren();
    for (const candidate of lastDecision?.candidates ?? []) {
      const item = document.createElement('li');
      item.textContent = `${descriptions[candidate.pageId][0]} · ${(candidate.probability * 100).toFixed(1)}%`;
      predictions.append(item);
    }
    preloadStatus.textContent = preloadText;
    traceList.replaceChildren();
    for (const entry of trace) {
      const item = document.createElement('li');
      item.textContent = entry;
      traceList.append(item);
    }
  }

  toggle.addEventListener('change', () => {
    ++idleGeneration;
    app.setEnabled(toggle.checked);
    trace = [];
    lastDecision = null;
    preloadText = toggle.checked ? '等待首条访问' : '数据预取未启用';
    if (toggle.checked) recordPage();
    render();
    if (toggle.checked) scheduleIdle();
  });
  clearButton.addEventListener('click', () => {
    ++idleGeneration;
    app.clear();
    trace = [];
    lastDecision = null;
    preloadText = app.getState().enabled ? '历史与后台任务已清除' : '数据预取未启用';
    render();
  });
  document.addEventListener('visibilitychange', () => {
    ++idleGeneration;
    if (document.hidden) {
      app.setEnvironment({ idle: false, foregroundBusy: false, memoryPressure: false });
      app.startNewSession();
      lastDecision = null;
      trace = [];
      preloadText = '页面恢复后开始新路径';
    } else if (app.getState().enabled) {
      recordPage();
      scheduleIdle();
    }
    render();
  });
  render();
} catch (error) {
  toggle.disabled = true;
  clearButton.disabled = true;
  status.textContent = `演示初始化失败：${error instanceof Error ? error.message : '未知错误'}`;
}
