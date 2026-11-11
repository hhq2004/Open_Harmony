# E 模块交付与合并说明

> 本文记录 E 提交当时的交付状态；之后 A/B/C 工程已完成 HAP 编译。当前项目状态以 [2026-11-11 版本复核](version-review-2026-11-11.md) 为准。

## 1. 交付身份与结论

- 负责人：E 模块（流水线与评测）
- 分工：`MeasurementSink`、`tests/`、`benchmarks/`、`.github/` 与验收组织
- 第一轮目标：统一测量口径、保存真实原始数据、汇总集成结果与交付证据
- 交付状态：**主机侧测量核心、B→C→D→E 集成场景、测试、pipeline 阶段、CI 摘要和验收文档已完成**；OpenHarmony 真机、ArkTS/HAP、真实用户数据和设备性能验证未运行，报告中保持 `deviceValidation: not-run`。
- 按用户要求：**未修改 README.md**。

## 2. 本轮具体改了什么

| 文件 | 改动 | 作用 |
| --- | --- | --- |
| `src/measurement/types.ts` | 记录、指标、报告类型 | E 的 schema，不修改共享契约 |
| `src/measurement/validation.ts` | 输入校验、默认值、JSONL 读写 | 拒绝非法时间/命中矛盾/未知字段/重复 ID |
| `src/measurement/sink.ts` | `JsonlMeasurementSink`、内存 writer | `MeasurementSink` 的可运行实现 |
| `src/measurement/aggregate.ts` | 指标聚合、最近秩分位数、分组 | 统一口径的可执行定义 |
| `src/measurement/report.ts` | 报告构造、来源一致性校验 | 防止主机/设备数据混标 |
| `src/measurement/index.ts` | 模块导出 | A/C/D/E 的接入入口 |
| `adapters/node-measurement-file.mjs` | Node JSONL 文件适配器 | 核心不依赖 Node 文件 API |
| `benchmarks/measurement.mjs` | B→C→D→E 受控主机场景、比较报告、CLI | 固定场景回放与证据生成 |
| `config/measurement-baseline.json` | 场景、延时、预测/调度/视图配置 | 可复现的基线 |
| `tests/measurement.test.mjs` | 8 项校验/聚合/sink/报告/文件测试 | 指标口径与 schema 回归 |
| `tests/measurement-integration.test.mjs` | 3 项 B/C/D/E 集成、确定性、JSONL 往返 | 闭环与清理检查 |
| `scripts/pipeline.mjs` | 新增 `measurement-evaluation` 阶段 | 测量进入统一自动检查 |
| `scripts/publish-summary.mjs` | 从最新报告生成 job summary | CI 可读证据 |
| `package.json` | 新增 `verify:measurement`、`test:coverage` | 本地复现入口 |
| `.github/workflows/host-pipeline.yml` | 上传测量产物、输出摘要 | 自动检查与归档 |
| `docs/measurement.md` | 指标口径、schema、隐私、限制 | E 的主文档 |
| `docs/measurement-contract-rfc.md` | 共享契约扩展提案 | 待 A/B/C/D 评审，本交付不改 `contracts.ts` |
| `docs/acceptance.md` | 验收矩阵与设备待办 | 第一轮验收证据 |
| `docs/audit-report.md` | 现有文档/声明审计 | 发现并记录不一致 |
| `docs/DELIVERY_E.md` | 本文件 | 合并交接 |

没有修改 B/C/D 的业务逻辑、`src/contracts.ts`、测试发现规则或 README。

## 3. 测量口径摘要

- 一次点击到页面可见的交互 = 一个机会；首次访问和断档保留在分母。
- `coverage = predictionsMade / interactions`，`hitRateAll = hits / interactions`，`hitRateWhenPredicted = hits / predictionsMade`。
- 分位数使用最近秩，零样本返回 `null`。
- `prefetchedBytes`/`wastedBytes` 是 C 的数据租约记账，不是进程/设备内存。
- `viewReuseRate` 的分母是优化交互数。
- `deviceValidation=run` 必须同时满足 `scope=device`、`dataKind=device`。

