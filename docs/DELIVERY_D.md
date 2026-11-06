# D 模块交付与合并说明（钟广申）

## 1. 交付身份与结论

- 负责人：钟广申。
- 分工：D「预渲染与资源管理」。
- 实现提交：`79cb2645f295db462155a13bd11c66ec616a319d`，提交主题为 `feat: add prerendered view resource lifecycle`。
- 开发基线：`afd31ce9c855827f09008807395bed4c0b49cb63`。提交前已 fetch 远端 `main`，当时没有新的远端提交。
- 交付状态：D 的主机侧 TypeScript 实现、模块测试、接口文档和完整 pipeline 验证已完成。OpenHarmony ArkUI、HAP 和设备/模拟器验证未运行，不将主机对象测试称为真机预渲染。

## 2. 本轮具体改了什么

| 文件 | 改动内容 | 合并时的作用 |
| --- | --- | --- |
| `src/preparation/view-preparer.ts` | 新增 `ResourceViewPreparer`、`ManagedPreparedView`、构建/取消/容量错误类型和默认配置 | D 的核心实现 |
| `src/preparation/index.ts` | 导出 D 的公共入口和类型 | A/C 从这里导入，不应深抄内部状态 |
| `tests/preparation.test.mjs` | 新增 15 项行为、异常和竞态测试 | 合并后回归验证 |
| `docs/preparation.md` | 模块设计、接口、所有权、顺序图、源码锚点和平台边界 | 设计审查与 A/C 接入依据 |
| `docs/DELIVERY_D.md` | 变更清单、验证证据和合并步骤 | 统一合并人的交接入口 |
| `README.md` | 更新当前基线、D 实现状态和文档入口 | 让项目首页反映真实进度 |

没有修改 `src/contracts.ts`、`package.json`、锁文件、B 的预测源码、A/C/E 的模块文件或 CI 配置。没有新增第三方运行依赖。`node_modules/`、`dist/`、`artifacts/` 都是本地生成物，未提交。

## 3. 对组长 D 要求的逐项回答

| 要求 | 实现位置 | 验证方式 |
| --- | --- | --- |
| 视图预构建 | `ResourceViewPreparer.prepare()` 调用注入的 `ViewBuilder`，成功结果才进入缓存 | 构建次数、重复任务、失败重试测试 |
| 一次真实视图复用 | `take(pageId)` 返回同一 `ManagedPreparedView`，`resource` 保持构建器原对象身份 | 对象引用严格相等、第二次取用返回 `undefined`、构建仅一次 |
| 一次预测落空释放 | `releaseAll('prediction-miss')`；同页新任务自动取消旧任务 | 两个缓存均释放且不能再次取用 |
| 取消后晚到资源释放 | 构建上下文持有取消信号；完成回调再次检查并先释放晚到资源 | 延迟 Promise 测试断言释放一次、Promise 取消拒绝、缓存为零 |
| 失效释放 | `take()` 惰性检查 TTL，`releaseExpired()` 主动清理 | 到期前可取用，到达 TTL 时释放 |
| 内存压力回收 | `releaseAll('memory-pressure')` 取消未决任务并释放缓存 | 已交前台资源存活，其他缓存和晚到资源释放 |

这里的“真实视图复用”指测试中实际创建的对象及其释放回调确实经过生产实现，不是只检查布尔标志或模拟返回状态；但它仍是主机侧测试适配器，不等价于 ArkUI 已完成布局、绘制和上屏。

## 4. 核心设计与接口约定

### 4.1 所有权

D 只拥有“待构建”和“已缓存、尚未取用”的视图。`take()` 成功后，视图所有权转给页面调用方：

- D 不再把它计入缓存容量，也不会因预测落空、内存压力或其他任务取消而释放它。
- 页面使用结束后必须调用 `dispose()`。
- `dispose()` 可重复调用，底层平台释放回调至多执行一次。
- 已释放后再读取 `resource` 会抛错，防止 use-after-free。

### 4.2 取消与竞态

- C 调用 `cancel(taskId, reason)`；公共 `ViewPreparer` 接口未改，`cancel()` 是 `ResourceViewPreparer` 的具体能力。
- 构建尚未开始时取消，会直接跳过平台构建。
- 构建进行中取消，Promise 以 `ViewPreparationCancelledError` 拒绝；调用方必须 `await/catch`。
- 平台构建器可以在异步边界检查 `signal.cancelled` 主动停止；即使构建器不协作，D 也会释放晚到结果。
- 同一 page 的新 task 替代旧 task。旧任务晚到不能覆盖或淘汰新任务。
- 同一未决 task 的重复 `prepare()` 返回同一 Promise，避免重复构建。

### 4.3 回收与配置

