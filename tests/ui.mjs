import { mkdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";

const require = createRequire(
  process.env.QA_PLAYWRIGHT_BASE
    ? `${process.env.QA_PLAYWRIGHT_BASE}/package.json`
    : import.meta.url,
);
const { chromium } = require("playwright");

const baseUrl = process.env.QA_BASE_URL ?? "http://console:8080";
const username = process.env.QA_USERNAME;
const password = process.env.QA_PASSWORD;
const output = process.env.QA_OUTPUT ?? "/artifacts";
const captureScreenshots = process.env.QA_CAPTURE_SCREENSHOTS === "true";
if (!username || !password) throw new Error("QA credentials are required");
const detailEntries = new Map([
  ["机器人", { entry: "新增机器人" }],
  ["通道", { entry: "新增通道" }],
  ["上下文", { entry: "新增来源" }],
  ["模型", { entry: "新增 Provider" }],
  [
    "能力",
    {
      tab: "机器人授权",
      tabSelector: ".subview-tabs",
      entry: "新增授权",
    },
  ],
  [
    "插件与扩展",
    {
      tab: "运行方案",
      tabSelector: ".segmented-control",
      entry: "新建 Profile",
    },
  ],
  ["调度", { entry: "新增任务" }],
]);

await mkdir(output, { recursive: true });
const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.BROWSER_EXECUTABLE_PATH ?? "/usr/bin/chromium",
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
});
const reports = [];
const pageNames = [
  "运行概览",
  "使用手册",
  "机器人",
  "通道",
  "消息",
  "上下文",
  "模型",
  "能力",
  "插件与扩展",
  "执行",
  "调度",
  "资源",
  "浏览器",
  "治理",
  "账号",
  "系统设置",
];
try {
  for (const target of [
    { name: "desktop", width: 1440, height: 1000 },
    { name: "mobile", width: 390, height: 844 },
  ]) {
    const context = await browser.newContext({
      viewport: { width: target.width, height: target.height },
    });
    const page = await context.newPage();
    const authResponses = [];
    const pageErrors = [];
    const failedResponses = [];
    page.on("pageerror", (error) => {
      pageErrors.push({
        name: error.name,
        message: error.message.slice(0, 500),
      });
    });
    page.on("response", async (response) => {
      if (response.status() >= 500)
        failedResponses.push({
          path: new URL(response.url()).pathname,
          status: response.status(),
        });
      if (!response.url().includes("/api/auth/")) return;
      let error;
      if (response.status() >= 400) {
        const payload = await response.json().catch(() => ({}));
        error = {
          code: String(payload?.code ?? payload?.error?.code ?? ""),
        };
      }
      authResponses.push({
        path: new URL(response.url()).pathname,
        status: response.status(),
        error,
      });
    });
    await page.goto(baseUrl, { waitUntil: "networkidle" });
    await page.getByLabel("用户名").fill(username);
    await page.getByLabel("密码").fill(password);
    await page.getByRole("button", { name: "登录" }).click();
    try {
      await page
        .getByRole("heading", { name: "运行概览", exact: true })
        .waitFor();
    } catch (error) {
      if (captureScreenshots)
        await page.screenshot({
          path: `${output}/${target.name}-login-failed.png`,
          fullPage: true,
        });
      console.error(
        JSON.stringify(
          {
            stage: "login",
            target,
            url: page.url(),
            authResponses,
            pageErrors,
            failedResponses,
          },
          null,
          2,
        ),
      );
      throw error;
    }
    const pages = [];
    for (const pageName of pageNames) {
      await page.getByRole("button", { name: pageName, exact: true }).click();
      try {
        await page
          .getByRole("heading", { name: pageName, exact: true })
          .waitFor();
      } catch (error) {
        console.error(
          JSON.stringify(
            {
              stage: "navigation",
              target,
              pageName,
              url: page.url(),
              pageErrors,
              failedResponses,
              structure: await page.evaluate(() => ({
                mainPresent: Boolean(document.querySelector("main")),
                headingCount: document.querySelectorAll("h1,h2,h3").length,
                activeNavCount: document.querySelectorAll("nav .active").length,
              })),
            },
            null,
            2,
          ),
        );
        throw error;
      }
      await page.waitForTimeout(150);
      const pageGuideTrigger = page.getByRole("button", {
        name: "本页指引",
        exact: true,
      });
      const pageGuideCount =
        pageName === "使用手册" ? 0 : await pageGuideTrigger.count();
      if (pageName !== "使用手册" && pageGuideCount !== 1)
        throw new Error(`${pageName} 缺少唯一的本页指引`);
      if (pageName !== "使用手册") {
        await pageGuideTrigger.click();
        const guideDialog = page.getByRole("dialog", {
          name: "本页指引",
          exact: true,
        });
        await guideDialog.waitFor();
        const guideSections = await guideDialog.locator("section").count();
        if (guideSections !== 3)
          throw new Error(`${pageName} 的本页指引内容不完整`);
        await page.keyboard.press("Escape");
        await guideDialog.waitFor({ state: "hidden" });
      }
      const healthRowSelector =
        pageName === "模型"
          ? ".provider-section .model-entity-row"
          : pageName === "通道"
            ? ".channel-row"
            : pageName === "插件与扩展"
              ? ".model-entity-row"
              : undefined;
      let healthSummaryCount = 0;
      if (healthRowSelector) {
        const healthRows = await page.locator(healthRowSelector).count();
        healthSummaryCount = await page
          .locator(`${healthRowSelector} .health-summary`)
          .count();
        if (healthRows && healthSummaryCount !== healthRows)
          throw new Error(
            `${pageName} 有 ${healthRows} 个可检测对象，但只有 ${healthSummaryCount} 个健康摘要`,
          );
        const incompleteHealthSummary = await page
          .locator(`${healthRowSelector} .health-summary`)
          .evaluateAll((summaries) =>
            summaries.some(
              (summary) =>
                !summary.querySelector(".status-pill") ||
                !/(最后检查|尚未执行健康检查)/.test(
                  summary.textContent ?? "",
                ),
            ),
          );
        if (incompleteHealthSummary)
          throw new Error(`${pageName} 的健康摘要缺少状态或最后检查时间`);
      }
      const detail = detailEntries.get(pageName);
      if (detail) {
        if (detail.tab)
          await page
            .locator(detail.tabSelector)
            .getByRole(
              detail.tabSelector === ".subview-tabs" ? "tab" : "button",
              { name: detail.tab, exact: true },
            )
            .click();
        await page
          .getByRole("button", { name: detail.entry, exact: true })
          .click();
        await page
          .getByRole("button", { name: "返回列表", exact: true })
          .waitFor();
      }
      const advancedCount = await page
        .locator("details.advanced-config")
        .count();
      if (detail) {
        if (!advancedCount)
          throw new Error(`${pageName} 详情页缺少高级配置入口`);
        await page.locator("details.advanced-config summary").first().click();
        await page.waitForTimeout(50);
        const submitFooters = page.locator(".form-actions:visible");
        if ((await submitFooters.count()) !== 1)
          throw new Error(`${pageName} 详情页缺少唯一的底部提交动作区`);
        const submitFooterInvalid = await submitFooters.evaluate((footer) => {
          const hasConfiguration = Boolean(
            footer.querySelector("input, select, textarea, label, details"),
          );
          const isLast = footer.parentElement?.lastElementChild === footer;
          return hasConfiguration || !isLast || !footer.querySelector("button");
        });
        if (submitFooterInvalid)
          throw new Error(`${pageName} 的提交动作区不是纯按钮的表单末行`);
      }
      if (
        captureScreenshots &&
        [
          "运行概览",
          "通道",
          "模型",
          "能力",
          "插件与扩展",
          "调度",
          "浏览器",
        ].includes(pageName)
      )
        await page.screenshot({
          path: `${output}/${target.name}-${pageName}.png`,
          fullPage: true,
        });
      const layout = await page.evaluate(() => {
        const root = document.documentElement;
        const clipped = [
          ...document.querySelectorAll("button, input, select, textarea"),
        ]
          .filter((element) => {
            const node = element;
            return node.tagName === "TEXTAREA"
              ? node.scrollWidth > node.clientWidth + 1
              : node.scrollWidth > node.clientWidth + 1 ||
                  node.scrollHeight > node.clientHeight + 1;
          })
          .map((element) => ({
            tag: element.tagName,
            width: element.clientWidth,
            scrollWidth: element.scrollWidth,
            height: element.clientHeight,
            scrollHeight: element.scrollHeight,
          }));
        return {
          viewportWidth: innerWidth,
          bodyScrollWidth: root.scrollWidth,
          horizontalOverflow: root.scrollWidth > innerWidth + 1,
          clipped,
          advancedOpen: Boolean(
            document.querySelector("details.advanced-config[open]"),
          ),
        };
      });
      if (layout.horizontalOverflow)
        throw new Error(
          `${pageName} 页面宽度 ${layout.bodyScrollWidth}px 超出 ${layout.viewportWidth}px 视口`,
        );
      if (layout.clipped.length)
        throw new Error(`${pageName} 存在 ${layout.clipped.length} 个控件内容被裁切`);
      pages.push({
        name: pageName,
        pageGuideCount,
        healthSummaryCount,
        advancedCount,
        ...layout,
      });
      if (detail)
        await page
          .getByRole("button", { name: "返回列表", exact: true })
          .click();
    }
    reports.push({ target, title: await page.title(), pages });
    await context.close();
  }
} finally {
  await browser.close();
}

await writeFile(
  `${output}/report.json`,
  `${JSON.stringify({ ok: true, reports }, null, 2)}\n`,
);
console.log(JSON.stringify({ ok: true, reports }, null, 2));
