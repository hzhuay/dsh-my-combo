# dsh-my-combo

DSH Web 插件整合包：**引用挑选的开源插件 + 自己的兼容层**（方案 A）。用户只需安装本包一个，即可获得整套选中的插件与统一的布局修复。

## 包含的插件（10 个上游 + 1 个自身兼容层）

| 行 id | 上游包 | 说明 |
|---|---|---|
| `combo-compat` | 自身 `dsh-my-combo` | 兼容层：列容器 shim + footer 布局 shim + CSS |
| `combo-cost-meter` | `dsh-cost-meter`（git #v1.5.40） | 余额/费用统计，默认显示在首页侧边栏 |
| `combo-aionui-panel` | `@linxin666/dsh-client-ui-aionui-panel` | 右侧文件树/预览面板 |
| `combo-task-board` | `@linxin666/dsh-client-ui-task-board` | 任务看板 |
| `combo-git-graph` | `@linxin666/dsh-client-ui-git-graph` | Git 分支图 |
| `combo-remote-web-ui` | `@linxin666/dsh-remote-web-ui` | 手机远程控制 |
| `combo-ssh` | `@linxin666/dsh-ssh` | SSH 远程运维 |
| `combo-liangshen` | `@linxin666/dsh-liangshen` | 梁神模式 preset |
| `combo-web-ui-settings` | `@linxin666/dsh-client-ui-web-ui-settings` | 设置页插件组容器 |
| `combo-community-plugins` | `@linxin666/dsh-client-ui-community-plugins` | 社区插件索引 |

## 目录结构

```
dsh-my-combo/
├── package.json          # 上游依赖 + dsh.bundle.patch / client 元数据
├── aggregate.json        # 插件清单 manifest（增删插件、改默认配置都改这里）
├── scripts/
│   ├── aggregate.mjs     # manifest → 生成 cordis.patch.yml
│   ├── bump.mjs          # 上游版本升级/监控脚本（--check）
│   └── self-update.mjs   # 本地 dsh 的整合包更新检查/一键应用
├── cordis.patch.yml      # 生成物（勿手改）
├── renovate.json          # 上游更新监控（Renovate，可选）
├── .github/workflows/     # 自动检查开 PR + 轻量冒烟（可选）
├── lib/
│   ├── index.js          # host 空壳
│   └── client.js         # 兼容层（列 shim + footer shim + CSS）
└── README.md
```

## 安装（开发期本地 link）

> pnpm 的 `link:`/`file:` 不会安装链接包的传递依赖，所以本地开发把 combo 注册为 **workspace 成员**：

1. `~/.dsh/profiles/web/pnpm-workspace.yaml` 的 `packages` 加入：

   ```yaml
   packages:
     - .
     - /home/zhq/workspace/dsh-my-combo
   ```

2. `~/.dsh/profiles/web/package.json` 的依赖改为：

   ```json
   "dsh-my-combo": "workspace:*"
   ```

3. 安装：

   ```bash
   cd ~/.dsh/profiles/web && pnpm install
   ```

> 发布后用户侧走正常安装（github/npm 引用），combo 的传递依赖会正常解析，无需 workspace。
> 本机 pnpm 11 供应链策略需要在 `pnpm-workspace.yaml` 里放行：`@linxin666/*` 加入 `minimumReleaseAgeExclude`（需引号），并设置 `blockExoticSubdeps: false`（combo 内含 git 依赖）。

安装前从 `~/.dsh/profiles/web/package.json` 的 `dependencies` 与 `dsh.profile.bundles` 中**移除**此前独立安装的 `dsh-cost-meter`、`@linxin666/dsh-web-ui-all`，避免同一插件双份加载。

> `dshmarket`（插件市场）已从 combo 拆出，**作为独立插件单独安装**：
>
> ```bash
> dsh plugin --profile web add dshmarket
> ```
>
> 并在 `dsh.profile.bundles` 中加入 `"dshmarket"`。最后重启 `dsh web`。

## 上游更新监控（整合包如何感知插件更新）

三种方式，从"零成本"到"全自动"，可叠加：

1. **本地一键检查（推荐先配）** — `scripts/bump.mjs --check` 只查不写，有更新时 exit 1：

   ```bash
   cd /home/zhq/workspace/dsh-my-combo
   node scripts/bump.mjs --check   # 无更新 exit 0；有更新打印清单并 exit 1
   ```

   配合 cron 被动提醒：

   ```bash
   # crontab -e：每天 9 点检查，有更新就弹通知
   0 9 * * * cd /home/zhq/workspace/dsh-my-combo && node scripts/bump.mjs --check >/tmp/dsh-combo-check.log 2>&1 || notify-send "dsh-my-combo" "上游插件有更新：$(cat /tmp/dsh-combo-check.log)"
   ```

2. **Renovate（推荐，仓库放到 GitHub 时）** — 提交 `renovate.json` 并启用 Renovate：
   - `@linxin666/*` 家族合并成一个 PR（groupName）；
   - git tag 依赖（dsh-cost-meter）走 git-tags 数据源；
   - 全部精确锁版本（rangeStrategy: pin）；PR 不自动合并，需人工验证。

3. **GitHub Actions 定时检查（不用 Renovate 的替代）** — `.github/workflows/auto-bump.yml`：
   - 每天 02:00 UTC 跑 `node scripts/bump.mjs --check`；
   - 有更新就执行 `bump.mjs`（升级依赖 + bump combo 版本）并自动开 PR；
   - 合并前由 `.github/workflows/verify.yml` 做轻量冒烟（aggregate 一致性、语法、挂载行齐全）。

