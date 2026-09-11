/**
 * parkLayout — RTS 阶段 B 宏观沙盘自动布局纯函数（v1）
 *
 * 输入产线列表（id + 类别 + 可选手动坐标），输出每厂 (x,z)，
 * 保证：无重叠、同输入稳定、手动坐标优先。
 *
 * 纯函数、零 React/three 依赖，可在 node 环境单测。
 * 设计见 docs/design-rts-stage-b.md §三 B2。
 *
 * 相对原型（apps/web/src/canvas/CanvasPark.tsx）的三处修正：
 * 1. 组内按 id 字典序排序（原型靠输入顺序 → 违反确定性）
 * 2. 碰撞改距离判定（原型 round 网格占位 → 相邻格视觉重叠）
 * 3. 找不到空位改阿基米德螺旋外扩（原型 20 次后静默重叠）
 */

/** 布局输入：parkLayout 只感知 id / category / manual，不依赖模板系统或运行态 */
export interface ParkLayoutInput {
  id: string;
  /** 类别；缺失或空串归入 "自定义" 桶 */
  category?: string;
  /** 手动坐标优先；x/z 非有限数时视为未手动（防 NaN 污染布局） */
  manual?: { x: number; z: number };
}

export type ParkLayoutResult = Map<string, { x: number; z: number }>;

// --- 常量（集中导出，便于调参与测试） ---

/** 厂区占地边长（园区单位，比 L1 board 大一个量级） */
export const FACTORY_SIZE = 200;
/** 类别行间距（纵向）= SIZE × 2.2，取整避免浮点漂移 */
export const ROW_GAP = 440;
/** 同类厂间距（横向）= SIZE × 1.6 */
export const COL_GAP = 320;
/** 最小圆心距（碰撞半径，略大于占地留缝）= SIZE × 1.2 */
export const MIN_GAP = 240;
/** 螺旋搜索硬上限（N≤100 远到不了，保底防死循环） */
export const HARD_CAP = 200;

/** 黄金角（≈137.5°），螺旋逐圈均匀分布，确定性无随机 */
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));
/** 螺旋径向步长 = MIN_GAP，首圈即落在碰撞半径外 */
const SPIRAL_STEP = MIN_GAP;

/** 自定义兜底桶名 */
const DEFAULT_CATEGORY = "自定义";

function dist(a: { x: number; z: number }, b: { x: number; z: number }): number {
  const dx = a.x - b.x;
  const dz = a.z - b.z;
  return Math.sqrt(dx * dx + dz * dz);
}

/** 候选点是否与所有已占位厂保持 ≥ MIN_GAP 距离 */
function isFree(p: { x: number; z: number }, placed: Array<{ x: number; z: number }>): boolean {
  for (const q of placed) {
    if (dist(p, q) < MIN_GAP) return false;
  }
  return true;
}

/**
 * 从候选点起用阿基米德螺旋外扩搜索第一个无碰撞位。
 * 确定性：黄金角 + sqrt(k) 径向，无 Math.random。
 * HARD_CAP 到顶（N≤100 不可达）兜底返回原位。
 */
function spiralUntilFree(
  p: { x: number; z: number },
  placed: Array<{ x: number; z: number }>,
): { x: number; z: number } {
  if (isFree(p, placed)) return p;
  for (let k = 1; k <= HARD_CAP; k++) {
    const ang = k * GOLDEN_ANGLE;
    const rad = SPIRAL_STEP * Math.sqrt(k);
    const q = { x: p.x + rad * Math.cos(ang), z: p.z + rad * Math.sin(ang) };
    if (isFree(q, placed)) return q;
  }
  return p;
}

function hasValidManual(f: ParkLayoutInput): boolean {
  return (
    f.manual !== undefined &&
    f.manual !== null &&
    Number.isFinite(f.manual.x) &&
    Number.isFinite(f.manual.z)
  );
}

/**
 * 园区自动布局 v1。
 *
 * 算法：
 * 1. 手动坐标厂先占位（按 id 排序，不互相避让——尊重用户显式摆放）
 * 2. 自动厂按 category 分组，类别字典序、组内 id 字典序（全链路确定性）
 * 3. 每类一行纵向居中，行内横向等距居中；候选位被占则螺旋外扩
 */
export function parkLayout(factories: readonly ParkLayoutInput[]): ParkLayoutResult {
  const result: ParkLayoutResult = new Map();
  const placed: Array<{ x: number; z: number }> = [];

  // 1. 手动坐标先占位（按 id 排序保证确定性）
  const manual = factories.filter(hasValidManual).sort((a, b) => a.id.localeCompare(b.id));
  for (const f of manual) {
    const coord = { x: f.manual!.x, z: f.manual!.z };
    result.set(f.id, coord);
    placed.push(coord); // 手动厂不互相避让，直接入 placed 供自动厂绕开
  }

  // 2. 自动厂按 category 分组
  const auto = factories.filter((f) => !hasValidManual(f));
  const byCategory = new Map<string, ParkLayoutInput[]>();
  for (const f of auto) {
    const cat = f.category && f.category.length > 0 ? f.category : DEFAULT_CATEGORY;
    const list = byCategory.get(cat);
    if (list) list.push(f);
    else byCategory.set(cat, [f]);
  }

  // 类别字典序；组内 id 字典序
  const categories = [...byCategory.keys()].sort();
  for (const cat of categories) {
    byCategory.get(cat)!.sort((a, b) => a.id.localeCompare(b.id));
  }

  // 3. 每组一行，行内横向居中
  for (let i = 0; i < categories.length; i++) {
    const list = byCategory.get(categories[i]!)!;
    const rowZ = (i - (categories.length - 1) / 2) * ROW_GAP;
    const startX = -((list.length - 1) / 2) * COL_GAP;

    for (let j = 0; j < list.length; j++) {
      const candidate = { x: startX + j * COL_GAP, z: rowZ };
      const final = spiralUntilFree(candidate, placed);
      result.set(list[j]!.id, final);
      placed.push(final);
    }
  }

  return result;
}
