# 取色与模板视觉检查

本地手动运行的视觉回归页面，不进 CI。真实专辑封面有版权，不能放进仓库，所以封面在浏览器里实时从 iTunes 取，只留在内存里；这里的示例歌词也是自己写的。

改了 `src/color.js`（取色、`cardPalette`）或 `src/render/`（模板）之后，打开这个页面，一眼看出：

- 24 张常见封面取出来的色板对不对；
- 每个模板 × 风格 × 明暗长什么样（每张封面一张总图）；
- 三道关口有没有过。

## 怎么跑

在仓库根目录起一个静态服务器，然后打开 `/tests/visual/`。

```
SERVE_TESTS=1 node server.mjs          # PowerShell：$env:SERVE_TESTS=1; node server.mjs
# 或者：python -m http.server 8080
```

打开 <http://localhost:8080/tests/visual/>。需要联网（iTunes Search API 和封面图片）。

仓库自带的 `server.mjs` 默认屏蔽 `tests/` 目录（线上不对外提供），只有设了 `SERVE_TESTS=1` 才放行这个页面。

页面一打开就自动运行：逐张查封面、取色、渲染、检查，顶部有进度。24 张大约一分钟（iTunes 搜索间隔约 1 秒，避免被限流）。

- **改了 src 之后**要点“重新载入页面”（或 F5）：浏览器按地址缓存模块，不重新载入就还是旧代码。
- **画幅**下拉：默认 4:5（所有模板同样大小，便于对比）；也可以换 9:16、1:1，或“各模板默认”。切换后在内存里直接重新渲染，不用重新取封面。
- **总图**默认缩到页面宽度，点一下切换成原始大小。每张封面有“导出此封面”；顶部“导出 PNG”把汇总表和全部总图拼成长图下载（太高会自动分成几张）。导出只用于本地对照，别把导出的图提交进仓库。
- 想只看几张：`/tests/visual/?only=yorushika-elma,swift-folklore`（id 见 `covers.json`）。
- 想加自己的封面：把图片拖到页面上，或用“选择本地封面”。本地图片同样只在内存里，会作为额外的一行加入检查。要长期保留的本地封面可以放进 `tests/visual/covers/`（已被 `.gitignore` 忽略），用的时候拖进页面。

## 总图怎么看

每张封面一张图：左边是封面（白点 = `focus` 视觉中心）、色板（粗圈 = 默认选中的种子色）、每个色块的 hex / 角色 / 面积、强调色、`meanL`、上下边缘色；右边按模板分组，每组里是风格（忠实 / 柔和 / 鲜明 / 单色），三行分别是自动 / 浅色 / 深色。沉浸和景深不分风格，每个明暗一张。

单元格边框：

- 红框：门 1 未通过。
- 蓝灰框：背景很接近，但属于豁免，不算失败，原因见该封面的“明细”。

某个模板在渲染模块里还没实现，或第一张就渲染出错，那一列会显示“未实现”和错误信息，不影响其他模板。

## 三道关口

**门 1 风格分离**（紧凑 / 经典 / 留白，沉浸和景深不分风格）：同一封面、同一明暗下，忠实、柔和、鲜明、单色四种风格两两背景色差 ΔE（OKLab × 100）≥ 8。背景在渲染出的图上取样：设计坐标 (8, 8) 的 8×8 方块；经典取底部 30 px 处（那里是纯背景）。浅色、深色、自动分别算。

豁免（总图里标蓝灰框，不算失败）：

- 种子色的 OKLCH C ≥ 0.15：忠实与鲜明这一对；
- 自动明暗下，忠实就是封面本色，它和任何风格接近都标“接近（封面本色）”；
- 种子色无彩（C < 0.04）：只检查鲜明–柔和、忠实–鲜明，其余对不检查。

**门 2 对比度**（直接用 `cardPalette` 算，不渲染）：全部色板 × 四种风格 × 自动 / 浅色 / 深色。

- 正文 `on` / `bg`：黑或白在这个背景上能到 7，就必须 ≥ 7；到不了，就 ≥ 黑/白最高值 − 0.05，且不低于 4.5。未通过时会写出该背景黑/白能达到的最高值。
- 次要文字 `onVar` / `bg` ≥ 4.5；
- 强调色 `accent` / `bg` ≥ 4.5。

汇总表里显示的是各项最紧的一个值；背景到不了 7 的情况会标“背景上限”。

**门 3 自动明暗**（只显示，不判定）：`resolveDark('auto', meanL)` 的结果和 `meanL` 并排，方便看“封面偏暗就自动深色”是否合理。

各风格用的色调（比如忠实的强制浅/深色调、柔和、单色的色调）不在这里写死，全部在运行时从 `cardPalette` 读，色调怎么改都不用动这个页面。

## covers.json

`covers` 数组里每一项：

| 字段 | 含义 |
| --- | --- |
| `id` | 用于 `?only=`，也用于导出文件名 |
| `label` | 页面上显示的名字 |
| `term` | iTunes 搜索词 |
| `entity` | `album` 或 `song`（`song` 取的是这首歌所在专辑的封面） |
| `country` | `jp` / `us` / `tw` |
| `match` | 可选。正则（忽略大小写），核对专辑名；写了就必须命中，否则这条检索算没找到 |
| `alt` | 可选。备用检索，没写的字段沿用上一层；前面的没命中才会用 |

查不到的封面会显示“iTunes 没找到，已跳过”，不会让整次检查失败。iTunes 目录会变，某张封面哪天找不到了，改 `term` / `match`，或者把本地图片拖进页面。

## 封面不会被保存

- 图片只是 `new Image()` 加载到内存里，页面不写 localStorage / IndexedDB，也不上传任何东西；关掉页面就没了。
- `tests/visual/covers/` 已写进 `.gitignore`。
- “导出 PNG”生成的图里含有封面，是本地对照用的，不要提交。

## 这个页面依赖的接口

模块用动态 `import()` 读取；缺了哪个，页面照常打开，顶部“接口检查”列出缺什么，对应的步骤标“出错”或“未检查”，不会白屏。

- `src/color.js`：`analyzeCover(img)`、`cardPalette({ seed, accent, style, mode, meanL })`、`resolveDark(mode, meanL)`、`hexToOklch(hex)`、`contrast(a, b)`。
- `src/render/index.js`：`renderCard(canvas, state, assets, { scale: 0.3, purpose: 'thumb' })`、`TEMPLATE_ORDER`、`TEMPLATE_INFO[t]`（`label`、`defaultRatio`、`ratios`（也认 `allowedRatios`）、`supports.style`）、`prepareCover(img)`。
- `state`：`template`、`seed`、`variant`（风格）、`dark[template]`（`'auto' | 'light' | 'dark'`）、`blur`（默认 `mid`）、`depthX`（`null`）等，以及标题、歌手、歌词、`focus`、`ratio`、`extras.progress` 等；`assets = { cover, analysis, customFont: false }`。

页面里的文字用系统字体渲染（不加载网络字体），只影响字形，不影响颜色判断。
