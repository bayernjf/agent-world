# 变更管理

> 变更记录 + 回滚流程（engineering-blueprint §11）。目的：每次变更可追溯、可回滚，出问题 30 秒内退回。

## 单机阶段流程（M0）

1. **评估风险**：变更影响范围——DB schema / 依赖 / 部署脚本 / 配置
2. **记录变更**：CHANGELOG.md + commit message（原子提交，见 [handoff.md](../../handoff.md)）
3. **执行 + 验证**：`deploy.sh` 部署后自动 health 检查（`/api/health` 的 `branch`/`commit` 确认版本）
4. **出问题回滚**：按下表选手段，一分钟内退回上一个已知良好状态

## 变更类型与回滚对照

| 变更类型 | 回滚手段 |
|---|---|
| 代码部署 | `scripts/deploy/rollback.sh`（`.last-known-good` 软链切回） |
| DB 迁移 | `scripts/migrate-down.ts`（一步回滚最新迁移） |
| 配置变更 | `.env` 改回原值 + `systemctl restart agent-world` |
| 依赖升级 | 锁文件回退 + `pnpm install --frozen-lockfile` |

## 变更记录约定

- 代码变更：git commit（原子提交，`feat`/`fix`/`docs`/`ci` 分离）
- 功能级变更：`CHANGELOG.md` + `handoff.md` Recently shipped
- 事故/异常：按 [postmortem-template.md](postmortem-template.md) 复盘

## 审批流程（M3 多人协作）

单机阶段无需审批（owner 自己拍板）；M3 多人协作时引入 PR 审批 + 变更窗口（低峰期变更），届时再细化。
