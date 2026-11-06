-- 标题字段废除：issue 正文即描述（description/descriptionText），
-- 列表/看板/搜索/通知的摘要行改由描述首个非空行读时派生（lib/issue-summary）。
-- 预发布阶段直接废弃存量 title 文本，不做数据搬迁。
ALTER TABLE "issues" DROP COLUMN "title";
