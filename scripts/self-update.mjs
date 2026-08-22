#!/usr/bin/env node
/**
 * self-update.mjs — 本地 dsh 整合包（dsh-my-combo）的更新检查 / 一键应用。
 *
 * 用法:
 *   node scripts/self-update.mjs --check            # 只检查：有新版则 exit 1（供 cron/通知）
 *   node scripts/self-update.mjs --check --json     # JSON 输出（给 GUI/通知脚本用）
 *   node scripts/self-update.mjs                    # 交互：展示变更 → 确认 → pnpm 更新
 *   node scripts/self-update.mjs --yes              # 跳过确认直接更新
 *   node scripts/self-update.mjs --profile-dir <目录> # 指定 dsh profile（默认 ~/.dsh/profiles/web）
 *
 * 判断"已装版本 vs 最新版本"按 profile 里 dsh-my-combo 的依赖 spec 分三种:
 *   - github:owner/repo#tag  → GitHub API 取最新 semver tag
 *   - npm 包名 / ^x.y.z       → npm view 取最新
 *   - workspace:* / file: / link: → 开发模式，无远程版本（提示后退出）
 * 应用更新:
 *   - github spec → pnpm add "github:owner/repo#<最新tag>"
 *   - npm spec    → pnpm update dsh-my-combo
 */
import { execSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { createInterface } from 'node:readline'

const args = process.argv.slice(2)
const checkOnly = args.includes('--check')
const json = args.includes('--json')
const yes = args.includes('--yes')
const profileDir = (() => {
  const i = args.indexOf('--profile-dir')
  return i >= 0 && args[i + 1] ? args[i + 1] : join(homedir(), '.dsh', 'profiles', 'web')
})()

const COMBO = 'dsh-my-combo'
const pkgPath = join(profileDir, 'package.json')
const nodeModulesCombo = join(profileDir, 'node_modules', COMBO, 'package.json')

function sh(cmd) {
  try {
    return execSync(cmd, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
  } catch (e) {
    throw new Error('command failed: ' + cmd + '\n' + (e.stderr || e.message))
  }
}

async function ghJson(url) {
  const res = await fetch(url, { headers: { 'user-agent': 'dsh-my-combo-self-update', accept: 'application/vnd.github+json' } })
  if (!res.ok) throw new Error('GitHub API ' + res.status + ' for ' + url)
  return res.json()
}

function semverParts(v) {
  const m = String(v).replace(/^v/, '').match(/^(\d+)(?:\.(\d+))?(?:\.(\d+))?/)
  return m ? [Number(m[1] || 0), Number(m[2] || 0), Number(m[3] || 0)] : null
}

function compare(a, b) {
  const x = semverParts(a), y = semverParts(b)
  if (!x || !y) return 0
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] < y[i] ? -1 : 1
  return 0
}

async function latestFromGithub(repo) {
  const tags = await ghJson('https://api.github.com/repos/' + repo + '/tags?per_page=50')
  if (!Array.isArray(tags)) return null
  const valid = tags.map(t => t.name).filter(t => semverParts(t) !== null)
  if (valid.length === 0) return null
  valid.sort((a, b) => compare(a, b))
  return valid[valid.length - 1]
}

function confirm(promptText) {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout })
    rl.question(promptText, (answer) => {
      rl.close()
      resolve(answer.trim().toLowerCase() === 'y')
    })
  })
}

async function main() {
  let result
  try {
    const profilePkg = JSON.parse(readFileSync(pkgPath, 'utf8'))
    const deps = profilePkg.dependencies || {}
    if (!deps[COMBO]) {
      result = { ok: false, reason: COMBO + ' 不在 ' + profileDir + ' 的依赖里（未使用整合包？）' }
    } else {
      const spec = deps[COMBO]
      const installed = (() => {
        try { return JSON.parse(readFileSync(nodeModulesCombo, 'utf8')).version } catch { return null }
      })()
      let latest = null
      let source
      let repo = null

      if (spec.startsWith('github:')) {
        repo = spec.replace(/^github:/, '').split('#')[0]
        latest = await latestFromGithub(repo)
        source = 'github'
      } else if (spec.startsWith('workspace:') || spec.startsWith('file:') || spec.startsWith('link:')) {
        source = 'dev:' + spec.split(':')[0]
      } else {
        latest = sh('npm view ' + COMBO + ' version')
        source = 'npm'
      }

      const updateAvailable = latest !== null && installed !== null && compare(latest, installed) > 0
      result = { ok: true, spec, source, repo, installed, latest, updateAvailable, profileDir }
    }
  } catch (e) {
    result = { ok: false, reason: String((e && e.message) || e) }
  }

  if (json) {
    console.log(JSON.stringify(result, null, 2))
    process.exit(result.ok && result.updateAvailable ? 1 : 0)
  }

  if (!result.ok) { console.error('✗ ' + result.reason); process.exit(2) }

  console.log('整合包: ' + COMBO)
  console.log('来源:   ' + result.source + (result.repo ? ' (' + result.repo + ')' : ''))
  console.log('已装:   ' + (result.installed ?? '未安装'))
  if (result.latest) console.log('最新:   ' + result.latest)

  if (!result.updateAvailable) {
    if (result.installed) console.log('✓ 已是最新版本')
    else console.log('（开发模式 workspace/file/link：无远程版本可比）')
    process.exit(0)
  }

  console.log('')
  console.log('↑ 有新版本: ' + result.installed + ' -> ' + result.latest)
  if (checkOnly) process.exit(1)

  if (!yes) {
    const ok = await confirm('确认更新? [y/N] ')
    if (!ok) { console.log('已取消'); process.exit(0) }
  }

  if (result.source === 'github' && result.repo) {
    sh('cd ' + profileDir + ' && pnpm add "github:' + result.repo + '#' + result.latest + '"')
  } else if (result.source === 'npm') {
    sh('cd ' + profileDir + ' && pnpm update ' + COMBO)
  } else {
    console.error('开发模式无法自动更新，请手动处理 workspace/file/link 依赖')
    process.exit(2)
  }

  console.log('✓ 已更新到 ' + result.latest)
  console.log('重启 dsh web 生效：dsh restart')
  process.exit(0)
}

await main()
