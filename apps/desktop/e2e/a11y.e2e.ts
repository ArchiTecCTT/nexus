// E2E d'accessibilité (axe-core) sur le build réel (.vite/build), via Playwright (_electron) :
// - axe-core est injecté dans la fenêtre par le protocole DevTools (page.evaluate), donc sans assouplir la CSP ;
// - chaque vue principale est analysée selon WCAG 2.0 / 2.1 / 2.2 niveaux A et AA, en thème clair puis sombre ;
// - toute violation d'impact « critical » ou « serious » fait échouer le test, avec la règle, l'aide et les éléments ;
// - l'éditeur Monaco et le terminal xterm.js sont exclus : composants tiers à mode lecteur d'écran propre
//   (limites connues, voir ACCESSIBILITY.md).
// Prérequis : `electron-forge package` ; exécuter sous un serveur X (xvfb-run en CI).
// NEXUS_A11Y_REPORT=<fichier.json> enregistre toutes les violations (tous impacts) pour analyse.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { AxeResults, ImpactValue, RunOptions } from "axe-core";
import { _electron as electron, type ElectronApplication, type Page } from "playwright";

// Hérité d'un hôte Electron (terminal de VS Code…) : ferait démarrer l'application testée comme simple Node.
delete process.env.ELECTRON_RUN_AS_NODE;

const appDir = fileURLToPath(new URL("..", import.meta.url));
const dataDir = mkdtempSync(join(tmpdir(), "nexus-a11y-e2e-"));
const projectDir = join(dataDir, "a11y-app");
const reportFile = process.env.NEXUS_A11Y_REPORT;
const axeSource = readFileSync(createRequire(import.meta.url).resolve("axe-core/axe.min.js"), "utf8");

mkdirSync(join(projectDir, "src"), { recursive: true });
writeFileSync(join(projectDir, "README.md"), "# A11y app\n");
writeFileSync(join(projectDir, "src", "index.ts"), 'export const hello = "world";\n');
try {
  execFileSync("git", ["init", "-q"], { cwd: projectDir });
} catch {
  mkdirSync(join(projectDir, ".git"), { recursive: true });
}

const mod = process.platform === "darwin" ? "Meta" : "Control";

/** Règles WCAG retenues (axe-core) : A et AA, versions 2.0, 2.1 et 2.2. */
const RUN_OPTIONS: RunOptions = {
  runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"] },
  resultTypes: ["violations"],
};

/** Composants tiers dotés de leur propre mode lecteur d'écran (limites documentées dans ACCESSIBILITY.md). */
const EXCLUDE = [[".monaco-editor"], [".xterm"]];

/** Impacts bloquants : les autres sont seulement rapportés (NEXUS_A11Y_REPORT). */
const BLOCKING: ReadonlySet<ImpactValue> = new Set(["critical", "serious"]);

interface Finding {
  view: string;
  rule: string;
  impact: ImpactValue | null;
  help: string;
  helpUrl: string;
  targets: string[];
}

let app: ElectronApplication;
let page: Page;
const findings: Finding[] = [];

before(async () => {
  app = await electron.launch({
    // Interface en français (libellés utilisés ci-dessous), quelle que soit la langue du système du runner.
    args: [appDir, "--lang=fr"],
    cwd: appDir,
    env: { ...process.env, NEXUS_USER_DATA_DIR: join(dataDir, "userdata") },
  });
  page = await app.firstWindow();
  await page.waitForLoadState("domcontentloaded");
  await page.setViewportSize({ width: 1440, height: 900 }).catch(() => {});
  await page.getByRole("heading", { level: 1 }).waitFor();
});

after(async () => {
  if (reportFile) {
    mkdirSync(dirname(reportFile), { recursive: true });
    writeFileSync(reportFile, `${JSON.stringify(findings, null, 2)}\n`);
  }
  await app?.close().catch(() => {});
  rmSync(dataDir, { recursive: true, force: true });
});

/** Attend la fin des animations (ouverture de boîte, bascule de thème) : on analyse l'état final, pas un entre-deux. */
async function settle(): Promise<void> {
  await page.evaluate(async () => {
    await Promise.all(document.getAnimations().map((a) => a.finished.catch(() => undefined)));
    await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
  });
}

