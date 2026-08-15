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

await mkdir(output, { recursive: true });
const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.BROWSER_EXECUTABLE_PATH ?? "/usr/bin/chromium",
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
});
const reports = [];
const pageNames = [
  "运行概览",
  "机器人",
  "通道",
  "消息",
  "上下文",
  "模型",
  "能力",
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
      if (
        captureScreenshots &&
        (pageName === "运行概览" || pageName === "能力")
      )
        await page.screenshot({
          path: `${output}/${target.name}-${pageName === "能力" ? "capabilities" : "overview"}.png`,
          fullPage: true,
        });
      const layout = await page.evaluate(() => {
        const root = document.documentElement;
        const clipped = [...document.querySelectorAll("button, input, select")]
          .filter((element) => {
            const node = element;
            return (
              node.scrollWidth > node.clientWidth + 1 ||
              node.scrollHeight > node.clientHeight + 1
            );
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
        };
      });
      pages.push({ name: pageName, ...layout });
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
