import { expect, test } from "@playwright/test";
import { WECOM1, appUrl, loginAs, logout } from "./utils";

// 旅程 1：mock 通道登录 → /me 落地；退出回到 /signin（会话通道闭环）
test("mock 通道登录与退出", async ({ page }) => {
  await loginAs(page, WECOM1);

  await expect(page).toHaveURL(/\/me/);
  await expect(page.getByRole("link", { name: "个人工作台" })).toBeVisible();

  // 顶栏徽标位渲染：href 精确到 /me（工作台里另有"前往待我处理"等深链卡片，
  // 只按 aria-label 模糊匹配会双命中），aria-label 是"待我处理 N"动态前缀
  await expect(page.locator(`a[href="${appUrl("/me")}"][aria-label^="待我处理"]`)).toBeVisible();
  await expect(page.locator(`a[href="${appUrl("/me")}"][aria-label^="未读通知"]`)).toBeVisible();

  await logout(page);
  await expect(page).toHaveURL(/\/signin/);
});
