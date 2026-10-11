// Registre des signatures de CLI connues (cahier maître §9 « Découverte », UC-01).
// La présence d'une CLI ne dit rien de son authentification : `authenticated` reste inconnu tant qu'aucune
// méthode documentée et non intrusive n'existe (jamais de lecture des dossiers d'authentification).

export type CliSignature = {
  connectorId: string;
  displayName: string;
  binaryNames: readonly string[];
  versionArgs: readonly string[];
  /** Première capture = version. */
  versionPattern: RegExp;
  probeTimeoutMs: number;
  /** Outil d'agent (true) ou outil d'intégration (git, gh, vercel). */
  agent: boolean;
  /**
   * Commande officielle et documentée qui indique l'état de connexion SANS que Nexus lise les fichiers d'authentification
   * (ex. `claude auth status --json`). Seul le booléen est retenu ; aucune donnée personnelle n'est conservée.
   */
  authStatus?: { args: readonly string[]; parse: (stdout: string) => boolean | undefined };
  /**
   * CLI sans commande d'état : connexion déduite de la PRÉSENCE (jamais du contenu) d'un fichier de session dans le HOME
   * ou d'une variable de clé API dans l'environnement de l'utilisateur.
   */
  authPresence?: { files: readonly string[]; env: readonly string[] };
};

const semver = /(\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?)/;

export const CLI_SIGNATURES: readonly CliSignature[] = [
  {
    connectorId: "claude-cli",
    displayName: "Claude Code",
    binaryNames: ["claude"],
    versionArgs: ["--version"],
    versionPattern: semver,
    probeTimeoutMs: 8000,
    agent: true,
    authStatus: {
      args: ["auth", "status", "--json"],
      parse: (out) => {
        try {
          const v = (JSON.parse(out) as { loggedIn?: unknown }).loggedIn;
          return typeof v === "boolean" ? v : undefined;
        } catch {
          return undefined;
        }
      },
    },
  },
  {
    connectorId: "codex-cli",
    displayName: "Codex CLI",
    binaryNames: ["codex"],
    versionArgs: ["--version"],
    versionPattern: semver,
    probeTimeoutMs: 8000,
    agent: true,
    authStatus: {
      args: ["login", "status"],
      parse: (out) => (/not logged in/i.test(out) ? false : /logged in/i.test(out) ? true : undefined),
    },
  },
  {
    connectorId: "gemini-cli",
    displayName: "Gemini CLI",
    binaryNames: ["gemini"],
    versionArgs: ["--version"],
    versionPattern: semver,
    probeTimeoutMs: 8000,
    agent: true,
    authPresence: {
      files: [".gemini/oauth_creds.json"],
      env: ["GEMINI_API_KEY", "GOOGLE_API_KEY", "GOOGLE_GENAI_USE_VERTEXAI"],
    },
  },
  {
    connectorId: "hermes-cli",
    displayName: "Hermes",
    binaryNames: ["hermes"],
    versionArgs: ["--version"],
    versionPattern: semver,
    probeTimeoutMs: 8000,
    agent: true,
  },
  {
    connectorId: "opencode-cli",
    displayName: "OpenCode",
    binaryNames: ["opencode"],
    versionArgs: ["--version"],
    versionPattern: semver,
    probeTimeoutMs: 8000,
    agent: true,
  },
  {
    connectorId: "qwen-cli",
    displayName: "Qwen Code",
    binaryNames: ["qwen"],
    versionArgs: ["--version"],
    versionPattern: semver,
    probeTimeoutMs: 8000,
    agent: true,
    authPresence: { files: [".qwen/oauth_creds.json"], env: ["DASHSCOPE_API_KEY", "OPENAI_API_KEY"] },
  },
  {
    connectorId: "git",
    displayName: "Git",
    binaryNames: ["git"],
    versionArgs: ["--version"],
    versionPattern: semver,
    probeTimeoutMs: 5000,
    agent: false,
  },
  {
    connectorId: "gh",
    displayName: "GitHub CLI",
    binaryNames: ["gh"],
    versionArgs: ["--version"],
    versionPattern: semver,
    probeTimeoutMs: 5000,
    agent: false,
  },
  {
    connectorId: "vercel",
    displayName: "Vercel CLI",
    binaryNames: ["vercel"],
    versionArgs: ["--version"],
    versionPattern: semver,
    probeTimeoutMs: 8000,
    agent: false,
  },
];
