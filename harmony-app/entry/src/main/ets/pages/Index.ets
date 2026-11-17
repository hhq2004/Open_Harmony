import { util } from '@kit.ArkTS';
import { systemDateTime } from '@kit.BasicServicesKit';
import { AppVisitCollector, DEMO_PAGES } from '../core/application/visit-collector';
import { AppVisitIntegration } from '../core/application/visit-integration';
import { createPredictionEngine } from '../core/prediction/index';
import { predictionProfile } from '../core/prediction-profile';
import type { SessionDecision } from '../core/prediction/index';
import { demoController, demoPageText, demoPreparedText, demoScheduler, demoViewPreparer } from './DemoPreload';
import type { DemoPageData } from './DemoPreload';
import { demoMeasurements } from './DemoMeasurement';

function pageLabel(page: string): string {
  if (page === 'home') return '首页';
  if (page === 'detail') return '详情页';
  if (page === 'cart') return '清单页';
  return '个人页';
}

let sessionSequence = 0;

function freshSessionId(): string {
  // The previewer mocks UUID generation. A local counter still makes each session distinct;
  // on a device the first 24 hex digits come from the secure UUID generator.
  const randomHex = util.generateRandomUUID(false).toLowerCase().replace(/[^0-9a-f]/g, '');
  const prefix = randomHex.slice(0, 24).padEnd(24, '0');
  const suffix = (++sessionSequence).toString(16).padStart(8, '0').slice(-8);
  return `s-${prefix}${suffix}`;
}

const engine = createPredictionEngine(DEMO_PAGES, predictionProfile);
const collector = new AppVisitCollector(engine.session, {
  allowedPages: DEMO_PAGES,
  createSessionId: freshSessionId,
});
const app = new AppVisitIntegration<DemoPageData>(collector, demoController, demoScheduler,
  (pageId: string) => DEMO_PAGES.some(page => page === pageId) ? { pageId, dataKey: pageId } : undefined);

@Entry
@Component
struct Index {
  @State private collectionEnabled: boolean = false;
  @State private currentPage: string = 'home';
  @State private pageContent: string = '首页静态内容';
  @State private predictionText: string = '采集未启用';
  @State private preloadText: string = '静态数据预取未启用';
  @State private trace: string[] = [];
  @State private viewText: string = '准备模型未启用';
  @State private measurementText: string = '演示记录 0 次';
  @State private measurementLines: string[] = [];
  @State private showMeasurements: boolean = false;
  @State private showTechnicalNotes: boolean = false;
  @State private showcaseBusy: boolean = false;
  @State private guideText: string = '点击下方按钮，观看一次完整的预测命中。';
  @State private outcomeText: string = '等待访问';
  @State private outcomeColor: string = '#47627F';
  @State private predictedPage: string = '';
  @State private preparedPage: string = '';
  @State private visitCount: number = 0;
  @State private reuseCount: number = 0;
  @State private releasedCount: number = 0;
  private lastCandidates: string[] = [];
  private readyTasks: Set<string> = new Set<string>();
  private prefetchedBytesSinceVisit: number = 0;
  private showcaseEpoch: number = 0;
  private unsubscribe: (() => void) | null = null;

  aboutToAppear(): void {
    app.setEnabled(false);
    this.collectionEnabled = false;
    this.currentPage = 'home';
    this.pageContent = demoPageText('home');
    this.predictionText = '采集未启用';
    this.preloadText = '静态数据预取未启用';
    this.trace = [];
    this.lastCandidates = [];
    this.readyTasks.clear();
    this.prefetchedBytesSinceVisit = 0;
    this.viewText = '准备模型未启用';
    demoMeasurements.reset();
    this.measurementText = demoMeasurements.summary();
    this.measurementLines = [];
    this.showTechnicalNotes = false;
    this.showcaseBusy = false;
    this.guideText = '点击下方按钮，观看一次完整的预测命中。';
    this.outcomeText = '等待访问';
    this.outcomeColor = '#47627F';
    this.predictedPage = '';
    this.preparedPage = '';
    this.visitCount = 0;
    this.reuseCount = 0;
    this.releasedCount = demoViewPreparer.stats().releasedViews;
    this.unsubscribe = demoScheduler.subscribe(task => {
      if (!this.collectionEnabled) return;
      if (task.state === 'data-ready') {
        if (!this.readyTasks.has(task.request.taskId)) {
          this.readyTasks.add(task.request.taskId);
          this.prefetchedBytesSinceVisit += task.byteLength;
        }
        this.preloadText = `已准备${pageLabel(task.request.pageId)}静态数据`;
        this.viewText = task.viewReady ? `已准备${pageLabel(task.request.pageId)}渲染模型` : '准备模型未就绪';
        if (task.viewReady) this.preparedPage = task.request.pageId;
      }
      if (task.state === 'cancelled') {
        this.preloadText = '上一轮预取已取消';
        this.viewText = `已释放准备资源 ${demoViewPreparer.stats().releasedViews} 次`;
        if (this.preparedPage === task.request.pageId) this.preparedPage = '';
        this.releasedCount = demoViewPreparer.stats().releasedViews;
      }
      if (task.state === 'failed') {
        this.preloadText = '预取失败，页面正常加载';
        this.viewText = '准备模型失败';
        if (this.preparedPage === task.request.pageId) this.preparedPage = '';
      }
    });
  }

