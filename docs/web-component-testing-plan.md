# Web 组件测试方案

> 创建：2026-09-02
> 状态：方案待评审
> 范围：`apps/web` 下的 React 组件测试

---

## 一、背景与目标

### 1.1 现状

- **44 个组件**，共 13063 行代码
- **176 个测试**，全是纯逻辑测试（geometry / store / sanitize / api），**零组件测试**
- 无 `vitest.config.ts`，无 `@testing-library/react`，无 `jsdom`
- 组件与 store 耦合深，依赖浏览器 API（localStorage、ResizeObserver、canvas）

### 1.2 测试盲区

| 已覆盖 | 未覆盖 |
|---|---|
| store 的 action 是否正确更新状态 | 组件是否正确调用了 store 的 action |
| geometry 函数计算是否正确 | Canvas 是否用正确的 geometry 渲染出正确的 UI |
| sanitize-html 是否正确清洗 | ArtifactCard 是否调用了 sanitize-html 渲染产物 |
| api 封装是否正确 | 组件是否在正确的时机调用了 api、处理了 loading/error |
| — | **用户交互路径**（点击、拖拽、输入、快捷键、表单提交） |
| — | **条件渲染**（不同节点类型显示不同配置、error 状态显示） |
| — | **props 传递**（父组件给子组件传的 props 是否正确） |

### 1.3 目标

1. **建立组件测试基础设施**（依赖、配置、Mock、工具函数）
2. **覆盖核心高价值组件**（Inspector / Settings / ProductGallery / TemplatePicker / CanvasToolbar）
3. **形成可复用的测试模式**，后续新增组件可参照编写
4. **不追求 100% 覆盖率**，优先覆盖交互复杂、容易出 bug 的路径

---

## 二、技术栈选型

| 工具 | 用途 | 版本 |
|---|---|---|
| `vitest` | 测试运行器（已在用） | 现有版本 |
| `@testing-library/react` | 渲染组件、查询元素、模拟交互 | latest |
| `@testing-library/user-event` | 更真实的用户交互模拟（打字、点击、拖拽） | latest |
| `@testing-library/jest-dom` | 扩展断言（toBeInTheDocument、toHaveValue 等） | latest |
| `jsdom` | 浏览器环境模拟（DOM、事件、localStorage） | latest |
| `zustand` 测试工具 | 重置/替换 store 状态 | 现有版本 |

### 2.1 为什么选 @testing-library 而不是 Enzyme

- **Enzyme 已停止维护**，不支持 React 19
- **@testing-library 是社区标准**，聚焦用户可见行为而非实现细节
- **查询方式更语义化**（getByRole、getByLabelText、getByText），测试更贴近真实用户
- **与 React 19 兼容**，支持 concurrent features

### 2.2 为什么需要 jsdom

- 当前测试运行在 Node 环境，没有 DOM
- 渲染 React 组件需要 `document`、`window`、`HTMLElement` 等浏览器 API
- `jsdom` 提供了足够的浏览器环境模拟，适合组件测试
- **不需要真实浏览器**（Playwright/Puppeteer），那是 E2E 测试的范畴

---

## 三、测试环境配置

### 3.1 安装依赖

```bash
cd apps/web
pnpm add -D @testing-library/react @testing-library/user-event @testing-library/jest-dom jsdom
```

### 3.2 创建 vitest.config.ts

```typescript
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    css: false,
  },
})
```

**关键配置说明**：
- `environment: 'jsdom'` — 所有测试运行在 jsdom 环境
- `globals: true` — 全局可用 describe/it/expect，不需要每次 import
- `setupFiles` — 测试前自动运行的设置文件（jest-dom 断言扩展、全局 Mock）
- `css: false` — 不处理 CSS 导入（组件里的 `import './index.css'` 不会报错）

### 3.3 创建测试设置文件 `src/test/setup.ts`

