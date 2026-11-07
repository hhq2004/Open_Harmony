# RFC：扩展 InteractionMeasurement 的可选字段

- 状态：**待 A/B/C/D 评审**
- 作者：E 模块（流水线与评测）
- 关联代码：`src/contracts.ts:59`、`src/measurement/`
- 本交付是否修改共享契约：**否**

## 1. 背景

共享契约 `src/contracts.ts` 只定义了：

```ts
export interface InteractionMeasurement {
  readonly interactionId: string;
  readonly pageId: string;
  readonly clickedAtMs: number;
  readonly visibleAtMs: number;
  readonly optimized: boolean;
  readonly predictionHit: boolean;
}

export interface MeasurementSink {
  record(measurement: InteractionMeasurement): void;
}
```

仅凭这些字段，E 无法可靠回答“这次交互对应哪个会话、预测了什么、任务是否复用了 D 的视图、消耗了多少字节、页面何时可交互”。当前 E 通过运行时可选扩展字段解决，但扩展字段还没有进入共享契约，A 在接入时容易遗漏或拼错。

## 2. 建议新增的可选字段

```ts
export type MeasurementBoundary = 'first-visit' | 'consecutive' | 'gap' | 'unknown';
export type MeasurementDataKind = 'synthetic' | 'host-observed' | 'device';

export interface InteractionMeasurement {
  readonly interactionId: string;
  readonly pageId: string;
  readonly clickedAtMs: number;
  readonly visibleAtMs: number;
  readonly optimized: boolean;
  readonly predictionHit: boolean;
  // 建议新增，全部可选，保持现有调用方源码兼容。
  readonly sessionId?: string;
  readonly interactiveAtMs?: number;
  readonly coldStart?: boolean;
  readonly boundary?: MeasurementBoundary;
  readonly predictedPages?: readonly string[];
  readonly actualPage?: string;
  readonly preloadTaskId?: string;
  readonly viewReused?: boolean;
  readonly prefetchedBytes?: number;
  readonly wastedBytes?: number;
  readonly dataKind?: MeasurementDataKind;
}
```

`MeasurementSink.record()` 的签名不变；`MeasurementRecord` 仍由 E 在写入时补齐 `schemaVersion` 和缺失字段的默认值。

## 3. 字段语义

| 字段 | 语义 | 默认值 |
| --- | --- | --- |
| `sessionId` | 匿名会话别名，不是账号/设备 ID | 缺省不写 |
| `interactiveAtMs` | 页面可交互的单调时间 | 缺省不写 |
| `coldStart` | 该交互是否为会话首次访问 | `false` |
| `boundary` | 上一轮到本轮是否连续，用于区分预测机会 | `unknown` |
| `predictedPages` | 上一轮实际发出的候选，按原顺序 | `[]` |
| `actualPage` | 实际进入页面，必须等于 `pageId` | `pageId` |
| `preloadTaskId` | C 的任务 ID，用于关联任务轨迹 | 缺省不写 |
| `viewReused` | 是否复用 D 的视图；要求 `optimized=true` | `false` |
| `prefetchedBytes` | C 数据租约字节，不是堆内存 | `0` |
| `wastedBytes` | 已取回但未消费的字节，不超过 `prefetchedBytes` | `0` |
| `dataKind` | 数据来源；报告据此决定能否声称设备结果 | `host-observed` |

## 4. 兼容性

- 全部新增字段可选；现有 A 调用方只传六个字段仍可编译、运行。
- `predictionHit=true` 时要求 `predictedPages` 包含 `actualPage`；如果 A 暂时不记录候选，可先记录 `predictedPages: [actualPage]`，但不能凭空声称命中。
- `viewReused=true` 要求 `optimized=true`，防止关闭优化的基线报告出现“复用”。
- 未知字段仍然拒绝；新增字段必须在这里登记，不能靠运行时透传。
- 不改变 `PathPredictor`、`PreloadScheduler`、`ViewPreparer` 接口，也不改变取消原因枚举。

## 5. 迁移建议

1. A 先在 `MeasurementSink.record()` 调用点补 `sessionId`、`interactiveAtMs` 和 `predictedPages`。
2. C/D 提供 `preloadTaskId`、`viewReused` 和字节估计；E 在本模块中汇总。
3. 设备接入后补 `dataKind='device'`，并在报告中单独记录设备/API/构建号。
4. 等 A/B/C/D 评审通过后，再改 `src/contracts.ts`；本 RFC 之前，`src/measurement` 的运行时校验已经覆盖这些字段，不阻塞当前交付。

## 6. 需要评审确认的问题

- `actualPage` 是否必须等于 `pageId`，还是允许一次点击产生多个页面目标？
- `prefetchedBytes` 是否只统计 C 的数据租约，D 的视图字节是否另开字段？
- 采集关闭/删除时，E 已经写出的报告是否需要按会话删除，还是只删除原始 JSONL？
- A 是否能在平台侧稳定提供 `interactiveAtMs`，还是只能提供 `visibleAtMs`？

在这些问题确认前，E 保持共享契约不变；本交付的扩展只存在于 measurement 模块内部，并已在 `docs/measurement.md` 说明默认值。
