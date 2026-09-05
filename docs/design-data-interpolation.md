# 连接器数据插值（Connector Data Interpolation）设计方案

> 状态：**已实施（2026-09-05 落地，D1-D7 全量 + 4 个原子 commit + 真实 dogfood 跑通）**。目标：让连接器的**结构化数据**成为一等公民——节点的任何配置字段（prompt、简报、notify 文案、branch 条件）都能用 `${...}` 引用数据源的值，而不是像现在这样被压成一段纯文本拼进原料。这是**引擎级通用能力，行业无关**；product（商品库）只是第一个带结构化数据的 connector 消费者。
> 创建：2026-09-05
>
> 源起：用户质疑「原料台节点面板为什么还有商品店铺字段，属性要适配各行各业」。复查发现两个裂缝：① source 简报字段与 connector 数据是「双来源文本拼接」，双填无提示、优先级靠猜；② `graph.ts` ProductConnector 注释宣称「字段级映射到 source 字段」，实现实为整块文本渲染进原料段——注释是理想态，实现是拼接态。市场对照：n8n 字段级表达式（`{{ $json.x }}`）、Dify 输入变量 + context 槽、ComfyUI widget→input，走的都是「内容是数据，节点表单只放行为参数」的同一条路。

## 1. 设计原则：机制与行业分层

**通用机制层**（引擎级，一次做对所有行业）：
- 连接器结构化数据通道（`data`）
- 插值上下文暴露（`${srcId.data.*}`）
- 手填字段的 fallback 合并语义（留空回填、手填覆写）
- 快捷名注册表机制

**领域适配层**（每个行业四件事，不碰引擎）：
1. 该 connector 的 `data` 填什么结构
2. 注册什么快捷名（product → `${product.name}`；未来法律 case connector → `${case.client}`、财务 invoice connector → `${invoice.amount}`）
3. 简报字段的 fallback 映射（product：`productName←name`、`brand←brand`；case：`notes←summary` 之类）
4. Inspector hint 文案

新行业接入 = 四件适配声明，引擎零改动。

## 2. 实施前锚点（现状）

- `run.ts` `productConnectorLoader` 在出口即把 `Product[]` 经 `formatProduct` 压成纯文本，结构化数据丢失，下游任何字段无法引用库值；
- `buildSourceBrief`（`nodes/shared.ts`）无条件把 8 个简报字段拼在 brief 最前，与 connector 原料块双份并存；
- 既有插值管线齐备且通用（`${var.xxx}` / `${nodeId.path}` / `${probe.url}` 走 engine.ts httpMeta 旁路 + interpCtx 合并），但 connector 数据不在上下文里。

## 3. 设计决策

| # | 决策 | 内容 |
|---|---|---|
| D1 | 通用数据通道 | `ResolvedMaterial`（`connectors.ts`）加可选 `data?: unknown`——任意 connector 的结构化数据。product connector 填 `Product[]`；未来 http（解析后 JSON）、database（rows）、file（文档元数据）免费获得同样通道。文本 `text` 照旧（原料块字节不变） |
| D2 | 上下文暴露 | 复刻 httpMeta 旁路模式新增 `sourceMeta: Map<nodeId, {data, content}>`，经 NodeRunContext 传入 source handler；interpCtx 对相邻 source 上游做同款合并——`${srcId}` 整节点引用仍解析为简报文本（不破坏），`${srcId.data[0].name}` 新增可用 |
| D3 | 快捷名注册表 | connector 类型 → 快捷名映射（product：`product`=data[0]、`products`=data）。仅当图中**恰好 1 个**该类型 source 时注入全局名（确定性，不依赖执行时序），≥2 个退化为命名空间形式 + log.info 提示。注册表放引擎初始化，新 connector 类型加一行注册。**全局快捷名已拍板做（2026-09-05）**，理由与语义见 §3.2 |
| D4 | 简报 fallback 合并 | `buildSourceBrief` 加第三参 `fallbacks?: Record<string, string>`（字段名→回填值），映射由各行业适配层声明（product：`{productName: name, brand: brand}`）；仅事实字段做 fallback（手填空→回填，非空→有意覆写），调性字段（audience/priceRange/tone/prohibited/brandTerms/notes）永远纯手工——数据源没有这些语义。`shared.ts` 保持零领域知识 |
| D5 | 简报字段可插值 | sourceNode 在 resolveConnector 成功后、buildSourceBrief 前对 8 个简报字段跑 `evaluateTemplate(field, {data, ...快捷名})`，先插值再 fallback（插值结果空串视同留空）；效果如商品名称写 `「${product.name}」双11限定款` |
| D6 | 注释修正 | `graph.ts` ProductConnector 失实注释改为真实语义：结构化数据经 sourceMeta 暴露为 `${srcId.data[0].name}`（及快捷名），文本块仍进原料段 |
| D7 | 前端 hint | 通用机制：「有结构化数据的 connector 显示数据源 hint」。V1 文案只覆盖 product（唯一有 data 的类型：「留空自动取商品库值；可用 ${product.name} 引用」）；架构上 hint 由 connector 适配层提供，新行业接文案即可 |

