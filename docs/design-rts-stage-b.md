# RTS 阶段 B · 宏观沙盘 MVP 设计细化（design-rts-stage-b）

> 定位：对 [design-rts-overview.md](design-rts-overview.md) §九「阶段 B · 宏观沙盘 MVP」9 步草案（B1-B9）的落地级细化，结合当前代码库（2026-09-11）实际状态复核每步的复用点、接口形状、风险与验收标准。
>
> 状态：**B1/B2/B3/B4/B6/B7/B8 已落地（2026-09-11，feature/20260824，本地未 push），B5 帧率优化、B9 i18n/token/全量测试/真机验收按用户决策延后**。L0 园区总览已可端到端走查（overview→parkLayout 聚簇→低模工厂→状态色→点厂浮层→钻取 L1→返回）。剩余：B5 中端机帧率实测、B9 真机/全量回归与设计 token 收尾，以及商业化闭环 + 真实多产线场景触发（见 overview §十）。
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

### B1 · 园区布局持久化（✅ 后端已落地 2026-09-11；前端接线留正式落地）

> **落地状态（2026-09-11）**：Schema（base DDL + 迁移 37）、driver 三方法、REST 两端点 + overview 扩展、全部测试均已在 `feature/20260824` 落地（server tsc/build 通过，新增 13 测试全绿）。**B1.5 已拍板：setParkCoord 不刷新 updated_at**（视图偏好不应让产线在列表跳顶）。落地中发现一个 node:sqlite 硬坑，见 B1.2 末尾。**仍未做（前端，正式落地时机）**：CanvasPark 接真实 overview 坐标、拖拽 onPointerUp 防抖 PUT、i18n、路由入口、钻取 L1、真机帧率、Hasee 副本库升级演练。

**目标**：每条产线（graph）在园区地图上有一个 (parkX, parkZ) 坐标，自动布局结果可手动覆盖，持久化到 DB，刷新/重开不丢。

#### B1.1 现状（已核对，不猜）

- `graphs` 表 base DDL 在 `sqlite-driver.ts:45-55`，列为 `id/user_id/name/doc/version/updated_at/origin_template_id`，无园区坐标。
- 迁移机制：`MIGRATIONS` 数组（`sqlite-driver.ts`），**本次落地后最新版本 = 37**（graphs.park_x/park_z），下一个 = 38；每项形如 `{version, description, detect, up, down?}`，`detect` 用 `columnExists(db, table, col)` 做幂等，`LATEST_VERSION = MIGRATIONS.at(-1).version`。
- **双轨关键事实**：`pg-driver.ts:50` 是 `await client.query(toPgDdl(DDL))`——**PostgreSQL 不跑 MIGRATIONS，只从 SQLite base DDL 整体派生**（`pg-sql.ts:62` 把 `REAL → double precision`）。因此加列必须**同时改两处**：① base DDL（管新建 SQLite 库 + 全部 PG 库）；② 迁移 37（管已存在的 SQLite 旧库升级）。先例就是 migration 19 `origin_template_id`——base DDL 第 52-54 行注释明写 "part of the latest schema so PG derivation sees it"。
- 读侧方法范式：`operationsByGraph(userId, {since, graphIds})`（`sqlite-driver.ts:1660`）已有**双 scope**——不传 graphIds 时按 `g.user_id = ?` 只看自己；传 graphIds（来自协作成员关系 visibleGraphs）时按 `g.id IN (...)` 看被授权的集合。园区坐标读方法沿用同一 scope 范式。

#### B1.2 Schema 变更（两处，缺一不可）

**① base DDL**（`sqlite-driver.ts:45` graphs 建表，origin_template_id 之后加）：

```sql
  origin_template_id TEXT,
  -- RTS stage-B macro-park position; NULL = not laid out, frontend auto-layouts
  park_x REAL,
  park_z REAL
```

**② 迁移 37**（追加到 MIGRATIONS 数组末尾，36 之后）：