/** Analyse la page avec axe-core ; renvoie les violations bloquantes mises en forme pour le message d'échec. */
async function audit(view: string): Promise<string[]> {
  await settle();
  // Injection par le protocole DevTools : non soumise à la CSP de la page (pas de script en ligne ni d'eval).
  if (!(await page.evaluate(() => "axe" in window))) await page.evaluate(axeSource);
  const results = await page.evaluate(
    async ({ exclude, options }) => {
      const axe = (window as unknown as { axe: { run: (c: unknown, o: unknown) => Promise<AxeResults> } }).axe;
      const r = await axe.run({ exclude }, options);
      return r.violations.map((v) => ({
        rule: v.id,
        impact: v.impact ?? null,
        help: v.help,
        helpUrl: v.helpUrl,
        targets: v.nodes.map((n) => n.target.join(" ")),
      }));
    },
    { exclude: EXCLUDE, options: RUN_OPTIONS },
  );
  const theme = await page.evaluate(() => document.documentElement.dataset.theme ?? "?");
  const label = `${view} (${theme})`;
  for (const r of results) findings.push({ view: label, ...r });
  return results
    .filter((r) => r.impact !== null && BLOCKING.has(r.impact))
    .map((r) => {
      const more = r.targets.length > 5 ? ` (+${r.targets.length - 5})` : "";
      return `[${label}] ${r.rule} (${r.impact}) : ${r.help}\n    ${r.targets.slice(0, 5).join("\n    ")}${more}\n    ${r.helpUrl}`;
    });
}

function assertClean(problems: string[]): void {
  assert.deepEqual(problems, [], `violations d'accessibilité :\n${problems.join("\n")}`);
}

async function setTheme(id: "dark" | "light"): Promise<void> {
  await page.keyboard.press(`${mod}+Shift+P`);
  const input = page.getByPlaceholder("Tapez une commande…");
  await input.waitFor();
  await input.fill(`theme.${id}`);
  await page.locator(`[data-command="theme.${id}"]`).click();
  await page.waitForFunction((want) => document.documentElement.dataset.theme === want, id, { timeout: 5_000 });
}

async function closeDialog(): Promise<void> {
  await page.keyboard.press("Escape");
  await page.getByRole("dialog").first().waitFor({ state: "detached", timeout: 5_000 });
}

test("accueil : aucune violation bloquante, en thème clair puis sombre", async () => {
  await setTheme("light");
  const problems = await audit("accueil");
  await setTheme("dark");
  problems.push(...(await audit("accueil")));
  assertClean(problems);
});

test("palette de commandes ouverte : aucune violation bloquante", async () => {
  await page.keyboard.press(`${mod}+Shift+P`);
  await page.getByPlaceholder("Tapez une commande…").waitFor();
  const problems = await audit("palette de commandes");
  await page.keyboard.press("Escape");
  await page.getByPlaceholder("Tapez une commande…").waitFor({ state: "hidden" });
  assertClean(problems);
});

test("boîte « Ouvrir un dossier » : aucune violation bloquante, puis ouverture du projet", async () => {
  await page.getByRole("button", { name: "Saisir un chemin" }).click();
  const dialog = page.getByRole("dialog", { name: "Ouvrir un dossier" });
  await dialog.waitFor();
  const problems = await audit("boîte Ouvrir un dossier");
  await dialog.getByLabel("Chemin du dossier").fill(projectDir);
  await dialog.getByRole("button", { name: "Ouvrir", exact: true }).click();
  await page.getByTestId("workbench").waitFor();
  await page.getByTestId("explorer-tree").getByRole("treeitem", { name: "README.md" }).waitFor();
  assertClean(problems);
});

test("plan de travail (explorateur, barres d'activité et d'état) : aucune violation bloquante, clair et sombre", async () => {
  await setTheme("light");
  const problems = await audit("plan de travail");
  await setTheme("dark");
  problems.push(...(await audit("plan de travail")));
  assertClean(problems);
});

test("boîte « Nouvelle session » : aucune violation bloquante", async () => {
  await page.getByRole("button", { name: "Session", exact: true }).click();
  await page.getByRole("dialog", { name: "Nouvelle session" }).waitFor();
  const problems = await audit("boîte Nouvelle session");
  await closeDialog();
  assertClean(problems);
});

test("réglages : aucune violation bloquante", async () => {
  await page.keyboard.press(`${mod}+Comma`);
  await page.getByRole("radiogroup", { name: "Thème" }).waitFor();
  assertClean(await audit("réglages"));
});