### 3.1 面板适配三段式（Inspector 如何「知道」与「适配」）

「节点面板的属性怎么适配各行各业」拆成三段，发生在不同层——**V1 面板几乎不用变聪明**：

| 段 | 发生层 | 机制 | 面板看到什么 |
|---|---|---|---|
| ① 感知 | 配置时·前端 | 面板读 `node.source.connector.type`（connector 配置本来就在 Inspector 的 ConnectorEditor 里）查本地注册表挂 hint——`CONNECTOR_FIELD_HINTS[type] = { fields, hintKey }`。切换 connector 类型即触发重渲染，hint 出现/消失。**零请求、不感知库里有什么数据** | 「留空自动取商品库值」提示 |
| ② 适配 | 运行时·引擎 | 真正的合并发生在 `buildSourceBrief(fallbacks)`——领域知识以 fallback 映射形式从面板挪到引擎。法律产线接 case connector → productName 留空 → brief 自动带出案件当事人名。**面板没变，输出变了** | 输入框仍显示空，但产物里出现库值 |
| ③ 换字段 | 未来·行业包 | 面板那 8 个字段名（productName/brand…）是电商历史特化，本方案**不增不删不换名**（动 schema 连坐模板/undo/版本快照）。真正「面板按行业换字段」= §13 挂起的行业包话题，复用 TemplateField 先例（服务端声明 schema、前端按 schema 渲染——TemplateFieldDialog 已验证该模式） | 行业包触发后 Inspector 动态渲染 |

一句话：**「知道」= 面板读 connector.type 查本地注册表（几行代码）；「适配」= 引擎按 fallback 映射合并（面板无感）；「换字段」= 留给 TemplateField 模式的行业包。**

### 3.2 全局快捷名决策记录（2026-09-05 拍板：做）

**决策**：product 适配层注册全局快捷名 `product`（=data[0]）与 `products`（=data），图中恰好 1 个 product-source 时注入插值上下文，运营直接写 `${product.name}` 而非 `${src-a1b2.data[0].name}`。

**做的理由（权衡后采信）**：
1. **可用性差距是真实的**——主流场景（单 product-source 推广/单品产线）下，不做则表达式要求用户去画布抄内部 nodeId；做则与领域心智直接对应，这个差距每天都在；
2. **与既有先例一致**——`var` 命名空间（`${var.xxx}` 无需 nodeId）与 httpMeta 跨分支暴露（`${probe.url}`）已是全局短名，项目哲学「常用表达式应该短」，不做反而破坏惯例；
3. **退化安全已设计**——≥2 个 product-source 时自动退化为命名空间形式 + log.info，代价是「没有全局名」而非「解析错数据」；
4. **hint 能写出确定语义**——「可用 ${product.name}」教得会普通运营；「用 ${<节点id>.data[0].name}」教不会。

**采信的风险与兜底**：
- 踩名（`product` 与节点 id 同命名空间）→ 理论风险，节点 id 为生成形态（`n-xxx`）；与 `var` 已接受的同级风险一致；**解析优先级钉死：节点 ctx 条目优先于快捷名**，并加守护测试防回归；
- 悬空引用更隐蔽（删 connector 后 `${product.name}` 静默空串）→ 缓解：run 日志 warn + hint 文案说明数据源依赖；
- 多 source 规模化时全局名失效退化 → 属减法设计非错误状态，log.info 提示切换。

**否决方理由存档**（不做）：踩名理论风险 / 悬空排查多一跳 / 多 source 场景习惯迁移成本 / 省约 15 行注册逻辑——均不构成否决级重量。

## 4. 改动清单

