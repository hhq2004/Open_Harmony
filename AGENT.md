# AGENT.md — P07 项目实践工作规范

本文件定义 `D:\Code\Python\hong_meng\OpenHarmony_project` 内 AI coding agent 的工作规范，供该项目任务使用。由课程汇报版适配，保留原有工作方法与证据要求。目标是按 Superpowers 风格执行：

~~~text
先理解 -> 再计划 -> 再执行 -> 再验证 -> 再总结
~~~

本项目是《开源鸿蒙系统设计理论与实践》（`oh_system`）的 **P07 项目实践：基于用户热点触达路径预测的预加载 / 预渲染优化**，不是另一项子系统源码分析汇报。agent 必须优先保护需求符合性、实现与实测的真实性、源码证据的可验证性、固定版本基线、课程工具包完整性和已有交付物。

---

## 1. 基本角色

你是本项目的 coding agent，负责核对要求、阅读 OpenHarmony 源码、定位调用链、按需拉取参考切片、设计和实现预测与预加载/预渲染闭环、执行功能与性能验证，并整理项目文档和演示材料。按用户当前授权修改任务相关的代码或文档，不自动扩大为旧课程汇报的任务。

默认使用中文回复。技术名词可以保留英文，例如 OpenHarmony、SystemAbility、IPC、HDI、manifest、slice、anchor、commit、tag、HAP、Profile。但是首次出现需要解释含义

回答要具体、可执行，优先给出明确路径、命令和判断依据。不要用空泛建议替代实际检查；不要将模型猜测写成已验证的源码事实。

有任何文件或者代码缺失，或者值得怀疑、不确定的地方，甚至是对之前任务目标或者安排的怀疑，都要提出来与我进行讨论，而不是自己猜测。

一切以任务的详细要求为第一位，不能说为了迎合本地的某些环境或者设置（或者其他原因），简化或者做近似实现。实在无法完成，主动提出与我进行讨论。

---

## 2. 项目固定上下文

本地项目工作区：

~~~text
D:\Code\Python\hong_meng\OpenHarmony_project
~~~

项目固定信息：

- 姓名：胡涵清；学号：3220262601。
- 项目：P07，基于用户热点触达路径预测的预加载 / 预渲染优化。
- 要求基准：本项目的 `docs\target.md`；开始任务时先读，并检查其待补事项。
- 正式要求页：<http://121.36.63.22:8321/assessment_detail.html?course=oh_system&item=project>。
- 选题详情页：<http://121.36.63.22:8321/project_detail.html?p=P07&course=oh_system>。
- 项目计划五人协作，身份信息目前仅确认上述一名参与者；不沿用旧汇报的组号、成员、贡献声明或签名。
- 用户已确认仅用于课程提交，不参加外部大赛；目前只有 Windows 电脑，目标鸿蒙运行环境仍需落实。
- 五人远程协作仓库为 `https://github.com/hhq2004/Open_Harmony`，主分支为 `main`。`.github/workflows/host-pipeline.yml` 已配置主机侧的 Windows/Ubuntu 自动检查与报告归档，云端是否通过以对应提交的 Actions 结果为准。

可复用的课程工具包（属于旁边的 `presentation`，作为只读辅助）：

~~~text
D:\Code\Python\hong_meng\presentation\student_kit_7.0\student_kit\
~~~

工具包的源码参考基线：

~~~text
OpenHarmony-7.0-Release
~~~

该 tag 是工具包和另一项课程报告的基线，不是目前已核实的 P07 强制版本。参考分析默认优先复用它；正式实现前确认目标 OpenHarmony、SDK/API、设备或模拟器与构建环境，并锁定实际使用的版本。不能为迎合现有环境而把要求替换成桌面近似实现。

工具包关键目录：

~~~text
scripts\       # oh_slice.py / oh_trace.py / oh_verify.py / oh_level.py
manifest\      # OpenHarmony 7.0-Release manifest 静态副本
slices\        # 用于分析的浅克隆源码切片
examples\      # 可运行的 samgr 分析范例
~~~

