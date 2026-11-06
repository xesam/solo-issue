import { expect, test } from "@playwright/test";
import { BASE_PATH } from "../src/lib/base-path";
import { WECOM1, appUrl, deleteIssueViaUi, loginAs, marker } from "./utils";
import { sweepE2eData } from "./fixtures";

// 旅程：列表行「发送」→ 弹预览框展示待复制文本（项目前缀/摘要/状态/绝对深链），可审查可修改
// → 点框内「复制」写入剪贴板并 toast 引导粘贴到聊天/邮件，弹窗自动关闭——
// 接收者点链接直达 issue（权限模型内：成员直达）。
test.beforeEach(async () => {
  await sweepE2eData(); // 吸收上次中断的历史残渣（幂等）
});

test.afterEach(async () => {
  await sweepE2eData(); // 无论成败，失败路径的尝试数据一并兜走
});

test("发送问题：弹窗预览可改后复制，剪贴板含摘要/状态/完整深链并 toast 引导", async ({ page, context }) => {
  const title = marker("send");
  const note = marker("send-note");
  await loginAs(page, WECOM1);

  await page.goto(appUrl("/w/main/p/demo/issues/new"));
  // 标题已废除：描述正文首行即摘要，发送文本取自该首行
  await page.locator('[contenteditable="true"]').first().click();
  await page.keyboard.type(title);
  await page.locator('button:has-text("创建并返回")').click();
  await page.waitForURL("**/p/demo", { timeout: 15_000 });

  // 剪贴板是敏感权限：显式授予后才能读写 writeText 的产物
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);

  const row = page.locator("tr", { hasText: title });
  await row.hover();
  await row.getByRole("button", { name: "发送问题" }).click();

  // 预览框弹出：待复制文本进可编辑 Textarea，含摘要/状态与 origin+basePath 绝对深链（不依赖 APP_URL，反代域名也对）
  const dialog = page.getByRole("dialog");
  const textarea = dialog.locator("textarea");
  const preview = await textarea.inputValue();
  expect(preview).toContain(title);
  expect(preview).toContain("状态：");
  const previewUrl = preview.match(/https?:\/\/\S+/)?.[0] ?? "";
  const origin = new URL(page.url()).origin;
  expect(previewUrl.startsWith(`${origin}${BASE_PATH}/w/main/p/demo/issues/`)).toBe(true);

  // 可修改：改写后的文本才是最终入剪贴板的内容
  await textarea.fill(`${preview}\n备注：${note}`);
  await dialog.getByRole("button", { name: "复制" }).click();

  // 成功反馈：toast 引导"已复制摘要，可粘贴到聊天或邮件发送"，弹窗自动关闭
  await expect(page.getByText("已复制摘要，可粘贴到聊天或邮件发送")).toBeVisible();
  await expect(dialog).toBeHidden();

  const clip = await page.evaluate(() => navigator.clipboard.readText());
  expect(clip).toContain(title);
  expect(clip).toContain(note);
  // 绝对深链 = 运行时 origin + basePath + issue 路径（编辑追加行在 URL 之后，取 URL 行单独断言）
  const clipUrl = clip.match(/https?:\/\/\S+/)?.[0] ?? "";
  expect(clipUrl.startsWith(`${origin}${BASE_PATH}/w/main/p/demo/issues/`)).toBe(true);
  expect(clipUrl).toMatch(/issues\/\d+$/);

  // 清理：进详情拿编号，走 UI 删除（真实路径含输入编号强确认）
  const number = Number(clip.match(/#(\d+)/)?.[1]);
  await row.locator("a").first().click();
  await page.waitForURL("**/issues/**", { timeout: 15_000 });
  await deleteIssueViaUi(page, number);
});
