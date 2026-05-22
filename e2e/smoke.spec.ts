import { expect, test } from "@playwright/test";

test("home page loads and can burn once", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText("烧 Token 生存挑战")).toBeVisible();
  await page.getByRole("button", { name: "立刻燃烧" }).click();
  await expect(page.getByText("最近结果")).toBeVisible();
});

test("admin page loads", async ({ page }) => {
  await page.goto("/admin");
  await expect(page.getByText("Admin Console")).toBeVisible();
  await expect(page.getByPlaceholder("输入 ADMIN_KEY")).toBeVisible();
});
