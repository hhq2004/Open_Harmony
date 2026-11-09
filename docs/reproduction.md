# P07 项目本机复现记录

复现日期：2026-11-09（中国标准时间）。工作目录：`C:\Users\lenovo\Desktop\课程作业\鸿蒙`。代码基线：本地分支 `codex/a-application-integration`，提交 `33fbde2`；远端主分支基线 `2fdd90f`。本文件记录已实际执行的步骤与结果，设备运行尚未验收。

## 环境

- Windows 11；Node.js `v22.19.0`，npm `10.9.3`。
- DevEco Studio `26.0.0.865` 位于 `D:\DevEcoStudio`；OpenHarmony SDK `26.0.0.38` 位于 `D:\OpenHarmonySdk\26.0.0`；hdc `3.2.0f`。
- 工程在 `harmony-app/build-profile.json5` 使用 `runtimeOS: OpenHarmony`、API `26.0.0`。

## 从依赖到构建

在项目根目录依次执行：

```powershell
npm ci
npm run pipeline
npm run build:harmony
hdc list targets
npm run demo
```

| 步骤 | 本次结果 | 证据 |
| --- | --- | --- |
| 锁定依赖安装 | 成功，安装 1 个包 | npm 退出码 0 |
| 主机侧完整流水线 | 成功，147 项测试全部通过，0 项失败 | `artifacts/pipeline/2026-11-09T13-50-24-084Z-0c9dcb5d/report.json` |
| 浏览器演示 | `http://127.0.0.1:4173/` 可打开 | 本机实测启用采集、首页→详情页→首页→详情页、预测候选与静态数据复用；清除与关闭状态正常 |
| OpenHarmony HAP 构建 | 成功，Hvigor 34 项任务完成 | `artifacts/harmony/run-20261109-215035-9cde5a/build.log` |
| HAP 产物 | 未签名，267,833 字节 | `artifacts/harmony/run-20261109-215035-9cde5a/entry-default-unsigned.hap`；SHA-256 `AEFA131DA56F3D3AAD2FA475D80EDF20E033E46F786F230A3FFC6E5E9C235FD8` |
| 设备发现 | `[Empty]` | `hdc list targets`；没有完成安装、启动和设备交互验证 |

`npm run demo` 会持续运行本地服务；结束演示时在启动它的终端按 Ctrl+C。演示用固定静态页面数据，只验证 A/B/C 的主机侧接入，不代表鸿蒙设备上的数据预取、D 的真实视图复用或性能收益。构建脚本在 D 盘英文目录执行 Hvigor，以避开工程根目录中文路径限制；每次运行产物和日志独立保存在 `artifacts/`，这些本地生成物默认不提交 Git。

## 设备端完成条件

当前还不能把“构建成功”记为“应用在设备上可运行”。本机另有一个未启动的 HarmonyOS 6.0.0（API 20）模拟器；[华为构建目标文档](https://developer.huawei.com/consumer/en/doc/harmonyos-guides-V13/ide-customized-multi-targets-and-products-guides-V13/)将 OpenHarmony HAP 与 HarmonyOS HAP 分别对应各自设备，现有模拟器也低于工程 API 26。需要先确认课程接受的目标系统，再完成相应的签名、安装、启动与交互录屏。

若课程要求 OpenHarmony，请提供或连接匹配 API 26 的 OpenHarmony 设备/镜像，并在设备上开启调试连接；A 随后验证默认关闭、页面访问、同会话预测、清除历史和退出恢复。若课程允许 HarmonyOS 模拟器，应另建兼容的 HarmonyOS 构建配置与 SDK，不把该模拟器结果写成 OpenHarmony 实测。设备测量和完整 C/D/E 平台联调仍需团队共同完成。
