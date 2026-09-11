# RTS 阶段 B · 宏观沙盘 MVP 设计细化（design-rts-stage-b）

> 定位：对 [design-rts-overview.md](design-rts-overview.md) §九「阶段 B · 宏观沙盘 MVP」9 步草案（B1-B9）的落地级细化，结合当前代码库（2026-09-11）实际状态复核每步的复用点、接口形状、风险与验收标准。
>
> 状态：**设计细化 + 技术预研中**（2026-09-11 启动，M1 等待期先行，不碰业务逻辑）。阶段 B 正式落地仍需商业化闭环 + 真实多产线场景触发（见 overview §十）。
>
> 约定：延续 overview 的工业沙盘本体论、算力分工（服务器算业务 / 浏览器 GPU 渲染）、LOD 低模优先、db.ts 抽象、i18n + 设计 token、原子提交英文 message。

## 一、当前代码库复用盘点（2026-09-11 复核）

| L1 已有能力 | 文件 | 阶段 B 复用方式 |
|---|---|---|
| three.js 场景基建（renderer / camera / lights / ground / grid / shadow） | `Canvas3D.tsx` mount-once effect (L201-311) | **直接复用模式**：CanvasPark 用同样的 mount-once effect 结构，参数调整（更大地面、更远阴影相机） |
| 正交相机 + 锁俯角 + OrbitControls | `Canvas3D.tsx` L226-251 | **直接复用**：PITCH/YAW/CAMERA_DIST 常量可提取共享，OrbitControls 配置相同（LEFT=PAN, minPolarAngle=maxPolarAngle=PITCH） |
| mount-once + data-sync 双 effect 防重建 | `Canvas3D.tsx` L200-679 vs L682-742 | **必须复用**：CanvasPark 用 `parkRef`（SceneState 等价物）+ mount-once `[]` + data-sync `[parks]` 双 effect，杜绝 graph 变更重建 renderer（audit M30 教训） |
| SceneState 可变共享状态 | `Canvas3D.tsx` L60-73 | **模式复用**：定义 `ParkSceneState`（factoryGroup / instancedMesh / layout / selectedId / prevSel） |
| Raycast 点选 + pointer capture + pointercancel | `Canvas3D.tsx` L313-431 | **直接复用模式**：工厂点选用同样的 pointerdown/move/up + setPointerCapture + pointercancel 兜底 |
| 状态 LED 每帧更新（呼吸动画） | `Canvas3D.tsx` L597-608 | **复用模式**：工厂状态色每帧更新（running=绿呼吸 / failed=红 / halted=黄脉冲 / idle=灰），用 InstancedMesh 的 instanceColor |
| Runtime ref 模式（每帧读、不重建场景） | `Canvas3D.tsx` L194-196, L537 | **必须复用**：CanvasPark 用 `parkDataRef.current = parkData`，rAF 循环每帧读 ref 更新颜色/角标，不触发 React 重渲染 |
| disposeGroupChildren + 全 traverse cleanup | `Canvas3D.tsx` L77-90, L656-673 | **直接复用**：InstancedMesh 需额外 dispose geometry+material，cleanup 遍历 dispose |
| XZPolyline 路径跟随（卡车） | `iso3d.ts` L41-82 | **阶段 B 暂不复用**：B 不做跨厂物流（留 C2），但卡车机制可扩展到园区尺度 |
| boardToWorld / worldToBoard 坐标映射 | `iso3d.ts` L9-16 | **不直接复用**：L0 用独立的园区坐标系（parkX/parkZ），不与 L1 board 坐标混用；但映射模式相同（原点居中） |
| zoomToFrustum / viewportCenterToWorld | `iso3d.ts` L19-35 | **可复用**：L0 相机 frustum 计算同理，但 VIEW_W/VIEW_H 换成园区视口尺寸 |
| iso3d-shapes.ts 29 种程序化造型 | `iso3d-shapes.ts` | **不复用**：L0 用低模盒体 + 类别色 billboard，不用 L1 精细造型；但 `statusLedColor` / `setGroupEmissive` / `SELECT_COLOR` 配色语义可复用 |
| 跨产线聚合接口（阶段 A 已建） | `db.operationsByGraph` / `GET /api/operations/overview` | **直接复用 + 扩展**：B3 在 A2 接口基础上加 L0 字段（类别、园区坐标），不新建接口 |
| React.lazy 独立 chunk | `Canvas3D.tsx` 被 lazy 加载 | **必须复用**：CanvasPark 独立 chunk，2D/单厂用户不加载宏观代码 |

