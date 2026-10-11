// E2E de l'interface (plan de travail façon IDE) sur le build réel (.vite/build), via Playwright (_electron).
// Les canaux encore en cours d'implémentation côté main peuvent répondre `unavailable` : chaque assertion accepte
// alors l'état « indisponible » propre affiché par l'interface, jamais un plantage.
// Prérequis : `electron-forge package` (ou build Vite) ; exécuter sous un serveur X (xvfb-run en CI).
// NEXUS_E2E_SCREENSHOTS=<dossier> enregistre des captures d'écran du parcours.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { _electron as electron, type ElectronApplication, type Page } from "playwright";

const appDir = fileURLToPath(new URL("..", import.meta.url));
const dataDir = mkdtempSync(join(tmpdir(), "nexus-ui-e2e-"));
const projectDir = join(dataDir, "stock-app");
const shots = process.env.NEXUS_E2E_SCREENSHOTS;

mkdirSync(join(projectDir, "src", "utils"), { recursive: true });
writeFileSync(join(projectDir, "README.md"), "# Stock app\n\nGestion de stock.\n");
writeFileSync(join(projectDir, "package.json"), JSON.stringify({ name: "stock-app", version: "1.0.0" }, null, 2));
writeFileSync(join(projectDir, "src", "index.ts"), 'export const hello = "world";\n');
writeFileSync(join(projectDir, "src", "utils", "math.ts"), "export const add = (a: number, b: number) => a + b;\n");
writeFileSync(join(projectDir, ".npmrc"), "//registry.example/:_authToken=not-a-real-token\n");
try {
  execFileSync("git", ["init", "-q"], { cwd: projectDir });
} catch {
  mkdirSync(join(projectDir, ".git"), { recursive: true });
}

let app: ElectronApplication;
let page: Page;
const pageErrors: string[] = [];
const cspViolations: string[] = [];
const consoleErrors: string[] = [];

async function shot(name: string): Promise<void> {
  if (!shots) return;
  mkdirSync(shots, { recursive: true });
  await page.screenshot({ path: join(shots, `${name}.png`) });
}

const mod = process.platform === "darwin" ? "Meta" : "Control";

before(async () => {
  app = await electron.launch({
    args: [appDir],
    cwd: appDir,
    env: { ...process.env, NEXUS_USER_DATA_DIR: join(dataDir, "userdata") },
  });
  page = await app.firstWindow();
  page.on("pageerror", (e) => pageErrors.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error" && /Content Security Policy/i.test(m.text())) cspViolations.push(m.text());
    else if (m.type() === "error") consoleErrors.push(m.text());
  });
  await page.waitForLoadState("domcontentloaded");
  await page.setViewportSize({ width: 1440, height: 900 }).catch(() => {});
  await page.getByRole("heading", { level: 1 }).waitFor();
});

after(async () => {
  await app?.close();
  rmSync(dataDir, { recursive: true, force: true });
});

test("accueil : zone de dépôt, ouverture de dossier, récents", async () => {
  await page.getByRole("heading", { level: 1, name: "Bonjour. Sur quoi travaille-t-on ?" }).waitFor();
  const dropzone = page.getByTestId("dropzone");
  await dropzone.getByText("Glissez un dossier ici").waitFor();
  assert.equal(await page.getByRole("button", { name: "Ouvrir un dossier" }).isVisible(), true);
  assert.equal(await page.getByRole("button", { name: "Saisir un chemin" }).isVisible(), true);
  assert.equal(await page.getByRole("button", { name: /Importer une archive/ }).isVisible(), true);
  await page.getByRole("heading", { name: "Récents" }).waitFor();
  await shot("01-accueil");
});

test("glisser-déposer simulé : survol mis en évidence, élément sans chemin refusé proprement", async () => {
  const dt = await page.evaluateHandle(() => {
    const d = new DataTransfer();
    d.items.add(new File(["x"], "dossier-simule"));
    return d;
  });
  await page.dispatchEvent("[data-testid=dropzone]", "dragenter", { dataTransfer: dt });
  await page.getByText("Relâchez pour ouvrir le dossier").waitFor();
  await shot("02-glisser");
  await page.dispatchEvent("[data-testid=dropzone]", "drop", { dataTransfer: dt });
  // Fichier synthétique : pas de chemin réel (ou pas un dossier) -> message clair, aucun plantage.
  await page
    .getByText(/Impossible de lire le chemin|Déposez un dossier/)
    .first()
    .waitFor();
  await page.getByText("Glissez un dossier ici").waitFor();
});