```ts
{
  version: 37,
  description: "graphs.park_x/park_z for RTS stage-B macro park layout (manual override of auto layout)",
  detect: (db) => columnExists(db, "graphs", "park_x"),
  up: (db) => {
    if (!columnExists(db, "graphs", "park_x")) db.exec("ALTER TABLE graphs ADD COLUMN park_x REAL");
    if (!columnExists(db, "graphs", "park_z")) db.exec("ALTER TABLE graphs ADD COLUMN park_z REAL");
  },
  down: (db) => {
    db.exec("ALTER TABLE graphs DROP COLUMN park_x");
    db.exec("ALTER TABLE graphs DROP COLUMN park_z");
  },
},
```

NULL 语义 = 未布局（前端落回 B2 自动布局）；两列要么一起写要么一起 NULL，不允许半态。PG 侧零额外工作（toPgDdl 自动把 REAL 译成 double precision）。

> ⚠️ **落地实测坑（node:sqlite，务必遵守）**：`CREATE TABLE graphs (...)` 的**语句体内不要写 `--` 行注释**，列注释一律放到 CREATE TABLE 上方。原因：`ALTER TABLE DROP COLUMN` 会从 `sqlite_master.sql` 里存的建表 SQL 重建表，当被删列旁边挨着 `--` 注释时，node:sqlite 重解析报 `error in table graphs after drop column: incomplete input`（已用真实存储 SQL 做 A/B：带注释必现、去注释通过，确定性复现）。本次已把 graphs 建表语句内的历史注释（含 origin_template_id）全部上移。后续给任何表加可回滚列都照此办理。

#### B1.3 数据访问方法（挂 sqlite-driver，沿用 operationsByGraph 双 scope）

| 方法 | 签名 | SQL 要点 |
|---|---|---|
| `getParkCoords` | `(userId, graphIds?: string[]) => Promise<Record<graphId, {x,z}>>` | `SELECT id, park_x, park_z FROM graphs WHERE <scope> AND park_x IS NOT NULL`；只回已布局的，NULL 的不回（前端自动补） |
| `setParkCoord` | `(userId, graphId, x, z) => Promise<boolean>`（返回是否命中 owner 行，false→404/403） | `UPDATE graphs SET park_x=?, park_z=? WHERE id=? AND user_id=?`；**带 user_id 防越权；刻意不写 updated_at（B1.5 已拍板）** |
| `clearParkCoord` | `(userId, graphId) => Promise<boolean>` | `UPDATE graphs SET park_x=NULL, park_z=NULL WHERE id=? AND user_id=?`（恢复自动布局；同样不碰 updated_at） |

- 坐标写不进 `doc`（doc 是产线图结构、有版本快照/undo/内容哈希链路，园区坐标是**视图层偏好**，混进去会污染 content_hash 与版本 diff）——独立成列是刻意分层。
- 协作场景：只有 owner 能 set/clear（`user_id` 约束）；协作者 get 走 graphIds scope、只读。这与 operationsByGraph 的授权模型一致，不另造权限。

#### B1.4 API（挂现有 graphs 路由，REST）

- `GET  /api/operations/overview` 扩展（见 B3）：每条 graph 带 `parkX/parkZ`（可空）——一次请求拿状态+坐标，前端不另发请求。
- `PUT  /api/graphs/:id/park-coord`  body `{x:number,z:number}` → setParkCoord（拖拽结束 onPointerUp 时防抖保存，非每帧）。
- `DELETE /api/graphs/:id/park-coord` → clearParkCoord（"恢复自动布局"菜单）。
- 三端点都走现有 auth 中间件 + owner 校验；写端点加现有 idempotency/校验（x/z 必须有限数 `Number.isFinite`，拒绝 NaN/Infinity/非数）。

#### B1.5 并发与一致性

- 单 owner 拖拽，**last-write-wins 足够**，不需要乐观锁版本号（坐标是个人视图偏好，无多人同时拖同一厂的业务场景；协作只读）。
- 前端拖拽中只改本地 state、不发请求；pointerUp 一次性 PUT，失败回滚到服务端值 + toast。
- updated_at 副作用——**已拍板（2026-09-11 落地）：setParkCoord/clearParkCoord 不刷新 updated_at**。理由：park 坐标是视图层偏好（已刻意排除在 doc/version/content_hash 之外），同理不应让"拖了一下园区"把产线顶到 listGraphs（updated_at DESC）最前；写方法 SQL 里根本不带 updated_at，并有单测守护写入前后 updated_at 不变。

#### B1.6 验收