```typescript
import '@testing-library/jest-dom'

// 全局 Mock：浏览器 API
// ResizeObserver（很多组件用它监听尺寸变化）
class ResizeObserverMock {
  observe() {}
  unobserve() {}
  disconnect() {}
}
global.ResizeObserver = ResizeObserverMock

// IntersectionObserver（懒加载、无限滚动可能用到）
class IntersectionObserverMock {
  observe() {}
  unobserve() {}
  disconnect() {}
}
global.IntersectionObserver = IntersectionObserverMock

// matchMedia（响应式组件可能用到）
global.matchMedia = (query: string) => ({
  matches: false,
  media: query,
  onchange: null,
  addListener: () => {},
  removeListener: () => {},
  addEventListener: () => {},
  removeEventListener: () => {},
  dispatchEvent: () => false,
})

// scrollTo（jsdom 不实现）
window.scrollTo = () => {}
```

### 3.4 创建测试工具函数 `src/test/utils.tsx`

```tsx
import { render } from '@testing-library/react'
import { ReactNode } from 'react'
import { BrowserRouter } from 'react-router-dom'

// 带路由的渲染器（组件里用了 useNavigate / useParams 时需要）
export function renderWithRouter(ui: ReactNode) {
  return render(<BrowserRouter>{ui}</BrowserRouter>)
}

// 重置所有 zustand store（每个测试前调用，避免状态污染）
export function resetAllStores() {
  // 具体 store 的 reset 方法，见下文 Mock 策略
}
```

---

## 四、测试策略

### 4.1 分层测试

```
┌─────────────────────────────────────────┐
│  E2E 测试（Playwright，暂不做）          │
│  真实浏览器、完整流程、慢、脆弱           │
├─────────────────────────────────────────┤
│  组件测试（本次范围）                     │
│  渲染单个组件、模拟交互、中等速度、稳定    │
├─────────────────────────────────────────┤
│  纯逻辑测试（已完成，176 个）            │
│  函数输入输出、最快、最稳定               │
└─────────────────────────────────────────┘
```

### 4.2 组件分级（按优先级）

#### P0 — 必须覆盖（交互复杂、容易出 bug、用户高频使用）

| 组件 | 行数 | 优先级理由 |
|---|---|---|
| `Inspector.tsx` | 3483 | 最复杂、节点配置全在这里、modality 过滤、表单校验、产物展示 |
| `Settings.tsx` | 1579 | 表单多、provider 配置、模型单价、API key 加密 |
| `ProductGallery.tsx` | 810 | 产物渲染、按流水线分组、kind 过滤、ArtifactCard 集成 |
| `TemplatePicker.tsx` | 171 | 用户入口、分类分组、搜索、fieldValues 应用 |
| `CanvasToolbar.tsx` | 258 | 画布操作、缩放、撤销重做、用户高频交互 |

#### P1 — 应该覆盖（有一定交互、中等复杂度）

| 组件 | 行数 | 优先级理由 |
|---|---|---|
| `ConnectorEditor.tsx` | 524 | 连接器配置、file/http/form/database 四种类型切换 |
| `TriggersPanel.tsx` | 507 | 触发器配置、cron/webhook/event/batch 四种类型 |
| `RunHistory.tsx` | 434 | 运行历史列表、状态展示、时间线回放入口 |
| `ControlPanel.tsx` | 407 | 运行控制、派发、暂停、恢复、参数输入 |
| `ModelAssignModal.tsx` | 263 | 批量分配模型、全选/清空、modality 过滤 |
| `GraphSwitcher.tsx` | — | 多产线切换、新建、删除 |
| `SourceFiles.tsx` / `SourceImages.tsx` | — | 文件/图片上传、双投料入口 |
| `Timeline.tsx` | — | 运行时间轴回放、节点状态、产物查看 |

#### P2 — 可选覆盖（简单展示组件、低交互）

- `GlossaryModal.tsx`、`BrandTermsModal.tsx`、`VariablesModal.tsx`、`VersionPanel.tsx`
- `ABDialog.tsx`、`ABReport.tsx`、`RunCompare.tsx`、`CostReport.tsx`、`EvalReport.tsx`
- `FailurePanel.tsx`、`KnowledgePanel.tsx`、`SkillPicker.tsx`
- `Onboarding.tsx`、`NewGraphDialog.tsx`、`TemplateFieldDialog.tsx`
- `UserMenu.tsx`、`AccountDialog.tsx`、`AuthPages.tsx`、`ProtectedRoute.tsx`
- `CommandPalette.tsx`、`ShortcutsHelp.tsx`、`UndoRedo.tsx`
- `Toast.tsx`、`Tooltip.tsx`、`Popover.tsx`、`Logo.tsx`、`FinishedProduct.tsx`、`ProductBlocks.tsx`

