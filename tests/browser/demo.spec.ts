import { test, expect, type Page } from "@playwright/test";
async function openDemo(page: Page) {
  await page.goto("/");
  await page.getByPlaceholder("Your name").fill("Nico");
  await page.getByRole("button", { name: "Open local demo" }).click();
  await expect(page).toHaveURL(/\/rooms\/nicos-room\/setup$/);
}
async function addPool(page: Page, names: string[]) {
  await page.getByRole("button", { name: "Add champion to Top pool" }).click();
  for (const name of names) {
    await page.getByRole("textbox", { name: "Search champions" }).fill(name);
    await page.getByRole("button", { name, exact: true }).click();
    await expect(
      page.getByRole("button", { name, exact: true }),
    ).toBeDisabled();
  }
  await page.getByRole("button", { name: "Close", exact: true }).click();
}
test("named rooms, host badge, direct joining and the current 173-champion catalogue", async ({
  page,
}) => {
  await openDemo(page);
  await expect(
    page.getByRole("heading", { name: "Nico's room", exact: true }),
  ).toBeVisible();
  await expect(page).toHaveTitle("Nico's room · Preparation");
  await expect(page.getByText("HOST", { exact: true })).toBeVisible();
  for (const name of [
    "Ready",
    "Not ready",
    "End room",
    "Leave room",
    "Available",
    "My role",
  ])
    await expect(page.getByText(name, { exact: true })).toHaveCount(0);
  await expect(page.locator("body")).not.toContainText("Riot Data Dragon");
  await expect(page.getByRole("heading", { name: "Draft board" })).toHaveCount(
    0,
  );
  await expect(page.getByRole("button", { name: "Start draft" })).toBeEnabled();
  const top = page.getByRole("group", { name: "Top role" });
  await top.getByRole("button", { name: "Join", exact: true }).click();
  await expect(top.locator(".pool-tile")).toHaveCount(0);
  await expect(top).toHaveCSS("border-top-width", "3px");
  const participants = page.getByRole("region", { name: "Room participants" });
  await expect(participants).toContainText("1/5");
  await expect(participants).not.toContainText("Top");
  await addPool(page, ["Zaahen", "Renekton", "Camille"]);
  await expect(top.locator(".pool-tile")).toHaveCount(3);
  await expect
    .poll(() =>
      top
        .locator(".pool-tile img")
        .first()
        .evaluate((img: HTMLImageElement) => img.naturalWidth),
    )
    .toBeGreaterThanOrEqual(64);
  const size = await top.locator(".pool-tile").first().boundingBox(),
    add = await page
      .getByRole("button", { name: "Add champion to Top pool" })
      .boundingBox();
  expect(size?.width).toBe(58);
  expect(add?.width).toBe(size?.width);
  await top
    .getByRole("button", { name: "Remove Zaahen from Top pool" })
    .click();
  await expect(top.locator(".pool-tile")).toHaveCount(2);
  await page.screenshot({
    path: "test-results/preparation-desktop.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBeTruthy();
  await page.screenshot({
    path: "test-results/preparation-mobile.png",
    fullPage: true,
  });
});
test("host starts immediately with no assigned role or selected champions", async ({
  page,
}) => {
  await openDemo(page);
  await page.getByRole("button", { name: "Start draft" }).click();
  await expect(page).toHaveURL(/\/rooms\/nicos-room\/draft$/);
  await expect(
    page.getByRole("heading", { name: "Draft board" }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Nico's room" }),
  ).toBeVisible();
  await expect(page).toHaveTitle("Nico's room · Draft");
});
test("full-width draft integrates pool candidates, score overlays and disabled picked or banned champions", async ({
  page,
}) => {
  await openDemo(page);
  await page
    .getByRole("group", { name: "Top role" })
    .getByRole("button", { name: "Join", exact: true })
    .click();
  await addPool(page, ["Renekton", "Darius", "Camille"]);
  await page.getByRole("button", { name: "Start draft" }).click();
  const top = page.getByRole("region", { name: "Top ally picks" });
  await expect(
    top.getByRole("button", { name: "Pick Renekton Top ally", exact: true }),
  ).toBeVisible();
  await expect(top.locator('[data-champion="58"] .tile-score')).toContainText(
    "N/A",
  );
  await expect(
    page.getByRole("heading", { name: "Recommendations" }),
  ).toHaveCount(0);
  await expect(page.locator(".rankings")).toHaveCount(0);
  await expect(page.getByText("Unassigned role", { exact: true })).toHaveCount(
    0,
  );
  const heading = await page
      .getByRole("heading", { name: "Draft board" })
      .boundingBox(),
    bans = await page
      .getByRole("region", { name: "Bans", exact: true })
      .boundingBox(),
    row = await page.locator(".board-head").boundingBox(),
    board = await page.locator(".integrated-board").boundingBox();
  expect(bans!.y).toBeGreaterThan(heading!.y);
  expect(bans!.y).toBeLessThan(row!.y);
  expect(board!.width).toBeGreaterThan(1100);
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
  await expect(
    top.locator('[data-champion="164"] .tile-score'),
  ).not.toContainText("N/A");
  await top
    .getByRole("button", { name: "Pick Renekton Top ally", exact: true })
    .click();
  await expect(
    top.getByRole("button", { name: "Pick Renekton Top ally", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(
    top.locator('[data-champion="58"] .tile-score'),
  ).not.toContainText("N/A");
  await page.getByRole("button", { name: "Ban 1 ally", exact: true }).click();
  await page.getByRole("textbox", { name: "Search champions" }).fill("Darius");
  await page.getByRole("button", { name: "Darius", exact: true }).click();
  await expect(
    top.getByRole("button", { name: "Pick Darius Top ally", exact: true }),
  ).toBeDisabled();
  await expect(top.locator('[data-champion="122"]')).toHaveClass(
    /tile-unavailable/,
  );
  await page.getByLabel("Remove ban Darius").click();
  await expect(
    top.getByRole("button", { name: "Pick Darius Top ally", exact: true }),
  ).toBeEnabled();
  await page
    .getByRole("button", { name: "Choose Top enemy", exact: true })
    .click();
  await page.getByRole("textbox", { name: "Search champions" }).fill("Darius");
  await page.getByRole("button", { name: "Darius", exact: true }).click();
  await expect(
    top.getByRole("button", { name: "Pick Darius Top ally", exact: true }),
  ).toBeDisabled();
  await page
    .getByRole("button", { name: "Remove Darius enemy", exact: true })
    .click();
  await expect(
    top.getByRole("button", { name: "Pick Darius Top ally", exact: true }),
  ).toBeEnabled();
  await top
    .getByRole("button", { name: "Score details for Renekton Top ally" })
    .click();
  await expect(
    page.getByRole("dialog", { name: "Score details" }),
  ).toContainText("Caitlyn");
  await page.getByRole("button", { name: "Close score details" }).click();
  await page.reload();
  await expect(page.getByLabel("Move Jhin enemy", { exact: true })).toHaveValue(
    "Jungle",
  );
  await expect(
    page.getByLabel("Move Caitlyn enemy", { exact: true }),
  ).toHaveValue("ADC");
  await expect(
    top.getByRole("button", { name: "Pick Renekton Top ally", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await page.screenshot({
    path: "test-results/draft-desktop.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(
    top.getByRole("button", { name: "Pick Renekton Top ally", exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBeTruthy();
  await page.screenshot({
    path: "test-results/draft-mobile.png",
    fullPage: true,
  });
});
test("Quit clears the room and does not restore it after reloading", async ({
  page,
}) => {
  await openDemo(page);
  page.once("dialog", (d) => d.dismiss());
  await page.getByRole("button", { name: "Quit", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Nico's room" }),
  ).toBeVisible();
  page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "Quit", exact: true }).click();
  await expect(page).toHaveURL("http://127.0.0.1:5173/");
  await page.reload();
  await expect(
    page.getByRole("button", { name: "Open local demo" }),
  ).toBeVisible();
  expect(
    await page.evaluate(() => localStorage.getItem("draftroom-current")),
  ).toBeNull();
  expect(
    await page.evaluate(() => localStorage.getItem("draftroom-demo")),
  ).toBeNull();
});
test("role swap appears on hover and an incoming popup closes after five seconds without swapping roles", async ({
  page,
}) => {
  await openDemo(page);
  await page
    .getByRole("group", { name: "Top role" })
    .getByRole("button", { name: "Join", exact: true })
    .click();
  await page.evaluate(() => {
    const r = JSON.parse(localStorage.getItem("draftroom-demo")!);
    r.state.players.push({
      id: "peer",
      name: "Alex",
      role: "ADC",
      pool: ["202"],
    });
    r.version++;
    localStorage.setItem("draftroom-demo", JSON.stringify(r));
  });
  await page.reload();
  const bottom = page.getByRole("group", { name: "Bottom role" }),
    overlay = bottom.getByRole("button", { name: "Swap role with Alex" });
  await expect(overlay).toHaveCSS("opacity", "0");
  await bottom.hover();
  await expect(overlay).toHaveCSS("opacity", "1");
  await page.screenshot({
    path: "test-results/swap-hover.png",
    fullPage: true,
  });
  await page.clock.install();
  await page.evaluate(() => {
    const r = JSON.parse(localStorage.getItem("draftroom-demo")!);
    localStorage.setItem(
      `draftroom-swaps-${r.id}`,
      JSON.stringify([
        {
          id: "test-swap",
          room_id: r.id,
          requester_id: "peer",
          target_id: "local-player",
          from_role: "ADC",
          to_role: "Top",
          created_at: new Date().toISOString(),
          expires_at: new Date(Date.now() + 5000).toISOString(),
        },
      ]),
    );
  });
  await page.reload();
  await expect(
    page.getByRole("dialog", { name: "Role swap request" }),
  ).toBeVisible();
  await page.screenshot({
    path: "test-results/swap-popup.png",
    fullPage: true,
  });
  const bar = page.getByRole("progressbar", {
    name: "Role swap time remaining",
  });
  const initial = Number(await bar.getAttribute("aria-valuenow"));
  await page.clock.fastForward(2000);
  expect(Number(await bar.getAttribute("aria-valuenow"))).toBeLessThan(initial);
  await page.clock.fastForward(3100);
  await expect(
    page.getByRole("dialog", { name: "Role swap request" }),
  ).toHaveCount(0);
  await expect(page.getByRole("group", { name: "Top role" })).toContainText(
    "Nico",
  );
  await expect(page.getByRole("group", { name: "Bottom role" })).toContainText(
    "Alex",
  );
});

test("requester also sees a popup with a draining timer and the other player’s name", async ({
  page,
}) => {
  await openDemo(page);
  await page
    .getByRole("group", { name: "Top role" })
    .getByRole("button", { name: "Join", exact: true })
    .click();
  await page.clock.install();
  await page.evaluate(() => {
    const r = JSON.parse(localStorage.getItem("draftroom-demo")!);
    r.state.players.push({
      id: "peer",
      name: "Mathis",
      role: "Mid",
      pool: ["103"],
    });
    r.version++;
    localStorage.setItem("draftroom-demo", JSON.stringify(r));
    localStorage.setItem(
      `draftroom-swaps-${r.id}`,
      JSON.stringify([
        {
          id: "outgoing-test",
          room_id: r.id,
          requester_id: "local-player",
          target_id: "peer",
          from_role: "Top",
          to_role: "Mid",
          created_at: new Date().toISOString(),
          expires_at: new Date(Date.now() + 5000).toISOString(),
        },
      ]),
    );
  });
  await page.reload();
  const dialog = page.getByRole("dialog", { name: "Role swap pending" });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText("Mathis");
  await expect(
    dialog.getByRole("button", { name: "Cancel", exact: true }),
  ).toBeVisible();
  await expect(
    dialog.getByRole("button", { name: "Accept", exact: true }),
  ).toHaveCount(0);
  const participants = page.getByRole("region", { name: "Room participants" });
  await expect(participants).toContainText("2/5");
  await expect(participants).toContainText("Nico");
  await expect(participants).toContainText("Mathis");
  await expect(participants).not.toContainText("Mid");
  const bar = dialog.getByRole("progressbar");
  const start = Number(await bar.getAttribute("aria-valuenow"));
  await page.clock.fastForward(2500);
  expect(Number(await bar.getAttribute("aria-valuenow"))).toBeLessThan(start);
  await page.screenshot({
    path: "test-results/swap-outgoing.png",
    fullPage: true,
  });
  await page.clock.fastForward(2600);
  await expect(dialog).toHaveCount(0);
});
