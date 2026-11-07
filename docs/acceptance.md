# E 模块验收与证据清单

本文件把 E 的第一轮要求逐条映射到代码、命令、测试和报告。**主机侧通过不等于目标平台通过**；设备相关项保持 `not-run`，直到 A 提供应用、SDK、设备或模拟器。

## 1. 第一轮要求对照

| 要求 | 交付 | 自动证据 | 状态 |
| --- | --- | --- | --- |
| 统一测量口径 | `docs/measurement.md` 定义覆盖率、命中率、落空率、冷启动、点击耗时、字节、复用和零分母规则 | 指标公式与聚合测试 `tests/measurement.test.mjs` 手算用例 | 已完成（待团队评审） |
| 统一记录格式 | `src/measurement/types.ts`、`src/measurement/validation.ts` | 非法时间、命中矛盾、未知字段、重复 ID、字节越界均拒绝 | 已完成 |
| `MeasurementSink` 实现 | `src/measurement/sink.ts`、`adapters/node-measurement-file.mjs` | JSONL 写入、重复投递幂等、冲突重复报错、关闭后拒绝写入 | 已完成 |
| 指标聚合 | `src/measurement/aggregate.ts` | 手算分母、最近秩 p50/p95、空分组、空输入返回 `null` | 已完成 |
| 报告来源诚实性 | `src/measurement/report.ts` | `scope`/`dataKind`/`deviceValidation` 交叉校验 | 已完成 |
| 主机回放 | `benchmarks/measurement.mjs`、`config/measurement-baseline.json` | B→C→D→E 集成，固定场景两次运行指标一致 | 已完成（host/synthetic） |
| 基线对照 | 同一场景的 `baseline` / `optimized` 两组 | `comparison.json` 的 delta、检查项、清理统计 | 已完成（host/synthetic） |
| 异常与边界验证 | `tests/measurement.test.mjs`、`tests/measurement-integration.test.mjs` | 冷启动、落空、取消、清理、重复、非法输入、JSONL 往返 | 已完成（主机） |
| 自动检查 | `scripts/pipeline.mjs` 的 `measurement-evaluation` 阶段 | `npm run pipeline` 全阶段通过 | 已完成（主机） |
| CI 归档与摘要 | `.github/workflows/host-pipeline.yml`、`scripts/publish-summary.mjs` | Windows/Ubuntu 上传 `artifacts/pipeline/` 和 `artifacts/measurement/`；job summary 输出指标 | 已配置，云端结果以 Actions 实际运行为准 |
| 集成结果汇总 | 本文件 | 每条要求有代码/测试/命令/状态 | 已完成 |
| 交付说明 | `docs/DELIVERY_E.md` | 改动、验证、合并步骤、平台待办 | 已完成 |
| 文档审计 | `docs/audit-report.md` | 测试数、链接、`not-run` 标注和合成数据声明核对 | 已完成 |

## 2. 复现命令

在仓库根目录、Node 22 环境执行：

```powershell
npm ci
npm run typecheck
npm test
npm run verify:measurement
npm run pipeline
```

`npm run verify:measurement` 只生成 E 的主机场景报告：

```text
artifacts/measurement/<run>/
├── comparison.json
├── config.json
├── baseline/report.json
├── baseline/interactions.jsonl
├── optimized/report.json
└── optimized/interactions.jsonl
```

完整 pipeline 在：

```text
artifacts/pipeline/<run>/report.json
artifacts/pipeline/<run>/measurement-evaluation/<run>/comparison.json
```

`artifacts/` 按仓库规则不提交 Git；合并人应在自己的环境重新生成，而不是寻找一个已提交的报告文件。

## 3. 当前主机场景的已知结果

固定场景 `measurement-baseline-v1`（合成数据、受控单调时钟、非设备）：