完整定义见 [measurement.md](measurement.md)。

## 4. 验证结果

环境：Windows、Node.js 22.23.4、TypeScript 5.9.3。

已运行：

```powershell
npm ci
npm run typecheck
npm test
npm run verify:measurement
npm run pipeline
```

结果：

| 阶段 | 结果 |
| --- | --- |
| 环境检查 | Node 22 通过；`hdc`/`ohpm`/`hvigorw` 未发现，目标验证 `not-run` |
| 严格类型检查 | 通过 |
| 干净编译 | 通过 |
| 单元测试 | 138 项通过（原 127 + E 新增 11） |
| 合成回放 | 通过 |
| 预取 HTTP 功能验证 | 通过 |
| 测量阶段 | 通过；`comparison.checks` 全为 `true` |
| 预测评测/事件对照/参数 sweep | 通过 |

主机场景结果（合成数据，不是设备性能）：

| 指标 | 基线 | 优化 |
| --- | ---: | ---: |
| 交互/命中/落空/冷启动 | 11/7/2/2 | 11/7/2/2 |
| 点击到可见 p50 | 22 ms（场景值） | 2 ms（场景值） |
| 点击到可见 p95 | 22 ms（场景值） | 22 ms（场景值） |
| 复用视图 | 0 | 7 |
| 预取/浪费字节 | 0/0 | 2304/512 |

本地最近一次完整运行：`artifacts/pipeline/2026-11-07T12-53-03-527Z-dd280d48/`，138 项测试通过，`measurement-evaluation` 阶段通过。`artifacts/` 为本地生成物，不提交 Git；合并人应自行运行命令生成，而不是寻找已提交的报告。

## 5. 合并步骤

1. 获取本交付分支/提交，确认新增文件与修改文件完整；不要只复制 `src/measurement/`，测试、benchmark、配置、CI 和文档要一起进入。
2. 本交付没有修改 `src/contracts.ts`、B/C/D 源码、README 或测试发现规则；冲突点预计只在 `package.json`、`scripts/pipeline.mjs`、`.github/workflows/host-pipeline.yml` 和 `docs/`。
3. 在合并后的工作树运行：

   ```powershell
   npm ci
   npm run pipeline
   ```

4. 确认 `report.json.stages` 包含 `measurement-evaluation`，且 `comparison.checks` 全部为 `true`。
5. 确认测试总数包含 E 的 11 项，且没有把 `artifacts/`、`dist/`、`node_modules/` 提交。
6. 由另一名成员审查测量口径和 `MeasurementSink` 行为；作者不能把自己的测试和自审冒充独立评审。

## 6. A/C/D 后续接入

- **A**：在点击/可见/可交互边界调用 `MeasurementSink.record()`；提供匿名 `sessionId`、`interactiveAtMs`、`predictedPages`，并确保每次导航只调用一次 `acceptDetailed`。
- **A/C**：用 C 的任务 ID、状态、取消原因和字节估计填充 `preloadTaskId`、`prefetchedBytes`、`wastedBytes`。
- **D**：提供 `viewReused` 和真实视图释放结果；不要把 `estimatedBytes` 写成设备内存。
- **A**：确定设备/模拟器后补 `dataKind=device`、设备型号、系统/API 版本、构建号，并按 `docs/acceptance.md` 第 5 节重跑。
- **E**：设备可用后执行同条件开启/关闭对照，更新 `docs/acceptance.md` 和最终报告；在完成前保持 `deviceValidation=not-run`。

## 7. 未验证项与红线

- 未验证：ArkUI 真实视图、真实空闲信号、内存压力、HAP 构建/安装、真机点击耗时、真实用户数据。
- 不把合成场景的 22 ms / 2 ms 写成设备加速。
- 不把 C 的字节记账写成进程内存或 GPU 内存。
- 不为凑指标删除冷启动/落空样本。
- 不在未评审的情况下修改共享 `src/contracts.ts`。
