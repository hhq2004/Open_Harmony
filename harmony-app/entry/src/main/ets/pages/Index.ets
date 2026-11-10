import { util } from '@kit.ArkTS';
import { systemDateTime } from '@kit.BasicServicesKit';
import { AppVisitCollector, DEMO_PAGES } from '../core/application/visit-collector';
import { AppVisitIntegration } from '../core/application/visit-integration';
import { createPredictionEngine } from '../core/prediction/index';
import { predictionProfile } from '../core/prediction-profile';
import type { SessionDecision } from '../core/prediction/index';
import { demoController, demoPageText, demoScheduler } from './DemoPreload';
import type { DemoPageData } from './DemoPreload';

function pageLabel(page: string): string {
  if (page === 'home') return '首页';
  if (page === 'detail') return '详情页';
  if (page === 'cart') return '清单页';
  return '个人页';
}

function freshSessionId(): string {
  return `s-${util.generateRandomUUID(false).replace(/-/g, '')}`;
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
  private unsubscribe: (() => void) | null = null;

  aboutToAppear(): void {
    app.setEnabled(false);
    this.collectionEnabled = false;
    this.currentPage = 'home';
    this.pageContent = demoPageText('home');
    this.predictionText = '采集未启用';
    this.preloadText = '静态数据预取未启用';
    this.trace = [];
    this.unsubscribe = demoScheduler.subscribe(task => {
      if (!this.collectionEnabled) return;
      if (task.state === 'data-ready') this.preloadText = `已准备${pageLabel(task.request.pageId)}静态数据`;
      if (task.state === 'cancelled') this.preloadText = '上一轮预取已取消';
      if (task.state === 'failed') this.preloadText = '预取失败，页面正常加载';
    });
  }

  aboutToDisappear(): void {
    if (this.unsubscribe !== null) this.unsubscribe();
    this.unsubscribe = null;
    app.setEnabled(false);
  }

  onPageHide(): void {
    app.setEnvironment({ idle: false, foregroundBusy: false, memoryPressure: false });
    app.startNewSession();
    this.trace = [];
    this.predictionText = '页面恢复后将开始新路径';
    this.preloadText = '页面隐藏，预取已停止';
  }

  onPageShow(): void {
    if (this.collectionEnabled) this.recordCurrent();
  }

  private recordCurrent(): void {
    try {
      const result = app.visit(this.currentPage, systemDateTime.getUptime(systemDateTime.TimeType.STARTUP));
      const decision: SessionDecision | null = result.decision;
      if (decision === null || decision.status !== 'accepted') return;
      if (result.prepared) {
        this.pageContent = result.prepared.data.value.text;
        this.preloadText = `已复用${pageLabel(this.currentPage)}静态数据`;
        result.prepared.dispose();
      } else {
        this.pageContent = demoPageText(this.currentPage);
        this.preloadText = '本次页面正常加载；可手动模拟空闲';
      }
      this.trace = [`${pageLabel(this.currentPage)} · ${decision.boundary === 'consecutive' ? '连续访问' : '新路径起点'}`,
        ...this.trace].slice(0, 20);
      this.predictionText = decision.candidates.length === 0 ? '暂无足够历史，暂不预测' :
        decision.candidates.map(candidate => `${pageLabel(candidate.pageId)} ${(candidate.probability * 100).toFixed(1)}%`).join('、');
    } catch {
      this.predictionText = '本次事件已拒绝；页面仍可继续访问';
    }
  }

  private toggleCollection(): void {
    app.setEnabled(!this.collectionEnabled);
    this.collectionEnabled = !this.collectionEnabled;
    this.trace = [];
    this.predictionText = this.collectionEnabled ? '等待首条访问' : '采集未启用';
    this.preloadText = this.collectionEnabled ? '等待候选与空闲信号' : '静态数据预取未启用';
    if (this.collectionEnabled) this.recordCurrent();
  }

  private navigate(page: string): void {
    if (page === this.currentPage) return;
    this.currentPage = page;
    if (this.collectionEnabled) this.recordCurrent();
    else this.pageContent = demoPageText(page);
  }

  private clearHistory(): void {
    app.clear();
    this.trace = [];
    this.predictionText = this.collectionEnabled ? '历史已清除，等待新路径' : '采集未启用';
    this.preloadText = this.collectionEnabled ? '预测历史与后台任务已清除' : '静态数据预取未启用';
  }

  private simulateIdle(): void {
    if (!this.collectionEnabled) return;
    app.setEnvironment({ idle: true, foregroundBusy: false, memoryPressure: false });
    this.preloadText = '演示空闲信号已送入调度器';
  }

  build() {
    Scroll() {
      Column({ space: 18 }) {
        Text('P07 · A/B/C 集成演示').fontSize(14).fontColor('#3266C6')
        Text('页面访问路径').fontSize(30).fontWeight(FontWeight.Bold)
        Text('固定页面别名进入预测器，并可演示静态数据预取。').fontSize(15).fontColor('#627088')
        Button(this.collectionEnabled ? '关闭本次会话采集' : '启用本次会话采集')
          .onClick(() => this.toggleCollection())
        Button('清除预测历史').backgroundColor('#E8EEFA').fontColor('#1B376D')
          .onClick(() => this.clearHistory())
        Button('模拟空闲并准备候选数据').backgroundColor('#E8EEFA').fontColor('#1B376D')
          .onClick(() => this.simulateIdle())
        Text('空闲由按钮手动模拟；不代表已接入系统空闲信号或真实网络/视图。')
          .fontSize(12).fontColor('#627088')
        Text('默认关闭；不读取网址、账号或设备标识，不上传或持久保存。')
          .fontSize(12).fontColor('#627088')
        Text('演示页面').fontSize(20).fontWeight(FontWeight.Bold)
        Column({ space: 8 }) {
          ForEach(DEMO_PAGES.slice(), (page: string) => {
            Button(pageLabel(page))
              .width('100%')
              .backgroundColor(page === this.currentPage ? '#3266C6' : '#E8EEFA')
              .fontColor(page === this.currentPage ? '#FFFFFF' : '#1B376D')
              .onClick(() => this.navigate(page))
          }, (page: string) => page)
        }
        Text(`当前：${pageLabel(this.currentPage)}`).fontSize(22).fontWeight(FontWeight.Bold)
        Text(`演示内容：${this.pageContent}`).fontSize(15)
        Text(`下一页预测：${this.predictionText}`).fontSize(16)
        Text(`数据预取：${this.preloadText}`).fontSize(16)
        Text('分数为历史条件频率，不保证本次命中。').fontSize(12).fontColor('#627088')
        Text('本次界面事件（最近 20 条）').fontSize(20).fontWeight(FontWeight.Bold)
        ForEach(this.trace, (entry: string) => {
          Text(entry).fontSize(14).fontColor('#41506A')
        }, (entry: string, index: number) => `${index}-${entry}`)
      }
      .alignItems(HorizontalAlign.Start)
      .padding(24)
      .width('100%')
    }
    .width('100%')
    .height('100%')
  }
}