**结论**：L1 的渲染引擎、相机、交互、状态驱动、cleanup 模式全部可复用。阶段 B 的新增量集中在：① 低模工厂几何（InstancedMesh）；② 园区自动布局算法；③ 园区坐标持久化；④ 钻取 L1 的场景切换。**不是第二套渲染器，是 L1 模式的多实例编排。**

## 二、阶段 B 范围与边界（复核）

### 做（B 范围）
- N 座**低模**工厂同屏（盒体 + 类别色 + 顶部类别 billboard + 状态 LED）
- 工厂状态色实时驱动（信息 1：运行态）
- 待办角标（信息 2：F2 待审数，工厂上方数字角标）
- 点击工厂 → 250ms 交叉淡切 → 钻取 L1（B8，不做连续 zoom）
- 园区自动布局 v1（按类别聚簇）
- 园区坐标持久化（自动布局结果可手动覆盖）
- LOD/帧率：InstancedMesh + 视口外冻结

### 不做（留 C 或以后）
- ❌ 跨厂物流管道/货运车队（C2）
- ❌ L0↔L1 连续 zoom（C3，B 用淡切）
- ❌ 资源经济栏（C4）
- ❌ 排期时间轴/拖拽改期（C5）
- ❌ 效果热度条（C6）
- ❌ 宏观轻操作全集（审批卡/重试/改期，C7；B 只做钻取 + 轻量重试/暂停 cron 浮层）
- ❌ 图结构编辑（增删节点/连线，永远在 L1/L2）

## 三、B1-B9 逐步细化（结合当前代码库）

### B1 · 园区布局持久化

**目标**：每条产线（graph）在园区地图上有一个 (parkX, parkZ) 坐标，自动布局结果可手动覆盖，持久化到 DB。

**当前状态**：graphs 表已有 `id/user_id/name/doc/version/updated_at/origin_template_id`，无园区坐标列。

**方案**：
- 在 graphs 表加两列：`park_x REAL DEFAULT NULL`、`park_z REAL DEFAULT NULL`（NULL = 未布局，前端用自动布局）
- 迁移走 `schema_migrations`（当前 schemaVersion=36，新迁移号 37）
- `db.ts` 加方法：
  - `getParkCoords(userId): Map<graphId, {x,z}>` — 批量读所有已布局坐标
  - `setParkCoord(userId, graphId, x, z)` — 写单条（手动覆盖时）
  - `clearParkCoord(userId, graphId)` — 恢复自动布局
- **不新建表**：坐标是 graph 的属性，挂 graphs 表最自然，避免 JOIN
- 兼容 SQLite / PostgreSQL 双轨（REAL 类型两边通用）

**验收**：
- db 单测：CRUD + 跨用户隔离 + NULL 回落自动布局 + 迁移幂等
- 旧库升级：已有 graph 的 park_x/park_z 为 NULL，前端自动布局

**风险**：无。纯加列 + db.ts 方法，不碰业务逻辑。

---

### B2 · 纯函数 parkLayout.ts（宏观自动布局 v1）

**目标**：输入产线列表（含 id + 类别 + 可选手动坐标），输出每条产线的 (parkX, parkZ)，无重叠、同输入稳定、手动坐标优先。