test("ouverture d'un projet par son chemin : le plan de travail s'affiche", async () => {
  await page.getByRole("button", { name: "Saisir un chemin" }).click();
  const dialog = page.getByRole("dialog", { name: "Ouvrir un dossier" });
  await dialog.waitFor();
  await dialog.getByLabel("Chemin du dossier").fill(projectDir);
  await dialog.getByRole("button", { name: "Ouvrir", exact: true }).click();
  await page.getByTestId("workbench").waitFor();
  await page.getByRole("button", { name: "Menu du projet" }).getByText("stock-app").waitFor();
  await page.getByRole("navigation", { name: "Barre d'activité" }).waitFor();
  assert.equal(await page.getByRole("navigation", { name: "Barre d'activité" }).getByRole("button").count(), 6);
  await page.getByRole("contentinfo", { name: "Barre d'état" }).waitFor();
});

test("explorateur : arbre paresseux, fichier protégé verrouillé, navigation clavier", async () => {
  const tree = page.getByTestId("explorer-tree");
  await tree.getByRole("treeitem", { name: "src" }).waitFor();
  await tree.getByRole("treeitem", { name: "README.md" }).waitFor();
  const npmrc = tree.getByRole("treeitem", { name: ".npmrc" });
  await npmrc.waitFor();
  assert.equal(await npmrc.getByLabel("Fichier protégé").count(), 1);

  await tree.getByRole("treeitem", { name: "src" }).click();
  await tree.getByRole("treeitem", { name: "index.ts" }).waitFor();
  assert.equal(await tree.getByRole("treeitem", { name: "src" }).getAttribute("aria-expanded"), "true");

  // Clavier : Origine puis flèche bas déplacent la sélection.
  await tree.focus();
  await page.keyboard.press("Home");
  await page.keyboard.press("ArrowDown");
  const selected = await tree.locator("[aria-selected=true]").getAttribute("data-path");
  assert.ok(selected && selected !== "src", `sélection après flèche bas : ${selected}`);
  await shot("03-explorateur");
});

test("éditeur Monaco : aperçu en italique, modification, Ctrl+S enregistre sur le disque", async () => {
  await page.getByTestId("explorer-tree").getByRole("treeitem", { name: "index.ts" }).click();
  const editor = page.locator('[data-testid=editor-panel][data-path="src/index.ts"]');
  await editor.locator(".monaco-editor").waitFor({ timeout: 20_000 });
  const tab = page.locator(".tab-inner", { hasText: "index.ts" });
  await tab.waitFor();
  assert.match((await tab.getAttribute("class")) ?? "", /is-preview/);

  await editor.locator(".view-lines").click();
  await page.keyboard.press(`${mod}+End`);
  await page.keyboard.type("\nexport const e2e = 42;");
  // La modification épingle l'onglet (plus en italique) et le marque modifié.
  await page.waitForFunction(() => {
    const el = [...document.querySelectorAll(".tab-inner")].find((n) => n.textContent?.includes("index.ts"));
    return el && !el.classList.contains("is-preview") && el.classList.contains("is-dirty");
  });
  await shot("04-editeur-modifie");
  await page.keyboard.press(`${mod}+s`);
  await page.waitForFunction(() => {
    const el = [...document.querySelectorAll(".tab-inner")].find((n) => n.textContent?.includes("index.ts"));
    return el && !el.classList.contains("is-dirty");
  });
  assert.match(readFileSync(join(projectDir, "src", "index.ts"), "utf8"), /export const e2e = 42;/);
});