> **为什么不自动合并？** 上游发版可能改 DOM/class/API，直接影响本包 `lib/client.js` 的 CSS 与 shim。
> 正确节奏：监控自动发现 → PR 自动开出 → 验证（本地或浏览器级 E2E）→ 合并并发版 → 用户只更新一个包。

## 更新机制（手动 / PR 合并后）

```bash
cd /home/zhq/workspace/dsh-my-combo
node scripts/bump.mjs --check   # 确认有哪些更新
node scripts/bump.mjs           # 应用升级并 bump combo 版本
node scripts/aggregate.mjs      # 如 manifest 有变化则重新生成 patch
# 本地验证通过后:
git add -A && git commit -m "chore: bump upstream deps"
git tag v<新版本> && git push --tags
```

用户侧只更新一个包：

```bash
dsh plugin --profile web update dsh-my-combo
```


## 本地自动更新（本机 dsh）

| 命令 | 作用 |
|---|---|
| `dsh-update --check` | 检查已装 vs 最新；有新版 exit 1（配 cron 通知） |
| `dsh-update --check --json` | JSON 输出（供通知脚本/GUI 用） |
| `dsh-update` | 交互确认后执行 pnpm 更新 |
| `dsh-update --yes` | 跳过确认直接更新 |

cron 每 6 小时检查一次并弹通知：

```bash
# crontab -e
0 */6 * * * /usr/bin/node /home/zhq/workspace/dsh-my-combo/scripts/self-update.mjs --check --json >/tmp/dsh-combo-update.json 2>&1 || notify-send "dsh-my-combo" "整合包有新版本，运行 dsh-update 查看"
```

> 发布版（npm/github）的 `scripts/` 需放进包 `files` 才能随包分发；
> 开发期直接指 `~/workspace/dsh-my-combo/scripts/self-update.mjs`。
> 应用更新后执行 `dsh restart` 生效。

## GUI 内更新提示（host 路由 + 前端徽标）

- host 半注册 `GET /combo-update-check`：返回 `{ current, latest, updateAvailable }`（GitHub tag 对比，1 小时缓存）；
- client 半每次打开页面拉取一次，有新版在顶部弹一个小徽标（15 秒自动消失，可点击关闭，关闭后本会话不再提示）；
- 仓库地址从 `package.json` 的 `repository.url` 读取；未配置（占位符）或网络失败时静默降级，不打扰。

## 发布流程（GitHub tag）

```bash
cd /home/zhq/workspace/dsh-my-combo
# 确认 package.json repository.url 指向你的仓库后:
git add -A && git commit -m "chore: v0.1.1"
git tag v0.1.1 && git push --tags
# .github/workflows/release.yml 会自动生成 GitHub Release
```
## 行顺序约束（重要，勿改）

设置页的 Web UI 插件卡片（远程控制/右侧面板/任务看板/社区插件）通过
`ctx.get("webUiSettings") ?? ctx.settingsScope` 取设置 scope，而
`webUiSettings` 服务由 **dsh-client-ui-web-ui-settings 的 apply** 注册。
四个消费插件没有在 `exports.inject` 里声明 `webUiSettings`（上游代码如此），
所以**必须保证 web-ui-settings 的 entry 排在四个消费插件之前**：它的 apply
先注册服务，消费插件 apply 时才能拿到；排后面就会 fallback 官方白名单 → notExposed。

上游 zhu1090093659/dsh-web-ui 的 dsh-web-ui-all 正是这样做的（web-ui-settings 排第 2 位）。
本包的 `aggregate.json` / `cordis.patch.yml` 也遵守此顺序：
`combo-web-ui-settings` 紧跟 `combo-compat`，位于 aionui-panel / task-board /
remote-web-ui / community-plugins 之前。**调整行顺序或增删插件时不要把它移到消费插件后面。**

## 兼容矩阵

| combo 版本 | dsh-cost-meter | @linxin666/* | dshmarket |
|---|---|---|---|
| 0.1.0 | v1.5.3 | 0.1.20 | 1.11.0 |
| 0.1.1 | v1.5.40 | 0.2.9 | 1.18.1 |

> 每次升级后更新此表，并记录验证结论（见 git log）。
>
> 2026-08-18 已应用升级（v0.1.1）：`@linxin666/*` → 0.2.9、`dsh-cost-meter` → v1.5.40、`dshmarket` → 1.18.1。0.1→0.2 为大版本，重启后需按验证清单确认 UI；若有 DOM/CSS 变化，同步修 `lib/client.js`。

## 验证清单

- [ ] `dsh --profile web --dump-config` 中只剩 `combo-*` 行 + base/web-app
- [ ] 首页侧边栏显示余额与当日费用
- [ ] footer（余额 / 远程控制）不再横向挤压，wide 与折叠两态正常
- [ ] 选中插件全部可用（右侧面板、看板、Git 图、SSH、梁神、设置页、社区索引、插件市场）
- [ ] 未选插件（宠物/live-stats/describe-image/皮肤）不再出现
- [ ] cost-meter 设置改动可保存、重启后仍在

## 许可证

MIT。列容器 shim 移植自 `@linxin666/dsh-web-ui-all`（Apache-2.0），版权与许可声明保留在 `lib/client.js` 头部。
