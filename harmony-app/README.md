# OpenHarmony A/B/C/D/E 演示工程

目标为 `runtimeOS: OpenHarmony`、API 26。页面在 `entry/src/main/ets/pages/Index.ets`，提供采集开关、清除历史、四个固定页面别名、下一页候选、静态数据预取、D 准备模型复用和 E 演示测量。启用采集后按“详情页 → 首页 → 模拟空闲并准备候选数据 → 详情页”，可看到候选数据及准备模型被前台接管；清除历史或关闭采集会取消后台任务并释放未接管的资源。空闲按钮只是手动演示信号。A/B/C/D/E 核心源码保存在仓库根目录 `src/`，`npm run sync:harmony` 生成 `entry/src/main/ets/core/` 和与 `config/prediction.json` 一致的配置；生成目录不提交 Git。

页面顶部新增结果卡、访问/复用/释放计数、A→E 状态链和普通访问与预测命中两条处理路径。录屏可点击“**一键展示预测命中**”：程序会清除演示历史，用固定的“首页 → 详情页 → 首页”路径建立预测，手动送入空闲信号准备详情页，再访问详情页显示实际复用结果。每一步有文字提示和短暂停顿，最后可展开 E 的原始记录。这个按钮仅用于本地合成演示，不代表真实用户访问或设备性能收益。

D 的 `ResourceViewPreparer` 通过 `DemoPreload.ets` 接到 C 的 `DataViewPreparer` 接口，准备的是供页面渲染的文本模型；实际 ArkUI `Text` 节点仍由页面创建。这能演示准备、命中、取消与释放的所有权流转，但不是原生视图预构建。E 的 `JsonlMeasurementSink`、`MemoryMeasurementWriter` 和 `summarizeMeasurements` 通过 `DemoMeasurement.ets` 接到页面点击流程，最近三条 JSONL 记录可在界面展开。测量只保存在内存，`dataKind=synthetic`；预取与未复用字节依据静态数据的 64 B 估算值统计，`visibleAtMs` 是页面状态更新时刻，不是屏幕实际可见时刻，不用于设备性能结论。

仓库绝对路径含中文，Hvigor 会拒绝直接构建。请在仓库根目录执行 `npm run build:harmony`，脚本在 D 盘英文路径创建独立构建副本并将日志与未签名 HAP 保存到 `artifacts/harmony/`。默认要求 `D:\DevEcoStudio` 与 `D:\OpenHarmonySdk`；其他安装位置可直接用参数运行 `scripts/build-harmony.ps1`。

当前已通过 ArkTS 编译和 HAP 打包，尚无调试签名和设备运行记录。预取数据来自 `DemoPreload.ets` 中固定的内存内容，没有真实网络请求、系统空闲判定、ArkUI 原生视图预构建或设备原始测量。打开 DevEco Studio 调试时应先使用英文路径构建副本、配置匹配的 OpenHarmony 设备及调试签名，再核对首访、切页、复用、关闭、恢复和清除行为。