| 文件 | 改动 |
|---|---|
| `packages/server/src/run.ts` | `productConnectorLoader` 返回值带 `data: products`（run.ts 两处调用点自动生效） |
| `packages/server/src/connectors.ts` | `ResolvedMaterial.data?: unknown` |
| `packages/server/src/engine.ts` | `sourceMeta` Map + 快捷名注册表 + interpCtx 合并（约 30 行） |
| `packages/server/src/nodes/types.ts` | NodeRunContext 加 `sourceMeta` |
| `packages/server/src/nodes/source.ts` | 取 `m.data` → 简报字段插值 → 算 fallbacks → 写 sourceMeta |
| `packages/server/src/nodes/shared.ts` | `buildSourceBrief` 加 `fallbacks` 参（通用 Record，无领域字段名） |
| `packages/core/src/graph.ts` | ProductConnector 注释修正（D6） |
| `apps/web/src/components/InspectorFields/SourceFields.tsx` + zh/en `nodes.json` | hint + i18n keys |

## 5. 测试计划

- **单测**（buildSourceBrief，通用 fallback 语义）：留空回填 / 手填覆写 / `${product.name}` 插值 / 无 data 向后兼容（现有 loader 测试只返回 text/images，天然不破坏）；
- **引擎集成**（`engine.products.test.ts` 2→11 例，product 作为首个消费者验证机制）：① 下游 textGen prompt 里 `${product.name}` 解析到库值；② 简报留空→输出含库值且与原料块不矛盾；③ 手填覆写优先；④ notify message 嵌 `${product.brand}`；⑤ 多 product-source：全局名不注入但 `${srcId.data[0].name}` 仍可用；⑥ 无 product connector 时 `${product.name}` 解析空串（与现有 missing-value 行为一致）；⑦ 纯占位符 `${products}` 类型保持（数组→primaryValue join）；⑧ **防重入守护**——商品名含 `${var.x}` 字面输出不被二次展开（`evaluateTemplate` 单遍 replace 语义的回归锚）；⑨ **branch 数值条件**——`${product.price} > 100` 路由正确（CondParser 占位符以字面量嵌入，number 保持数值比较语义）；⑩ **回归基线**——纯手工模板 brief 逐字节不变的快照测试；⑪ **踩名守护**——命名/生成 id 恰为 `product` 的节点存在时，节点 ctx 优先于快捷名（§3.2 优先级规则的回归锚）。

## 6. 语义边界（使用前必读）

1. **`product`=data[0] 的确定性**：多商品时「第一个」= connector 查询返回顺序，实施时必须确认商品库查询带稳定 ORDER BY（如 `id`），否则 `${product.name}` 跨 run 结果不确定；
2. **空 data 不报错**：connector 启用但库空/筛空 → 快捷名解析全空串（与 missing-value 行为一致），不 fail run；run 日志 warn 顺手记；
3. **数据单语**：商品库字段是单语内容（录什么出什么），`${product.name}` 不随 UI locale 切换——现状既如此，非本方案新增；
4. **防重入**：数据值里含 `${...}` 字面量**不会被二次展开**（单遍 replace），数据可以安全携带任意文本。

## 7. 生命周期与安全

- **跨进程 resume 限制**：`sourceMeta` 与既有 `httpMeta` 同为 execute 调用内内存 Map——resumeRun 从 event log 重建状态后 meta 为空，`${srcId.data[0].name}` 在 resume 后的节点里解析空串；`${srcId}` 整节点引用不受影响（brief artifact 已持久化，含 fallback 结果）。这与 httpMeta 是同级既有语义，实施时验证先例并保持一致，不单独修复；
- **历史 run 回看是特性**：brief artifact 持久化时已含 fallback 合并结果 → 回看旧 run 看到的是**当时的数据快照**，审计友好；
- **Prompt 注入面**：库数据是自由文本，插值后进 prompt——brief 文本拼接现有的面，非新增；新增暴露面是数据也进 notify message / branch 条件。V1 信任模型 = 用户信任自己录入的数据（与 brief 手填同级），不做内容过滤，作为已知面记录；
- **类型守卫**：`data?: unknown` 消费侧（快捷名注册/插值）需 `Array.isArray` 等守卫，未知结构不 crash、解析为空串。

## 8. 免费能力：branch 数值条件

插值上下文对 branch 节点是同一份（CondParser 支持 `${nodeId.path}` 占位符、number 以裸字面量嵌入），因此 **`${product.price} > 100` 数值比较自动可用**——价格分档、库存判断路由零成本获得。运营侧最有价值的一条，⑨ 号测试守护。

