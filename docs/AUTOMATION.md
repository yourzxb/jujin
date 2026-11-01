# 每日资源维护

聚金提供核验与增量合并脚本；每日调度由使用者的 Codex 或其他任务运行环境配置。仓库本身不包含已登录账户、模型密钥或预启用的定时任务。

建议按自己的业务设置：AI 写作辅助、公众号运营、小程序和教育知识付费。关联度优先于总星数；优先检查 GitHub 日榜、周榜中与这些场景相关的项目。每次最多收录六个资源及六个灵感，允许零新增。

1. 阅读已有目录，按链接和方案语义去重。
2. 读取原仓库 README、LICENSE、最近提交，确认国内使用方式和成本。运行 `node scripts/research-daily-github.mjs owner/repo ...` 保存带日期的元数据、星数和榜单快照。
3. 对比跨日星数快照计算净增量，并明确起止时间。仅有一次星数快照时，不标称近期暴涨。榜单增长值注明日榜或周榜及核验时间。
4. 将已核验条目写成 JSON 批次，结构参照 `catalog/daily-discovery.json` 的 resources 和 inspirations 数组。每条必须提供 relatedBusinesses、existingBusinessFit、checkedAt、addedAt 与来源。
5. 运行 `node scripts/merge-daily-discovery.mjs 批次.json`，再依次运行两个 build 脚本。旧目录副本保存在本机 `data/catalog-history/`。
6. 运行目录和业务测试，检查 `/api/state` 的资源数量；刷新浏览器显示更新。

自动化只增补本地资料目录，不应自动创建业务项目、修改收支、安装上游工具或推送公开 GitHub。未核验条目保留在本地研究记录，不纳入正式目录。记录新增、跳过原因和失败；写入失败时保留或恢复上一版完整目录。
