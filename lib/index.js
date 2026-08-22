/**
 * dsh-my-combo — host half.
 *
 * 除上游插件行外，本包自身注册一个轻量路由 GET /combo-update-check：
 * 返回整合包"已装版本 vs GitHub 最新 tag"，供前端徽标/本地脚本轮询。
 * 仓库地址从 package.json 的 repository 读取；未配置或网络失败时返回
 * { ok:false }，前端不会弹任何提示（静默降级）。
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

export const inject = ['webServer']

const here = dirname(fileURLToPath(import.meta.url))
const selfPkg = JSON.parse(readFileSync(join(here, '..', 'package.json'), 'utf8'))

function semverParts(v) {
  const m = String(v).replace(/^v/, '').match(/^(\d+)(?:\.(\d+))?(?:\.(\d+))?/)
  return m ? [Number(m[1] || 0), Number(m[2] || 0), Number(m[3] || 0)] : null
}

function maxSemver(list) {
  let best = null
  for (const t of list) {
    const p = semverParts(t)
    if (!p) continue
    if (!best) { best = t; continue }
    const q = semverParts(best)
    for (let i = 0; i < 3; i++) {
      if (p[i] !== q[i]) { if (p[i] > q[i]) best = t; break }
    }
  }
  return best
}

function repoFromUrl(url) {
  if (!url) return null
  const m = String(url).match(/(?:github\.com\/)([^/]+\/[^/]+?)(?:\.git)?$/)
  return m ? m[1] : null
}

const CACHE_TTL = 60 * 60 * 1000 // 1 小时缓存，避免每次页面加载都打 GitHub API
let cache = { at: 0, data: null }

async function latestOf(repo) {
  const res = await fetch('https://api.github.com/repos/' + repo + '/tags?per_page=50', {
    headers: { 'user-agent': 'dsh-my-combo-update-check', accept: 'application/vnd.github+json' }
  })
  if (!res.ok) throw new Error('github ' + res.status)
  const tags = await res.json()
  return Array.isArray(tags) ? maxSemver(tags.map(t => t.name)) : null
}

export function apply(ctx) {
  const dispose = ctx.webServer.register({
    kind: 'exact',
    path: '/combo-update-check',
    handler: async (req, res) => {
      const current = selfPkg.version
      const repo = repoFromUrl(selfPkg.repository && selfPkg.repository.url)
      const send = (code, body) => {
        const text = JSON.stringify(body)
        res.writeHead(code, { 'content-type': 'application/json', 'cache-control': 'no-store' })
        res.end(text)
      }
      try {
        if (!repo || repo.includes('YOUR_GITHUB_USER')) {
          return send(200, { ok: false, reason: 'repository not configured', current })
        }
        const now = Date.now()
        if (!cache.data || now - cache.at > CACHE_TTL) {
          cache = { at: now, data: { latest: await latestOf(repo), repo } }
        }
        const latest = cache.data.latest
        const updateAvailable = latest !== null && semverParts(latest) !== null && semverParts(current) !== null
          && (semverParts(latest)[0] > semverParts(current)[0] || semverParts(latest)[1] > semverParts(current)[1] || semverParts(latest)[2] > semverParts(current)[2])
        return send(200, { ok: true, current, latest, updateAvailable, repo })
      } catch (e) {
        return send(200, { ok: false, reason: String((e && e.message) || e), current })
      }
    }
  })
  return () => dispose()
}
