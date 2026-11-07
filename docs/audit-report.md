# E 模块文档与声明审计

审计日期：2026-11-07（北京时间）。范围：当前仓库 README、模块说明、交付说明、课程要求文档与本次新增测量材料。目的不是修改他人的模块文档，而是记录不一致、过期数字和不能声称的结论。

## 1. 审计方法

- 逐项对照 [README](../README.md)、[docs/target.md](target.md)、[docs/prediction.md](prediction.md)、[docs/preload.md](preload.md)、[docs/preparation.md](preparation.md)、[docs/DELIVERY_D.md](DELIVERY_D.md) 的实际文字。
- 以当前工作树运行 `npm run pipeline` 的实际结果核对测试数、阶段和产物；以 Git 历史核对提交号。
- 只记录可验证事实；没有设备的地方不补写设备结论。

## 2. 主要发现

| # | 位置 | 发现 | 影响 | 处理 |
| --- | --- | --- | --- | --- |
| A1 | `README.md` “当前开发基线” | 写有“采集、调度和测量 已声明接入接口，目标平台实现待开发”，但 C 的 `src/preload/` 已有主机侧实现（PR #3），测量现在也有 E 的主机实现 | 首页低估了已完成的主机侧工作，可能误导验收人 | 记录；按用户要求本轮不改 README，建议后续由 README 维护人更新 |
| A2 | `README.md` 五人模块分工 | E 的状态仍是初始描述，未链接 `docs/measurement.md`、`docs/DELIVERY_E.md` | 验收人找不到 E 的证据入口 | 记录；本轮不改 README，E 文档可从 `docs/acceptance.md` 进入 |
| A3 | `docs/preload.md` | 记录 2026-11-06 主机侧 127 项测试通过；当前工作树包含 E 新增测试后为 138 项 | 数字是历史快照，不是当前总数；容易被误读成固定门槛 | 记录；不改 C 的历史记录，当前结果以 `npm run pipeline` 和 Actions 为准 |
| A4 | `docs/DELIVERY_D.md` | 记录 D 交付时 82 项测试；当前已增长到 138 项 | 同上，属于交付时快照 | 记录；不修改 D 的交付说明 |
| A5 | `docs/preload.md` / `docs/preparation.md` | 多处明确标注“目标平台验证未运行”“不是真机预渲染” | 与当前实际一致，未发现虚假声明 | 保留 |
| A6 | `README.md` “预测基线与测试数据” | 明确合成数据不能写成真实命中率、点击加速或内存优化 | 与 E 的报告口径一致 | 保留，作为 E 报告的限制依据 |
| A7 | `.github/workflows/host-pipeline.yml` | 只执行主机检查；没有 ArkTS/HAP 构建或设备任务 | 云端绿色不代表鸿蒙功能完成 | 已在 `docs/acceptance.md` 第 5 节列为 `not-run` |
| A8 | `docs/target.md` 第 11 节 | 课程验收清单大多仍未勾选，设备/真实数据项未完成 | 不能把当前主机结果当作课程最终验收 | `docs/acceptance.md` 已逐项映射并标注限制 |
| A9 | 仓库根 | 没有 LICENSE、CODEOWNERS、PR 模板；分支保护无法从公开仓库确认 | 开源/协作规范性不足，但不影响主机功能 | 记录；不属于 E 第一轮代码交付，建议管理员后续补充 |
| A10 | `package.json` | `engines` 要求 Node `>=22 <23`；本机默认 Node 24 会让 `scripts/doctor.mjs` 失败 | 开发者直接运行 `npm run pipeline` 可能误以为项目失败 | 本轮使用 Node 22.23.4 验证；建议本地安装匹配版本或使用版本管理器 |
| A11 | `docs/measurement.md`（本轮新增） | 场景中的 22 ms / 2 ms 是受控参数，不是设备数据 | 若被摘出上下文会变成虚假性能结论 | 文档和报告均保留 `scope=host`、`synthetic`、`deviceValidation=not-run`、`timingSource=controlled-host-clock` |
| A12 | `docs/measurement-contract-rfc.md`（本轮新增） | 共享 `InteractionMeasurement` 尚未包含 E 的扩展字段 | A 接入时可能漏字段；当前由运行时校验兜底 | 已记录提案，待 A/B/C/D 评审后再改 `src/contracts.ts` |

## 3. 已核对为一致的内容

- B 的 `probability` 被说明为经验条件频率，不是校准置信度；E 不在测量层重新解释为置信度。
- C/D 文档明确区分主机测试适配器与 ArkUI 真机视图；E 的报告没有越过这条边界。
- `artifacts/` 在 `.gitignore` 中；报告由运行生成，不随源码提交。
- `README` 要求每个模块补充自己的测试；E 新增测试符合该规则。
- `docs/target.md` 引用的外部模板、来源快照和 SHA-256 索引仍在 `docs/sources/` 中；本轮未修改。

## 4. 建议的后续动作

1. 由 README 维护人更新 E 状态、`docs/measurement.md` 链接和 C 的实际主机实现状态；本轮按用户要求不改 README。
2. A 交付应用后，在 `docs/acceptance.md` 第 5 节逐项替换 `not-run`，并附设备型号、系统/API、构建号、原始报告路径。
3. 共享契约评审通过后再修改 `src/contracts.ts`；在此之前保持 `measurement-contract-rfc.md` 的待评审状态。
4. 仓库管理员补充 LICENSE、CODEOWNERS、PR 模板和主分支必需检查；这些不影响 E 的主机测量，但影响最终工程规范性评分。
5. 最终报告/PPT 引用测量数字时，必须同时复制 `dataKind` 和 `deviceValidation`，不能只摘毫秒数。
