# P07 课程最终提交目录与清单

这是最后交付材料的目录规划。项目实践页要求个人仓库地址、项目简介、基于官方模板的详细设计文档，以及视频或 PPT；其他工程证据用于复现和说明。当前仓库尚未完成目标设备闭环，本目录不是“已可提交”的声明。

```text
submission/
├── README.md                     本清单、版本和材料索引
├── project-summary.md            项目简介当前实现稿（联调实测后更新）
├── design/                       基于官方 DOCX 模板另存的正式设计文档（待完成）
├── presentation/                 视频或基于官方 PPTX 模板的正式演示稿，二选一（待完成）
└── evidence/
    ├── environment/              IDE、SDK、设备/模拟器版本和构建命令（待补）
    ├── integration/              A–E 接口评审、联调与异常场景记录（待补）
    └── measurements/             E 的真实原始数据、指标脚本和结果（待补）
```

源码和测试以**仓库根目录**的 `src/`、`harmony-app/`、`demo/`、`tests/`、`config/`、`scripts/` 为准，不在这里复制一份过期源码。现有可引用材料：[`../docs/A-workflow.md`](../docs/A-workflow.md) A 流程、[`../docs/A-integration-review.md`](../docs/A-integration-review.md) 接口交接、[`../docs/environment.md`](../docs/environment.md) 环境、[`../docs/reproduction.md`](../docs/reproduction.md) 本机复现记录、[`../docs/prediction.md`](../docs/prediction.md) B 模块说明、`../docs/` 下两份官方原始模板。构建日志与未签名 HAP 在本地 `artifacts/harmony/`，默认不提交 Git；最终证据应在核实后复制或归档。

最终提交前逐项核对：

- [ ] 仓库有一个可构建、可安装并在目标设备/模拟器运行的 OpenHarmony 应用，写明系统与 SDK/API 版本。
- [ ] A 的页面事件脱敏、开关、会话接入和删除历史在设备上验证。
- [x] A/B/C 主机侧交接已验证，浏览器静态数据预取可复现。
- [ ] C/D 的目标平台预取、真实视图复用、预测落空取消和晚到资源释放完成设备联调。
- [ ] E 保存真实路径、基线与优化对照、点击可见时间和内存/资源开销原始证据。
- [ ] 基于原始 DOCX 模板完成设计文档，标明个人贡献和 `文件:行号#符号名` 证据。
- [ ] 准备视频或 PPT，并与实际设备演示及测量一致。
- [ ] 填写个人仓库地址；核对教师关于截止时间和提交方式的最新通知。
