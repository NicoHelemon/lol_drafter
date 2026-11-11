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
  await expect(page.getByLabel("My role", { exact: true })).toHaveCount(0);
  const top = page.getByRole("group", { name: "Top role" });
  await top.getByRole("button", { name: "Choose role", exact: true }).click();
  await expect(top.locator(".pool-tile")).toHaveCount(0);
  await top.getByRole("button", { name: "Add champion to Top pool" }).click();
  for (const name of ["Renekton", "Darius", "Camille"]) {
    await page.getByRole("textbox", { name: "Search champions" }).fill(name);
    await page.getByRole("button", { name, exact: true }).click();
    await expect(
      page.getByRole("button", { name, exact: true }),
    ).toBeDisabled();
  }
  await expect(page.getByRole("button", { name: "Save pool" })).toHaveCount(0);
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await expect(top.locator(".pool-tile")).toHaveCount(3);
  const size = await top.locator(".pool-tile").first().boundingBox();
  const addSize = await top
    .getByRole("button", { name: "Add champion to Top pool" })
    .boundingBox();
  expect(size?.width).toBe(58);
  expect(addSize?.width).toBe(size?.width);
  expect(addSize?.height).toBe(size?.height);
  expect(
    await top
      .locator(".role-image")
      .evaluate((img: HTMLImageElement) => img.naturalWidth > 0),
  ).toBeTruthy();
  await page.getByRole("button", { name: "Ready ✓", exact: true }).click();
  await top
    .getByRole("button", { name: "Remove Darius from Top pool" })
    .click();
  await expect(top.locator(".pool-tile")).toHaveCount(2);
  await expect(
    page.getByRole("button", { name: "Start draft" }),
  ).toBeDisabled();
  await top.getByRole("button", { name: "Add champion to Top pool" }).click();
  await page.getByRole("textbox", { name: "Search champions" }).fill("Darius");
  await page.getByRole("button", { name: "Darius", exact: true }).click();
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await page.screenshot({
    path: "test-results/preparation-desktop.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBeTruthy();
  await page.screenshot({
    path: "test-results/preparation-mobile.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 1280, height: 900 });
  await startDraft(page);
  await expect(
    page.getByRole("region", { name: "Room preparation" }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("heading", { name: "Draft board" }),
  ).toBeVisible();
  await expect(page.getByText("No contextual data yet").first()).toBeVisible();
  await page
    .getByRole("button", { name: "Choose Bottom enemy", exact: true })
    .click();
  await page.getByRole("textbox", { name: "Search champions" }).fill("Jhin");
  await page.getByRole("button", { name: "Jhin", exact: true }).click();
  await page
    .getByLabel("Move Jhin enemy", { exact: true })
    .selectOption("Jungle");
  await page
    .getByRole("button", { name: "Choose Bottom enemy", exact: true })
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
  await expect(page.locator("body")).not.toContainText("Delta 2");
  await expect(page.getByText("ADC", { exact: true })).toHaveCount(0);
  await expect(page.getByText("SCORE", { exact: true })).toBeVisible();
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
    page.getByRole("button", { name: "Choose Bottom enemy", exact: true }),
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
