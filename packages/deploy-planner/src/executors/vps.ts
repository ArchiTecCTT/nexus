// Déploiement d'un back-end sur un VPS (Hostinger ou autre) par SSH + Docker.
// Le script et le contenu du fichier .env passent sur l'entrée standard de ssh (jamais dans la ligne de commande),
// la clé privée reste un fichier de l'utilisateur (jamais copiée), les sorties sont expurgées des valeurs secrètes.
import { existsSync } from "node:fs";
import { runProcess, type RunOptions, type RunResult } from "@nexus/process-supervisor";
import { DeployError, type ExecContext, type StepOutcome } from "./common.ts";

export type VpsTarget = {
  host: string;
  user: string;
  port: number;
  keyPath: string;
  appName: string;
  /** URL de clonage du dépôt (https publique ou ssh si le VPS a une clé de déploiement). */
  repoUrl: string;
  branch: string;
  rootDir: string;
  port_app: number;
  env: Record<string, string>;
  hasDockerfile: boolean;
  language: string;
  startCommand?: string;
};

const HOST = /^[a-zA-Z0-9.-]{1,253}$/;
const USER = /^[a-z_][a-z0-9_-]{0,31}$/;
const NAME = /^[a-z0-9][a-z0-9-]{0,49}$/;
const BRANCH = /^[A-Za-z0-9._/-]{1,200}$/;
const ENV_KEY = /^[A-Za-z_][A-Za-z0-9_]*$/;

const shq = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;

/** Dockerfile Node minimal, utilisé seulement si le projet n'en a pas (écrit sur le serveur, pas dans le projet). */
export function nodeDockerfile(port: number, start = "npm start"): string {
  return [
    "FROM node:22-alpine",
    "WORKDIR /app",
    "COPY package*.json ./",
    "RUN npm ci --omit=dev || npm install --omit=dev",
    "COPY . .",
    "RUN npm run build --if-present",
    `ENV PORT=${port}`,
    `EXPOSE ${port}`,
    `CMD ${JSON.stringify(start.split(" "))}`,
    "",
  ].join("\n");
}

/** Script exécuté sur le VPS (bash -s). Aucune valeur secrète dans le script lui-même : le .env arrive à part. */
export function vpsScript(t: VpsTarget, envFile: string): string {
  const dir = `$HOME/nexus-apps/${t.appName}`;
  const work = t.rootDir === "." ? dir : `${dir}/${t.rootDir}`;
  const dockerfile = t.hasDockerfile
    ? ""
    : `cat > Dockerfile <<'NEXUS_DOCKERFILE'\n${nodeDockerfile(t.port_app, t.startCommand)}NEXUS_DOCKERFILE`;
  return `set -eu
command -v docker >/dev/null 2>&1 || { echo "NEXUS_ERROR docker absent du serveur : installez Docker (modèle Hostinger « Ubuntu + Docker »)"; exit 20; }
command -v git >/dev/null 2>&1 || { echo "NEXUS_ERROR git absent du serveur"; exit 21; }
mkdir -p "$HOME/nexus-apps"
if [ -d ${dir}/.git ]; then
  echo "Mise à jour du dépôt"; git -C ${dir} fetch --depth 1 origin ${shq(t.branch)} && git -C ${dir} checkout -q FETCH_HEAD
else
  echo "Clonage du dépôt"; git clone -q --depth 1 --branch ${shq(t.branch)} ${shq(t.repoUrl)} ${dir}
fi
cd ${work}
umask 077
cat > .env <<'NEXUS_ENV'
${envFile}NEXUS_ENV
${dockerfile}
echo "Construction de l'image"
docker build -q -t nexus-${t.appName} . >/dev/null
docker rm -f nexus-${t.appName} >/dev/null 2>&1 || true
docker run -d --name nexus-${t.appName} --restart unless-stopped --env-file .env -p 80:${t.port_app} nexus-${t.appName} >/dev/null
sleep 3
docker ps --filter name=nexus-${t.appName} --format '{{.Status}}' | grep -q Up || { echo "NEXUS_ERROR le conteneur ne démarre pas :"; docker logs --tail 30 nexus-${t.appName}; exit 22; }
echo "NEXUS_OK"
`;
}

export async function deployVps(
  ctx: ExecContext,
  t: VpsTarget,
  opts: { sshPath?: string; runner?: (o: RunOptions) => Promise<RunResult> } = {},
): Promise<StepOutcome> {
  if (!HOST.test(t.host)) throw new DeployError("missing_input", "Adresse du VPS invalide");
  if (!USER.test(t.user)) throw new DeployError("missing_input", "Utilisateur SSH invalide");
  if (!NAME.test(t.appName)) throw new DeployError("missing_input", "Nom d'application invalide");
  if (!BRANCH.test(t.branch)) throw new DeployError("missing_input", "Branche invalide");
  if (!existsSync(t.keyPath)) throw new DeployError("missing_input", "Clé SSH introuvable");
  if (!t.hasDockerfile && t.language !== "javascript") {
    throw new DeployError(
      "unsupported",
      "Pas de Dockerfile : ajoutez-en un (Nexus ne sait générer que celui d'une application Node)",
    );
  }
  for (const [k, v] of Object.entries(t.env)) {
    if (!ENV_KEY.test(k) || /[\r\n]/.test(v))
      throw new DeployError("missing_input", `Variable ${k} invalide (pas de saut de ligne dans une valeur)`);
  }
  const envFile = Object.entries(t.env)
    .map(([k, v]) => `${k}=${v}\n`)
    .join("");
  const ssh = opts.sshPath ?? "/usr/bin/ssh";
  const lines: string[] = [];
  const r = await (opts.runner ?? runProcess)({
    file: ssh,
    args: [
      "-i",
      t.keyPath,
      "-p",
      String(t.port),
      "-o",
      "BatchMode=yes",
      "-o",
      "StrictHostKeyChecking=accept-new",
      "-o",
      "ConnectTimeout=15",
      `${t.user}@${t.host}`,
      "bash -s",
    ],
    cwd: "/",
    env: { PATH: "/usr/bin:/bin", HOME: process.env.HOME ?? "/" },
    stdin: vpsScript(t, envFile),
    timeoutMs: 20 * 60_000,
    redact: Object.values(t.env).filter((v) => v.length >= 6),
    onLine: (l) => {
      lines.push(l);
      ctx.log(`VPS : ${l}`);
    },
    ...(ctx.signal && { signal: ctx.signal }),
  });
  if (r.exitCode === 0 && lines.some((l) => l.includes("NEXUS_OK"))) {
    return { message: `Back-end en ligne sur ${t.host}`, url: `http://${t.host}` };
  }
  if (r.exitCode === 255) throw new DeployError("auth", "Connexion SSH refusée (hôte, utilisateur ou clé incorrects)");
  const err = lines.find((l) => l.startsWith("NEXUS_ERROR"))?.replace("NEXUS_ERROR ", "");
  throw new DeployError("provider", err ?? `Échec sur le VPS (code ${r.exitCode ?? r.spawnError ?? "inconnu"})`);
}