test("fichier protégé : jamais lu, affiché en lecture seule verrouillée", async () => {
  await page.getByTestId("explorer-tree").getByRole("treeitem", { name: ".npmrc" }).click();
  await page.getByText("Fichier protégé", { exact: true }).first().waitFor();
  await page.getByText(/Nexus ne l'affiche pas et ne le modifie pas/).waitFor();
  assert.equal(await page.getByText("not-a-real-token").count(), 0);
});

test("terminal : Ctrl+` ouvre un terminal réel (ou un état indisponible propre), puis le masque", async () => {
  await page.keyboard.press(`${mod}+Backquote`);
  const panel = page.getByTestId("terminal-panel").first();
  await panel.waitFor();
  const unavailable = page.getByTestId("terminal-unavailable");
  const xterm = panel.locator(".xterm");
  await xterm.waitFor();
  // Laisse le temps à terminal.create de répondre.
  await page.waitForTimeout(1500);
  if (await unavailable.isVisible()) {
    await unavailable.getByText("Terminal pas encore disponible").waitFor();
  } else {
    await panel.locator(".xterm-helper-textarea").focus();
    await page.keyboard.type("echo nexus-e2e-$((40+2))");
    await page.keyboard.press("Enter");
    // Rendu DOM (repli sans WebGL) : la sortie est lisible dans le DOM.
    const rows = panel.locator(".xterm-rows");
    if ((await rows.count()) > 0) await rows.getByText("nexus-e2e-42").first().waitFor({ timeout: 15_000 });
  }
  await shot("05-terminal");
  await page.keyboard.press(`${mod}+Backquote`);
  await panel.waitFor({ state: "hidden" });
});

test("palette de commandes (Ctrl+Maj+P) et ouverture rapide (Ctrl+P)", async () => {
  await page.keyboard.press(`${mod}+Shift+P`);
  const input = page.getByPlaceholder("Tapez une commande…");
  await input.waitFor();
  await input.fill("terminal");
  await page.getByRole("option", { name: /Nouveau terminal/ }).waitFor();
  await shot("06-palette");
  await page.keyboard.press("Escape");
  await input.waitFor({ state: "hidden" });

  await page.keyboard.press(`${mod}+P`);
  const quick = page.getByPlaceholder(/Aller au fichier/);
  await quick.waitFor();
  await quick.fill("math");
  await page.getByRole("option", { name: /math\.ts/ }).waitFor({ timeout: 15_000 });
  await page.keyboard.press("Enter");
  await page
    .locator('[data-testid=editor-panel][data-path="src/utils/math.ts"] .monaco-editor')
    .waitFor({ timeout: 20_000 });
});

test("onglets : menu contextuel (scinder, agrandir…), puis scission à droite", async () => {
  await page.locator(".tab-inner", { hasText: "math.ts" }).click({ button: "right" });
  const split = page.getByText("Scinder à droite", { exact: true }).last();
  await split.waitFor();
  await shot("06b-menu-onglet");
  await split.click();
  // Deux vues du même fichier (même modèle) côte à côte.
  await page.waitForFunction(
    () => document.querySelectorAll('[data-testid=editor-panel][data-path="src/utils/math.ts"]').length === 2,
  );
  await page.keyboard.press(`${mod}+w`);
  await page.waitForFunction(
    () => document.querySelectorAll('[data-testid=editor-panel][data-path="src/utils/math.ts"]').length === 1,
  );
});

test("Ctrl+W ferme l'onglet actif sans fermer la fenêtre", async () => {
  const mathEditor = page.locator('[data-testid=editor-panel][data-path="src/utils/math.ts"]');
  await mathEditor.locator(".view-lines").click();
  await page.keyboard.press(`${mod}+w`);
  await mathEditor.waitFor({ state: "detached" });
  assert.equal(app.windows().length, 1);
  await page.getByTestId("workbench").waitFor();
});

test("nouvelle session : agent, consigne et trois grandes cartes de mode", async () => {
  await page.getByRole("button", { name: "Session", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Nouvelle session" });
  await dialog.waitFor();
  const modes = dialog.getByRole("radiogroup", { name: "Mode" }).getByRole("radio");
  assert.equal(await modes.count(), 3);
  await dialog.getByRole("radio", { name: /Autonome\s*L'agent agit directement/ }).waitFor();
  await dialog.getByRole("radio", { name: /Autonome en sandbox/ }).waitFor();
  // TUI interactive (« Terminal ») choisie par défaut pour claude-cli/codex-cli/gemini-cli.
  const claude = dialog.getByRole("radio", { name: /claude-cli/ });
  if (await claude.isVisible().catch(() => false)) {
    await claude.click();
    const view = dialog.getByRole("radiogroup", { name: "Affichage de la session" });
    assert.equal(await view.getByRole("radio", { name: /Terminal/ }).getAttribute("aria-checked"), "true");
    assert.equal(await view.getByRole("radio", { name: /Conversation/ }).isEnabled(), true);
  }
  // Comparaison : multi-sélection, mode Autonome désactivé avec une explication.
  const compare = dialog.getByRole("checkbox", { name: "Comparer plusieurs agents" });
  if (await compare.isVisible().catch(() => false)) {
    await compare.check();
    assert.equal(await dialog.getByTestId("mode-autonomous").isDisabled(), true);
    await dialog.getByText(/plusieurs agents écriraient dans le même dossier/).waitFor();
    await shot("07b-comparer");
    await compare.uncheck();
    assert.equal(await dialog.getByTestId("mode-autonomous").isDisabled(), false);
  }
  const supervised = dialog.getByRole("radio", { name: /Avec validation/ });
  await supervised.click();
  assert.equal(await supervised.getAttribute("aria-checked"), "true");

  await dialog.getByRole("textbox", { name: "Consigne" }).fill("Ajoute un test pour la fonction add.");
  // Sans agent détecté, l'identifiant du connecteur se saisit à la main.
  const connector = dialog.getByLabel("Identifiant du connecteur");
  if (await connector.isVisible().catch(() => false)) await connector.fill("claude-code");
  await shot("07-nouvelle-session");
  // Le bouton de lancement est prêt ; on ne lance PAS de vraie session (elle consommerait un agent réel).
  const start = dialog.getByRole("button", { name: "Lancer la session" });
  assert.equal(await start.isEnabled(), true);
  if (await dialog.isVisible()) {
    await page.keyboard.press("Escape");
    await dialog.waitFor({ state: "hidden" });
  }
});

test("contrôle de source : branche, fichiers modifiés et boutons Commit / Push", async () => {
  await page.keyboard.press(`${mod}+Shift+G`);
  const sidebar = page.getByTestId("sidebar");
  await sidebar.getByText("Contrôle de source", { exact: true }).first().waitFor();
  const commit = sidebar.getByRole("button", { name: "Commit" });
  const unavailable = sidebar.getByText(/Contrôle de source indisponible|pas encore disponible/);
  await commit.or(unavailable).first().waitFor({ timeout: 15_000 });
  if (await commit.isVisible()) {
    await sidebar.getByText("README.md").first().waitFor();
    assert.equal(await sidebar.getByRole("button", { name: "Push", exact: true }).isVisible(), true);
    // Pull request : petit dialogue (titre, description, base, brouillon), annulé sans rien créer.
    await sidebar.getByRole("button", { name: "Créer une pull request" }).click();
    const pr = page.getByRole("dialog", { name: "Créer une pull request" });
    await pr.waitFor();
    assert.equal(await pr.getByLabel("Branche de base").inputValue(), "main");
    await pr.getByLabel("Brouillon").waitFor();
    await shot("09b-pull-request");
    await pr.getByRole("button", { name: "Annuler" }).click();
    await pr.waitFor({ state: "hidden" });
    await shot("09-controle-source");
  }
});

test("sandbox : connexion refusée -> toast « Autoriser ce domaine »", async () => {
  await app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0]?.webContents.send("nexus:event", {
      type: "sandbox-denied",
      target: "registry.example.org:443",
      reason: "hors liste d'autorisation",
    });
  });
  const toastEl = page.locator("[data-sonner-toast]", { hasText: "Connexion bloquée : registry.example.org:443" });
  await toastEl.waitFor();
  await shot("09c-sandbox-refus");
  // Confirmation native du processus principal : simulée ici (l'utilisateur clique « Autoriser »).
  await app.evaluate(({ dialog }) => {
    const g = globalThis as unknown as { __nexusConfirms: string[] };
    g.__nexusConfirms = [];
    dialog.showMessageBox = (async (...args: unknown[]) => {
      const o = args.at(-1) as { detail?: string };
      g.__nexusConfirms.push(o.detail ?? "");
      return { response: 1, checkboxChecked: false };
    }) as typeof dialog.showMessageBox;
  });
  await toastEl.getByRole("button", { name: "Autoriser ce domaine" }).click();
  await page
    .getByText(/registry\.example\.org:443.*(autorisé|déjà autorisé)|Les réglages ne sont pas encore servis/)
    .first()
    .waitFor();
  const confirms = await app.evaluate(() => (globalThis as unknown as { __nexusConfirms: string[] }).__nexusConfirms);
  assert.ok(
    confirms.some((d) => d.includes("registry.example.org:443")),
    "confirmation native demandée",
  );
});

test("agents : liste des sessions et bouton Nouvelle session", async () => {
  await page.getByRole("navigation", { name: "Barre d'activité" }).getByRole("button", { name: "Agents" }).click();
  await page.getByTestId("sessions-list").waitFor();
  await page
    .getByTestId("sidebar")
    .getByRole("button", { name: /Nouvelle session/ })
    .waitFor();
});

test("réglages : thème clair puis sombre, langue EN puis FR", async () => {
  await page.keyboard.press(`${mod}+Comma`);
  const group = page.getByRole("radiogroup", { name: "Thème" });
  await group.waitFor();
  await group.getByRole("radio", { name: "Clair" }).click();
  assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), "light");
  await shot("10-reglages-clair");
  await group.getByRole("radio", { name: "Sombre" }).click();
  assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), "dark");

  await page.getByRole("button", { name: "Langue : français / English" }).first().click();
  await page.getByRole("navigation", { name: "Activity bar" }).waitFor();
  assert.equal(await page.evaluate(() => document.documentElement.lang), "en");
  await page.getByRole("button", { name: "Language: français / English" }).first().click();
  await page.getByRole("navigation", { name: "Barre d'activité" }).waitFor();
});