**当前状态**：无。L1 的布局是用户手动拖节点（`moveNode`），无自动布局。

**方案**：
- 纯函数，不依赖 React/three.js，可单测
- 输入：`{ id: string; category: string; manual?: {x:number; z:number} }[]`
- 输出：`Map<id, {x:number; z:number}>`
- 算法 v1（类 BFS 分层 + 类别聚簇）：
  1. 手动坐标的产线先占位（fixed set）
  2. 剩余产线按 category 分组，每组排成一行（row），行间距 = FACTORY_SIZE * 2
  3. 组内行内间距 = FACTORY_SIZE * 1.5
  4. 组间按 category 名字典序排列，从中心向外展开
  5. 碰撞检测：新位置与已有位置（含手动）距离 < FACTORY_SIZE * 1.2 则顺延到下一个空位
- 常量：`FACTORY_SIZE = 200`（园区坐标单位，比 L1 board 坐标大一个量级）
- 稳定性：同输入同输出（排序用 category + id 字典序，不依赖遍历顺序）

**验收**：
- 纯函数单测：N=0（空 Map）/ N=1（原点）/ N=10（无重叠）/ 含手动坐标（手动优先、自动不重叠）/ 同输入两次调用结果一致
- 性能：N=100 布局 < 1ms（纯计算，无 DOM）

**风险**：布局美观度是主观的，v1 只求"无重叠 + 类别聚簇"，后续可迭代更优算法（力导向、网格填充）。纯函数可替换，不影响其他模块。

---

### B3 · 扩展 A2 overview 接口（加 L0 字段）

**目标**：阶段 A 已建 `GET /api/operations/overview`（返回全局状态 + 每产线卡数据），阶段 B 在其基础上加 L0 所需字段，不新建接口。

**当前状态**：A2 接口返回 `{ totals, graphs: [{ id, name, status, lastRunAt, costToday, haltedCount, nextRuns }] }`（具体形状以 `api.operations.test.ts` 为准）。

**方案**：
- 在每 graph 对象加字段：
  - `category: string` — 产线类别（从 graph.doc 或模板元数据提取，用于布局聚簇 + 低模配色）
  - `parkX: number | null`、`parkZ: number | null` — 已持久化的园区坐标（NULL = 前端自动布局）
  - `pendingReview: number` — 待审数（F2，用于角标）
- `category` 来源：优先 `graph.doc.category`（如果模板/产线有类别字段），兜底从 `origin_template_id` 映射模板类别，再兜底 `"uncategorized"`
- **不改动 A2 的 totals 和已有字段**，只追加，保证阶段 A 的 OperationsDashboard 不受影响
- api 测试：新字段齐全 + 旧字段不变 + 跨用户隔离

**验收**：
- api 测试：返回形状含新字段 + 旧字段兼容 + 未认证 401
- OperationsDashboard（阶段 A）回归：不受新字段影响

**风险**：`category` 字段的来源需要确认 graph.doc 是否有类别概念。如果没有，B3 需要先定义产线类别（可从模板名推断，或加一个 doc.category 字段）。**这是 B3 的前置确认项**。

---

### B4 · CanvasPark.tsx L0 场景（低模工厂 + 地面 + 相机）

**目标**：新建 `apps/web/src/canvas/CanvasPark.tsx`，渲染 N 座低模工厂的 3D 园区场景，`React.lazy` 独立 chunk。

**当前状态**：无 L0 场景。L1 `Canvas3D.tsx` 是单厂精细视图。

**方案**（严格复用 L1 mount-once 模式）：