### 4.3 每个组件的测试维度

| 维度 | 说明 | 例子 |
|---|---|---|
| **渲染** | 组件是否正确渲染初始状态 | Inspector 选中 textGen 节点后显示模型下拉 |
| **交互** | 用户操作后状态是否正确更新 | 修改提示词后调用 updateNode |
| **条件渲染** | 不同 props/状态下显示不同内容 | imageGen 节点只显示图片模型 |
| **错误处理** | 错误状态是否正确展示 | API 失败显示错误提示 |
| **表单校验** | 非法输入是否被拦截 | API key 为空时保存按钮禁用 |
| **无障碍** | 语义化标签、aria 属性（可选） | 按钮有 aria-label、表单有 label |

### 4.4 不测试什么

- **CSS 样式**（视觉回归测试需要专门工具，不在本次范围）
- **第三方库内部行为**（zustand、react-router 自己有测试）
- **纯展示组件的静态文本**（性价比低）
- **动画和过渡效果**（jsdom 不支持 CSS 动画）
- **Canvas 像素级渲染**（jsdom 的 canvas 支持有限，只测交互逻辑）

---

## 五、核心组件测试点设计

### 5.1 Inspector.tsx（P0，最高优先级）

**测试场景**：

1. **渲染不同节点类型**
   - 选中 textGen 节点 → 显示模型下拉（只含文本模型）、温度滑块、提示词 textarea
   - 选中 imageGen 节点 → 显示模型下拉（只含图片模型）、尺寸选择、提示词
   - 选中 code 节点 → 显示代码编辑器、语言选择、超时设置
   - 选中 http 节点 → 显示 URL 输入、方法选择、headers 编辑
   - 选中 gate 节点 → 显示质检规则、阈值设置

2. **模型下拉 modality 过滤**
   - textGen 节点的模型下拉不包含图片/视频模型
   - imageGen 节点的模型下拉不包含文本模型
   - 切换节点类型后模型下拉更新

3. **表单交互**
   - 修改提示词 → 调用 `updateNode`，store 中节点的 prompt 更新
   - 修改温度 → 调用 `updateNode`
   - 切换模型 → 调用 `updateNode`
   - 清空提示词 → 是否有校验提示

4. **产物展示**
   - 节点有文本产物 → 显示文本内容
   - 节点有图片产物 → 显示图片（ArtifactCard）
   - 节点有 JSON 产物 → 显示 JSON 树
   - 节点无产物 → 显示空状态

5. **节点操作**
   - 点击删除节点 → 调用删除 action
   - 点击复制节点 → 调用复制 action
   - 点击禁用/启用节点 → 切换 disabled 状态

### 5.2 Settings.tsx（P0）

**测试场景**：

1. **Provider 管理**
   - 添加新 provider → 表单显示、保存后出现在列表
   - 编辑已有 provider → 表单预填、保存后更新
   - 删除 provider → 确认对话框、删除后从列表移除
   - provider 类型切换（openai-compatible / 其他）→ 显示不同字段

2. **模型配置**
   - 添加模型 → 选择 provider、输入模型名、选择 modality
   - 模型单价设置 → token 单价、按次计费
   - 删除模型 → 从列表移除

3. **表单校验**
   - API key 为空 → 保存按钮禁用或显示错误
   - provider name 为空 → 显示错误
   - 模型名重复 → 显示错误

4. **加密验证**
   - 输入 API key → 保存后不显示明文（显示掩码）
   - 重新打开设置 → API key 字段显示掩码而非明文

### 5.3 ProductGallery.tsx（P0）

**测试场景**：

1. **产物列表渲染**
   - 有产物时 → 按流水线分组显示
   - 无产物时 → 显示空状态
   - 产物很多时 → 滚动加载或分页

2. **kind 过滤**
   - 选择"图片" → 只显示图片产物
   - 选择"文本" → 只显示文本产物
   - 选择"全部" → 显示所有产物