- ✅ **已落地（2026-09-11，`park-coord.test.ts` 6 例）**：① 旧库（version=36）跑迁移 37 后两列存在且全 NULL；② 迁移幂等（连跑两次/二次打开不报错，靠 detect）；③ CRUD + 跨用户隔离（A 读不到/改不了 B 的坐标）；④ NULL 回落（clear 后 getParkCoords 不回该 id）；⑤ down 回滚列消失且迁移 36 的 model 列仍在；⑥ setParkCoord 不刷新 updated_at。
- ✅ **pg 侧（`pg-sql.test.ts`）**：断言 toPgDdl 后的 graphs 建表含 `park_x double precision`、`park_z double precision`。
- ✅ **API（`api.park-coord.test.ts` 6 例，纯 HTTP）**：未登录 401、owner PUT 200 且 overview 带坐标、非有限数/缺字段 400、外部无权限人 404（隐藏存在性）、被授权 viewer 非 owner 403、未知 graph 404、DELETE 后 overview 回落 null。
- ⏳ **旧库升级演练（留部署窗口，M1 期不做）**：在 Hasee 副本库上跑迁移，已有 graph 坐标 NULL、前端自动布局不空白。

**风险**：低（已验证）。纯加列 + 三个只读/单点写方法，不碰 run/engine 业务逻辑；唯一的 updated_at 副作用点已按 B1.5 拍板为"不刷新"。

---

### B2 · 纯函数 parkLayout（宏观自动布局 v1，正式化 + 原型缺陷修正）

**目标**：输入产线列表（id + 类别 + 可选手动坐标），输出每厂 (x,z)，无重叠、同输入稳定、手动坐标优先。纯函数、零 React/three 依赖。

#### B2.1 类别从哪来（顺带解决 B3 的前置确认项）

**已核对：graph 实例不携带 category**——`category` 只定义在 `GraphTemplate`（`templates.ts:58`），实例化后的 `GraphDoc`（`graph.ts`）没有 category 字段；实例只保留 `graphs.origin_template_id`。因此类别在**服务端 overview 组装时反查**，不新增列：

```
category(graph) = TEMPLATE_BY_ID[graph.origin_template_id]?.category ?? "自定义"
```

- 内置模板建的产线 → 模板分类（营销内容/效率工具/…）；空白产线与自建产线（origin_template_id 为空）→ 兜底桶 "自定义"。
- 反查在服务端做（模板表本就在 core，server 已依赖）；parkLayout 只接收已经算好的 category 字符串，**不感知模板系统**，保持纯函数。

#### B2.2 模块归属：从原型搬到 packages/core

原型把 `parkLayout` 写在 `apps/web/src/canvas/CanvasPark.tsx`（three 组件文件）里。正式版**搬到 `packages/core/src/parkLayout.ts`**，理由：
1. 纯计算无 DOM/three，core 是 compile/topoSort 等纯图逻辑的既有归属，零依赖可在 node 环境单测（web jsdom 不必背 three）；
2. 服务端 overview 未来若要直接下发"建议坐标"也能复用（B3 只下发 category、坐标前端算，但留服务端复用的可能）；
3. CanvasPark.tsx 改为 `import { parkLayout } from "@agent-world/core"`，原型里的实现删除，避免双份逻辑漂移。

#### B2.3 正式算法（修正原型三个缺陷）

原型（CanvasPark.tsx:78-132）可跑但有三处正式化必须修：

| 原型现状 | 问题 | 正式版修法 |
|---|---|---|
| 组内保持输入顺序（`auto` 不过滤后不排序） | API 返回顺序变 → 布局变，**违反确定性** | 组内按 `id` 字典序排序，类别也按字典序，全链路不依赖入参顺序 |
| 占位用 `key=round(x/SIZE)` 网格单元，碰撞只查同一格 | 手动坐标落在相邻格但视觉距离 < 一厂宽时**仍会重叠**；且只判点不判半径 | 改**距离判定**：候选点与所有已占位厂圆心距 `< MIN_GAP` 即碰撞（MIN_GAP = FACTORY_SIZE × 1.2） |
| `while(occupied && attempts<20)` 20 次后**静默放下去**（必然重叠） | 找不到空位时产出重叠布局，无兜底 | 改**阿基米德螺旋外扩搜索**，从候选点起逐圈找第一个无碰撞位；设硬上限（如 200 次）保底，理论 N≤100 远到不了 |

