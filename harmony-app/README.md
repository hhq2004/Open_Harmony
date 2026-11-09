# OpenHarmony A/B/C 演示工程

目标为 `runtimeOS: OpenHarmony`、API 26。页面在 `entry/src/main/ets/pages/Index.ets`，提供采集开关、清除历史、四个固定页面别名、下一页候选和静态数据预取展示。启用采集后按“详情页 → 首页 → 模拟空闲并准备候选数据 → 详情页”，可看到候选数据被前台接管；页面内容由该数据填入。空闲按钮只是手动演示信号，不代表系统空闲检测。A/B/C 核心源码保存在仓库根目录 `src/`，`npm run sync:harmony` 生成 `entry/src/main/ets/core/` 和与 `config/prediction.json` 一致的配置；生成目录不提交 Git。

仓库绝对路径含中文，Hvigor 会拒绝直接构建。请在仓库根目录执行 `npm run build:harmony`，脚本在 D 盘英文路径创建独立构建副本并将日志与未签名 HAP 保存到 `artifacts/harmony/`。默认要求 `D:\DevEcoStudio` 与 `D:\OpenHarmonySdk`；其他安装位置可直接用参数运行 `scripts/build-harmony.ps1`。

当前已通过 ArkTS 编译和 HAP 打包，尚无调试签名和设备运行记录。预取数据来自 `DemoPreload.ets` 中固定的内存内容，没有真实网络请求、系统空闲判定或 D 的 ArkUI 视图预构建。打开 DevEco Studio 调试时应先使用英文路径构建副本、配置匹配的 OpenHarmony 设备及调试签名，再核对首访、切页、复用、关闭、恢复和清除行为。