## 9. 风险与对策

- **interpCtx 动刀** → httpMeta 合并既有 notify/branch 测试守护，source 分支新增用例覆盖；
- **brief 输出文本变化** → 纯手工模板逐字节不变（data undefined 时零行为差异）；有 connector 的简报多出 fallback 行属预期变化，实施前 grep 现有测试对简报文本的断言；
- **快捷名与节点 id 撞名**（`product`）→ 已拍板做全局名（§3.2）：解析优先级钉死「节点 ctx 条目优先于快捷名」+ ⑪ 号守护测试；与 `var` 同级风险项目已接受；
- **模板不跟改** → V1 内置模板零改动（`${product.x}` 写进无 product connector 的模板会解析成空串，反而危险），dogfood 留给真实电商产线；
- **SourceConfig 的 8 个电商字段挂在通用 source 节点上** → 本方案不动 schema（无破坏），用 fallback 映射让它们消费数据源；字段本身行业化的长期演进（行业包/模板自定义字段）是独立话题，见 §13。

## 10. 前端体验（D7 之外的已知边界）

- **调试可见性**：fallback 结果落在 brief artifact 里看得到；下游 prompt 的插值结果排查依赖现有 debug 面——若只有最终输出，追一个 `${product.x}` 空串需要两跳（brief → prompt）。V1 接受，GlossaryModal 补 `${product.*}` 词条是顺手活；
- **语法帮助**：写法示例进 hint 文案（V1）+ 术语表词条（顺手），不做自动补全。

## 11. 提交切分（4 个原子 commit）

1. `feat(server): expose connector data as structured interpolation context`（D1+D2+D3+types）
2. `feat(server): interpolate and fallback-merge brief fields from connector data`（D4+D5+D6）
3. `test(server): cover connector data interpolation and brief merge`
4. `feat(web): hint brief fields with data source fallback`（D7+i18n）

## 12. 使用与维护（零预设）

**使用者不需要预设任何映射规则。**「适配」全部代码内置，使用者只维护数据本身：

| 角色 | 提供内容 | 存在形式 |
|---|---|---|
| 开发者（随版本发布） | 快捷名注册（product=data[0]）、fallback 映射（productName←name）、hint 文案 | 写死在 engine 注册表 / source 适配声明 / i18n——**不是配置文件，不发版不变** |
| 使用者 | **零预设**——建商品库数据 + source 节点选 connector，即完成全部接线 | `${product.name}` 里的 `product` 来自注册表而非用户定义；简报留空自动回填，无需声明 |

运营侧不存在「维护一张映射规则表」这种东西——没有新的管理页，没有 YAML。

**维护成本三层递减**：

1. **机制层**（engine 插值管线）：一次写完基本不动，只有插值语法本身扩展时才碰；
2. **适配层**（每 connector 类型）：新 connector 上线时加四件套（data 结构/快捷名/映射/hint），**每类型一次性成本**——通道通用（`data?: unknown` + fallbacks 为 Record），新类型接入不回头改引擎，这是本方案核心维护性设计；
3. **数据层**（商品库等内容）：日常增删改与配置完全解耦——改价格、上新，下次 run 自动取新值。数据变更零配置变更，这正是「数据进插值上下文」相对「配置里塞内容」的维护优势。

**数据演进的免费午餐**：商品库将来加列（如 sku）→ `data` 原样传 `Product[]` → `${product.sku}` 自动可用，零改动。

**V1 接受的两个维护点**：① 模板引用悬空——图里写了 `${product.name}` 后又删 connector，静默解析为空串（不炸产线也不提示；run 日志加 warn 是顺手活）；② 前端 hint 注册表 / 后端 fallback 注册表两处维护，均极小，V1 不合并。

## 13. 边界与后续

- **行业字段长期演进**：source 简报 8 字段是内容线时期电商特化的历史产物，挂在通用 source 上。本方案给它们数据源通道但不做 schema 变更；未来多行业真实需求出现时，再评估行业包（industry pack）或模板自定义字段（TemplateField 已有先例），届时简报字段迁移与 data 通道正交。
- **其他 connector 接入**：http/database/file 的 data 接入不在本方案范围（各自触发时按 §1 四件套适配），但通道与注册表为它们预留。
- **电商视角消费方式**：见 [design-ecommerce-roadmap.md §F4.1](design-ecommerce-roadmap.md)（指针）。