```
CanvasPark.tsx 结构：
├── Props: { parks: ParkFactory[]; onSelect: (id) => void; selectedId?: string }
├── ParkFactory = { id, name, category, status, pendingReview, parkX?, parkZ? }
├── mountRef (div)
├── parkRef (ParkSceneState, 等价 L1 SceneState)
│   ├── factoryGroup: THREE.Group
│   ├── instancedMesh: THREE.InstancedMesh  (低模盒体)
│   ├── billboardGroup: THREE.Group  (顶部类别标签 + 待审角标)
│   ├── layout: Map<id, {x,z}>
│   ├── selectedId: string | null
│   └── prevSel: string | null
├── dataRef (每帧读的实时数据 ref，等价 L1 runtimeRef)
├── mount-once effect []:
│   ├── WebGLRenderer (antialias, shadowMap)
│   ├── OrthographicCamera (PITCH/YAW 同 L1, CAMERA_DIST 更大 ~3000)
│   ├── OrbitControls (LEFT=PAN, 锁俯角, zoom)
│   ├── AmbientLight + DirectionalLight (阴影相机范围更大)
│   ├── Ground (5000x5000, 深色) + GridHelper
│   ├── 空 factoryGroup / billboardGroup
│   ├── InstancedMesh (BoxGeometry(180,120,180), MeshLambertMaterial, maxCount=100)
│   ├── Raycast 点选 (pointer capture + pointercancel, 同 L1)
│   ├── rAF 循环 (每帧读 dataRef 更新 instanceColor + 角标)
│   └── cleanup (全 traverse dispose + renderer.dispose + forceContextLoss)
├── data-sync effect [parks]:
│   ├── 计算布局 (parkLayout + 手动坐标优先)
│   ├── 更新 InstancedMesh 的 instanceMatrix (每厂位置+缩放)
│   ├── 更新 billboard (类别标签 sprite + 待审角标 sprite)
│   ├── 重置 selected highlight
│   └── 不重建 renderer/camera/loop
└── return <div ref={mountRef} className="canvas-park" />
```

**低模工厂设计**：
- 主体：BoxGeometry(180, 120, 180)，类别色（复用 L1 ARTIFACT_COLORS 或新增 6 类工厂色）
- 顶部：PlaneGeometry billboard（类别名文字 sprite，始终面向相机）
- 状态：instanceColor 每帧更新（running=绿呼吸 / failed=红 / halted=黄 / idle=灰）
- 待审角标：工厂右上角小圆形 sprite + 数字（pendingReview > 0 时显示）
- 选中：instanceColor 提亮 + 底部圆环（RingGeometry）

**关键技术决策**：
- **InstancedMesh**：N 座工厂用一个 draw call，而不是 N 个 Mesh。这是 LOD 性能的核心。instanceMatrix 存位置+缩放，instanceColor 存状态色。
- **Billboard 用 Sprite**：THREE.Sprite 始终面向相机，适合文字标签和角标。文字用 CanvasTexture 动态生成。
- **相机距离**：L0 CAMERA_DIST ~3000（L1 是 1200），因为园区尺度更大。阴影相机范围也要相应放大（left/right/top/bottom ~2500）。
- **地面尺寸**：5000x5000（L1 是 3000x3000）。

**验收**：
- typecheck 通过
- 浏览器看 N=10 厂立起来、状态色正确、可平移/缩放/旋转
- 2D 用户不加载该 chunk（React.lazy + 独立路由）
- graph/parks 变更不重建 renderer（回归测试：mount 一次后 parks 变化，renderer 引用不变）

**风险**：
- InstancedMesh 的 raycast 需要特殊处理（`intersectObject` 对 InstancedMesh 返回 instanceId），需要在 raycast 结果中取 `instanceId` 映射到 graphId。**这是 B4 的技术预研重点。**
- Billboard Sprite 的文字 CanvasTexture 生成性能：N=100 时每厂一个 CanvasTexture 可能耗内存，可缓存同类别的文字纹理。

---

### B5 · LOD/帧率优化

**目标**：10+ 产线中端机 ≥ 30fps。

**当前状态**：L1 单厂精细视图在中端机稳定 60fps（节点数通常 < 30）。L0 同屏 N 厂需要专门优化。