  aboutToDisappear(): void {
    this.showcaseEpoch += 1;
    this.showcaseBusy = false;
    if (this.unsubscribe !== null) this.unsubscribe();
    this.unsubscribe = null;
    app.setEnabled(false);
    this.viewText = `准备资源已释放 ${demoViewPreparer.stats().releasedViews} 次`;
  }

  onPageHide(): void {
    this.showcaseEpoch += 1;
    this.showcaseBusy = false;
    app.setEnvironment({ idle: false, foregroundBusy: false, memoryPressure: false });
    app.startNewSession();
    this.trace = [];
    this.lastCandidates = [];
    this.predictedPage = '';
    this.preparedPage = '';
    this.readyTasks.clear();
    this.prefetchedBytesSinceVisit = 0;
    this.predictionText = '页面恢复后将开始新路径';
    this.preloadText = '页面隐藏，预取已停止';
  }

  onPageShow(): void {
    if (this.collectionEnabled) this.recordCurrent();
  }

  private recordCurrent(clickedAtMs?: number): void {
    try {
      const previousCandidates = this.lastCandidates.slice();
      const prefetchedBytes = this.prefetchedBytesSinceVisit;
      const result = app.visit(this.currentPage, systemDateTime.getUptime(systemDateTime.TimeType.STARTUP));
      const decision: SessionDecision | null = result.decision;
      if (decision === null || decision.status !== 'accepted') return;
      this.readyTasks.clear();
      this.prefetchedBytesSinceVisit = 0;
      const reusedBytes = result.prepared?.data.byteLength ?? 0;
      const viewReused = result.prepared?.view !== undefined;
      this.visitCount += 1;
      if (result.prepared) {
        this.pageContent = result.prepared.view === undefined ? result.prepared.data.value.text :
          demoPreparedText(result.prepared.view);
        this.preloadText = `已复用${pageLabel(this.currentPage)}静态数据`;
        this.viewText = result.prepared.view === undefined ? '准备模型未命中' : `已复用${pageLabel(this.currentPage)}准备模型`;
        result.prepared.dispose();
        if (viewReused) this.reuseCount += 1;
        this.outcomeText = viewReused ? `命中：直接复用${pageLabel(this.currentPage)}准备模型` :
          `命中：复用${pageLabel(this.currentPage)}静态数据`;
        this.outcomeColor = '#157A52';
      } else {
        this.pageContent = demoPageText(this.currentPage);
        this.preloadText = '本次页面正常加载；可手动模拟空闲';
        this.viewText = '本次没有可复用的准备模型';
        this.outcomeText = previousCandidates.includes(this.currentPage) ? '预测正确，但本次未准备完成' :
          previousCandidates.length > 0 ? '预测落空：正常加载当前页' : '普通加载：正在积累访问历史';
        this.outcomeColor = previousCandidates.length > 0 ? '#B45B29' : '#47627F';
      }
      this.preparedPage = '';
      this.releasedCount = demoViewPreparer.stats().releasedViews;
      this.trace = [`${pageLabel(this.currentPage)} · ${decision.boundary === 'consecutive' ? '连续访问' : '新路径起点'}`,
        ...this.trace].slice(0, 20);
      this.predictionText = decision.candidates.length === 0 ? '暂无足够历史，暂不预测' :
        decision.candidates.map(candidate => `${pageLabel(candidate.pageId)} ${(candidate.probability * 100).toFixed(1)}%`).join('、');
      this.lastCandidates = decision.candidates.map(candidate => candidate.pageId);
      this.predictedPage = this.lastCandidates[0] ?? '';
      if (clickedAtMs !== undefined) {
        demoMeasurements.record(this.currentPage, clickedAtMs,
          systemDateTime.getUptime(systemDateTime.TimeType.STARTUP), previousCandidates,
          viewReused, prefetchedBytes, Math.max(0, prefetchedBytes - reusedBytes),
          decision.boundary ?? 'unknown');
        this.measurementText = demoMeasurements.summary();
        this.measurementLines = demoMeasurements.lines();
      }
    } catch {
      this.predictionText = '本次事件已拒绝；页面仍可继续访问';
    }
  }

