# A 目标环境与构建记录

首次记录日期：2026-11-04；最近复核：2026-11-09（中国标准时间）。本记录只写已在这台电脑核验的结果。

## 已安装环境

| 项目 | 实际值 |
| --- | --- |
| 操作系统 | Windows 11 家庭版中文版，64 位，Build 26200；内存 16 GB |
| IDE | `D:\DevEcoStudio`，DevEco Studio 26.0.0.865，`build.txt` 为 `DS-261.23567.138.36.2600865` |
| OpenHarmony SDK | `D:\OpenHarmonySdk\26.0.0`，ETS/Toolchains 版本 26.0.0.38；Native、Previewer 组件已安装 |
| 工具 | ohpm 26.0.0.630、Hvigor 6.26.9、hdc 3.2.0f |
| 用户环境变量 | `DEVECO_HOME=D:\DevEcoStudio`、`DEVECO_SDK_HOME=D:\DevEcoStudio\sdk`、`JAVA_HOME=D:\DevEcoStudio\jbr`；hdc/ohpm/hvigorw 已加入用户 PATH |
| 工程目标 | `runtimeOS: OpenHarmony`，`compileSdkVersion`、`compatibleSdkVersion`、`targetSdkVersion` 均为 `26.0.0` |

用户提供的安装包为 `C:\Users\lenovo\Downloads\devecostudio-windows-26.0.0.865.zip`，本机 SHA-256 为 `5A36B625F1F1BDC3AE34C684EBB2A68BD9610C2FC830CA6C3C733E58FF28F2AA`。解压后的 EXE 通过 Windows Authenticode 校验，签名主体为 `Huawei Technologies Co., Ltd.`；安装程序退出码为 0。IDE 官方入口：[华为 DevEco Studio](https://developer.huawei.com/consumer/cn/deveco-studio/)。本记录没有取得官网公布的该 ZIP 哈希，因此不宣称 ZIP 与官网哈希逐字节匹配。

## 构建步骤与结果

当前仓库路径包含中文，Hvigor 的项目路径校验会拒绝该路径。`npm run build:harmony` 先从仓库源码同步 A/B 逻辑，再将 `harmony-app/` 复制到 `D:\P07BuildRuns\run-*` 英文路径，在那里写入 `sdk.dir=D:/OpenHarmonySdk` 并调用 Hvigor。该命令保留每次运行的独立目录和日志，不覆盖旧证据。

```powershell
npm ci
npm run pipeline
npm run build:harmony
```

2026-11-04 的主机侧 pipeline 通过，包含 71 个测试。OpenHarmony ArkTS 构建成功，34 个任务完成，生成未签名 HAP：

```text
artifacts/harmony/run-20261104-173333-2f220c/build.log
artifacts/harmony/run-20261104-173333-2f220c/entry-default-unsigned.hap
```

该 HAP 大小 267,566 字节，SHA-256 为 `6C704ABD34D48A33B79A385A219684BE96787D174BAED73EDBF140C6F5961CCE`。`hdc list targets` 返回 `[Empty]`，当前没有可用设备或模拟器；未进行 HAP 签名、安装、启动、页面交互或性能实测。设备就绪后，先配置调试签名，再在匹配的 OpenHarmony 设备/模拟器上安装并验证 A 的开关、清除、会话和事件顺序。

2026-11-09 拉取主分支并加入 A→B→C 主机侧接入后，`npm run pipeline` 的 147 项测试全部通过，报告位于 `artifacts/pipeline/2026-11-09T13-39-48-032Z-71817e63/report.json`。再次执行 `npm run build:harmony`，34 项任务成功，生成 `artifacts/harmony/run-20261109-214006-7e4fe8/entry-default-unsigned.hap`，大小 267,833 字节，SHA-256 为 `1DDE02AC79D7A5212180CDBD82B9731BE497D2B0E21EB77E53BC62DCE067123E`。该 HAP 仍为 A/B 演示工程，C 的静态数据预取只在浏览器演示与主机测试中接入。`hdc list targets` 再次返回 `[Empty]`，设备安装与运行未验证。

本机 DevEco Studio 带有 HarmonyOS Emulator 程序，但没有已启动的目标。当前 HAP 的 `runtimeOS` 是 `OpenHarmony`；[华为构建目标说明](https://developer.huawei.com/consumer/en/doc/harmonyos-guides-V13/ide-customized-multi-targets-and-products-guides-V13/)将此类 HAP 指定给 OpenHarmony 设备，而 HarmonyOS 模拟器对应 HarmonyOS 目标。因此不能仅因本机存在模拟器程序就把该 HAP 记为已在目标环境运行。下一步需取得匹配 API 26 的 OpenHarmony 设备/镜像，或在团队确认改用 HarmonyOS 目标后重新配置、签名、安装并复测。

首次尝试时 Hvigor 在 C 盘默认 SDK 路径下载了临时 Native 组件；因系统盘余量不足，后续 SDK 改到 D 盘并成功完成构建。C 盘的 `C:\Users\lenovo\AppData\Local\OpenHarmony\Sdk\.temp\native\install` 可能仍有约 3 GB 的中断下载临时文件。自动清理操作被执行策略拒绝，尚未删除；确认无需恢复该次中断下载后，可由用户在文件资源管理器中清理。