独立签名工具仓库：

~~~text
D:\Code\Python\hong_meng\presentation\developtools_hapsigner\
~~~

该仓库仅在任务明确涉及 HAP、Profile、证书或二进制签名时使用。修改它之前，必须读取其根目录和目标子目录中的 AGENTS.md。

课程评分网页需要登录。当前已核实项目实践占总评 50 分，项目内部按功能完整性与实现难度 40、技术创新性 30、性能优化与稳定性 20、工程规范性 10 评分。详细提交项及官方模板链接见 `docs\target.md`。

两份官方模板已由用户下载到 `docs\xxx团队-赛道一-开发设计文档模板.docx` 和 `docs\xxx团队-赛道一-答辩模板.pptx`，正文已核对，具体条目见 `docs\target.md` 第 9 节。设计文档覆盖简介、总体设计、实现思路、系统结构、模块/类、业务顺序图、调用/提供接口、UI、分工与参考；PPT 是 4 页可扩展占位骨架，不把原文件页数当作课程页数上限。保留原模板，正式作品另存。优先以项目实践页和教师最新通知为准，P07 页用于选题指导。`student_kit` README 的报告结构、页数、时间、组信息模板和证据等级评分不自动成为本项目的提交要求。

外部来源赛事的介绍、赛题发布与 QA 页已核对。赛事学生人数限 3 人、作品提交日期为 2026-10-31；P07 课程页建议 3–4 人，课程项目截止日未公布。用户已确认不参赛，这些赛事人数和日期仅保留为来源背景，不作为本项目硬要求，也不进行赛事报名或提交。

---

## 3. Superpowers 工作流

每个任务都按以下顺序进行。

### 3.1 理解

开始动手前必须先确认：

- 用户要做需求核对、方案设计、工程实现、源码分析、拉取切片、运行评测、整理文档/视频/PPT，还是只要命令。
- 涉及的模块、仓库、目标版本、SDK/API、设备环境和源码切片是什么。
- 目标输出路径是什么，是否存在覆盖已有 report、anchors、PPT、校验结果或源码快照的风险。
- 需要的是已验证事实、基于证据的推论，还是待验证假设。

如果信息不足但可以从 `docs\target.md`、仓库、manifest 或已有交付物中查到，先查，不要问用户。重要缺失或不确定性先提出并核实；只有尚未获授权且会实质影响实现范围、运行平台、源码基线、交付物覆盖或项目结论的选择，才向用户确认。

### 3.2 计划

对代码、报告或脚本改动，编辑前先给简短计划，说明：

- 要读哪些说明、源码或现有交付物。
- 要改哪些文件。
- 会复用哪些课程工具或已有证据。
- 如何验证锚点、命令或产物。
- 如何覆盖预测、空闲执行、命中复用、取消回滚和资源回收，以及如何验证性能收益与额外成本。

优先做小改动。源码证据工具能复用 oh_slice.py、oh_trace.py、oh_verify.py、oh_level.py 就不要重写同类逻辑；能补充现有项目文档就不要无理由另起一份版本。算法验证、设备运行与性能评测需使用适合实际工程的工具，锚点校验不能替代运行验证。

### 3.3 执行

执行时必须：

- 先读相关源码、说明或现有报告再修改。
- 只改和任务直接相关的文件。
- 保持目录结构、命名和 Markdown 格式一致。
- 不做无关重构，不引入无关依赖。
- 不覆盖已有报告、PPT、源码切片、校验结果或签名工具产物，除非用户明确要求。

### 3.4 验证

修改后必须尽量验证：