3. **产物详情**
   - 点击产物 → 展开详情（ArtifactCard）
   - 图片产物 → 显示图片预览
   - 文本产物 → 显示文本内容（经过 sanitize-html）
   - JSON 产物 → 显示可折叠 JSON 树

4. **流水线分组**
   - 同一流水线的产物在同一组下
   - 组标题显示流水线名称
   - 点击组标题 → 折叠/展开该组

### 5.4 TemplatePicker.tsx（P0）

**测试场景**：

1. **模板列表渲染**
   - 打开选择器 → 显示 27 个业务模板（不含空白产线）
   - 模板按分类分组显示（11 个分类）
   - 空白产线钉在最前

2. **搜索过滤**
   - 输入"小红书" → 只显示匹配的模板
   - 输入不存在的关键词 → 显示空状态
   - 清空搜索 → 显示所有模板

3. **模板选择**
   - 点击模板 → 调用创建产线的 action
   - 模板有 fieldValues → 弹出 TemplateFieldDialog 让用户填写
   - 模板无 fieldValues → 直接创建产线

4. **分类导航**
   - 点击分类 → 滚动到对应分类
   - 分类至少有 1 个模板（无空分类）

### 5.5 CanvasToolbar.tsx（P0）

**测试场景**：

1. **缩放控制**
   - 点击放大 → zoom 增加
   - 点击缩小 → zoom 减少
   - 点击适应屏幕 → 调用 fitToBounds
   - 显示当前缩放比例

2. **撤销重做**
   - 有可撤销操作时 → 撤销按钮可用
   - 无可撤销操作时 → 撤销按钮禁用
   - 点击撤销 → 调用 undo
   - 点击重做 → 调用 redo

3. **其他操作**
   - 点击保存 → 调用保存 action
   - 点击运行 → 调用派发 action
   - 点击删除选中 → 调用删除选中节点 action

---

## 六、Mock 策略

### 6.1 Store Mock

组件大量依赖 zustand store，有两种策略：

#### 策略 A：使用真实 store + 初始状态（推荐）

```tsx
import { useCanvasStore } from '@/store/canvas'

beforeEach(() => {
  // 重置到初始状态
  useCanvasStore.setState(useCanvasStore.getInitialState())
})

test('renders with custom viewport', () => {
  // 设置特定状态
  useCanvasStore.setState({ viewport: { x: 100, y: 200, zoom: 0.5 } })
  render(<CanvasToolbar />)
  // 断言显示 50%
})
```

**优点**：
- 测试更真实，store 和组件的集成行为一起测
- 不需要 mock store 的实现
- 可以测试组件调用 store action 后状态是否正确更新

**缺点**：
- store 之间可能有依赖（比如 graph store 依赖 canvas store）
- 需要仔细清理状态，避免测试间污染

#### 策略 B：Mock store（仅用于复杂依赖场景）

```tsx
vi.mock('@/store/canvas', () => ({
  useCanvasStore: vi.fn(() => ({
    viewport: { x: 0, y: 0, zoom: 1 },
    zoomIn: vi.fn(),
    zoomOut: vi.fn(),
    fitToBounds: vi.fn(),
  })),
}))
```

**使用场景**：
- store 有复杂的异步初始化（比如从 localStorage 加载）
- store 依赖浏览器 API 难以模拟
- 只需要测试组件的渲染逻辑，不需要测 store 集成

### 6.2 API Mock

组件调用 `api.ts` 封装的请求，用 `vi.mock` 替换：

```tsx
vi.mock('@/lib/api', () => ({
  api: {
    getGraphs: vi.fn().mockResolvedValue([{ id: '1', name: 'Test' }]),
    createGraph: vi.fn().mockResolvedValue({ id: '2', name: 'New' }),
    deleteGraph: vi.fn().mockResolvedValue({}),
    // ...
  },
}))
```

**测试 loading/error 状态**：

```tsx
test('shows loading state while fetching', async () => {
  vi.mocked(api.getGraphs).mockReturnValue(new Promise(() => {})) // pending
  render(<GraphSwitcher />)
  expect(screen.getByText('加载中...')).toBeInTheDocument()
})

test('shows error state on fetch failure', async () => {
  vi.mocked(api.getGraphs).mockRejectedValue(new Error('Network error'))
  render(<GraphSwitcher />)
  expect(await screen.findByText('加载失败')).toBeInTheDocument()
})
```