  private toggleCollection(): void {
    app.setEnabled(!this.collectionEnabled);
    this.collectionEnabled = !this.collectionEnabled;
    this.trace = [];
    this.lastCandidates = [];
    this.predictedPage = '';
    this.preparedPage = '';
    this.readyTasks.clear();
    this.prefetchedBytesSinceVisit = 0;
    this.predictionText = this.collectionEnabled ? '等待首条访问' : '采集未启用';
    this.preloadText = this.collectionEnabled ? '等待候选与空闲信号' : '静态数据预取未启用';
    this.viewText = this.collectionEnabled ? '等待准备模型' : '准备模型未启用';
    this.outcomeText = this.collectionEnabled ? '普通加载：正在积累访问历史' : '采集关闭';
    this.outcomeColor = '#47627F';
    if (this.collectionEnabled) this.recordCurrent();
  }

  private navigate(page: string): void {
    if (page === this.currentPage) return;
    const clickedAtMs = systemDateTime.getUptime(systemDateTime.TimeType.STARTUP);
    this.currentPage = page;
    if (this.collectionEnabled) this.recordCurrent(clickedAtMs);
    else this.pageContent = demoPageText(page);
  }

  private clearHistory(): void {
    app.clear();
    this.lastCandidates = [];
    this.predictedPage = '';
    this.preparedPage = '';
    this.readyTasks.clear();
    this.prefetchedBytesSinceVisit = 0;
    this.trace = [];
    this.predictionText = this.collectionEnabled ? '历史已清除，等待新路径' : '采集未启用';
    this.preloadText = this.collectionEnabled ? '预测历史与后台任务已清除' : '静态数据预取未启用';
    this.viewText = `已释放准备资源 ${demoViewPreparer.stats().releasedViews} 次`;
    this.releasedCount = demoViewPreparer.stats().releasedViews;
    this.outcomeText = '历史已清除，等待新路径';
    this.outcomeColor = '#47627F';
  }

  private simulateIdle(): void {
    if (!this.collectionEnabled) return;
    app.setEnvironment({ idle: true, foregroundBusy: false, memoryPressure: false });
    this.preloadText = '演示空闲信号已送入调度器';
  }

  private pause(ms: number): Promise<void> {
    return new Promise<void>((resolve) => { setTimeout(() => resolve(), ms); });
  }

  /** Fixed local path for explaining the existing A→B→C→D→E handoff. */
  private async runShowcase(): Promise<void> {
    if (this.showcaseBusy) return;
    this.showcaseBusy = true;
    const epoch = ++this.showcaseEpoch;
    try {
      app.setEnabled(false);
      app.clear();
      app.setEnabled(true);
      this.collectionEnabled = true;
      demoMeasurements.reset();
      this.measurementText = demoMeasurements.summary();
      this.measurementLines = [];
      this.trace = [];
      this.lastCandidates = [];
      this.predictedPage = '';
      this.preparedPage = '';
      this.readyTasks.clear();
      this.prefetchedBytesSinceVisit = 0;
      this.visitCount = 0;
      this.reuseCount = 0;
      this.currentPage = 'home';
      this.pageContent = demoPageText('home');
      this.guideText = '第 1 步：A 记录首页访问；B 尚无足够路径。';
      this.recordCurrent();
      await this.pause(700);
      if (epoch !== this.showcaseEpoch) return;
      this.navigate('detail');
      this.guideText = '第 2 步：访问详情页，学习“首页 → 详情页”。';
      await this.pause(700);
      if (epoch !== this.showcaseEpoch) return;
      this.navigate('home');
      this.guideText = '第 3 步：返回首页，B 预测下一页是详情页。';
      await this.pause(850);
      if (epoch !== this.showcaseEpoch) return;
      this.simulateIdle();
      this.guideText = '第 4 步：模拟空闲，C 预取数据，D 准备渲染模型。';
      await this.pause(950);
      if (epoch !== this.showcaseEpoch) return;
      this.navigate('detail');
      this.guideText = this.outcomeColor === '#157A52' ?
        '第 5 步：预测命中！页面复用准备结果，E 已记录本次操作。' :
        '第 5 步：已访问详情页；若准备未完成，页面自动使用普通加载。';
    } catch {
      this.guideText = '演示中断；可再次点击按钮重新开始。';
    } finally {
      if (epoch === this.showcaseEpoch) this.showcaseBusy = false;
    }
  }

