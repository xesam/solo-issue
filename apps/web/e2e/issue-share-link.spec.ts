import { expect, test } from "@playwright/test";
import { BASE_PATH } from "../src/lib/base-path";
import { WECOM1, appUrl, deleteIssueViaUi, loginAs, marker } from "./utils";
import { sweepE2eData } from "./fixtures";

// 旅程：列表行一键「分享」（写入剪贴板）→ toast 引导粘贴到聊天/邮件，剪贴板含项目前缀/
// 标题/状态与 origin+basePath 绝对深链——接收者点链接直达 issue（权限模型内：成员直达）。
test.beforeEach(async () => {
  await sweepE2eData(); // 吸收上次中断的历史残渣（幂等）
});

test.afterEach(async () => {
  await sweepE2eData(); // 无论成败，失败路径的尝试数据一并兜走
});

test("分享问题：hover 行浮出按钮，剪贴板含标题/状态/完整深链并 toast 引导", async ({ page, context }) => {
  const title = marker("share");
  await loginAs(page, WECOM1);

  await page.goto(appUrl("/w/main/p/demo/issues/new"));
  await page.locator('input[placeholder="问题标题"]').fill(title);
  await page.locator('button:has-text("创建并返回")').click();
  await page.waitForURL("**/p/demo**", { timeout: 15_000 });

  // 剪贴板是敏感权限：显式授予后才能读取 writeText 的产物
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);

  const row = page.locator("tr", { hasText: title });
  await row.hover(); // 行级 group-hover 浮现按钮（opacity 不拦 hit-testing，hover 只为贴近真实操作）
  await row.getByRole("button", { name: "分享问题" }).click();

  // 成功反馈：toast 引导"已复制摘要，可粘贴分享到聊天或邮件"
  await expect(page.getByText("已复制摘要，可粘贴分享到聊天或邮件")).toBeVisible();

  const clip = await page.evaluate(() => navigator.clipboard.readText());
  expect(clip).toContain(title);
  expect(clip).toContain("状态：");
  // 绝对深链 = 运行时 origin + basePath + issue 路径（不依赖 APP_URL 配置，反代域名也对）
  const url = clip.match(/https?:\/\/\S+/)?.[0] ?? "";
  const origin = new URL(page.url()).origin;
  expect(url.startsWith(`${origin}${BASE_PATH}/w/main/p/demo/issues/`)).toBe(true);
  expect(clip.trimEnd()).toMatch(/issues\/\d+$/);

  // 清理：进详情拿编号，走 UI 删除（真实路径含输入编号强确认）
  const number = Number(clip.match(/#(\d+)/)?.[1]);
  await row.locator("a").first().click();
  await page.waitForURL("**/issues/**", { timeout: 15_000 });
  await deleteIssueViaUi(page, number);
});
