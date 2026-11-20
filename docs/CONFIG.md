# 实验配置与器材字段

[生产规范](WORKFLOW.md) 说明人和 Agent 的工作顺序。这里记录当前播放器可读取的字段；如遇差异，以 `scripts/lab-core.mjs` 的校验和实际显示为准。所有仓库内路径使用相对仓库根目录的 ASCII 路径和正斜杠。ID 使用小写英文字母、数字和单连字符，如 `stand`、`move-stand`。

## 器材目录

`assets/catalog.json` 顶层是 `{ "schemaVersion": 1, "assets": [...] }`。每个条目必须有：

| 字段 | 内容 |
| --- | --- |
| `id` | 稳定的器材 ID；与 `version` 一起唯一。 |
| `title` | 显示名称。 |
| `version` | 正整数版次。同一个 ID 可保留多个版本；已有实验继续引用原版。 |
| `status` | `candidate` 用于本地预览；`approved` 表示已得到该版模型审核，可用于正式项目。 |
| `source`、`model`、`preview` | `assets/` 下可读取的 `.blend`、GLB 2.0 和 PNG 文件路径。 |
| `anchors` | 命名锚点到 `[x, y, z]` 的映射；坐标用 GLB 的局部坐标，单位为米、Y 轴向上。至少一个点。 |
| `provenance` | 素材来源和权属相关说明。 |

目录锚点用于建模交接和编排参照；当前通用步骤的移动目标必须填入场景坐标，不会通过锚点名字自动计算。正式构建只带上平台已登记实验实际引用的获批模型和预览图，不带 `source` 和 `provenance`。

## 项目文件

`experiments/<id>/experiment.json` 顶层使用 `schemaVersion: 1`。文件的 `id` 要与目录名一致；`title`、`summary` 使用非空文字。至少放一个器材实例和一个步骤，实例 ID 和步骤 ID 在各自列表里不能重复。粒子、液位、动画等效果只有在共用播放器已实现相应动作时才能配用。

```json
{
  "schemaVersion": 1,
  "id": "stand-position-demo",
  "title": "铁架台摆放练习",
  "summary": "查看器材并把铁架台移动到标记位置。",
  "instruments": [
    {
      "id": "stand-1",
      "assetId": "stand",
      "assetVersion": 1,
      "position": [-0.18, 0, 0],
      "rotationY": 0
    }
  ],
  "steps": [
    {
      "id": "identify",
      "title": "识别铁架台",
      "instruction": "点选铁架台。",
      "observable": "已选中铁架台。",
      "wrongFeedback": "请点选铁架台。",
      "action": { "type": "select", "instrumentId": "stand-1" }
    },
    {
      "id": "place",
      "title": "摆放铁架台",
      "instruction": "把铁架台移到标记位置。",
      "observable": "铁架台底座位于标记处。",
      "wrongFeedback": "铁架台还未到指定位置。",
      "action": {
        "type": "move-to",
        "instrumentId": "stand-1",
        "position": [0.18, 0, 0]
      }
    }
  ]
}
```

`assetId` 和 `assetVersion` 一起指向目录中的确切版本；同一种器材可以使用多个不同的实例 ID。实例 `position` 和 `move-to` 的 `position` 都是场景中的 `[x, y, z]`，单位为米。`rotationY` 可省略，若填写，使用弧度。步骤按数组顺序执行；每步都要填写 `title`、`instruction`、`observable`、`wrongFeedback`。当前支持 `select` 和 `move-to`，`action.instrumentId` 必须指向同一个实验中已有的实例。不要在 `experiment.json` 里写执行代码。

与配置同目录的 `intake.md` 记输入和验收用例；`review.json` 用于复核记录，初始化为：

```json
{
  "schemaVersion": 1,
  "model": [],
  "web": [],
  "teaching": []
}
```

每轮按对应数组追加意见：`fingerprint` 由 `npm run lab -- fingerprints <id>` 生成，`decision` 只接受 `approved` 或 `changes-requested`，`reviewer` 和 `notes` 不得为空，`date` 用 `YYYY-MM-DD`。程序只接受最后一轮处于 `approved` 且指纹与当前构建内容一致的审核。等待真实反馈时不新增伪造记录。

## 平台目录

`platform/catalog.json` 顶层使用 `{ "schemaVersion": 1, "projects": [...] }`。新项目登记 `id`、`title`、`summary`、`kind: "config"` 和 `href: "./player.html?id=<id>"`；`thumbnail` 可省略，否则指向仓库 `assets/` 下允许公开的 PNG。现有制氧项目使用专有的 `legacy` 类型和原入口，不作为首发新实验的模板。新项目只有通过当前版本的模型、网页和教学审核，且引用的器材版本均为 `approved`，才可进入公开构建。