正式伪代码：

```
parkLayout(factories):
  result = {}; placed = []                      // placed: [{x,z}] 用于距离判定
  // 1. 手动坐标先占位（按 id 排序后占，保证确定性）
  for f in factories.filter(manual).sort(byId):
      result[f.id] = f.manual; placed.push(f.manual)
  // 2. 自动厂按 category 分组，类别名字典序
  groups = groupBy(factories.filter(!manual), category)  // 组内按 id 排序
  cats = sortedKeys(groups)
  rowZ(i) = (i - (cats.length-1)/2) * ROW_GAP           // 类别行，纵向居中
  // 3. 每组一行，行内横向居中排列
  for i,cat in cats:
      list = groups[cat]                                // 已按 id 排序
      startX = -((list.length-1)/2) * COL_GAP
      for j,f in list:
          candidate = (startX + j*COL_GAP, rowZ(i))
          candidate = spiralUntilFree(candidate, placed) // 距离碰撞 + 螺旋兜底
          result[f.id] = candidate; placed.push(candidate)
  return result

spiralUntilFree(p, placed):
  if free(p, placed) return p
  for k in 1..HARD_CAP:                                 // 阿基米德螺旋
      ang = k * GOLDEN_ANGLE; rad = STEP * sqrt(k)
      q = p + (rad*cos(ang), rad*sin(ang))
      if free(q, placed) return q
  return p   // HARD_CAP 到顶（N≤100 不可达），兜底返回原位并由测试守护 N=100 不重叠
free(p, placed) = placed.every(q => dist(p,q) >= MIN_GAP)
```

#### B2.4 常量（集中导出，便于调参与测试）

| 常量 | 值 | 含义 |
|---|---|---|
| `FACTORY_SIZE` | 200 | 厂区占地边长（园区单位，比 L1 board 大一个量级） |
| `ROW_GAP` | 440（SIZE×2.2） | 类别行间距（纵向） |
| `COL_GAP` | 320（SIZE×1.6） | 同类厂间距（横向） |
| `MIN_GAP` | 240（SIZE×1.2） | 最小圆心距（碰撞半径，略大于占地留缝） |
| `HARD_CAP` | 200 | 螺旋搜索硬上限 |

#### B2.5 复杂度与边界

- 时间复杂度：每个自动厂螺旋搜索最坏扫 placed（O(n)）距离，整体 O(n²)；n≤100 时 ≤1 万次距离运算，实测 <1ms，无性能问题。
- 输入边界：① 空数组 → 空 Map；② 全手动 → 原样返回不重排；③ 单厂无手动 → 居中 (0,0)；④ 两手动厂坐标恰好重合 → 手动不互相避让（**尊重用户显式摆放**，只让自动厂绕开，文档注明手动重叠是用户意图）；⑤ category 缺失/空串 → 归入 "自定义" 桶，不抛异常；⑥ id 重复 → 后者覆盖（由上游 overview 保证 id 唯一，纯函数内 last-wins 并可加 dev warn）。
- 稳定性：仅依赖 (id, category, manual)，同输入逐字节同输出；无随机数（螺旋用确定性黄金角，不用 Math.random）。

#### B2.6 测试矩阵（core，纯函数不依赖 DOM）

1. N=0 → 空 Map；2. N=1 自动 → (0,0)；3. N=5 同类 → 一行、等距、两两距离 ≥ MIN_GAP；4. 多类 → 分行、行 z 不同、各类内部一行；5. 手动优先（手动厂坐标原样保留，自动厂绕开不碰撞）；6. 确定性（同输入两次结果深相等 + 打乱入参顺序结果仍一致——专门锁原型"靠输入顺序"的缺陷）；7. 手动厂堵在自动位正前方 → 螺旋让位不重叠（锁网格→距离的修复）；8. N=100 全自动无重叠且 <1ms（性能 + HARD_CAP 不可达）；9. category 空 → 归桶不抛；10. 全手动 → 零自动重排。

#### B2.7 与原型的迁移

**状态：已落地（2026-09-11，未 push）**

