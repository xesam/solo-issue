import { expect, test } from "@playwright/test";
import { WECOM1, WECOM2, appUrl, deleteIssueViaUi, loginAs, logout, marker } from "./utils";
import { sweepE2eData } from "./fixtures";

// 旅程 4+5（走查报告 §四-s4/s5）：评论 @提及（弹层 role=listbox/option 语义，F2 修复后可走
// role 定位）+ 跨用户通知闭环。候选弹层的数据源（成员表）是异步加载的，
// @ 的键入采用小重试直至弹层出现（见 spec 内注释）。
test.beforeEach(async () => {
  await sweepE2eData(); // 吸收上次中断的历史残渣（幂等）
});

test.afterEach(async () => {
  await sweepE2eData(); // 无论成败，失败路径的尝试数据一并兜走
});

test("评论 @提及 → 跨用户收到 MENTIONED 通知", async ({ page }) => {
  const title = marker("mention");
  await loginAs(page, WECOM1);

  // 前置：建一条干净的 issue（走"创建并返回"再进详情页）
  await page.goto(appUrl("/w/main/p/demo/issues/new"));
  await page.locator('input[placeholder="问题标题"]').fill(title);
  await page.locator('button:has-text("创建并返回")').click();
  await page.waitForURL("**/p/demo**", { timeout: 15_000 });
  const row = page.locator("tr", { hasText: title });
  await row.locator("a").first().click();
  await page.waitForURL("**/issues/**", { timeout: 15_000 });
  const number = Number(page.url().match(/issues\/(\d+)/)?.[1]);

  // 详情页评论框：编辑器在描述编辑器之后（DOM 顺位 last）
  const commentBox = page.locator('[contenteditable="true"]').last();
  await commentBox.click();
  await page.keyboard.type("走查评论：请评估 ");

  // 成员候选数据是异步的（React Query 缓存命中时无网络往返，不能等响应）——
  // 「敲 @ → 短轮询弹层 → 未弹则退格重敲」小重试直弹为止，规避加载竞态
  const popup = page.locator("#mention-suggestions");
  for (let i = 0; i < 5; i++) {
    await page.keyboard.type("@");
    try {
      await popup.waitFor({ state: "visible", timeout: 2_000 });
      break;
    } catch {
      await page.keyboard.press("Backspace");
      if (i === 4) throw new Error("提及弹层五次重试未出现：成员表可能不可用");
    }
  }
  await expect(popup).toBeVisible();
  await expect(popup).toHaveAttribute("aria-label", "可提及的成员");
  await expect(popup).toHaveAttribute("aria-activedescendant", "mention-option-0");
  // 候选项可访问名 = 姓名 + 凭据标识（如 "企业微信2 企业微信"），因此用子串匹配；
  // "企业微信2" 恰不是 "企业微信100" 的子串，无歧义
  await popup.getByRole("option", { name: WECOM2 }).click();
  await page.keyboard.type("下班前给个结论");

  await page.locator('button:has-text("发送评论")').click();
  await expect(page.getByText(/走查评论：请评估/).first()).toBeVisible({ timeout: 15_000 });

  // 跨用户收信
  await logout(page);
  await loginAs(page, WECOM2);
  await page.goto(appUrl("/me?tab=notifications"));
  // 钉到本次编号：正则匹配 DEMO-\d+ 会被任何历史提及通知满足（虽经 sweep 清扫，
  // 仍以精确编号消歧——通知标题模板见 im.instance.mentioned）
  await expect(page.getByText(`在 DEMO-${number} 中提及你`).first()).toBeVisible({ timeout: 15_000 });
  await expect(
    page.locator(`a[href="${appUrl("/me")}"][aria-label^="未读通知"]`),
  ).toHaveAttribute("aria-label", /未读通知 [1-9]\d*/);

  // 收尾：回到提及者清理数据
  await logout(page);
  await loginAs(page, WECOM1);
  await page.goto(appUrl(`/w/main/p/demo/issues/${number}`));
  await deleteIssueViaUi(page, number);
});
