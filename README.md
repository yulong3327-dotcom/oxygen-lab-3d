# 化学实验室 · 3D 实验生产工作台

从 [AGENTS.md](AGENTS.md) 开始。每个实验有独立任务单和配置，共用 Blender 器材库及 Three.js 播放器。接手制作前阅读 [生产规范](docs/WORKFLOW.md) 和 [配置字段](docs/CONFIG.md)。

```console
npm ci
npm run dev
```

打开终端打印的 `/platform/` 地址访问实验目录。两个待审样板可在同一个本地服务器访问：`/platform/player.html?id=stand-placement` 和 `/platform/player.html?id=stand-comparison`。两份配置都加载 `stand@1`。它们是交互样板，不是已验收的化学课程。

```console
npm run lab -- init <new-experiment-id>
npm run lab -- list-assets
npm run lab -- validate <experiment-id>
npm run lab -- fingerprints <experiment-id>
npm run check
npm test
npx playwright install chromium
npm run test:browser
npm run build
```

`npm run build` 输出可发布的 `dist/`。源模型、参考资料和未确认的实验配置不进入发布产物。制作端可用 stdio MCP 服务 `node scripts/lab-mcp.mjs` 查询器材、校验实验和读取审核指纹；这些操作也可以直接用上面的 CLI 命令。Blender 源文件不由 MCP 改动。

## 高锰酸钾制氧气 · 原版入口

按提示将六件仪器逐个拖入实验台。仪器可在台面自由摆放，靠近当前提示位置后吸附。组装后按顺序完成八个实验步骤，从检查气密性到用带火星的小木条验氧。

- 电脑：拖放仪器，拖动实验台旋转视角。
- 手机：可以拖动仪器缩略图，也可以先点仪器，再点实验台上的对应位置。
- 实验中将蓝色标记拖到对应落点，也可依次选择起点、落点。实验完成后可点击部件名称查看说明，或选择「重做实验」保留装置并重做八步操作。

直接打开 `index.html` 即可运行。网站使用本地 Three.js 和 Lucide 资源，无需构建或安装依赖；浏览器需要支持 WebGL。