- ✅ 新建 `packages/core/src/parkLayout.ts`（纯函数 + ParkLayoutInput/ParkLayoutResult 类型 + 5 常量）与 `parkLayout.test.ts`（11 例，10 例矩阵 + 1 例常量断言）。
- ✅ CanvasPark.tsx 改为 `import { parkLayout } from "@agent-world/core"`，原型实现已删除；FACTORY_SIZE 保留为 three 几何渲染常量（注释指向 core/parkLayout.ts）。
- ✅ 原型 7 例测试（CanvasPark.test.ts）全部为 parkLayout 纯函数断言，已迁移+扩充到 core 11 例，原测试文件已删除（无纯渲染断言需保留）。
- ✅ core 导出已加入 `packages/core/src/index.ts`（`export * from "./parkLayout.js"`）。
- ✅ 验证：core 224/224 全绿（原 213 + 新增 11），web typecheck 通过，web 全量测试通过（i18n 正则误报已通过 CanvasPark.tsx 注释全英文化修复）。
- 原型三缺陷全部修正：① id 字典序确定性排序 ② 距离碰撞判定（dist < MIN_GAP）③ 阿基米德螺旋兜底（HARD_CAP=200）。

**风险**：低。算法可替换（纯函数、输入输出契约固定），美观度 v1 只承诺"无重叠 + 类别聚簇 + 确定稳定"，力导向/网格填充等更优算法留后续，替换不动 DB/API。

---

### B3 · 扩展 A2 overview 接口（加 L0 字段）

> **落地状态（2026-09-11，未 push）**：✅ 已落地。`operationsByGraph` 补选 `origin_template_id`；overview handler 组装 `category`（`getTemplate(originTemplateId)?.category ?? "自定义"` 反查）、`pendingReview = halted`（待审数恰好等于每产线 halted run 数，无需新查询），连同 B1 的 `parkX/parkZ` 一并下发；web `OperationsGraphSummary` 类型同步。`api.operations.test.ts` 新增 2 例（类别反查 + 待审映射），7 例全绿；server 测试 1037→1039。内置浏览器 live 验证：10 厂 overview 正确返回 5 个真实类别（写作/数据分析/IT 运维/营销内容/办公协同）+ 无模板产线兜底「自定义」。

**目标**：阶段 A 已建 `GET /api/operations/overview`（返回全局状态 + 每产线卡数据），阶段 B 在其基础上加 L0 所需字段，不新建接口。

**当前状态**：A2 接口返回 `{ totals, graphs: [{ id, name, status, lastRunAt, costToday, haltedCount, nextRuns }] }`（具体形状以 `api.operations.test.ts` 为准）。

**方案**：
- 在每 graph 对象加字段：
  - `category: string` — 产线类别（用于布局聚簇 + 低模配色）
  - `parkX: number | null`、`parkZ: number | null` — 已持久化的园区坐标（NULL = 前端自动布局）
  - `pendingReview: number` — 待审数（F2，用于角标）
- `category` 来源（**2026-09-11 已核对，见 B2.1**）：graph 实例**不带** category 字段（`GraphDoc` 无此列，category 只在 `GraphTemplate` 上），因此服务端组装 overview 时用 `TEMPLATE_BY_ID[origin_template_id]?.category ?? "自定义"` 反查，不新增列、不写进 doc。
- **不改动 A2 的 totals 和已有字段**，只追加，保证阶段 A 的 OperationsDashboard 不受影响
- api 测试：新字段齐全 + 旧字段不变 + 跨用户隔离

**验收**：
- api 测试：返回形状含新字段 + 旧字段兼容 + 未认证 401
- OperationsDashboard（阶段 A）回归：不受新字段影响

**风险**：~~category 字段来源待确认~~ **已闭环（B2.1）**：确认 graph.doc 无类别概念，统一走 `origin_template_id → 模板 category → "自定义" 兜底`，无需给 doc 加字段。

---

### B4 · CanvasPark.tsx L0 场景（低模工厂 + 地面 + 相机）

