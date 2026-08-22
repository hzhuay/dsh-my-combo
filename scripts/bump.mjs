#!/usr/bin/env node
/**
 * 上游版本升级 + 监控脚本（方案 A 的更新机制核心）。
 *
 * 用法:
 *   node scripts/bump.mjs --check      # 只检查：有更新则打印并 exit 1（供 cron/CI 监控）
 *   node scripts/bump.mjs              # 应用升级，combo 版本 patch+1
 *   node scripts/bump.mjs --minor      # combo 版本 minor+1
 *   node scripts/bump.mjs --major      # combo 版本 major+1
 *
 * 追踪规则（按上游发布方式分三种）:
 *   - @linxin666/*        同仓库锁步发布 → npm view 取最新，精确锁版本
 *   - github:...#tag      打 semver tag → GitHub API 取最新 tag（如 dsh-cost-meter）
 *   - github:...#<sha40>  无 tag、只按 commit 发布 → GitHub API 取默认分支最新 commit（如 dsh-web-restart）
 *   - dshmarket            npm view 取最新，精确锁版本
 *
 * 之后: 本地 link 验证 → git tag v<新版本> → 发布。
 * 说明: 用 GitHub REST API 而不是 git ls-remote，规避本机 git 协议不稳（HTTP2 framing）的问题。
 */
import { execSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const args = process.argv.slice(2)
const checkOnly = args.includes('--check')
const dryRun = args.includes('--dry-run')
const bumpKind = args.includes('--major') ? 'major' : args.includes('--minor') ? 'minor' : 'patch'

function sh(cmd) {
  try {
    return execSync(cmd, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
  } catch (e) {
    throw new Error('command failed: ' + cmd + '\n' + (e.stderr || e.message))
  }
}

async function ghJson(url) {
  const res = await fetch(url, {
    headers: { 'user-agent': 'dsh-my-combo-bump', accept: 'application/vnd.github+json' }
  })
  if (!res.ok) throw new Error('GitHub API ' + res.status + ' for ' + url)
  return res.json()
}

function semverSortable(tag) {
  const m = String(tag).match(/^v?(\d+)(?:\.(\d+))?(?:\.(\d+))?/)
  return m ? [Number(m[1] || 0), Number(m[2] || 0), Number(m[3] || 0)] : null
}

// 取仓库最新 semver tag（如 v1.5.40）
async function latestGitTag(repo) {
  const tags = await ghJson('https://api.github.com/repos/' + repo + '/tags?per_page=50')
  if (!Array.isArray(tags)) return null
  const valid = tags.map(t => t.name).filter(t => semverSortable(t) !== null)
  if (valid.length === 0) return null
  valid.sort((a, b) => {
    const x = semverSortable(a), y = semverSortable(b)
    for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] - y[i]
    return a.localeCompare(b)
  })
  return valid[valid.length - 1]
}

// 取仓库默认分支最新 commit sha（无 tag 仓库的追踪方式）
async function latestCommitSha(repo) {
  const commits = await ghJson('https://api.github.com/repos/' + repo + '/commits?per_page=1')
  if (!Array.isArray(commits) || commits.length === 0) return null
  return commits[0].sha || null
}

const pkgPath = join(root, 'package.json')
const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'))
const deps = pkg.dependencies || {}
const changes = []

for (const [name, spec] of Object.entries(deps)) {
  if (name.startsWith('@linxin666/')) {
    const latest = sh('npm view ' + name + ' version')
    if (spec !== latest) { deps[name] = latest; changes.push(name + ': ' + spec + ' -> ' + latest) }
  } else if (spec.startsWith('github:')) {
    const repo = spec.replace(/^github:/, '').split('#')[0]
    const ref = spec.includes('#') ? spec.split('#')[1] : ''
    if (/^[0-9a-f]{40}$/.test(ref)) {
      // 按 commit 追踪（如 dsh-web-restart 无 tag）
      const head = await latestCommitSha(repo)
      if (head && head !== ref) {
        deps[name] = 'github:' + repo + '#' + head
        changes.push(name + ': pinned ' + ref.slice(0, 7) + ' -> ' + head.slice(0, 7) + ' (new commits; verify before merge)')
      } else if (!head) {
        console.warn('[skip] ' + name + ': cannot query GitHub API for ' + repo)
      }
    } else {
      // 按 semver tag 追踪（如 dsh-cost-meter）
      const tag = await latestGitTag(repo)
      if (tag && ref !== tag) {
        deps[name] = 'github:' + repo + '#' + tag
        changes.push(name + ': ' + (ref || '(unpinned)') + ' -> ' + tag)
      } else if (!tag) {
        console.warn('[skip] ' + name + ': no semver tags found for ' + repo)
      }
    }
  } else if (name === 'dshmarket') {
    const latest = sh('npm view dshmarket version')
    if (spec !== latest) { deps[name] = latest; changes.push(name + ': ' + spec + ' -> ' + latest) }
  }
}

if (changes.length === 0) {
  console.log('all upstream dependencies are up to date')
  process.exit(checkOnly ? 0 : 0)
}

console.log('pending upstream updates (' + changes.length + '):\n' + changes.join('\n'))

if (checkOnly || dryRun) {
  process.exit(checkOnly ? 1 : 0)
}

const [maj, min, pat] = pkg.version.split('.').map(Number)
pkg.version = bumpKind === 'major' ? (maj + 1) + '.0.0'
  : bumpKind === 'minor' ? maj + '.' + (min + 1) + '.0'
  : maj + '.' + min + '.' + (pat + 1)
writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n', 'utf8')
console.log('[bump] ' + pkg.name + ' -> v' + pkg.version)
console.log('下一步: 本地验证通过后 git tag v' + pkg.version + ' 发版。')