### 6.3 路由 Mock

组件用了 `useNavigate` / `useParams` / `useLocation`：

```tsx
import { MemoryRouter } from 'react-router-dom'

function renderWithRoute(ui: ReactNode, route = '/') {
  return render(
    <MemoryRouter initialEntries={[route]}>
      {ui}
    </MemoryRouter>
  )
}
```

或者 mock `useNavigate`：

```tsx
const mockNavigate = vi.fn()
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom')
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  }
})
```

### 6.4 核心库 Mock

`@agent-world/core` 提供类型和常量，一般不需要 mock（纯数据）。但如果组件调用了 core 的函数，可以按需 mock。

### 6.5 浏览器 API Mock

在 `setup.ts` 中全局 mock：
- `ResizeObserver`
- `IntersectionObserver`
- `matchMedia`
- `scrollTo`
- `localStorage`（jsdom 已内置，但可以用 `vi.spyOn` 监控调用）
- `canvas` API（jsdom 的 canvas 支持有限，复杂绘制需要 mock）

---

## 七、目录结构与命名规范

### 7.1 目录结构

```
apps/web/src/
├── test/
│   ├── setup.ts          # 全局设置（jest-dom、浏览器 API Mock）
│   └── utils.tsx         # 测试工具函数（renderWithRouter、resetStores）
├── components/
│   ├── Inspector.tsx
│   ├── Inspector.test.tsx    # 组件测试，与组件同目录
│   ├── Settings.tsx
│   ├── Settings.test.tsx
│   └── ...
├── store/
│   ├── canvas.ts
│   └── canvas.test.ts        # 已有的 store 测试保持不变
└── ...
```

### 7.2 命名规范

- 测试文件与组件同目录，命名为 `ComponentName.test.tsx`
- 测试描述用中文，格式：`描述测试场景`
- `describe` 按功能分组，`it`/`test` 描述具体行为

```tsx
describe('Inspector', () => {
  describe('渲染不同节点类型', () => {
    it('选中 textGen 节点时显示文本模型下拉', () => {})
    it('选中 imageGen 节点时显示图片模型下拉', () => {})
  })

  describe('模型下拉 modality 过滤', () => {
    it('textGen 节点的下拉不包含图片模型', () => {})
  })
})
```

---

## 八、实施步骤（分阶段）

### 阶段 1：基础设施搭建（0.5 天）

1. 安装依赖：`@testing-library/react`、`@testing-library/user-event`、`@testing-library/jest-dom`、`jsdom`
2. 创建 `vitest.config.ts`，配置 jsdom 环境
3. 创建 `src/test/setup.ts`，配置 jest-dom 断言和全局浏览器 API Mock
4. 创建 `src/test/utils.tsx`，封装 renderWithRouter 等工具函数
5. **验证**：写一个最简单的组件测试（比如 Logo 组件），确认环境跑通
6. 运行现有 176 个测试，确认配置变更不破坏现有测试

### 阶段 2：P0 组件试点（2-3 天）

按优先级逐个覆盖：

1. **CanvasToolbar.tsx**（最简单，适合试点）
   - 缩放控制、撤销重做、保存/运行按钮
   - 验证 store 集成测试模式

2. **TemplatePicker.tsx**（中等复杂度）
   - 模板列表渲染、搜索过滤、分类分组、模板选择
   - 验证列表渲染和用户交互模式

3. **ProductGallery.tsx**（中等复杂度）
   - 产物列表、kind 过滤、ArtifactCard 集成、流水线分组
   - 验证条件渲染和 API Mock 模式

4. **Settings.tsx**（高复杂度）
   - Provider 管理、模型配置、表单校验、API key 加密
   - 验证表单测试和异步操作模式

5. **Inspector.tsx**（最高复杂度，最后做）
   - 不同节点类型渲染、模型 modality 过滤、表单交互、产物展示
   - 验证复杂条件渲染和多 store 集成模式

### 阶段 3：P1 组件扩展（2-3 天，可选）

- ConnectorEditor、TriggersPanel、RunHistory、ControlPanel
- ModelAssignModal、GraphSwitcher、SourceFiles/SourceImages、Timeline

### 阶段 4：完善与维护（持续）