**方案**：
- **InstancedMesh**（B4 已做）：N 厂一个 draw call，这是最大优化
- **视口外冻结**：rAF 循环中，对视口外的工厂跳过 instanceColor 更新（虽然 InstancedMesh 还是一个 draw call，但颜色计算可省）。实际上 InstancedMesh 的颜色更新是批量的（一次 setColorAt），不需要逐厂判断视口。**B5 的重点是 billboard/sprite 的视口剔除**。
- **单 rAF 循环**：所有动画（状态呼吸、角标脉冲）在一个 rAF 里完成，不新开循环
- **mount-once 双 effect**（B4 已做）：parks 变更只更新 instanceMatrix + billboard，不重建 renderer
- **降帧策略**：页面不可见时（`document.hidden`）暂停 rAF，可见时恢复
- **阴影优化**：L0 阴影贴图 1024x1024（L1 是 2048x2048），低模不需要高精度阴影

**验收**：
- 10+ 厂中端机（MacBook Air M1 / 集成显卡）≥ 30fps，记录入 handoff
- graph 变更不重建 renderer 回归测试
- 页面隐藏后 rAF 暂停（console 计数验证）

**风险**：InstancedMesh + raycast 的性能在 N=100 时需要实测。如果 raycast 成为瓶颈，可加空间分区（八叉树），但 B 阶段 N 通常 < 20，不需要。

---

### B6 · 实时状态驱动

**目标**：工厂状态色与待审角标实时更新，经 ref 每帧读取，不重建场景。

**当前状态**：L1 用 `runtimeRef` 模式（`useVisibleRuntime()` + `runtimeRef.current = runtime`），rAF 每帧读 ref 更新 LED。阶段 A 的 OperationsDashboard 用 15s 轮询 `GET /api/operations/overview`。

**方案**：
- CanvasPark 接收 `parks` prop（由父组件从 overview 接口轮询获取，15s 同阶段 A）
- `dataRef.current = parks`（每 render 更新，等价 L1 runtimeRef）
- rAF 循环每帧读 `dataRef.current`：
  - 遍历每厂，更新 `instancedMesh.setColorAt(i, statusColor)`（running 加呼吸 `0.5 + 0.4*sin(now*0.006)`）
  - 更新待审角标 sprite 的可见性 + 文字（pendingReview > 0 显示，=0 隐藏）
  - `instancedMesh.instanceColor.needsUpdate = true`（批量标记，不逐厂）
- **不触发 React 重渲染**：状态变化只改 three.js 对象，不走 setState
- SSE 升级（可选，留 C）：B 阶段用 15s 轮询足够（工厂状态变化频率低，不像 L1 节点级 packets 高频）

**验收**：
- 浏览器手动改 run 状态（或等 cron 触发），工厂颜色实时变化（≤15s 延迟）
- 无场景重建（console 验证 renderer 引用不变）
- 待审角标数字正确

**风险**：15s 轮询的延迟对"实时感"有影响，但工厂级状态（running/done/failed）变化频率低，可接受。C 阶段可升级 SSE。

---

### B7 · Raycast 点厂 + 轻操作浮层

**目标**：点击工厂选中高亮 + 浮层（钻取 L1 / 重试 / 暂停 cron）。

**当前状态**：L1 raycast 点选节点（`Canvas3D.tsx` L313-431），用 `raycaster.intersectObjects(nodeGroup.children, true)` + `userData.nodeId`。

**方案**：
- **InstancedMesh raycast**：`raycaster.intersectObject(instancedMesh)` 返回的 hit 含 `instanceId`，用 `instanceId → graphId` 映射（在 data-sync effect 中维护 `idByIndex: string[]`）
- 选中高亮：
  - 选中厂的 instanceColor 提亮（或加 emissive，但 InstancedMesh 不支持 per-instance emissive，用颜色提亮代替）
  - 底部加 RingGeometry 选中环（单独 Mesh，跟随选中厂位置）
