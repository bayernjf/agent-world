# 画布等距 3D 展示视图设计（详细方案）

> 定位：在现有 2D 编辑画布上，加一个「受限 3D」展示视图（等距俯视 + 水平旋转 + 平移），2D 与 3D 一键切换。**2D 编辑，3D 展示**。创建：2026-09-06。
>
> 约定：数据层零改动；3D 是「另一种渲染」，不是替代 2D；本体论是工厂，不是皮肤（见 [design-glossary.md](design-glossary.md)）。

## 一、目标与边界

**目标**：用户在 2D 平面（编辑）与受限 3D（展示）间一键切换；3D 里能水平旋转、平移、看立体工厂。

**摄像机规格（已拍板）**：俯角固定（不能上下）+ 水平旋转（连续 yaw）+ 平移 + **正交投影**（无透视）。

**边界（明确不做）**：自由视角 3D、数据层改动、3D 内编辑（拖节点/连线）、2D 行为变化。

## 二、现状盘点（精确值，来自代码）

| 项 | 值 | 来源 |
|---|---|---|
| board 固定尺寸 | `VIEW_W=1440`, `VIEW_H=640` | `canvas/board.ts` |
| 节点尺寸 | `PLANT_W=150`, `PLANT_H=92` | `store/graph.ts` |
| 吸附网格 | `GRID=20` | `store/graph.ts` |
| 节点坐标 | `node.x / node.y`（**中心点**，board 用户空间） | `graph.ts` |
| 视口 | `viewport={zoom,panX,panY}`，`screen = board*zoom + pan` | `store/canvas.ts` |
| 视口中心(board) | `cx=(VIEW_W/2-panX)/zoom`, `cy=(VIEW_H/2-panY)/zoom` | `CanvasToolbar.tsx` |
| 挂载点 | `App.tsx` → `<Canvas mode diagnostics>` | `App.tsx:901` |
| 卡车数据 | `RuntimeState.packets: PacketRuntime[]`（含 `edgeId`） | `core/runtime.ts` |
| three.js | **未引入**，需新增 | `package.json` |

## 三、架构设计

### 3.1 依赖选型：裸 `three.js`（不用 react-three-fiber）

**决策**：裸 `three.js` + `useRef`/`useEffect` 命令式管理。

**理由**：
- 场景极简（方块 + 管道 + 卡车），不需要 R3F 的声明式抽象
- 避免 R3F 额外依赖（`@react-three/fiber` + `@react-three/drei`）及 React 19 兼容风险
- 生命周期清晰：`useEffect` 里 `new WebGLRenderer` → 挂 canvas → 清理时 `dispose`

**体积与代码分割**：three.js gzip 约 150KB，必须 `React.lazy` 动态加载，纯 2D 用户不背这个包：

```tsx
const Canvas3D = React.lazy(() => import("./canvas/Canvas3D"));
```

### 3.2 组件架构

```
App.tsx
  └─ {viewMode === "2d" ? <Canvas/> : <Suspense><Canvas3D/></Suspense>}
```

- 新增 `canvas/Canvas3D.tsx`：3D 场景容器（renderer + scene + camera + controls 生命周期）
- 新增 `canvas/Plant3D.tsx`（或纯函数）：节点方块 + 图标
- 新增 `canvas/Pipe3D.tsx`（或纯函数）：3D 管道
- **复用**：图数据（`useGraph`）、运行数据（`useRun`）、节点详情弹窗（`Inspector`）

两套渲染互斥挂载，2D 的 SVG/Canvas 与 3D 的 WebGLCanvas 不同时存在。

### 3.3 状态管理

- **视角模式**：新增 `store/view-mode.ts` → `{ viewMode: "2d" | "3d", setViewMode }`，`persist` 记住上次选择
- **3D 摄像机**：`camera3d: { yaw, panX, panZ }`（persist，切回 3D 回到上次旋转/位置）；俯角与视野是常量，不存
- **2D 视口**：现有 `store/canvas.ts` 不动

## 四、数据映射（精确换算）

**坐标**（board → 3D 世界，把 board 中心平移到世界原点）：

```
worldX = node.x - VIEW_W/2        // -720 .. 720
worldZ = node.y - VIEW_H/2        // -320 .. 320
worldY = 0                        // 地面
```

**节点方块**（第一期占位）：`BoxGeometry(PLANT_W, 60, PLANT_H)` = `(150, 60, 92)`，中心放 `(worldX, 30, worldZ)`，Y 轴朝上为高度。

**边/管道**：2D 边是正交路由（`Pipes.tsx` 的 path）。3D 管道直接把该 path 的顶点映射到 XZ 平面，加一个固定 `Y` 高度（如 30），生成一条折线（`THREE.Line` 或细圆柱）。

**选中映射**：2D 选中节点 id → 3D 高亮对应方块（同一 `useGraph().selectedId`）。

## 五、摄像机（精确参数）

