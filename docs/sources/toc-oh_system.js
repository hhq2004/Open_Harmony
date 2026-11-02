/* 开源鸿蒙系统设计理论与实践 · 章节目录数据（篇 / 章 / 节 / 子节）
   说明：当前为目录设计阶段，各节尚未绑定 page（内容页后续逐步补齐）。 */
window.COURSE_TOC = [
{ part:'第一部分：系统认知与开发基础', chapters:[
  { ch:'第1章 OpenHarmony 概述', secs:[
    {no:'1.1', t:'操作系统演进与 OpenHarmony 定位', page:'part4/ch1/1.1/index.html', subs:[
      {no:'1.1.1', t:'从 Linux、Android 到 OpenHarmony', page:'part4/ch1/1.1/1.1.1/index.html'},
      {no:'1.1.2', t:'OpenHarmony 设计理念', page:'part4/ch1/1.1/1.1.2/index.html'},
      {no:'1.1.3', t:'OpenHarmony 与 HarmonyOS 的关系', page:'part4/ch1/1.1/1.1.3/index.html'},
    ]},
    {no:'1.2', t:'技术特性与开源生态', page:'part4/ch1/1.2/index.html', subs:[
      {no:'1.2.1', t:'全场景分布式能力', page:'part4/ch1/1.2/1.2.1/index.html'},
      {no:'1.2.2', t:'版本演进路线', page:'part4/ch1/1.2/1.2.2/index.html'},
      {no:'1.2.3', t:'开源社区与贡献方式', page:'part4/ch1/1.2/1.2.3/index.html'},
    ]},
    {no:'1.3', t:'本章测试', page:'part4/ch1/1.3/index.html'},
  ]},
  { ch:'第2章 系统架构总览', secs:[
    {no:'2.1', t:'分层架构', page:'part4/ch2/2.1/index.html', subs:[
      {no:'2.1.1', t:'内核层', page:'part4/ch2/2.1/2.1.1/index.html'},
      {no:'2.1.2', t:'系统服务层', page:'part4/ch2/2.1/2.1.2/index.html'},
      {no:'2.1.3', t:'框架层', page:'part4/ch2/2.1/2.1.3/index.html'},
      {no:'2.1.4', t:'应用层', page:'part4/ch2/2.1/2.1.4/index.html'},
    ]},
    {no:'2.2', t:'分布式架构', page:'part4/ch2/2.2/index.html', subs:[
      {no:'2.2.1', t:'超级终端与分布式软总线', page:'part4/ch2/2.2/2.2.1/index.html'},
      {no:'2.2.2', t:'分布式数据与任务调度', page:'part4/ch2/2.2/2.2.2/index.html'},
    ]},
    {no:'2.3', t:'一次开发、多端部署', page:'part4/ch2/2.3/index.html'},
  ]},
  { ch:'第3章 源码与开发环境', secs:[
    {no:'3.1', t:'源码获取与目录结构', page:'part4/ch3/3.1/index.html'},
    {no:'3.2', t:'编译构建体系（hb / GN / Ninja）', page:'part4/ch3/3.2/index.html'},
    {no:'3.3', t:'烧录与运行（开发板 / 模拟器）', page:'part4/ch3/3.3/index.html'},
    {no:'3.4', t:'调试与诊断（hdc / hilog / DFX）', page:'part4/ch3/3.4/index.html'},
  ]},
]},
{ part:'第二部分：内核与驱动', chapters:[
  { ch:'第4章 多内核架构', secs:[
    {no:'4.1', t:'Linux 内核与 LiteOS', page:'part4/ch4/4.1/index.html'},
    {no:'4.2', t:'内核抽象层 KAL', page:'part4/ch4/4.2/index.html'},
    {no:'4.3', t:'进程、线程与调度', page:'part4/ch4/4.3/index.html'},
    {no:'4.4', t:'内存管理', page:'part4/ch4/4.4/index.html'},
    {no:'4.5', t:'文件系统与存储', page:'part4/ch4/4.5/index.html'},
  ]},
  { ch:'第5章 硬件驱动框架 HDF', secs:[
    {no:'5.1', t:'HDF 驱动模型与架构', page:'part4/ch5/5.1/index.html'},
    {no:'5.2', t:'驱动生命周期与开发流程', page:'part4/ch5/5.2/index.html'},
    {no:'5.3', t:'外设驱动实战（GPIO / I2C / SPI / UART）', page:'part4/ch5/5.3/index.html'},
    {no:'5.4', t:'传感器与设备接入', page:'part4/ch5/5.4/index.html'},
  ]},
]},
{ part:'第三部分：系统服务与应用框架', chapters:[
  { ch:'第6章 系统服务架构', secs:[
    {no:'6.1', t:'系统服务管理 SAMgr', page:'part4/ch6/6.1/index.html'},
    {no:'6.2', t:'系统服务开发与注册', page:'part4/ch6/6.2/index.html'},
    {no:'6.3', t:'公共服务（通知 · 账号 · 电源 · 升级）', page:'part4/ch6/6.3/index.html'},
  ]},
  { ch:'第7章 应用框架', secs:[
    {no:'7.1', t:'Ability 组件模型（FA / Stage）', page:'part4/ch7/7.1/index.html'},
    {no:'7.2', t:'Ability 生命周期与调度（AppSpawn）', page:'part4/ch7/7.2/index.html'},
    {no:'7.3', t:'ArkUI 框架与渲染管线', page:'part4/ch7/7.3/index.html'},
  ]},
]},
{ part:'第四部分：分布式能力（核心特色）', chapters:[
  { ch:'第8章 分布式软总线', secs:[
    {no:'8.1', t:'软总线通信原理', page:'part4/ch8/8.1/index.html'},
    {no:'8.2', t:'组网与设备发现', page:'part4/ch8/8.2/index.html'},
    {no:'8.3', t:'传输与会话管理', page:'part4/ch8/8.3/index.html'},
    {no:'8.4', t:'软总线实战：两台设备互通', page:'part4/ch8/8.4/index.html'},
  ]},
  { ch:'第9章 分布式数据管理', secs:[
    {no:'9.1', t:'分布式数据模型', page:'part4/ch9/9.1/index.html'},
    {no:'9.2', t:'分布式数据库与冲突解决', page:'part4/ch9/9.2/index.html'},
    {no:'9.3', t:'分布式文件与对象', page:'part4/ch9/9.3/index.html'},
  ]},
  { ch:'第10章 分布式任务调度与设备虚拟化', secs:[
    {no:'10.1', t:'跨设备流转（迁移与拉起）', page:'part4/ch10/10.1/index.html'},
    {no:'10.2', t:'设备虚拟化', page:'part4/ch10/10.2/index.html'},
    {no:'10.3', t:'分布式安全与权限', page:'part4/ch10/10.3/index.html'},
  ]},
]},
{ part:'第五部分：系统优化与综合实践', chapters:[
  { ch:'第11章 系统启动与升级', secs:[
    {no:'11.1', t:'启动流程全景', page:'part4/ch11/11.1/index.html'},
    {no:'11.2', t:'OTA 与差分升级（系统视角）', page:'part4/ch11/11.2/index.html'},
  ]},
  { ch:'第12章 安全子系统', secs:[
    {no:'12.1', t:'安全架构总览', page:'part4/ch12/12.1/index.html'},
    {no:'12.2', t:'权限与沙箱机制', page:'part4/ch12/12.2/index.html'},
  ]},
  { ch:'第13章 性能与功耗优化', secs:[
    {no:'13.1', t:'性能分析方法论', page:'part4/ch13/13.1/index.html'},
    {no:'13.2', t:'功耗治理（HiView / HDF 电源）', page:'part4/ch13/13.2/index.html'},
  ]},
  { ch:'第14章 综合项目实践', secs:[
    {no:'14.1', t:'综合分析项目（课程设计）', page:'part4/ch14/14.1/index.html'},
    {no:'14.2', t:'课程总结与展望', page:'part4/ch14/14.2/index.html'},
  ]},
]},
];