- **轻操作浮层**：HTML 浮层（不是 three.js 对象），定位在选中厂屏幕坐标上方：
  - 「进入」按钮 → onSelect(graphId) → 父组件处理钻取 L1
  - 「重试」按钮（仅 failed 状态）→ 调用重试 API（复用已有 run retry）
  - 「暂停 cron」按钮（仅 cron 产线）→ 调用 trigger 暂停 API
- 浮层用 `project()` 将 3D 坐标转屏幕坐标，HTML absolute 定位
- 点击空白处取消选中（同 L1 `selectNone`）

**验收**：
- 浏览器点选命中正确（N=10 厂逐个点，选中对应厂）
- 浮层按钮动作生效（钻取跳 L1 / 重试 / 暂停 cron）
- 点击空白取消选中

**风险**：
- InstancedMesh raycast 的 `instanceId` 在 three.js 中需要 `instancedMesh.instanceMatrix.needsUpdate` 后才准确，需确认 raycast 时矩阵已更新。**技术预研验证项。**
- 浮层屏幕坐标跟随相机变化（平移/缩放/旋转时），需要在 rAF 中更新浮层位置，或用 CSS transform。

---

### B8 · 钻取 L1（淡切）

**目标**：点厂「进入」→ 250ms 交叉淡切 → 切换到该 graph 的 L1 视图；返回时回到 L0，视角记忆不丢。

**当前状态**：L1 已有 2D↔3D 交叉淡切机制（`useViewMode` toggle + Canvas3D lazy load）。L0 是新视图，需要定义 L0↔L1 的切换。

**方案**：
- **视图状态机**：在 `useViewMode` 或新建 `useParkView` store 中加 `view: '2d' | '3d' | 'park'`
- **钻取流程**：
  1. 用户在 L0 点厂 → 「进入」→ `setView('3d')` + `setActiveGraph(graphId)`
  2. L0 CanvasPark 开始淡出（opacity 0 → 250ms）
  3. L1 Canvas3D 开始淡入（opacity 0→1，250ms），加载目标 graph
  4. L0 完全隐藏后卸载（或保留在后台？B 阶段卸载，节省内存）
- **返回流程**：
  1. L1 中「返回园区」按钮 → `setView('park')`
  2. L1 淡出，L0 淡入
  3. L0 相机恢复到钻取前的位置（存在 `parkCameraRef`，钻取时保存）
- **视角记忆**：L0 相机状态（position/target/zoom）存在 store 中（同 L1 `camera3d`），钻取返回时恢复
- **连续 zoom 留 C**：B 只用淡切，不做相机连续推近

**验收**：
- 浏览器走查：L0 点厂 → 淡切 → L1 正确显示目标 graph（无串厂）
- 返回 → L0 相机位置与钻取前一致
- 淡切无闪烁白屏

**风险**：
- L0 和 L1 同时存在两个 WebGL context 可能有性能问题（移动端尤其）。B 阶段钻取后卸载 L0，返回时重新挂载（mount-once effect 会重建 renderer，有 ~100ms 开销，可接受）。
- graph 切换：L1 的 `useGraph` store 需要切换到目标 graph，钻取时调用 `loadGraph(graphId)`。

---

### B9 · i18n/token + 全量测试 + 真机验收

**目标**：全量 i18n + 设计 token + 测试 + 10+ 产线真机帧率与状态一致性验收。

**当前状态**：项目已有 i18n 框架（`keys.test` 校验）、设计 token（CSS 变量）、测试框架（vitest + @testing-library/react + jsdom）。

**方案**：
- **i18n**：CanvasPark 所有可见文案走 `t('park.xxx')`，zh/en 同构，`keys.test` 4/4 绿
- **设计 token**：颜色用 CSS 变量 / 既有语义色，工厂类别色复用 L1 调色板或新增 `--park-factory-xxx` 变量，无硬编码色值
- **测试**：
  - `parkLayout.test.ts`：纯函数单测（B2 验收项）
  - `CanvasPark.test.tsx`：组件测试（挂载不崩 / parks 变更不重建 renderer / 选中高亮 / 空态）
  - `api.operations.test.ts` 追加：B3 新字段
  - `db.parkCoords.test.ts`：B1 持久化
