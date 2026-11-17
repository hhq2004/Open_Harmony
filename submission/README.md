# P07 课程提交材料

本次打包对应 `codex/de-app-integration` 分支，基于提交 `b95765f` 加入应用可视化页面与说明修改。A/B/C/D/E 已接入 OpenHarmony API 26 的 ArkTS 静态数据演示；主机侧 pipeline 通过，最新 ArkTS 工程已生成未签名 HAP。DevEco 预览器的一键演示显示访问 4 次、准备模型复用 1 次、资源释放 1 次。D 在应用中准备文本渲染模型，E 记录内存中的合成测量；尚无新版设备安装运行、ArkUI 原生视图预构建或设备性能对照证据。

## 网页上传文件

| 网页栏目 | 文件 | 说明 |
| --- | --- | --- |
| 项目文档 | `../../P07提交材料/P07-开发设计文档-更新版.docx` | 依据官方 DOCX 模板，已更新 D/E 接入与验证边界 |
| PPT | `../../P07提交材料/P07-答辩汇报-更新版.pptx` | 依据官方 PPTX 模板，共十页 |
| 项目打包文件 | `../../P07-Open_Harmony-visual-20261117.zip` | 当前工作区的已跟踪项目源码、测试、配置和说明；排除本地构建缓存及三个未跟踪中文文档 |
| 项目视频 | 单独录制与上传 | 展示 DevEco 预览器的一键预测命中流程；视频不放入源码压缩包 |

上述文件位于仓库的上一级 `课程作业` 目录；正式文档和 PPT 位于其中的 `P07提交材料` 目录。网页中的个人仓库地址与项目简介需在对应字段填写，简介稿见 [project-summary.md](project-summary.md)。

## 复现与证据

在仓库根目录执行 `npm ci`、`npm run pipeline`、`npm run build:harmony`。2026-11-17 本机 pipeline 全阶段通过；最新 ArkTS 构建完成 34 项 Hvigor 任务，未签名 HAP 和日志位于被 Git 忽略的 `artifacts/harmony/run-20261117-201127-50ceae/`。打包文件不包含 `artifacts/`、`node_modules/`、`dist/` 或其他本机构建缓存。

应用演示与平台限制见 [harmony-app/README.md](../harmony-app/README.md)；A 至 E 模块的源代码、主机测试和配置分别位于 `src/`、`tests/`、`config/`。如课程要求设备性能收益，还需补充匹配的设备、签名安装、真实请求、原生视图准备及同条件原始测量。