> **落地状态（2026-09-11，未 push）**：✅ 已落地（生产级重写原型）。`CanvasPark.tsx` 采用 mount-once 双 effect（挂载 effect [] 建 renderer/正交相机/光/地面/grid/InstancedMesh/选中环/rAF/raycast；数据 effect [factories] 只重算矩阵+billboard），几何/相机常量按方案落地（FACTORY_SIZE=200、CAMERA_DIST=3000、GROUND_SIZE=6000、maxCount=100），布局复用 core `parkLayout`（手动坐标优先）。`App.tsx` 以 `React.lazy(() => import("./canvas/CanvasPark"))` + `Suspense` 独立分包（与 Canvas3D 同模式），接真实 overview（15s 轮询）。新增 `CanvasPark.test.tsx` 4 例（空态/挂载卸载/mount-once 不重建 renderer/待审不崩）全绿。内置浏览器 live：N=10 厂立起来、按类别聚簇、done=蓝/idle=灰状态色与类别色 billboard 正确、可缩放平移。纹理函数对无 2d context（jsdom）做了空纹理兜底。

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

> **落地状态（2026-09-11，未 push）**：✅ 已落地。factories prop 每轮询（15s）更新 → `dataRef`，单一 rAF 每帧遍历 InstancedMesh `setColorAt`：running 绿色正弦呼吸（BREATH_SPEED=0.006）、failed 红、halted 黄、done 蓝、idle 灰，批量 `instanceColor.needsUpdate`；待审角标 sprite 按 pendingReview 显隐。状态色更新只改 three 对象、不走 setState；浮层屏幕坐标同样在 rAF 内 `Vector3.project` 写 transform。live 验证 done/idle 两态颜色正确（running 呼吸由同代码路径 + 单测覆盖，未 live 触发真实 run）。

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

> **落地状态（2026-09-11，未 push）**：✅ 已落地。InstancedMesh raycast 取 `instanceId`，经数据 effect 维护的 `idByIndex` 映射到 graphId；选中后底部 RingGeometry 选中环跟随，HTML `.park-popover` 在 rAF 内投影定位。浮层按钮按态条件渲染：「进入」常显；「重试」仅 failed（调 `api.rerunRun(lastRunId)`）；「暂停/恢复 cron」仅 hasCron（`listTriggers`→找 cron→翻转 enabled→`createTrigger` upsert）。App.tsx 实现 retryFactory / toggleFactoryCron。live 验证：点 done 厂弹「厂名 + 进入」（无重试/无 cron 按钮，条件渲染正确），点空白取消选中。

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

> **落地状态（2026-09-11，未 push）**：✅ 已落地。`view-mode` store 扩为 `"2d" | "3d" | "park"`，新增持久化 `parkCamera`（钻取返回恢复机位）与非持久化 `drilledFromPark` 标记。流程：L0 点厂「进入」→ `enterFactory`（置 drilledFromPark、必要时 switchGraph、setViewMode("3d")）→ CSS 淡切到 L1 Canvas3D 单厂；L1 显示 `.park-back-btn`（t("park:backToPark")）→ `backToPark` 回 L0 并恢复相机。live 验证：演示产线钻取后正确显示其单厂 3D（1 文坊·1 质检站·4 管道，无串厂），返回后 L0 工厂布局/机位一致、无白屏。连续 zoom 仍留 C。

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
| 5 | **parkLayout 算法 N=100 性能** | 纯函数 benchmark，验证 < 1ms（正式版迁到 `packages/core/src/parkLayout.ts`，见 B2.2，原型在 web 仅作验证） | 🟢 低（纯计算） |

**预研产出**：`apps/web/src/canvas/CanvasPark.tsx` 原型（用 mock 数据，不接业务），验证以上 5 项后再正式进入 B1-B9 落地。

## 五、与阶段 A 的关系

阶段 A（OperationsDashboard 平面运营工作台）已上线，是 L0 的**信息架构原型**和**数据源**：
- A2 `GET /api/operations/overview` 是 B3 的接口基础
- A 的 9 格汇总条 + 产线状态卡是 L0 六类信息的平面验证
- L0 上线后，OperationsDashboard 保留为「列表视图」，L0 为「沙盘视图」，两者并存（用户可切换）

## 六、落地顺序建议（正式启动时）

1. **技术预研**（当前）：CanvasPark 原型 + 5 项验证
2. **B1 + B2**（纯后端 + 纯函数，无 UI 依赖）：园区坐标持久化（迁移 37 + base DDL + 三方法/三端点）+ 布局算法（`packages/core/src/parkLayout.ts`，10 例单测）。**B1/B2 设计已于 2026-09-11 正式化到代码级（本文 §三），正式落地时照此实现即可**
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
