// Each project (psri, vmm, ...) has its own SparkTG account. Adding a new
// project needs no code change — just add its name to TELEPHONY_PROJECTS
// and set SPARKTG_<PROJECT>_SVC_ID / _USERNAME / _PASSWORD in .env.
const projectNames = (process.env.TELEPHONY_PROJECTS || 'psri')
  .split(',')
  .map(s => s.trim().toLowerCase())
  .filter(Boolean)

const projects = {}
for (const name of projectNames) {
  const prefix = `SPARKTG_${name.toUpperCase()}_`
  projects[name] = {
    svcId: process.env[`${prefix}SVC_ID`] || '',
    username: process.env[`${prefix}USERNAME`] || '',
    password: process.env[`${prefix}PASSWORD`] || '',
  }
}

export function getProjectConfig(project) {
  const cfg = projects[project]
  if (!cfg) {
    throw new Error(`Unknown project "${project}" — not listed in TELEPHONY_PROJECTS`)
  }
  if (!cfg.svcId || !cfg.username || !cfg.password) {
    throw new Error(`SparkTG credentials not configured for project "${project}"`)
  }
  return cfg
}

export function listProjects() {
  return projectNames
}