test("vues avancées (missions, équipes, approbations, architecture, publication) : rendu sans plantage", async () => {
  await page
    .getByRole("navigation", { name: "Barre d'activité" })
    .getByRole("button", { name: "Missions avancées" })
    .click();
  await page.getByTestId("sidebar").getByText("Missions", { exact: true }).waitFor();
  const views: Array<[string, string]> = [
    ["Gérer les équipes", "Équipes"],
    ["Ouvrir les approbations", "Approbations"],
    ["Architecture et usage", "Architecture et usage"],
    ["Publier (push vérifié, Vercel)…", "Publication"],
  ];
  for (const [command, heading] of views) {
    await page.keyboard.press(`${mod}+Shift+P`);
    const input = page.getByPlaceholder("Tapez une commande…");
    await input.fill(command);
    await page.getByRole("option", { name: command }).click();
    await page.getByRole("heading", { level: 2, name: heading, exact: true }).waitFor({ timeout: 15_000 });
  }
  await page.getByRole("heading", { level: 2, name: "Publication" }).waitFor();
  await shot("13-publication");
  await page.locator(".tab-inner", { hasText: "Architecture et usage" }).click();
  // Diagramme Mermaid (strict) rendu, ou erreur expliquée.
  await page.locator("figure.diagram svg").or(page.getByRole("alert")).first().waitFor({ timeout: 20_000 });
  await shot("14-architecture");
});