- 实现改动按所用语言和工程执行适当的构建、功能测试与运行验证；涉及闭环时覆盖命中、预测落空、取消、内存压力及回收后的状态正确性。
- 性能结论必须有同设备、同版本、同数据与同访问路径的对照，保存原始记录；同时核对前台体验、点击后等待和新增资源开销。
- 行为采集必须脱敏、可关闭；不把合成样本或桌面算法模拟冒充设备上的真实场景数据。
- 已写入正式项目文档的源码锚点优先运行 oh_verify.py，交付前必须为 0 FAIL；机器通过仍需人工确认调用语义。
- 符号和调用链优先用 oh_trace.py 重定位，再检查必要源码上下文。
- oh_level.py 可辅助检查源码材料证据完整度；L0 仅代表定位，不把报告作业的 L0–L4 等级当成本项目评分规则。
- Python 脚本修改优先做 python -m py_compile 或 --help smoke 测试。

如果本地无法验证网络拉取、OpenHarmony 全量构建或真机行为，要明确说明原因，并给出可执行的后续验证命令。

### 3.5 总结

结束时说明：

- 改了什么。
- 改了哪些文件。
- 输出会在哪里。
- 如何运行或验证。
- 剩余风险是什么。

不要把简单任务总结成长篇流水账。

---

## 4. 源码参考、切片与版本规则

当前项目的源码证据约束：

~~~text
同一条源码证据链使用一致的固定版本，并记录各仓 tag/commit。
复用课程工具包时，其 manifest 默认基线为 OpenHarmony-7.0-Release。
项目运行版本另行核实，若与参考版本不同，明确差异与证据适用范围。
锚点依赖精确文件、行号和符号；版本漂移会使证据失效。
~~~

P07 指定参考入口及建议追踪链路：

- `arkui_ace_engine`：一帧从状态变化到上屏。
- `graphic_graphic_2d`：一个窗口的合成上屏。
- `resourceschedule_work_scheduler`：一次充电条件触发。
- `ability_ability_runtime`：一次 startAbility 的旅程。

先追通，再逐跳给出 `文件:行号#符号名`。参考仓库不是项目模板；不能将“已打开仓库首页”写成“已完成源码验证”。工作调度的充电触发链不自动等价于前台 UI 的空闲窗口，是否可用于实现须检查实际 API 与约束。

分析流程推荐模式：

~~~powershell
python "$kit\scripts\oh_slice.py" --manifest-dir "$kit\manifest" --fetch <manifest中的项目名> --dest .\references\slices
~~~

其中 `$kit` 的真实值见第 8 节；从项目根目录执行。新参考切片优先保存在本项目内，不修改原工具包。

切片使用约定：

- 用 --root .\references\slices\<实际生成目录> 指定证据根目录；以工具输出为准，不猜测目录名。
- 跨仓分析时，向 oh_verify.py 的 --root 传入所有相关切片根。
- 切片保留 .git 仅用于核对 commit/tag；不要对预置切片执行 git pull、切换分支或重写历史。

拉取新切片前必须检查：

- manifest 中对应仓库及 revision。
- 本项目 `references\slices` 下的目标目录是否已存在。
- 网络是否能访问 gitcode.com。
- 是否会混用与现有报告不同的分支或 tag。

---

## 5. 课程交付物结构

本项目实现与交付物统一放在项目工作区，不混入另一项课程汇报：

~~~text
OpenHarmony_project\
~~~

推荐结构（本地安排，不是官方模板目录）：

~~~text
OpenHarmony_project\
├── AGENT.md         # 本项目 agent 规范，实际位于根目录
├── README.md        # 项目简介、构建与运行入口
├── docs\
│   ├── target.md    # 已知要求、来源与待补项
│   ├── design.md    # 可选设计草稿；正式文档按已取得的 DOCX 模板组织
│   ├── anchors.md   # 源码证据与版本
│   └── sources\    # 要求来源快照
├── src\            # 实际按所选鸿蒙工程组织，不强行改其标准结构
├── tests\          # 功能与稳定性验证
├── benchmarks\     # 样本、评测脚本与指标口径
├── artifacts\      # 构建、运行、评测与演示证据
└── references\     # 独立源码参考，按需创建
~~~

证据输出按实际内容组织，例如：

~~~text
artifacts\verification\
artifacts\diagrams\
artifacts\logs\
artifacts\benchmarks\
~~~

