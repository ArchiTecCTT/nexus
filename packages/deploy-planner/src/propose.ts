// Propositions de déploiement déterministes (catalogue Nexus) : point de départ que l'IA qui pilote ajuste ensuite.
// Les coûts sont des ordres de grandeur publics, affichés avec un avertissement : jamais présentés comme un devis.
import type {
  DeployProvider,
  DeploymentProposal,
  ProjectProfile,
  ProposalRequirement,
  ProposalStep,
} from "@nexus/contracts";

type Comp = ProjectProfile["components"][number];

/** Fournisseurs que Nexus sait déployer lui-même ; les autres sont proposés avec un guide pas à pas. */
export const AUTOMATED: ReadonlySet<DeployProvider> = new Set([
  "vercel",
  "render",
  "railway",
  "hostinger-vps",
  "mongodb-atlas",
]);

export const PROVIDER_LABEL: Record<DeployProvider, string> = {
  vercel: "Vercel",
  netlify: "Netlify",
  render: "Render",
  railway: "Railway",
  "hostinger-vps": "VPS Hostinger",
  fly: "Fly.io",
  "mongodb-atlas": "MongoDB Atlas",
  supabase: "Supabase",
  neon: "Neon",
};

const REQ: Record<string, ProposalRequirement> = {
  vercel: {
    id: "vercel-token",
    label: "Jeton Vercel",
    kind: "secret",
    provider: "vercel",
    secretName: "VERCEL_TOKEN",
    help: "vercel.com → Account Settings → Tokens",
  },
  render: {
    id: "render-key",
    label: "Clé API Render",
    kind: "secret",
    provider: "render",
    secretName: "RENDER_API_KEY",
    help: "dashboard.render.com → Account Settings → API Keys",
  },
  railway: {
    id: "railway-token",
    label: "Jeton Railway",
    kind: "secret",
    provider: "railway",
    secretName: "RAILWAY_TOKEN",
    help: "railway.com → Account Settings → Tokens",
  },
  atlas: {
    id: "atlas-sa",
    label: "Compte de service MongoDB Atlas (client ID et secret) et identifiant du projet Atlas",
    kind: "secret",
    provider: "mongodb-atlas",
    secretName: "ATLAS_CLIENT_SECRET",
    help: "cloud.mongodb.com → Organization → Access Manager → Service Accounts (rôle Project Owner)",
  },
  vps: {
    id: "vps-ssh",
    label: "Accès SSH au VPS (hôte, utilisateur, clé privée)",
    kind: "ssh",
    provider: "hostinger-vps",
    help: "hPanel Hostinger → VPS → Accès SSH. Docker doit être installé (modèle « Ubuntu + Docker »).",
  },
  repo: {
    id: "git-remote",
    label: "Dépôt Git distant (GitHub) à jour",
    kind: "repository",
    help: "Render et Railway déploient depuis le dépôt : poussez d'abord votre code.",
  },
};

function dbStep(kind: string, provider: DeployProvider): ProposalStep {
  return provider === "mongodb-atlas"
    ? {
        id: "db-atlas",
        title: "Créer la base MongoDB Atlas (cluster gratuit M0), l'utilisateur et récupérer l'URI",
        provider,
        kind: "auto",
        detail:
          "Cluster M0, utilisateur dédié au mot de passe généré, accès réseau ouvert aux hébergeurs ; l'URI est rangée dans le coffre sous MONGODB_URI.",
      }
    : {
        id: `db-${provider}`,
        title: `Créer la base ${kind} sur ${PROVIDER_LABEL[provider]}`,
        provider,
        kind: provider === "railway" || provider === "render" ? "auto" : "manual",
        detail: `Base ${kind} gérée ; l'URL de connexion est rangée dans le coffre sous DATABASE_URL.`,
      };
}

function backStep(c: Comp, provider: DeployProvider): ProposalStep {
  const detail: Record<string, string> = {
    render: `Service web Render créé depuis le dépôt (dossier ${c.path}), variables d'environnement injectées, déploiement automatique à chaque push.`,
    railway: `Service Railway créé depuis le dépôt (dossier ${c.path}), variables injectées, domaine public généré.`,
    "hostinger-vps": `Connexion SSH, récupération du dépôt, fichier .env écrit sur le serveur, ${c.hasDockerfile ? "image Docker existante" : "Dockerfile généré"} puis \`docker compose up -d --build\` derrière un reverse proxy.`,
    fly: "fly launch dans le dossier du back-end puis fly deploy.",
  };
  return {
    id: `back-${c.id}`,
    title: `Déployer le back-end « ${c.name} » sur ${PROVIDER_LABEL[provider]}`,
    provider,
    kind: AUTOMATED.has(provider) ? "auto" : "manual",
    componentId: c.id,
    detail: detail[provider] ?? "",
  };
}

function frontStep(c: Comp, provider: DeployProvider): ProposalStep {
  return {
    id: `front-${c.id}`,
    title: `Déployer le front-end « ${c.name} » sur ${PROVIDER_LABEL[provider]}`,
    provider,
    kind: AUTOMATED.has(provider) ? "auto" : "manual",
    componentId: c.id,
    detail:
      provider === "vercel"
        ? `Déploiement Vercel du dossier ${c.path} (preview puis production confirmée) ; l'URL publique du back-end est injectée dans la variable du front (ex. VITE_API_URL / NEXT_PUBLIC_API_URL).`
        : `Déploiement sur ${PROVIDER_LABEL[provider]} du dossier ${c.path}.`,
  };
}