test("fermer puis rouvrir le projet depuis les récents : disposition restaurée", async () => {
  await page.getByRole("button", { name: "Menu du projet" }).click();
  await page.getByRole("menuitem", { name: "Fermer le projet" }).click();
  const recent = page.getByTestId("recent-projects");
  await recent.getByText("stock-app", { exact: true }).first().waitFor();
  await shot("12-accueil-recents");
  await recent.getByRole("button", { name: /stock-app/ }).click();
  await page.getByTestId("workbench").waitFor();
  // L'onglet index.ts (épinglé) est restauré avec son contenu enregistré.
  await page.locator(".tab-inner", { hasText: "index.ts" }).click();
  await page
    .locator('[data-testid=editor-panel][data-path="src/index.ts"] .monaco-editor')
    .waitFor({ timeout: 20_000 });
});

test("disposition sauvegardée par projet, aucun secret en stockage local", async () => {
  await page.waitForTimeout(600);
  const storage = await page.evaluate(() => {
    const out: Record<string, string> = {};
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i) as string;
      out[k] = localStorage.getItem(k) ?? "";
    }
    return out;
  });
  const keys = Object.keys(storage);
  assert.ok(
    keys.every((k) => k.startsWith("nexus.")),
    JSON.stringify(keys),
  );
  assert.ok(
    keys.some((k) => k.startsWith("nexus.layout.")),
    JSON.stringify(keys),
  );
  assert.ok(!JSON.stringify(storage).includes("not-a-real-token"));
  await shot("11-plan-de-travail");
});

test("aucune erreur JavaScript ni violation CSP pendant le parcours", () => {
  // Informations : erreurs console non bloquantes (ex. refus d'un canal), utiles au diagnostic.
  if (consoleErrors.length > 0) console.log("console.error :", consoleErrors.slice(0, 20));
  assert.deepEqual(consoleErrors, []);
  assert.deepEqual(pageErrors, []);
  assert.deepEqual(cspViolations, []);
});