- 新增组件时同步添加测试
- 修复 bug 时先写失败测试再修复
- 定期检查测试覆盖率（不追求 100%，但核心组件应 >60%）

---

## 九、时间估算

| 阶段 | 内容 | 估算时间 |
|---|---|---|
| 阶段 1 | 基础设施搭建 | 0.5 天 |
| 阶段 2 | P0 组件（5 个） | 2-3 天 |
| 阶段 3 | P1 组件（8 个） | 2-3 天（可选） |
| **总计（P0）** | **基础设施 + 5 个核心组件** | **2.5-3.5 天** |
| **总计（P0+P1）** | **全部高价值组件** | **4.5-6.5 天** |

---

## 十、验收标准

### 10.1 基础设施验收

- [ ] `vitest.config.ts` 配置正确，`npx vitest run` 可以运行组件测试
- [ ] `setup.ts` 配置了 jest-dom 断言和必要的浏览器 API Mock
- [ ] 现有 176 个纯逻辑测试全部通过（配置变更不破坏现有测试）
- [ ] 一个最简单的组件测试（Logo）可以通过

### 10.2 P0 组件验收

每个 P0 组件满足：

- [ ] 至少覆盖 3 个测试维度（渲染、交互、条件渲染、错误处理、表单校验）
- [ ] 至少 5 个测试用例
- [ ] 测试用例描述清晰，能看懂测的是什么
- [ ] 测试之间状态隔离（一个测试的状态不影响另一个）
- [ ] 测试稳定（连续运行 3 次全部通过，无 flaky）

### 10.3 整体验收

- [ ] 所有测试（纯逻辑 + 组件）一次运行全部通过
- [ ] 测试运行时间 < 30 秒（组件测试不应太慢）
- [ ] 无 console.error / console.warn 输出（除非是预期的）
- [ ] 文档更新：handoff.md 的 Quality gate 部分更新测试数量

---

## 十一、风险与应对

| 风险 | 影响 | 应对 |
|---|---|---|
| **Inspector 太复杂（3483 行），测试难写** | 耗时超预期 | 先测核心路径（节点类型切换、模型过滤、表单提交），不追求全覆盖 |
| **jsdom 不支持 canvas** | Canvas 组件无法测渲染 | 只测 Canvas 的交互逻辑（缩放、拖拽、选中），不测像素级渲染 |
| **store 之间依赖复杂** | 测试初始化麻烦 | 封装 `resetAllStores` 工具函数，统一初始化 |
| **组件重构导致测试大量失败** | 维护成本高 | 测试聚焦用户可见行为，不测实现细节；重构时同步更新测试 |
| **异步操作测试 flaky** | 测试不稳定 | 使用 `findBy*`（带超时）代替 `getBy*`；避免 `setTimeout` 硬编码等待 |
| **React 19 兼容性** | @testing-library 可能不兼容 | 使用最新版 @testing-library/react（已支持 React 19） |

---

## 十二、不做什么（明确边界）

1. **不做 E2E 测试**（Playwright/Puppeteer）——那是另一个范畴，需要真实浏览器和完整后端
2. **不做视觉回归测试**（截图对比）——需要专门工具和基线维护
3. **不追求 100% 覆盖率**——核心组件 >60% 即可，简单展示组件可以不测
4. **不测 CSS 样式**——jsdom 不支持完整 CSS 计算，视觉问题靠人工和 E2E
5. **不测第三方库内部行为**——zustand、react-router 自己有测试
6. **不重构组件**——测试过程中发现组件设计问题，记录下来但不立即重构（避免范围蔓延）

---

## 十三、后续扩展方向

1. **覆盖率报告**：配置 `@vitest/coverage-v8`，生成覆盖率报告
2. **组件测试 CI 集成**：CI 中运行组件测试，PR 必须通过
3. **E2E 测试**：项目稳定后引入 Playwright，覆盖核心用户流程
4. **视觉回归测试**：引入 Chromatic 或 Loki，做组件截图对比
5. **Storybook**：组件文档化和可视化测试，与组件测试互补

---

> 方案评审通过后，按阶段 1 → 阶段 2 顺序实施。每完成一个阶段提交一次 commit，commit message 用英语，原子提交，不 push。