默认配置集中在 `DEFAULT_VIEW_PREPARER_OPTIONS`：最多 4 个缓存视图、估算总量 32 MiB、TTL 60 秒。它们只是开发默认值，不是课程指标或设备实测结论。

普通容量超限按“较低数值优先级 → 最久未使用 → taskId 字典序”淘汰。较大 `priority` 表示更重要，A/C 必须使用同一方向。单个视图超过总字节预算时释放新视图并抛出 `ViewCapacityError`，不会清空全部有效缓存。`estimatedBytes` 是适配器提供的记账估计，不是真实堆内存采样。

### 4.4 错误处理

- 构建失败原样传播并清理待构建索引，之后可显式重试。
- `releaseAll()` 尽力处理所有任务，一个释放失败不妨碍其他释放，最终以 `AggregateError` 报告。
- 非法请求、非法配置、非法资源大小和非法时钟均响亮失败，不静默返回成功。
- `getStats()` 提供待构建数、缓存数、缓存估算字节、释放数、晚到释放数、过期数和淘汰数。

完整调用示例与 Mermaid 顺序图见 [preparation.md](preparation.md)。

## 5. 测试与真实证据

验证环境为 Windows、Node.js 22.21.1、TypeScript 5.9.3。已运行完整 `scripts/pipeline.mjs`，结果如下：

| 阶段 | 结果 |
| --- | --- |
| 环境检查 | 通过；Node 22 符合仓库要求 |
| 严格类型检查 | 通过 |
| 干净编译 | 通过 |
| 单元测试 | 82/82 通过，其中 D 新增 15 项 |
| 合成路径回放 | 通过 |
| 路径策略对照 | 通过 |
| 事件策略对照 | 通过 |
| 参数批量对照 | 通过 |
| D 源码规范扫描 | 0 错误、0 警告 |

本地报告：`artifacts/pipeline/2026-11-05T10-42-02-333Z-5ed7c9d1/report.json`。报告和构建产物按仓库规则不提交 Git，合并人应在自己的环境重新生成，而不是寻找一个不存在的已提交报告文件。

D 的 15 项测试覆盖：对象身份复用、预测落空、构建期间取消晚到、构建前取消、TTL 边界、选择性过期、优先级/LRU、重复准备刷新 LRU、字节预算与超大资源、内存压力下的前台所有权、同页新旧竞态、重复任务去重、构建失败重试、释放异常聚合、非法输入。

## 6. 统一合并人的操作步骤

1. 获取包含本交付的提交，确认实现提交 `79cb264` 存在于历史中。

   ```powershell
   git log --oneline --decorate
   git show --stat 79cb264
   ```

2. 若在其他分支合并，使用团队约定的 merge 或 cherry-pick。不要只复制 `src/preparation/`；测试、文档和 README 应一起进入。

3. 本交付没有改公共契约和依赖文件。可能的文本冲突点是 `README.md` 的“当前开发基线”和“模块接入规则”：解决时保留其他成员新增的状态行，同时保留 D 的状态和文档链接，不要用整边覆盖删掉别人的工作。

4. 在合并后的最新工作树安装锁定依赖并运行完整流水线：

   ```powershell
   npm ci
   npm run pipeline
   ```

5. 确认测试总数包含 D 的 15 项，并重点检查对象身份复用、预测落空、取消后晚到资源、内存压力和同页新旧竞态五条用例。

6. 由另一名成员按 README 要求审查接口或行为。作者不能把自己的测试和自审冒充团队独立审查。

## 7. A/C/E 后续接入清单

- A：提供真实 ArkUI 视图构建器、视图句柄、平台资源释放函数、估算字节和单调时钟；验证复用后的页面状态。
- C：把调度取消接到 `ResourceViewPreparer.cancel()`，并处理 `prepare()` 的取消拒绝，避免未处理 Promise rejection。
- A/C：统一较大数值为高优先级；收到内存告警时调用 `releaseAll('memory-pressure')`。
- E：在合并后的流水线保留 D 测试，并在目标设备组织开启/关闭优化的同条件对照。
- 全体：在真实目标环境验证预构建是否包含布局/绘制、平台取消、内存回收、前台流畅性和点击响应收益。当前没有这些实测数字。

## 8. 合并验收的最小清单

- [ ] `79cb264` 及后续 D 文档提交已进入合并历史。
- [ ] 两个源码文件、专项测试、两份 D 文档和 README 均存在，未漏拷。
- [ ] `src/contracts.ts` 没有被本交付改动。
- [ ] 合并后 `npm run pipeline` 全通过，包含 D 的 15 项测试。
- [ ] 没有把 `node_modules/`、`dist/`、`artifacts/` 提交进仓库。
- [ ] 另一名成员已完成接口或行为审查。
- [ ] 平台未验证项仍如实保留，没有在汇报中写成真机性能达标。
