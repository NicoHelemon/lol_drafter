import { test, expect, type Page } from "@playwright/test";
async function openDemo(page: Page) {
  await page.goto("/");
  await page.getByPlaceholder("Your name").fill("Test host");
  await page.getByRole("button", { name: "Open local demo" }).click();
  await expect(page).toHaveURL(/\/rooms\/[^/]+\/setup$/);
}
async function startDraft(page: Page) {
  await page.getByRole("button", { name: "Ready ✓", exact: true }).click();
  await page.getByRole("button", { name: "Start draft" }).click();
  await expect(page).toHaveURL(/\/rooms\/[^/]+\/draft$/);
}
test("separate preparation and draft pages, English copy, ready gate, persisted draft and mobile", async ({
  page,
}) => {
  await openDemo(page);
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expect(
    page.getByRole("heading", { name: "Preparation", exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("heading", { name: "Draft board" })).toHaveCount(
    0,
  );
  await expect(
    page.getByRole("heading", { name: "Recommendations" }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Start draft" }),
  ).toBeDisabled();
  await page.getByRole("button", { name: "Pool · 3 champions" }).click();
  await page.getByRole("textbox", { name: "Search champions" }).fill("Aatrox");
  await page.getByRole("button", { name: "Aatrox", exact: true }).click();
  await page.getByRole("button", { name: "Save pool" }).click();
  await expect(
    page.getByRole("button", { name: "Pool · 4 champions" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Add demo player" }).first().click();
  await page.screenshot({path:'test-results/preparation-desktop.png',fullPage:true});
  await page.setViewportSize({width:390,height:844});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBeTruthy();
  await page.screenshot({path:'test-results/preparation-mobile.png',fullPage:true});
  await page.setViewportSize({width:1280,height:900});
  await startDraft(page);
  await expect(
    page.getByRole("region", { name: "Room preparation" }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("heading", { name: "Draft board" }),
  ).toBeVisible();
  await expect(page.getByText("No contextual data yet").first()).toBeVisible();
  await page
    .getByRole("button", { name: "Choose ADC enemy", exact: true })
    .click();
  await page.getByRole("textbox", { name: "Search champions" }).fill("Jhin");
  await page.getByRole("button", { name: "Jhin", exact: true }).click();
  await page
    .getByLabel("Move Jhin enemy", { exact: true })
    .selectOption("Jungle");
  await page
    .getByRole("button", { name: "Choose ADC enemy", exact: true })
    .click();
  await page.getByRole("textbox", { name: "Search champions" }).fill("Caitlyn");
  await page.getByRole("button", { name: "Caitlyn", exact: true }).click();
  await expect(page.getByLabel("Move Jhin enemy", { exact: true })).toHaveValue(
    "Jungle",
  );
  await expect(
    page.getByLabel("Move Caitlyn enemy", { exact: true }),
  ).toHaveValue("ADC");
  await page.getByRole("button", { name: "Ban 1 ally", exact: true }).click();
  await page
    .getByRole("textbox", { name: "Search champions" })
    .fill("Renekton");
  await page.getByRole("button", { name: "Renekton", exact: true }).click();
  await expect(
    page.locator(".recommendation").filter({ hasText: "Renekton" }),
  ).toHaveCount(0);
  await page.getByLabel("Remove ban Renekton").click();
  await expect(
    page.locator(".recommendation").filter({ hasText: "Renekton" }),
  ).toHaveCount(1);
  await page.reload();
  await expect(page.getByLabel("Move Jhin enemy", { exact: true })).toHaveValue(
    "Jungle",
  );
  await expect(
    page.getByLabel("Move Caitlyn enemy", { exact: true }),
  ).toHaveValue("ADC");
  await expect(page).toHaveURL(/\/draft$/);
  await expect(page.locator("body")).not.toContainText("V1");
  await expect(page.locator("body")).not.toContainText("Seulement");
  await page.screenshot({
    path: "test-results/draft-desktop.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page
    .getByRole("button", { name: "Recommendations", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Recommendations" }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBeTruthy();
  await page.screenshot({
    path: "test-results/draft-mobile.png",
    fullPage: true,
  });
});
test("leave room confirms, clears the saved room, and does not restore it on reload", async ({
  page,
}) => {
  await openDemo(page);
  page.once("dialog", (d) => d.dismiss());
  await page.getByRole("button", { name: "Leave room", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Preparation", exact: true }),
  ).toBeVisible();
  page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "Leave room", exact: true }).click();
  await expect(page).toHaveURL("http://127.0.0.1:5173/");
  await expect(
    page.getByRole("button", { name: "Open local demo" }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole("button", { name: "Open local demo" }),
  ).toBeVisible();
  expect(
    await page.evaluate(() => localStorage.getItem("draftroom-current")),
  ).toBeNull();
});
test("end room works from preparation and leaves a read-only draft until leaving", async ({
  page,
}) => {
  await openDemo(page);
  page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "End room", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Room ended", exact: true }),
  ).toBeVisible();
  await expect(page).toHaveURL(/\/draft$/);
  await expect(
    page.getByRole("button", { name: "Choose ADC enemy", exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "End room", exact: true }),
  ).toHaveCount(0);
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Room ended", exact: true }),
  ).toBeVisible();
  page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "Leave room", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Open local demo" }),
  ).toBeVisible();
});