- **真机验收**：
  - 造 10+ 产线（用模板批量创建，或写 seed 脚本）
  - 中端机（MacBook Air / 集成显卡）帧率 ≥ 30fps
  - 状态与 SSE/轮询一致（手动触发 run，验证工厂颜色变化）
  - 钻取/返回无串厂
  - 记录入 handoff

**验收**：
- `keys.test` 绿、无硬编码中文/色值
- 全量测试绿（core/server/web）
- 真机 10+ 产线 ≥ 30fps，记录入 handoff

**风险**：jsdom 不支持 WebGL，CanvasPark 组件测试需要 mock three.js（同 L1 Canvas3D.test.tsx 的做法）。

## 四、技术预研重点（B 阶段启动前必须验证）

| # | 预研项 | 验证方法 | 风险等级 |
|---|---|---|---|
| 1 | **InstancedMesh raycast + instanceId** | 原型中 N=10 盒体，逐个点击验证 instanceId 映射正确 | 🔴 高（如果 raycast 不准，B7 点选整个失效） |
| 2 | **InstancedMesh per-instance color 更新** | 原型中 rAF 每帧 setColorAt + instanceColor.needsUpdate，验证颜色正确 + 性能 | 🟡 中（API 用法需确认） |
| 3 | **Sprite billboard 文字 CanvasTexture** | 原型中 N=10 厂顶部显示类别名，验证文字清晰 + 面向相机 + 内存占用 | 🟡 中 |
| 4 | **双 WebGL context 共存/切换** | 原型中 L0 + L1 交替挂载，验证无 context 丢失 / 内存泄漏 | 🟡 中 |
| 5 | **parkLayout 算法 N=100 性能** | 纯函数 benchmark，验证 < 1ms | 🟢 低（纯计算） |

**预研产出**：`apps/web/src/canvas/CanvasPark.tsx` 原型（用 mock 数据，不接业务），验证以上 5 项后再正式进入 B1-B9 落地。

## 五、与阶段 A 的关系

阶段 A（OperationsDashboard 平面运营工作台）已上线，是 L0 的**信息架构原型**和**数据源**：
- A2 `GET /api/operations/overview` 是 B3 的接口基础
- A 的 9 格汇总条 + 产线状态卡是 L0 六类信息的平面验证
- L0 上线后，OperationsDashboard 保留为「列表视图」，L0 为「沙盘视图」，两者并存（用户可切换）

## 六、落地顺序建议（正式启动时）

1. **技术预研**（当前）：CanvasPark 原型 + 5 项验证
2. **B1 + B2**（纯后端 + 纯函数，无 UI 依赖）：园区坐标持久化 + 布局算法
3. **B3**（接口扩展）：overview 加 L0 字段
4. **B4 + B5**（核心渲染）：CanvasPark 低模场景 + LOD 优化
5. **B6**（实时驱动）：状态色 + 角标
6. **B7**（交互）：点选 + 浮层
7. **B8**（钻取）：淡切 L1
8. **B9**（收尾）：i18n/token + 测试 + 真机验收

每步原子提交、英文 message、步间跑测试、绿了才进下一步（同 overview §九约定）。

## 七、关联文档

- [design-rts-overview.md](design-rts-overview.md)（总览，三层世界 + 三阶段）
- [design-canvas-isometric.md](design-canvas-isometric.md)（L1 微观 3D，四期已建成，模式复用来源）
- [deferred-items.md](deferred-items.md)（P3 触发条件登记）
- [PRODUCT_STRATEGY.md](PRODUCT_STRATEGY.md) §七（RTS 原始决策）
