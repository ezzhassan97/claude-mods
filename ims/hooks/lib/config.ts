import type { PluginOptions } from 'claude-code'

// The IMS pack's options (userConfig). The defaults are ims-nawy's own rules
// from its CLAUDE.md, so the pack works with no setup.

export const config = {
  reviewer: 'mazenfayez',
  ghUser: 'ezzhassan-nawy',
  frontendRepo: 'NawyRE/nawy-inventory-frontend',
  backendRepo: 'NawyRE/nawy-inventory-backend',
  prBase: 'staging',
  mysqlTunnel: 3308,
  mongoTunnel: 27317,
  jiraSite: 'nawy.atlassian.net',
  jiraProject: 'IMS',
}

const str = (v: unknown, d: string): string => (typeof v === 'string' && v.trim() ? v.trim() : d)
const num = (v: unknown, d: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : d)

export function configure(o: PluginOptions): void {
  config.reviewer = str(o.reviewer, 'mazenfayez')
  config.ghUser = str(o.gh_user, 'ezzhassan-nawy')
  config.frontendRepo = str(o.frontend_repo, 'NawyRE/nawy-inventory-frontend')
  config.backendRepo = str(o.backend_repo, 'NawyRE/nawy-inventory-backend')
  config.prBase = str(o.pr_base, 'staging')
  config.mysqlTunnel = num(o.mysql_tunnel_port, 3308)
  config.mongoTunnel = num(o.mongo_tunnel_port, 27317)
  config.jiraSite = str(o.jira_site, 'nawy.atlassian.net')
  config.jiraProject = str(o.jira_project, 'IMS')
}