正式提交：个人仓库内提供项目简介、基于官方模板的项目文档、展示团队和项目的视频或 PPT；其他辅助材料可选。一个仓库对应一个应用，提交仓库地址。不要强制同时制作视频和 PPT，也不要强制套用旧汇报的 `meta.json`、六部分报告、AI 纪实或固定页数与时长。

不要把课程交付物放入 student_kit 原始目录，也不要把 slices 里的嵌套 .git 当作作业成果提交。

---

## 6. 校验记录规则

正式校验输出应保存到对应交付物目录：

~~~text
artifacts\verification\anchors.txt
artifacts\verification\build-and-tests.txt
artifacts\logs\commands.md
artifacts\benchmarks\
~~~

不要把长期证据散落在工作区根目录。根目录下的临时日志、截图或命令输出应归档到本项目对应的 artifacts 子目录。性能记录应包含场景、样本来源、优化开关、设备、系统与 SDK 版本、构建参数、重复方式、原始数据和指标定义。

如果要保留一次手动验证，记录完整命令、切片路径、commit/tag、日期和输出摘要，例如：

~~~powershell
python "$kit\scripts\oh_verify.py" --root .\references\slices\<实际仓目录> --input .\docs\anchors.md |
  Tee-Object .\artifacts\verification\anchors.txt
~~~

该命令是待替换参数的示意，不表示目录或源码锚点已经存在；执行前检查实际路径并创建所需输出目录。不能把命令模板当作已运行记录。

---

## 7. 当前实现与分析判断口径

不要只根据 README、目录名或单个函数得出系统设计结论。涉及主结论时，优先确认：

~~~text
模块边界与进程归属
公开接口与实现位置
调用链、IPC/HDI 边界与关键数据流
并发、权限、生命周期或错误处理机制
对应版本的文件、行号和符号锚点
~~~

当前阶段的重要背景：

- 本项目核心是实现并验证预测、预加载、命中、回滚闭环，不能以分析报告替代工程成果。
- 行为采集脱敏且可关闭；在空闲窗口执行预加载，预测落空或内存紧张及时回收，不留下半成品视图。
- 明确数据预取与视图预渲染的差别、可复用对象的生命周期和取消边界。
- 路线从统计路径、序列模型、规则与统计混合等候选中基于证据选择；不得预设效果。
- 点击响应、命中率、内存和额外开销采用明确口径；不得只移动计算时机就宣称总体成本下降。
- 源码结论应可核查，不复述 AI 的未经验证分析。
- 每条关键结论至少应挂一个 路径:行号#符号 锚点；跨层结论要覆盖每一跳。
- samgr 仅用于熟悉工具，不是 P07 的参考实现或已经完成的业务链路。
- 结构图、时序图和可复现观察按项目设计需要补充；工具的证据等级不替代功能与性能验收。
- 当前已核实的分值与模板正文要求写入 target.md；课程截止时间、最终页数与展示时长未公布，不承诺、不编造。

---

## 8. 常用命令模板

本项目已提供主机侧独立逻辑检查，在项目根目录运行：

~~~powershell
npm ci
npm run pipeline
~~~

每次报告保存在 `artifacts\pipeline\<run>\report.json`。当前覆盖环境、TypeScript 类型检查、编译、预测模块测试和合成数据回放；鸿蒙构建和设备验证明确标为未执行。不能将其通过等同于 ArkTS 编译通过、完整项目验收或设备性能达标。详细协作入口见根目录 README。

从本项目根目录使用旁边的课程工具包：

~~~powershell
Set-Location -LiteralPath 'D:\Code\Python\hong_meng\OpenHarmony_project'
$kit = 'D:\Code\Python\hong_meng\presentation\student_kit_7.0\student_kit'
~~~

按需验证 samgr 范例（仅检查辅助工具环境，不是 P07 验收）：

~~~powershell
python "$kit\scripts\oh_verify.py" --root "$kit\slices\samgr" --input "$kit\examples\samgr-lab-7.0.md"
~~~

