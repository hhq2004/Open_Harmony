# OpenHarmony A/B 演示工程

目标为 `runtimeOS: OpenHarmony`、API 26。页面在 `entry/src/main/ets/pages/Index.ets`，提供采集开关、清除历史、四个固定页面别名及下一页候选展示。A/B 核心源码保存在仓库根目录 `src/`，`npm run sync:harmony` 生成 `entry/src/main/ets/core/` 和与 `config/prediction.json` 一致的配置；生成目录不提交 Git。

仓库绝对路径含中文，Hvigor 会拒绝直接构建。请在仓库根目录执行 `npm run build:harmony`，脚本在 D 盘英文路径创建独立构建副本并将日志与未签名 HAP 保存到 `artifacts/harmony/`。默认要求 `D:\DevEcoStudio` 与 `D:\OpenHarmonySdk`；其他安装位置可直接用参数运行 `scripts/build-harmony.ps1`。

当前已通过 ArkTS 编译和 HAP 打包，尚无调试签名和设备运行记录。打开 DevEco Studio 调试时应先使用英文路径构建副本、配置匹配的 OpenHarmony 设备或模拟器及调试签名，再核对首访、切页、关闭、恢复和清除行为。