| 指标 | 基线 | 优化 | 说明 |
| --- | ---: | ---: | --- |
| 交互 | 11 | 11 | 两条会话，含 2 次冷启动 |
| 有预测 | 9 | 9 | 同一 B 模型 |
| 命中 | 7 | 7 | 预测正确性不因优化开关改变 |
| 落空 | 2 | 2 | `home → settings` 两次 |
| 点击到可见 p50 | 22 ms | 2 ms | **场景参数**，不是设备延迟 |
| 点击到可见 p95 | 22 ms | 22 ms | 落空/冷启动仍走前台 |
| 复用视图 | 0 | 7 | D 的受控视图对象 |
| 预取字节 | 0 | 2304 | C 数据租约记账 |
| 浪费字节 | 0 | 512 | 两次落空的预取 |

这些数字用于验证测量与对照管线，不能写入真机性能结论。

本地最近一次完整验证（Windows、Node.js 22.23.4）：

```text
Pipeline: passed
Run: artifacts/pipeline/2026-11-07T12-53-03-527Z-dd280d48/
Tests: 138 passed
Measurement stage: passed
Comparison checks: all true
```

报告路径：`artifacts/pipeline/2026-11-07T12-53-03-527Z-dd280d48/measurement-evaluation/` 下最新的 `comparison.json`。该目录按仓库规则不提交 Git，换到其他机器需重新运行。

## 4. 自动检查项

`comparison.checks` 必须全部为 `true`：

| 检查 | 含义 |
| --- | --- |
| `predictionsMatchAcrossRuns` | 基线与优化消费同一预测结果，命中数不因优化改变 |
| `baselineMadeNoPrefetch` | 基线没有预取/浪费字节 |
| `optimizedHitsReusedViews` | 命中的优化交互复用了视图 |
| `optimizedCleanup` | 优化运行结束后无残留任务、持有字节为 0、物理槽空闲 |
| `baselineCleanup` | 基线没有遗留定时器 |
| `schedulerErrorsZero` | C 的清理、观察者、取消失败计数为 0 |
| `scenarioIssuesZero` | 没有“预测命中但 take 失败”的集成不一致 |

## 5. 设备/平台待验证项（未完成）

| 项 | 当前状态 | 依赖 |
| --- | --- | --- |
| ArkUI 真实视图构建、布局、绘制和复用 | `not-run` | A 提供平台视图构建器 |
| 真实空闲信号与前台忙碌撤销 | `not-run` | A/C 平台适配 |
| 真实内存压力与平台内存峰值 | `not-run` | A/C/D 平台接入 |
| HAP 构建、安装、启动 | `not-run` | A 的鸿蒙工程与 SDK |
| 真机点击到可见/可交互 | `not-run` | A 的应用与设备 |
| 真实脱敏用户路径数据 | `not-run` | A 的采集与隐私评审 |
| 设备参数标定与最终性能结论 | `not-run` | 上述全部完成 |

在完成这些项之前，仓库不能声称“预渲染闭环已在 OpenHarmony 真机验证”或“点击耗时下降 X%”。

## 6. 课程评分对照

| 评分项 | E 能提供的证据 | 当前限制 |
| --- | --- | --- |
| 功能完整性 40 | B→C→D→E 主机闭环、命中/落空/清理检查、原始 JSONL | 缺 A 的应用与设备闭环 |
| 技术创新性 30 | 不属于 E 主责；E 提供可复核的对照口径 | 不能替代预测/调度/回收设计 |
| 性能优化与稳定性 20 | 开启/关闭对照报告、耗时分组、字节成本、清理检查 | 主机场景不是设备性能 |
| 工程规范性 10 | 指标文档、schema、测试、pipeline、CI 摘要、验收矩阵、隐私说明 | 设备报告仍待补 |

## 7. 合并前检查

- [ ] `src/contracts.ts` 未被本交付修改（扩展字段只存在于 measurement 模块）。
- [ ] `npm run pipeline` 在当前 Node 22 环境全绿。
- [ ] `measurement-evaluation` 阶段出现在 `report.json` 的 `stages` 中。
- [ ] `comparison.checks` 全部为 `true`。
- [ ] 报告保持 `scope=host`、`dataKind=synthetic`、`deviceValidation=not-run`。
- [ ] `artifacts/`、`dist/`、`node_modules/` 未提交。
- [ ] 另一名成员完成接口或行为评审。
- [ ] 设备未验证项在最终文档/PPT 中如实标注。