| 参数 | 值 | 说明 |
|---|---|---|
| 投影 | `OrthographicCamera` | 无透视，保持等距观感 |
| 俯角 | 固定 45°（与水平面夹角） | OrbitControls `minPolarAngle = maxPolarAngle = Math.PI/4` |
| 水平旋转 | 自由 yaw | `enableRotate = true` |
| 平移 | 自由 | `enablePan = true` |
| 上下缩放 | **锁死** | `enableZoom = false` |
| 初始朝向 | 与 2D 对齐（2D 的「上」= 屏幕「上」） | 实现时调 yaw 初值，原则是「切过来不转向」 |
| 视野 | 切换时按 2D `zoom` 初始化一次 frustum 宽高，之后锁定 | 见 §六 |

正交相机的可视范围由 frustum（`left/right/top/bottom`）控制，与距离无关，所以「锁上下」= 锁 frustum + 锁俯角，天然无透视变形。

## 六、切换算法（精确）

**2D → 3D**：

1. 读 2D 视口中心（board 坐标）：`cx = (VIEW_W/2 - panX)/zoom`, `cy = (VIEW_H/2 - panY)/zoom`
2. 映射为 3D 目标点：`targetX = cx - VIEW_W/2`, `targetZ = cy - VIEW_H/2`
3. `controls.target.set(targetX, 0, targetZ)`（锚点对齐——切过去还看同一块）
4. frustum 按 2D `zoom` 初始化：可视宽度 = `stageSize.width / zoom`（映射视野），高度同比例
5. yaw 用「上次 3D 的 yaw」（首次进用对齐 2D 的默认值），俯角锁死 45°
6. 交叉淡入淡出（2D 卸载 + 3D 挂载，`opacity` 或 CSS 过渡约 250ms）

**3D → 2D**：

1. 读 3D `controls.target` → 映射回 board：`cx = targetX + VIEW_W/2`, `cy = targetZ + VIEW_H/2`
2. 用 `store/canvas.centerOn(cx, cy)` 让 2D 视口中心对齐（锚点反向对齐）
3. 2D 的 `zoom` 保持 3D 之前的原值（各自独立记忆）

**状态保存**：切走时保存当前视角状态（2D 存 viewport，3D 存 yaw/pan），切回恢复。

## 七、交互细节

| 操作 | 3D 行为 |
|---|---|
| 旋转 | 左键拖（OrbitControls 默认） |
| 平移 | 右键拖 / 双指 |
| 缩放 | 禁用（滚轮不响应） |
| 选中节点 | raycast 点击方块 → 高亮 + 弹节点详情（复用 `Inspector`） |
| 编辑 | 无（3D 只读），详情面板给「回 2D 编辑」入口 |
| 视角切换 | 画布角落「视角」按钮 / 快捷键 `V` |

## 八、性能

- 节点数量级（29 种 × N 个，通常 <100）：方块用 `InstancedMesh` 合并绘制，管道用 `Line`/`InstancedMesh`
- 卡车动画（第二期）：单 rAF 循环驱动，复用 `PacketRuntime` 数据，与 2D `PacketLayer` 同源
- 切回 2D 时 `renderer.dispose()` 释放 WebGL 上下文，避免泄漏

## 九、测试策略

- **纯函数单测**：坐标映射、锚点对齐、frustum 换算抽成纯函数，`vitest` 可测
- **组件测试**：`Canvas3D` 用 `vi.mock("three")` mock 掉，断言「切换模式渲染正确组件 + 状态正确传递」
- **WebGL 真渲染**：jsdom 无 WebGL，3D 的视觉正确性靠浏览器手工验证，不写自动化像素断言

## 十、分期实施

**第一期 MVP（验证体验，纯占位造型）**：

1. 引入 `three.js` + `React.lazy` 代码分割
2. `Canvas3D`：正交场景 + 锁俯角摄像机（旋转/平移）+ 方块占位 + 3D 管道
3. 2D ↔ 3D 切换（锚点 + 朝向 + 淡切 + 状态记忆）
4. 3D 只读（raycast 选中 + 详情弹窗）

**第二期（完整效果）**：

5. 29 种程序化几何造型（双点医院式示意）
6. 卡车沿 3D 管道跑（复用 `PacketRuntime`）
7. 运行状态亮灯（质检/返工/失败）

## 十一、已拍板决策

正交投影 ✅｜固定俯角 + 水平旋转 + 平移 ✅｜模式切换（非分屏）✅｜2D 编辑 / 3D 查看 ✅｜先占位后造型 ✅

## 十二、风险与回滚

- **风险**：three.js 引入使 web 包体积 +~150KB（gzip），缓解 = `React.lazy` 代码分割，2D 用户不加载
- **回滚**：3D 是纯新增独立组件 + 独立 store，出问题删掉 `Canvas3D` + `store/view-mode` 即可，2D 零影响
