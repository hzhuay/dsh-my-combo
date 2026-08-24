/**
 * dsh-my-combo — host half.
 *
 * 粘合层定位（方案见 docs/glue-layer-plan.md）：
 * 本包自身不聚合任何上游插件，只提供客户端兼容层（lib/client.js 的
 * 列容器 shim + footer shim + 布局 CSS）。host 半为空壳。
 */
const inject = []
function apply(_ctx) {}
export { apply, inject }
