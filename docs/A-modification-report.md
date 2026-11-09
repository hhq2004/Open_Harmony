# A 部分修改报告

日期：2026-11-09（中国标准时间）

分支：`codex/a-application-integration`

基线：远端 `main` 的 `2fdd90f`，在已有 A 主机侧实现上继续集成。

## 任务对应关系

| A 第一轮要求 | 本次交付 | 核验状态 |
| --- | --- | --- |
| 目标环境与演示应用 | DevEco Studio 26.0.0.865、OpenHarmony SDK 26.0.0.38；`harmony-app/` 为 `runtimeOS: OpenHarmony`、API 26；四个固定页面、采集开关、清除历史和候选展示 | ArkTS 编译、HAP 打包通过；未签名，未在设备运行 |
| 行为采集：`VisitCollector`、`VisitEvent` | `AppVisitCollector` 只接受固定页面别名；默认关闭，匿名会话 ID 只在进程内使用；恢复、关闭、清除切断会话邻接 | `tests/visit-collector.test.mjs` 与完整主机流水线通过 |
| 同会话事件传给预测器 | 每次有效访问调用 B 的 `acceptDetailed()` 一次，结果交给 A 的集成层；异常路由和时间拒绝，不跨越无效事件学习 | 主机测试通过；ArkTS 代码编译通过 |
| 组织接口评审与集成 | `AppVisitIntegration` 将 B 候选接入 C 的控制器，处理前台开始、命中、落空、关闭、清除及会话轮换；交接规则写于 `docs/A-integration-review.md` | 主机侧集成测试与浏览器演示通过；接口记录待其他成员确认 |

## 本轮具体修改

1. `scripts/sync-harmony.mjs` 现在同步 A 的集成层与 C 的调度器、控制器、类型到 ArkTS 工程。共享逻辑仍由仓库根目录 `src/` 维护，生成目录不提交。
2. `harmony-app/entry/src/main/ets/pages/DemoPreload.ets` 提供四页固定内存数据、平台单调时钟和定时器适配，供演示调度器使用。
3. `harmony-app/entry/src/main/ets/pages/Index.ets` 接入 A→B→C。点击页面产生脱敏事件；按钮手动模拟空闲后，C 准备下一候选的静态数据；下次访问若匹配，页面接管数据并填入演示内容。关闭或清除时同步清理投机任务。
4. `src/preload/scheduler.ts` 把 `Object.hasOwn()` 改为等价的 `Object.prototype.hasOwnProperty.call()`，解决当前 ArkTS 编译目标兼容问题；Node 侧行为与安全检查保持一致。
5. 更新 `README.md`、`harmony-app/README.md`、A 流程、接口交接与项目简介，标明演示边界。

## 验证记录

- `npm run pipeline`：147 项测试全部通过，0 项失败；报告 `artifacts/pipeline/2026-11-09T14-04-55-599Z-98c5b6de/report.json`。
- `npm run build:harmony`：Hvigor 34 项任务成功，生成 `artifacts/harmony/run-20261109-220554-68678e/entry-default-unsigned.hap`，349,096 字节，SHA-256 `5FF4CA6E884BB3059A467FD18FABA4B2EBABCA285442C98028066ADFBE3C75D4`。
- 浏览器演示在上一轮已实际操作：启用采集、连续切页、候选出现、静态数据复用、清除和关闭均可见；本轮 ArkTS 应用只完成编译与打包，未宣称设备上交互通过。

## 交接与后续项

当前静态数据源和手动空闲按钮用于 A 的集成演示，不等同于 C 的真实网络预取、系统空闲判定，也不等同于 D 的真实 ArkUI 视图复用。E 的真实设备原始测量、签名、安装和设备交互仍未完成。用户已说明本轮无需一定在模拟器运行，因此不把模拟器作为本轮复现前置条件；如果课程最终要求目标设备验收，需先确定系统与 API 匹配的设备，再补对应证据。

代码与材料目录见 `submission/README.md`。其他成员对接口的确认意见可补充到 `docs/A-integration-review.md`，不把本记录写成团队已共同签字的结论。