export function proposeDeployments(profile: ProjectProfile): DeploymentProposal[] {
  const fronts = profile.components.filter((c) => c.role === "frontend");
  const backs = profile.components.filter((c) => c.role === "backend" || c.role === "worker");
  const dbKind =
    profile.databases.find((d) => d.kind !== "sqlite")?.kind ??
    (profile.databases.some((d) => d.kind === "sqlite") ? "postgres" : undefined);
  if (fronts.length === 0 && backs.length === 0) return [];
  const proposals: DeploymentProposal[] = [];
  const mongo = dbKind === "mongodb";

  const build = (o: {
    id: string;
    title: string;
    summary: string;
    front: DeployProvider;
    back: DeployProvider;
    db: DeployProvider;
    cost: [number, number];
    complexity: DeploymentProposal["complexity"];
    pros: string[];
    cons: string[];
  }): DeploymentProposal => {
    const placements: DeploymentProposal["placements"] = [
      ...fronts.map((c) => ({
        componentId: c.id,
        role: c.role,
        provider: o.front,
        why: `${PROVIDER_LABEL[o.front]} est optimisé pour ${c.framework ?? "les front-ends"} (CDN, previews).`,
      })),
      ...backs.map((c) => ({
        componentId: c.id,
        role: c.role,
        provider: o.back,
        why: `${PROVIDER_LABEL[o.back]} exécute un serveur ${c.framework ?? c.language} en continu.`,
      })),
      ...(dbKind
        ? [
            {
              componentId: "database",
              role: "database" as const,
              provider: o.db,
              why: `Base ${dbKind} gérée (sauvegardes, haute disponibilité).`,
            },
          ]
        : []),
    ];
    const steps: ProposalStep[] = [
      ...(dbKind ? [dbStep(dbKind, o.db)] : []),
      ...backs.map((c) => backStep(c, o.back)),
      ...fronts.map((c) => frontStep(c, o.front)),
    ];
    const providers = new Set(placements.map((p) => p.provider));
    const requirements: ProposalRequirement[] = [
      ...(providers.has("render") || providers.has("railway") ? [REQ.repo!] : []),
      ...(providers.has("mongodb-atlas") ? [REQ.atlas!] : []),
      ...(providers.has("render") ? [REQ.render!] : []),
      ...(providers.has("railway") ? [REQ.railway!] : []),
      ...(providers.has("hostinger-vps") ? [REQ.vps!] : []),
      ...(providers.has("vercel") ? [REQ.vercel!] : []),
    ];
    return {
      id: o.id,
      title: o.title,
      summary: o.summary,
      placements,
      monthlyCost: {
        min: o.cost[0],
        max: o.cost[1],
        currency: "USD",
        caveat: "Ordre de grandeur des offres publiques ; dépend du trafic et des options choisies.",
      },
      complexity: o.complexity,
      pros: o.pros,
      cons: o.cons,
      requirements,
      steps,
      origin: "rules",
    };
  };

  // A — Services gérés, le plus simple.
  proposals.push(
    build({
      id: "managed",
      title: backs.length
        ? "Tout géré : Vercel + Render" + (dbKind ? (mongo ? " + MongoDB Atlas" : " + base Render") : "")
        : "Front sur Vercel",
      summary:
        "Aucun serveur à administrer : chaque partie est hébergée par un service spécialisé, déployé automatiquement à chaque push.",
      front: "vercel",
      back: "render",
      db: mongo ? "mongodb-atlas" : "render",
      cost: backs.length ? [0, 25] : [0, 20],
      complexity: "low",
      pros: ["Démarrage gratuit possible", "Aucune administration système", "Previews par branche (Vercel)"],
      cons: backs.length
        ? ["Offre gratuite Render : mise en veille après inactivité (premier appel lent)", "Trois comptes à gérer"]
        : ["Pas de back-end hébergé"],
    }),
  );

  if (backs.length) {
    // B — VPS Hostinger : coût fixe, contrôle total.
    proposals.push(
      build({
        id: "vps",
        title: `Front Vercel + back-end sur VPS Hostinger${dbKind ? (mongo ? " + MongoDB Atlas" : ` + ${dbKind} sur le VPS`) : ""}`,
        summary:
          "Le back-end tourne en conteneur Docker sur votre VPS (prix fixe, pas de mise en veille) ; le front reste sur le CDN de Vercel.",
        front: "vercel",
        back: "hostinger-vps",
        db: mongo ? "mongodb-atlas" : "hostinger-vps",
        cost: [5, 15],
        complexity: "medium",
        pros: ["Prix fixe et prévisible", "Pas de mise en veille", "Contrôle total du serveur"],
        cons: ["Mises à jour et sécurité du serveur à votre charge", "Accès SSH requis"],
      }),
    );
    // C — Railway tout-en-un.
    proposals.push(
      build({
        id: "railway",
        title: "Tout sur Railway" + (dbKind ? ` (front, back et ${dbKind})` : ""),
        summary: "Une seule plateforme pour tout le projet, base comprise : un seul compte, un seul tableau de bord.",
        front: fronts.some((c) => c.framework === "Next.js") ? "vercel" : "railway",
        back: "railway",
        db: mongo ? "mongodb-atlas" : "railway",
        cost: [5, 20],
        complexity: "low",
        pros: ["Un seul compte", "Base de données en un clic", "Pas de mise en veille"],
        cons: [
          "Facturation à l'usage (pas de palier gratuit permanent)",
          "Moins adapté aux front-ends statiques qu'un CDN",
        ],
      }),
    );
  }
  return proposals;
}