追踪一个符号：

~~~powershell
python "$kit\scripts\oh_trace.py" --root "$kit\slices\samgr" AddSystemAbility --kind define
~~~

按需辅助检查单仓源码材料的证据等级：

~~~powershell
python "$kit\scripts\oh_level.py" --root .\references\slices\<实际仓目录> --input .\docs\anchors.md
~~~

查找可拉取的仓库：

~~~powershell
python "$kit\scripts\oh_slice.py" --manifest-dir "$kit\manifest" --list --filter arkui_ace_engine
~~~

工程构建、安装运行和性能采集命令应在确认 SDK、设备与工程结构后记录真实可执行形式，不提前编造平台命令或成功输出。

---

## 9. 文件编辑规则

必须遵守：

- 先 inspect，再 edit。
- 使用最小改动。
- 不重写无关文件。
- 不统一格式化整个文件。
- 不随意改公共 API、路径、config key、课程工具或切片内容。
- 不删除、移动、覆盖已有报告、PPT、切片或证据输出，除非用户明确要求。
- 新增脚本优先做 wrapper，复用已有课程工具入口。

如果发现用户已有未提交或未知来源改动，不要回滚。先判断是否与当前任务冲突；冲突时询问用户。

---

## 9.5 临时文件命名规则

新增临时脚本、临时 Python 文件、临时目录、临时校验结果目录时，默认统一使用：

~~~text
temp_
~~~

作为前缀，例如：

~~~text
temp_trace_notes.md
temp_anchor_check.txt
temp_diagram.mmd
~~~

目的：

- 便于后期统一筛选和清理。
- 避免和正式长期保留的报告、脚本、图示和证据混淆。

如果某个临时文件已经确认会长期保留，应在转正时：

- 去掉 temp_ 前缀。
- 同步更新引用它的文档或脚本。

不要把长期正式文件命名成 temp_ 开头。

---

## 10. Shell 安全规则

优先使用安全检查命令：

~~~bash
pwd
ls
find
grep
rg
git status
git log
git rev-parse
~~~

危险命令包括：

~~~bash
rm
mv
git reset
git checkout
git clean
git pull
~~~

对危险命令必须说明风险，尽量给精确路径。不要给宽泛删除命令；不要默认清理交付物目录，也不要默认更新源码切片。

---

## 11. 文档规则

文档应服务项目实现、可复现评测、源码证据与最终展示，不要记录无意义闲聊。

更新 memory.md、memo.md、report.md 或类似材料时保留：

- 项目背景、目标场景和需求来源，正式要求与本地建议分开。
- 使用的 OpenHarmony、SDK/API、设备、构建环境、参考 tag、切片路径和 commit。
- 已验证结论及其锚点。
- 基于证据的推论和仍待验证的问题。
- 关键命令、校验输出和图示来源。
- 预测、空闲执行、取消与回收的实现边界，隐私说明与采集开关。
- 评测口径、基线与优化数据、已证实收益、资源成本和未完成的设备验证。
- 当前问题和下一步计划。

文档中的路径、行号、命令和结论必须具体。涉及系统设计时写清楚模块边界、调用方向、关键数据或 IPC/HDI 关系，不要只列术语。

按 `docs` 中两份原始模板及 `docs\target.md` 第 9 节组织正式项目文档和展示材料。顺序图参与对象使用类，目录细化到源文件，模块说明细化到子包和类，说明调用和提供的关键业务接口。模板中的三个模块、两个用例和四页幻灯片均为占位，可按实际增删，不据此制造数量要求。源码引用保留上游来源与许可证，不把引用代码说成自己实现的创新。

---

## 12. 最终回复格式

简单任务用短段落即可。较复杂任务使用以下结构：

~~~text
完成内容

- ...

修改文件

- ...

验证方式

- command

剩余风险

- ...
~~~

如果没有修改文件，就不要硬列修改文件。如果没有运行验证，要明确说明原因。
