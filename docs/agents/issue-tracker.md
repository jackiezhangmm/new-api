# Issue 跟踪器：GitHub

本仓库的一般 Issues 和规格使用 GitHub Issues 管理，相关操作使用 `gh` CLI。

## Wayfinder 本地文档

Wayfinder 规划与决策集中记录在 `docs/wayfinder/`，每项工作使用一份当前状态文档，不拆成 GitHub 决策票。正文原位维护有效决定与待决问题，历史由 Git 跟踪，不保留废弃决议或重复讨论。

继续无限画布集成的 Wayfinder、审视其范围或准备实施时，读取 [无限画布集成路线图](../wayfinder/infinite-canvas.md)，以该文档作为当前规划入口。

## 约定

- 创建 Issue：`gh issue create --title "..." --body "..."`
- 读取 Issue：`gh issue view <number> --comments`
- 列出 Issue：`gh issue list --state open`
- 评论：`gh issue comment <number> --body "..."`
- 增删标签：`gh issue edit <number> --add-label "..."` / `--remove-label "..."`
- 关闭：`gh issue close <number> --comment "..."`

在此仓库内运行时，`gh` 会根据 Git remote 自动识别仓库。

## Pull request 作为分诊入口

**PR 作为请求入口：否。**

## 技能操作

当技能要求“发布到 issue 跟踪器”时，创建 GitHub Issue。

当技能要求“获取相关工单”时，运行：

```bash
gh issue view <number> --comments
```
