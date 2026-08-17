// The Knowledge base manifest — every article, its section, and its order.
// New articles: drop a .md file in src/content/docs/<section>/ and add one
// line here. The .md import returns the raw text (webpack asset/source).

import welcome from "./get-started/welcome.md";
import quickstart from "./get-started/quickstart.md";
import signInAndRoles from "./get-started/sign-in-and-roles.md";
import portalTour from "./get-started/portal-tour.md";

import tasks from "./engine/tasks.md";
import modelsAndRouter from "./engine/models-and-router.md";
import approvalGate from "./engine/approval-gate.md";
import scheduler from "./engine/scheduler.md";
import supervisorAndDeadLetters from "./engine/supervisor-and-dead-letters.md";
import crewsAndDelegation from "./engine/crews-and-delegation.md";
import compare from "./engine/compare.md";

import workflows from "./automate/workflows.md";
import skills from "./automate/skills.md";
import reports from "./automate/reports.md";

import marketplace from "./plugins/marketplace.md";
import pluginSdk from "./plugins/plugin-sdk.md";

import aiOverview from "./ai-controller/overview.md";
import aiActions from "./ai-controller/actions.md";
import aiWatch from "./ai-controller/autonomous-watch.md";

import agentMesh from "./mesh/agent-mesh.md";
import federationTools from "./mesh/federation-tools.md";

import teams from "./collaborate/teams.md";
import notifications from "./collaborate/notifications.md";
import brain from "./collaborate/brain.md";

import auditAndCompliance from "./govern/audit-and-compliance.md";
import mcp from "./govern/mcp.md";
import alerts from "./govern/alerts.md";

import administration from "./administer/administration.md";
import cli from "./administer/cli.md";
import configurationReference from "./administer/configuration-reference.md";
import deployment from "./administer/deployment.md";
import troubleshooting from "./administer/troubleshooting.md";

export interface DocSection {
  id: string;
  label: string;
  order: number;
}

export interface DocArticle {
  slug: string;
  section: string;
  title: string;
  description: string;
  order: number;
  body: string;
}

export const DOC_SECTIONS: DocSection[] = [
  { id: "get-started", label: "Get started", order: 0 },
  { id: "engine", label: "Agent engine", order: 1 },
  { id: "automate", label: "Automate", order: 2 },
  { id: "plugins", label: "Plugins", order: 3 },
  { id: "ai-controller", label: "AI Controller", order: 4 },
  { id: "mesh", label: "Mesh & federation", order: 5 },
  { id: "collaborate", label: "Collaborate", order: 6 },
  { id: "govern", label: "Govern", order: 7 },
  { id: "administer", label: "Administer", order: 8 },
];

/** Pull the `# Title` and the `> description` from the raw markdown. */
function head(md: string): { title: string; description: string } {
  const title = md.match(/^#\s+(.+)$/m)?.[1]?.trim() ?? "Untitled";
  const description = md.match(/^>\s+(.+)$/m)?.[1]?.trim() ?? "";
  return { title, description };
}

function article(slug: string, section: string, order: number, body: string): DocArticle {
  return { slug, section, title: head(body).title, description: head(body).description, order, body };
}

export const DOC_ARTICLES: DocArticle[] = [
  // Get started
  article("welcome", "get-started", 0, welcome),
  article("quickstart", "get-started", 1, quickstart),
  article("sign-in-and-roles", "get-started", 2, signInAndRoles),
  article("portal-tour", "get-started", 3, portalTour),
  // Agent engine
  article("tasks", "engine", 0, tasks),
  article("models-and-router", "engine", 1, modelsAndRouter),
  article("approval-gate", "engine", 2, approvalGate),
  article("scheduler", "engine", 3, scheduler),
  article("supervisor-and-dead-letters", "engine", 4, supervisorAndDeadLetters),
  article("crews-and-delegation", "engine", 5, crewsAndDelegation),
  article("compare", "engine", 6, compare),
  // Automate
  article("workflows", "automate", 0, workflows),
  article("skills", "automate", 1, skills),
  article("reports", "automate", 2, reports),
  // Plugins
  article("marketplace", "plugins", 0, marketplace),
  article("plugin-sdk", "plugins", 1, pluginSdk),
  // AI Controller
  article("overview", "ai-controller", 0, aiOverview),
  article("actions", "ai-controller", 1, aiActions),
  article("autonomous-watch", "ai-controller", 2, aiWatch),
  // Mesh & federation
  article("agent-mesh", "mesh", 0, agentMesh),
  article("federation-tools", "mesh", 1, federationTools),
  // Collaborate
  article("teams", "collaborate", 0, teams),
  article("notifications", "collaborate", 1, notifications),
  article("brain", "collaborate", 2, brain),
  // Govern
  article("audit-and-compliance", "govern", 0, auditAndCompliance),
  article("mcp", "govern", 1, mcp),
  article("alerts", "govern", 2, alerts),
  // Administer
  article("administration", "administer", 0, administration),
  article("cli", "administer", 1, cli),
  article("configuration-reference", "administer", 2, configurationReference),
  article("deployment", "administer", 3, deployment),
  article("troubleshooting", "administer", 4, troubleshooting),
];

export function sectionById(id: string): DocSection | undefined {
  return DOC_SECTIONS.find((s) => s.id === id);
}

export function articlesInSection(sectionId: string): DocArticle[] {
  return DOC_ARTICLES.filter((a) => a.section === sectionId).sort((a, b) => a.order - b.order);
}

export function articleBySlug(slug: string): DocArticle | undefined {
  return DOC_ARTICLES.find((a) => a.slug === slug);
}

export function sortedSections(): DocSection[] {
  return [...DOC_SECTIONS].sort((a, b) => a.order - b.order);
}

/** Total article count, shown on the KB home. */
export const DOC_ARTICLE_COUNT = DOC_ARTICLES.length;
