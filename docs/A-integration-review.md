# A 模块接口交接与集成记录

状态：A 的主机侧接入实现与自测已完成；本记录供 B/C/D/E 成员确认，不代表其他成员已签字验收。代码基线：`main` 的 `2fdd90f` 加本地未提交 A 工作树。

## 交接顺序

1. A 仅用固定页面别名生成 `VisitEvent`，会话 ID 为本次进程内随机值，时间来自单调时钟；不把 URL、账号、设备标识或正文交给 B。
2. `AppVisitCollector.visit()` 对一次真实访问只调用 `SessionPredictor.acceptDetailed()` 一次；B 返回边界、完成的转移和下一页候选。A 不再直接调用模型 `observe()`。
3. `AppVisitIntegration.visit()` 在导航开始将 C 环境标记为前台忙；若 B 返回乱序则不提交 C。会话间隔、淘汰、关闭、页面隐藏和清除时，让 C 结束对应任务。
4. A 用 `{pageId, dataKey}` 表示实际页面与候选。当前浏览器演示的四页内容固定，故 `dataKey=pageId`；真实详情页若有动态内容，必须在预测时有可确定的脱敏内容键，否则跳过预取。候选优先级按排名映射为 `-rank`，较大值优先。
5. C 的 `PredictionPreloadController.visit()` 先核对上一轮实际访问并 `take()` 或取消，再提交新的最高优先级候选。取出的 bundle 所有权交页面，页面用完后调用一次 `dispose()`；该方法重复调用安全。
6. C 与 D 的主机侧适配测试已覆盖数据/视图所有权和取消后晚到释放。实际 ArkUI 视图构建器、生命周期与设备资源预算仍需平台联调。E 的设备测量不能使用浏览器静态数据代替。

## 已固定的接口约定

| 接口 | 提供方 → 使用方 | A 的处理 | 验证 |
| --- | --- | --- | --- |
| `VisitEvent` / `acceptDetailed` | A → B | 固定别名、匿名会话、单调时间；每次访问调用一次 | `tests/visit-collector.test.mjs` |
| `SessionDecision` | B → A | 仅 `accepted` 进入 C；gap/evictedSessionId 结束 C 旧会话 | `tests/visit-integration.test.mjs` |
| `PreloadTarget` / `PredictionPreloadController` | A → C | 固定内容键、排名优先级、前台先于新投机任务 | 同上及 `tests/preload.test.mjs` |
| `PreparedPreload.dispose()` | C → A | 页面接管数据与视图所有权；释放时只调用 bundle 的 dispose | `tests/visit-integration.test.mjs`、`tests/preload-preparation.test.mjs` |
| `DataViewPreparer` | D → C | A 不直接管理 C 所借用的 D 视图 | `tests/preload-preparation.test.mjs` 的主机适配 |
| `MeasurementSink` | A/C/D → E | 设备点击、可见、交互时间与任务状态需同一单调时钟关联 | 设备适配待完成 |

## 需团队确认并完成的平台工作

- A/C：确定 OpenHarmony 设备或模拟器及页面真实数据源；SDK 请求必须可取消且取消后最终结束。浏览器示例用静态内存数据，不构成目标平台的预取验收。
- A/C：由平台提供可靠的空闲、前台忙和内存压力信号；不能把定时器延迟直接当作空闲。导航开始先通知 C，页面稳定后再通知空闲。
- C/D：提供真实 ArkUI 视图构建与数据绑定适配器，确认任务 ID、内容键、缓存预算和取消后晚到资源的唯一持有者。
- A/E：确定设备端脱敏原始事件及测量数据的保存/删除策略；清除历史应清除 B/C 内存状态，已导出报告另按评测规则处理。
- B/C/D/E：在目标设备复核开关、冷启动、连续访问、预测命中、落空、请求失败、取消、过期和内存压力；保存原始日志与构建版本。

## 当前可复现结果

`npm run pipeline` 覆盖 A→B→C 的匿名会话、预取移交、关闭、清除和非法路由；`npm run demo` 可在浏览器中观察“首页 → 详情页 → 首页 → 详情页”的候选与静态数据复用。`npm run build:harmony` 只验证 A/B ArkTS 工程可编译，尚未验证 C/D/E 目标平台适配或设备运行。
