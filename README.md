# P07 预加载与预渲染优化

本仓库用于“基于用户热点触达路径预测的预加载 / 预渲染优化”课程项目。目标是在合适的空闲窗口提前准备下一页数据和视图，并验证命中收益、预测落空回收以及资源开销。

代码仓库：[hhq2004/Open_Harmony](https://github.com/hhq2004/Open_Harmony)。课程要求、原始来源和模板条目见 [target.md](docs/target.md)。本项目仅用于课程提交，外部来源赛事的赛程不自动作为课程截止时间。

## 当前开发基线

| 内容 | 状态 |
| --- | --- |
| 本地主机侧 pipeline | 已实现环境检查、类型检查、编译、单元测试、合成路径回放和报告保存 |
| 路径预测 | 已实现有界一阶模型、统一配置、会话接入、生命周期回放和参数批量对照；见 [B 模块说明](docs/prediction.md) |
| 预渲染资源生命周期 | 已实现视图构建适配、身份复用、预测落空/过期/内存压力释放、容量淘汰及晚到资源处理；见 [D 模块说明](docs/preparation.md) 和 [钟广申的交付与合并说明](docs/DELIVERY_D.md) |
| 自动化测试 | 覆盖预测、窗口淘汰、会话隔离、开关/清除、离线评测，以及视图复用、取消竞态和资源回收；新增模块需补充自己的测试 |
| GitHub Actions | 已配置 Windows/Ubuntu 检查；具体运行结果以仓库 Actions 页面为准 |
| A 采集与集成演示 | 已实现固定页面别名、默认关闭的匿名会话采集、清除与生命周期边界；浏览器演示已接入 B/C 静态数据预取，OpenHarmony API 26 工程已编译 A/B HAP；见 [A 流程](docs/A-workflow.md) |
| 调度、预渲染和测量 | C/D/E 主机侧模块与测试已合入；应用中的端到端接入和设备验证待完成，见 [预取](docs/preload.md)、[预渲染](docs/preparation.md) 与 [测量](docs/measurement.md) |
| OpenHarmony 构建和设备评测 | DevEco Studio 26.0.0.865 与 OpenHarmony SDK 26.0.0.38 已配置并完成 ArkTS 编译；HAP 尚未签名，未检测到设备/模拟器，设备运行与性能评测待完成 |

单独运行本地 pipeline 只检查 TypeScript 核心逻辑；ArkTS 另通过 `npm run build:harmony` 验证。两种构建都不能证明预渲染功能或设备性能达标，端到端联调需随平台实现逐步接入。

## 取得代码与运行

独立逻辑开发使用 Node.js 22、npm 和 Git。首次取得代码：

```powershell
git clone https://github.com/hhq2004/Open_Harmony.git
cd Open_Harmony
npm ci
npm run pipeline
```

已有本地工作目录时，直接在包含 `package.json` 的项目根目录运行后两条命令。源码、锁文件和工作流均以当前项目为仓库根，不把外层 `hong_meng` 工作区或 `presentation` 旧作业纳入工程。

pipeline 按以下顺序执行：

```text
环境检查 → 严格类型检查 → 干净编译 → 单元测试 → 合成路径回放 → 路径/事件策略对照 → 参数批量对照 → 保存报告
```

任一步失败即停止后续步骤，返回非零退出码。编译只清理本项目生成的 `dist/`，防止旧产物误通过；运行记录保留在独立的 `artifacts/pipeline/<run>/` 目录，包含 `report.json` 和各阶段的标准输出、错误输出。

| 命令 | 用途 |
| --- | --- |
| `npm run doctor` | 检查 Node 版本以及相关命令是否可发现 |
| `npm run typecheck` | 检查 `src/**/*.ts` 的 TypeScript 类型 |
| `npm run build` | 清理生成目录并重新编译 |
| `npm test` | 先编译，再执行 Node 单元测试 |
| `npm run replay` | 先编译，再回放合成路径 |
| `npm run evaluate:prediction` | 先编译，比较四个基线及当前配置，保存逐跳决策、输入、配置与来源校验值 |
| `npm run sweep:prediction` | 先编译，用验证段比较配置，仅对选中配置执行最终测试 |
| `npm run pipeline` | 执行完整的主机侧检查并保存报告 |
| `npm run demo` | 编译并启动 A/B/C 本地浏览器演示，打开 `http://127.0.0.1:4173/` |
| `npm run build:harmony` | 同步 A/B 核心至 ArkTS 工程，在 D 盘英文路径构建 OpenHarmony HAP；需安装 DevEco Studio 与 SDK，步骤见 [环境记录](docs/environment.md) |

`doctor` 对 `hdc`、`ohpm` 等工具的检测范围是命令路径，不验证设备连接、SDK 兼容性或鸿蒙构建是否成功。工具尚未配置时，独立算法检查仍可运行，报告中的目标环境验证保持 `not-run`。

预测配置入口为 [config/prediction.json](config/prediction.json)，空的 `model`、`session` 对象继承 `src/prediction/config.ts` 的统一默认值。Node 评测命令默认读取该文件；应用由 A 加载同一配置，再交给 `createPredictionEngine(pageCatalog, profile)`，核心代码不依赖 Node 文件接口。报告的 `profile` 保存解析后的配置，`effectiveConfig` 另明确记录数据集会话策略与 `--top-k` 覆盖后的生效值。

## 五人模块分工

以下按 A–E 标记职责，不绑定姓名。各成员维护自己的模块实现、测试、接口说明和相关源码证据。

| 角色 | 主责与接入入口 | 第一轮交付 |
| --- | --- | --- |
| A 应用与集成 | 目标环境、演示应用、行为采集；`VisitCollector`、`VisitEvent` | 应用可运行，页面事件脱敏且可关闭，同会话事件能传给预测器；组织接口评审与集成 |
| B 路径预测 | 转移统计、候选预测、独立测试和离线预测评测；`PathPredictor`、`src/prediction/` | 预测模块可调用，冷启动和异常输入行为明确，测试及离线结果可复现 |
| C 调度与数据预取 | 空闲判定、优先级、数据预取、任务取消；`PreloadScheduler` | 一次预取完成、一次取消及失败处理，可追踪任务状态 |
| D 预渲染与资源管理 | 视图预构建、命中复用、失效释放和内存压力回收；`ViewPreparer`、`PreparedView` | 一次真实视图复用、一次预测落空释放，验证取消后晚到资源也能释放 |
| E 流水线与评测 | 自动检查、基线、回放、异常验证和验收组织；`MeasurementSink`、`tests/`、`benchmarks/`、`.github/` | 统一测量口径、保存真实原始数据、汇总集成结果与交付证据 |

A 组织应用与模块集成，E 维护自动检查并组织最终验收。每个模块的功能和模块测试由实现者交付；公共接口由相关上下游共同确认。

## 模块接入规则

共享类型见 [src/contracts.ts](src/contracts.ts)。这些是待评审的逻辑契约，并非已经实现的鸿蒙系统 API。目前 A 的主机侧采集器、B 的预测模型及会话接入器、C 的调度器、D 的预渲染资源管理器和 E 的测量模块有实际实现；仍需在应用中完成 C/D/E 接入与目标设备验证。

1. 先在任务或 PR 中写清模块入口、输入输出、依赖、异常行为和验收方法，再按独立分支开发。
2. 主机侧 TypeScript 实现放在 `src/`，对应测试放在 `tests/<module>.test.mjs`。当前 pipeline 从 `tests/` 顶层发现测试文件；新建嵌套测试目录前，应先同步修改测试发现规则。
3. 合并前运行 `npm run pipeline`，由另一名成员检查接口或行为。涉及 SDK/API 的代码还需在目标环境中编译和运行，`.ets` 文件不会由当前 TypeScript 检查自动验收。
4. 公共接口改动须与上下游同步评审，包括页面标识规则、优先级方向、完成/失败通知和取消时序；不得只在单个模块中另定一套格式。
5. 日志和原始结果保存到对应 `artifacts/` 子目录，引用固定版本的源码时提供 `文件:行号#符号名`。

A 可通过 `SessionPredictor.accept(VisitEvent)` 接入已脱敏事件，由 B 接入器隔离会话并调用预测模型，避免上游再调用 `observe` 造成重复学习。接入器默认关闭，关闭时清除会话游标并停止学习/预测，`clear()` 清除游标与模型。A 的真实采集开关、原始数据清除及日志脱敏仍需在平台实现中验证，详见 [接入说明](docs/prediction.md)。

主机侧 A 采集位于 `src/application/visit-collector.ts`：仅接受固定路由别名，匿名会话在启用、恢复和清除时轮换，关闭期间不投递事件。`src/application/visit-integration.ts` 将 B 的一次决策接到 C，处理前台开始、上一轮命中/落空、会话结束、关闭与清除。`demo/` 用固定本地数据展示浏览器空闲后的预取与复用；没有服务端事件接收或持久化，也没有 D 的真实视图。接口交接见 [A 集成评审记录](docs/A-integration-review.md)。

ArkTS 工程位于 `harmony-app/`，`scripts/sync-harmony.mjs` 从 `src/` 和 `config/prediction.json` 生成 A/B 共享逻辑及配置；`scripts/build-harmony.ps1` 复制工程到 D 盘英文路径后编译，日志与未签名 HAP 进入 `artifacts/harmony/`。实际设备安装启动、自动签名和应用性能测量还需目标设备或模拟器。具体环境、构建证据与剩余步骤见 [环境记录](docs/environment.md)。

需要区分关闭、迟到事件、超时或淘汰边界时，使用 `acceptDetailed()` 获取 `SessionDecision`；其候选与 `accept()` 来自同一执行路径。不要为同一次访问先后调用两者，以免重复学习。共享 `src/contracts.ts` 接口未改动，B 的跨模块交接步骤见模块说明末尾。

调度侧负责取消任务，资源侧负责释放已经创建及取消后晚到的资源。`PreparedView.dispose()` 应可重复调用，`take()` 成功后由调用者持有并释放资源。D 提供 `ResourceViewPreparer.cancel()`、明确的取消异常、TTL/容量策略和生命周期测试；C 调用取消，A 提供真实平台视图构建器。接口、错误传播、任务状态和并发边界见 [D 模块说明](docs/preparation.md)，共享 `src/contracts.ts` 未改动。

## 鸿蒙环境与开发范围

各成员可在自己的 Windows 电脑上协作。独立预测逻辑可先使用 Node.js 开发、测试和离线评测；应用、调度、预渲染与设备测量需要团队落实匹配的 IDE、SDK/API 和可运行的目标环境。

A 牵头确定目标系统、应用工程及设备或模拟器，C、D 验证相应平台能力，E 将可执行的构建和运行检查接入流水线，并组织同环境对照测量。目标环境出现模块兼容性问题时，由对应实现者配合修正。

当前方案没有必须租服务器的要求。若最终选择修改并编译系统或框架源码，再按目标版本落实适用的 Linux 构建环境和资源；不预先把全量系统编译作为每位成员的开发前置条件。模拟器结果应标明实际系统与配置，不能记为真机实测。

## 预测基线与测试数据

一阶模型按近期页面转移频次输出候选，默认最多保留 2,048 次转移；可配置最小样本数和候选频率门槛。未知页面或证据不足时不预测；相同频率按页面标识确定顺序。分数是条件频率，筛选和截取候选后不重新归一化，不能将其称为已校准的置信度。当前为内存模型，没有持久化或用户画像。

`benchmarks/fixtures/synthetic-sessions.json` 是明确标记的合成数据，只用于连通 pipeline。回放时先预测再观察真实下一跳，按会话隔离；训练数据在评测之前提供，评测过程中逐步在线更新。报告同时给出预测覆盖率、全体机会命中率和有预测时命中率，分母为零时返回 `null`。

这些数字不能写成真实用户命中率、点击加速或内存优化结果。后续应以经过脱敏的真实路径和固定目标环境建立单独评测。

`benchmarks/fixtures/prediction-scenarios.json` 另提供重复路径、歧义路径、路径变化和冷启动四组合成对照。运行 `npm run evaluate:prediction` 会比较完整历史、近期窗口、带门槛窗口、最近一次后继及当前配置 `configured`；独立结果保存在 `artifacts/prediction/<run>/`。编译后运行 `node benchmarks/prediction.mjs --mode frozen --top-k 2` 可冻结训练模型并检查前两个候选。自有数据格式和指标定义见 B 模块说明，不根据这些合成样本确定最终设备参数。

完整 pipeline 的对照结果保存在本次 `artifacts/pipeline/<run>/prediction-evaluation/` 内，随现有 GitHub Actions 产物归档；其中的结构计数与主机耗时不能代替设备内存及点击响应测量。

`benchmarks/fixtures/prediction-events.json` 使用第二版输入格式，包含交错会话、全局投递顺序、会话内时间和开关/结束/清除事件，直接经过真实的 B 会话接入器。编译后运行 `node benchmarks/prediction.mjs --input benchmarks/fixtures/prediction-events.json`；完整 pipeline 会将该对照结果保存在 `prediction-event-evaluation/` 子目录。此前的纯路径格式继续用于算法检查；含超时、开关或交错会话的输入应使用事件格式。

`npm run sweep:prediction` 使用 `config/prediction-candidates.json` 的候选和选择约束，以及 `benchmarks/fixtures/prediction-sweep.json` 的训练/验证/最终测试三段数据。所有候选只在验证段比较；按覆盖率及候选数量约束选择后，仅对胜出配置用训练＋验证历史重新训练并执行最终测试。结果保存在 `artifacts/prediction-sweep/`；完整 pipeline 将其归档到 `prediction-parameter-sweep/`。该命令不会修改当前配置；示例数据为合成数据，选中项不代表生产参数。

## GitHub 自动检查

工作流见 [.github/workflows/host-pipeline.yml](.github/workflows/host-pipeline.yml)，运行结果见 [Actions](https://github.com/hhq2004/Open_Harmony/actions)。推送代码、提交或更新 PR、手动触发时，在 Windows 与 Ubuntu 两个环境分别安装锁定依赖并运行同一条主机侧 pipeline。

工作流使用固定提交的官方 Actions，并缓存 npm 下载内容。已生成的报告在检查成功或失败后均尝试归档，保留 14 天，可在对应运行中下载 `host-pipeline-*` 产物。云端状态以对应提交的实际结果为准，工作流文件存在不等于检查已经通过。

仓库管理员应在实际检查名称确定后配置成员权限、PR 审查和主分支必需状态检查。当前工作流只执行主机侧检查；OpenHarmony HAP 构建虽已在本机通过，CI 构建、安装启动、真实预渲染/取消/回收集成测试及设备评测仍需后续加入。

## 资料与目录

| 路径 | 内容 |
| --- | --- |
| `src/` | 共享逻辑接口和主机侧模块源码 |
| `tests/` | 可自动执行的模块与回放测试 |
| `scripts/` | 环境检查、干净编译和 pipeline 入口 |
| `benchmarks/` | 合成回放输入、评测脚本；真实数据需另行说明来源和口径 |
| `config/` | 预测配置覆盖项、批量对照候选及选择约束；默认值集中在核心配置模块 |
| `docs/target.md` | 项目要求、评分、模板条目和待落实事项 |
| `docs/reproduction.md` | 本机依赖安装、流水线、演示与 HAP 构建的实测复现记录 |
| `docs/` 中的 DOCX/PPTX | 两份原始官方模板；正式作品另存，不覆盖原件 |
| `docs/sources/` | 要求网页快照、提取数据、模板内容核对及来源索引，不参与程序运行 |
| `artifacts/` | 本地构建、检查、运行和评测证据，默认不提交 Git |

`docs/sources/` 中的 `P07.json`、`oh_system-assessment.json` 来自课程动态数据；HTML/JS 是网页快照；`template_*.html/txt` 保留最初在线访问受登录限制的记录；`template-content-review.json` 提取自后来取得的本地模板。来源与 SHA-256 索引见 [source-index.json](docs/sources/source-index.json)。这些资料不是 OpenHarmony 源码或真实用户评测样本。

依赖、编译输出、运行证据和临时文件已设置 Git 忽略规则，参考切片也单独忽略以避免嵌套 Git。交付时按课程要求提供项目简介、基于模板的项目文档、视频或 PPT，以及可供教师读取的仓库地址。