  build() {
    Scroll() {
      Column({ space: 16 }) {
        Column({ space: 8 }) {
          Text('P07 · A / B / C / D / E').fontSize(13).fontColor('#A9D6FF')
          Text('预测下一页，提前做好准备').fontSize(25).fontWeight(FontWeight.Bold).fontColor('#FFFFFF')
          Text('固定路径演示 · 观察一次预测怎样变成页面复用').fontSize(13).fontColor('#D9E8FA')
        }
        .alignItems(HorizontalAlign.Start)
        .width('100%')
        .padding(20)
        .backgroundColor('#153B66')
        .borderRadius(18)

        Column({ space: 12 }) {
          Row({ space: 8 }) {
            Text('本次结果').fontSize(13).fontColor('#52667D')
            Text(this.collectionEnabled ? '匿名采集已开启' : '匿名采集默认关闭')
              .fontSize(12).fontColor(this.collectionEnabled ? '#157A52' : '#7C8897')
          }
          .width('100%')
          .justifyContent(FlexAlign.SpaceBetween)
          Text(this.outcomeText).fontSize(20).fontWeight(FontWeight.Bold).fontColor(this.outcomeColor)
          Text(this.guideText).fontSize(14).fontColor('#394F68')
          Row({ space: 8 }) {
            Column({ space: 4 }) {
              Text(`${this.visitCount}`).fontSize(22).fontWeight(FontWeight.Bold).fontColor('#1D4E82')
              Text('访问记录').fontSize(11).fontColor('#60748B')
            }.width('31%').padding(10).backgroundColor('#F1F6FC').borderRadius(10)
            Column({ space: 4 }) {
              Text(`${this.reuseCount}`).fontSize(22).fontWeight(FontWeight.Bold).fontColor('#157A52')
              Text('模型复用').fontSize(11).fontColor('#60748B')
            }.width('31%').padding(10).backgroundColor('#EDF9F2').borderRadius(10)
            Column({ space: 4 }) {
              Text(`${this.releasedCount}`).fontSize(22).fontWeight(FontWeight.Bold).fontColor('#B45B29')
              Text('资源释放').fontSize(11).fontColor('#60748B')
            }.width('31%').padding(10).backgroundColor('#FFF5ED').borderRadius(10)
          }.width('100%')
        }
        .alignItems(HorizontalAlign.Start)
        .width('100%')
        .padding(16)
        .backgroundColor('#FFFFFF')
        .borderRadius(16)

        Button(this.showcaseBusy ? '演示进行中…' : '▶ 一键展示预测命中')
          .width('100%')
          .height(48)
          .backgroundColor('#2768C4')
          .enabled(!this.showcaseBusy)
          .onClick(() => { void this.runShowcase(); })
        Text('演示会重置当前历史，并自动走完：首页 → 详情页 → 首页 → 空闲准备 → 详情页。')
          .fontSize(12).fontColor('#6A7C90')

        Column({ space: 10 }) {
          Text('手动体验').fontSize(18).fontWeight(FontWeight.Bold).fontColor('#1C334E')
          Row({ space: 8 }) {
            Button(this.collectionEnabled ? '关闭采集' : '开启采集')
              .width('48%').backgroundColor('#E4EDF9').fontColor('#1F5DA8')
              .enabled(!this.showcaseBusy).onClick(() => this.toggleCollection())
            Button('清除历史')
              .width('48%').backgroundColor('#E4EDF9').fontColor('#1F5DA8')
              .enabled(!this.showcaseBusy).onClick(() => this.clearHistory())
          }
          Row({ space: 6 }) {
            ForEach(DEMO_PAGES.slice(), (page: string) => {
              Button(pageLabel(page))
                .fontSize(12)
                .width('23%')
                .backgroundColor(page === this.currentPage ? '#2768C4' : '#EDF3FA')
                .fontColor(page === this.currentPage ? '#FFFFFF' : '#2D557E')
                .enabled(!this.showcaseBusy)
                .onClick(() => this.navigate(page))
            }, (page: string) => page)
          }.width('100%')
          Button('模拟空闲 · 准备预测候选')
            .width('100%').backgroundColor('#DFF3E8').fontColor('#157A52')
            .enabled(this.collectionEnabled && !this.showcaseBusy)
            .onClick(() => this.simulateIdle())
        }
        .alignItems(HorizontalAlign.Start)
        .width('100%')
        .padding(16)
        .backgroundColor('#FFFFFF')
        .borderRadius(16)

        Column({ space: 10 }) {
          Text('此刻发生了什么').fontSize(18).fontWeight(FontWeight.Bold).fontColor('#1C334E')
          Text(`A · 访问采集     当前在${pageLabel(this.currentPage)}，已记录 ${this.visitCount} 次访问`)
            .fontSize(14).fontColor('#355678')
          Text(`B · 路径预测     ${this.predictedPage === '' ? '仍在学习访问路径' :
            `下一页可能是${pageLabel(this.predictedPage)}`}`)
            .fontSize(14).fontColor('#355678')
          Text(`C · 数据预取     ${this.preloadText}`).fontSize(14).fontColor('#355678')
          Text(`D · 模型准备     ${this.viewText}`).fontSize(14).fontColor('#355678')
          Text(`E · 演示测量     ${this.measurementText}`).fontSize(14).fontColor('#355678')
          if (this.preparedPage !== '') {
            Text(`● ${pageLabel(this.preparedPage)}已在后台准备，点击它可观察复用`)
              .fontSize(13).fontColor('#157A52')
          }
        }
        .alignItems(HorizontalAlign.Start)
        .width('100%')
        .padding(16)
        .backgroundColor('#FFFFFF')
        .borderRadius(16)

        Column({ space: 9 }) {
          Text('两条页面处理路径').fontSize(18).fontWeight(FontWeight.Bold).fontColor('#1C334E')
          Text('普通访问').fontSize(13).fontColor('#7D5E32')
          Text('点击 → 取数据 → 准备内容 → 展示').fontSize(14).fontColor('#805B2D')
            .width('100%').padding(12).backgroundColor('#FFF4E7').borderRadius(10)
          Text('预测命中').fontSize(13).fontColor('#157A52')
          Text('空闲时预取并准备 → 点击 → 直接复用 → 展示').fontSize(14).fontColor('#157A52')
            .width('100%').padding(12).backgroundColor('#EAF8EF').borderRadius(10)
          Text(`当前展示：${this.pageContent}`).fontSize(14).fontColor('#344E68')
        }
        .alignItems(HorizontalAlign.Start)
        .width('100%')
        .padding(16)
        .backgroundColor('#FFFFFF')
        .borderRadius(16)

        Button(this.showMeasurements ? '收起 E 的原始记录' : '查看 E 的原始记录')
          .width('100%').backgroundColor('#E4EDF9').fontColor('#1F5DA8')
          .onClick(() => this.showMeasurements = !this.showMeasurements)
        if (this.showMeasurements) {
          Column({ space: 8 }) {
            ForEach(this.measurementLines, (line: string) => {
              Text(line).fontSize(10).fontColor('#41506A')
            }, (line: string, index: number) => `${index}-${line}`)
          }.width('100%').padding(12).backgroundColor('#FFFFFF').borderRadius(10)
        }
        Button(this.showTechnicalNotes ? '收起演示说明' : '查看演示说明')
          .width('100%').backgroundColor('#EDF3FA').fontColor('#546C86')
          .onClick(() => this.showTechnicalNotes = !this.showTechnicalNotes)
        if (this.showTechnicalNotes) {
          Column({ space: 7 }) {
            Text('本演示使用固定页面别名、静态内存数据和手动空闲信号。').fontSize(12).fontColor('#60748B')
            Text('D 准备文本渲染模型；ArkUI 原生节点仍由页面创建。').fontSize(12).fontColor('#60748B')
            Text('E 的时间是状态更新时刻，数据标为 synthetic，不代表设备性能。').fontSize(12).fontColor('#60748B')
            Text('采集默认关闭；不读取账号和设备标识，也不上传或持久保存。').fontSize(12).fontColor('#60748B')
            Text(`候选详情：${this.predictionText}`).fontSize(12).fontColor('#60748B')
            ForEach(this.trace, (entry: string) => {
              Text(entry).fontSize(12).fontColor('#60748B')
            }, (entry: string, index: number) => `${index}-${entry}`)
          }.alignItems(HorizontalAlign.Start).width('100%').padding(12)
        }
      }
      .alignItems(HorizontalAlign.Start)
      .padding(16)
      .width('100%')
      .backgroundColor('#F1F5FA')
    }
    .width('100%')
    .height('100%')
  }
}
