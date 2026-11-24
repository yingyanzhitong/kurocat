# KuroCat 皮肤格式

导入文件是一个 `CatSkinConfig` JSON 对象。照片皮肤文件不超过 1 MB，纯参数皮肤文件不超过 64 KB。仓库中的 `src-tauri/src/cats.rs` 是解析端，`src/catSkins.ts`、`src/catEngine.ts` 和 `src/photoCat.ts` 是渲染端。

## 照片皮肤

在常规参数之外加 `photo` 对象。关节版包含下列三个字段。

- `png` 保存透明部件贴图 PNG 的标准 Base64 字符串，直接写入 JSON，去掉 URI 前缀和换行。宽高均不超过 768 像素，PNG 文件不超过 512 KB。
- `rig` 的五个字段为 `head`（含短段颈毛）、`body`（含后腿，不含头、前腿和尾巴）、`tail`（根在左，尖在右）、`upperLeg`（肩在上，肘在下）、`foreleg`（肘在上，爪在下）。每个值为贴图内不重叠的整数像素矩形 `[x, y, width, height]`，左上为原点。每边至少 8 像素。头和躯干的交界应有自然毛边。前腿素材由左右共用，单段素材需包含完整关节周围的毛发，防止弯肘时露缝。
- 可选 `rig.classicPose: true` 采用原版 KuroCat 的侧伸弧尾和待机前腿姿态。尾巴绘制在右侧躯干后方，前腿在待机时收拢并与胸口融合。省略时沿用关节皮肤的身前卷尾姿态。
- 可选 `rig.tuckPaws: true` 只启用收爪和肘部贴图重叠，适用于保留身前卷尾的皮肤。
- 可选 `rig.joinedNeck: true` 让躯干上缘跟随下巴的位移和侧倾，适用于头部与躯干沿平滑颈线重叠的贴图。
- 可选 `rig.headDrop` 控制头部向下移动，范围 0–24 个逻辑像素。配合 `joinedNeck` 可缩短颈胸轮廓，保持脸部贴图比例。
- 可选 `rig.tailScale` 将尾巴厚度增至 1–2 倍。像素贴图同时填写 `tailColor` 和 `tailTipColor` 时，从尾根到尾尖叠加渐变，沿用原贴图的毛纹和轮廓。
- 可选 `rig.frontTail: true` 使用从右胯向胸前收拢的卷尾。卷尾贴图的尾尖在左、尾根在右，宽度和毛色按参考图绘制。绘制时先画卷尾，再画前腿和爪尖。
- 可选 `rig.originalPaws: true` 使用原版前爪的待机、收爪、敲键和握鼠标路径，并使用原版键盘与鼠标位置。上臂和前爪贴图提供这些动作的填充纹理。
- 可选 `rig.showRestingForelegs: true` 配合 `originalPaws` 显示落地前腿。适用于和原版布偶坐姿一致、躯干底部已有两块静态前爪的贴图。渲染时用附近毛色盖住原有前爪，由同一对活动前腿完成待机和伸爪。
- 可选 `rig.roundPaws: true` 配合 `originalPaws`，让前腿沿自然的肘部弧线收窄到腕部，再使用 `foreleg` 底端的圆爪与趾纹。准备贴图时，保留该部件底部约四分之一的完整爪垫。
- 可选 `rig.collar` 是独立颈圈的贴图矩形。颈圈随头转动，在前腿之上、头部之下绘制。
- 可选 `rig.twoToneForelegs: true` 启用原版前爪的双色材质，取色位置见下文。
- 在 `originalPaws` 模式下，可加 `rig.classicPawMotion: true` 复用原版收爪、落键和握鼠标的时序。
- `eyes` 按画面从左到右保存两只眼睛，每项为 `{"x":0.39,"y":0.35,"rx":0.061,"ry":0.05}` 形状，数字为示例。`x`、`y` 是相对 `head` 矩形的中心位置，`rx`、`ry` 是覆盖整只眼睛的水平和垂直半径比例，范围为 0.005–0.15。测量时计入头部矩形内的透明边距。
- 像素贴图可将 `pixelArt` 设为 `true`。该选项需要 `rig`。关闭平滑边缘时，渲染器按固定像素网格合成部件，再用最近邻放大。贴图缩放也用最近邻，检查部件边缘的透明度。
- 可选 `photo.smoothEdges: true` 配合像素模式直接从源贴图采样，在最终显示坐标上平滑渲染会旋转和移动的部件。比较动态预览时，两边的整帧缩放应采用相同过滤方式。

省略 `rig` 时使用旧版整图照片外观，眼睛坐标相对整个 PNG。可用本地 JSON 脚本读取 PNG 字节并做 Base64 编码。

## 原版前爪的双色毛发

同时启用 `photo.rig.originalPaws` 和 `photo.rig.twoToneForelegs` 时，引擎从贴图取两块纹理。位置以各自的部件矩形为基准，从顶部向下量，两块都取水平居中的约 24% 宽度。

| 部件 | 垂直取样范围 | 动作中显示的位置 |
| --- | --- | --- |
| `upperLeg` | 高度的 28%–49% | 靠肩的上半段 |
| `foreleg` | 高度的 79%–90% | 从腿中段延伸至爪尖的下半段 |

让这两块采样区落在相应颜色的不透明毛发内，避开描边和透明留白。咪咪的上臂取身侧深毛，下段取白色前爪毛。引擎将分界放在肩与爪尖之间约一半的位置，随伸爪方向旋转。若照片中的白色只占很短的爪尖，或分界形状需要精确还原，可使用分段贴图逐段绘制。修改双色材质后，在试玩页伸爪检查整条腿的分布。

## 常规参数

`lynx-bicolor` 使用原版布偶猫渲染器和动作。可用 `furColor`、`furSecondaryColor`、`outlineColor`、`maskColor`、`foreheadBridgeColor`、`stripeColor`、`eyeColorTop`、`eyeColorBottom`、`earTipColor`、`earOuterColor`、`earInnerColor`、`noseColor`、`tailColor`、`tailTipColor` 及头部 `spots` 匹配照片。还可设置键盘和鼠标高亮色。此预设保持原版布偶猫的身体线条、四肢涂色和运动。原版风格的 JSON 省略 `photo`。

如需保留照片特有的脸部比例，在 `lynx-bicolor` 中填写 `portrait`。

- `eyeGap` 是两眼中心的距离，范围 26–54 个逻辑像素。
- `eyes` 按画面从左到右填写两项。每项的 `rx` 为水平半径（7–18），`ry` 为垂直半径（5–16），`y` 为垂直偏移（-9–6，正值向下），`tilt` 为轴线转角（-0.45–0.45 弧度）。可选 `irisShade`（0–0.4）用于保留参考照可见的眼部明暗差异。
- `cheekScale` 是脸颊宽度倍率，范围 0.9–1.22。`muzzleDrop` 是口鼻向下的距离，范围 0–12 个逻辑像素。
- `chestRuff` 为真时绘制长胸毛；`frontTail` 为真时尾巴绕到身前。两项均为可选布尔值，应按全身照选择。

```json
{
  "id": "photo-cream-mittens",
  "name": "奶油白手套",
  "emoji": "🐱",
  "pattern": "bicolor",
  "furColor": "#f3ebdc",
  "furSecondaryColor": "#ddc9b2",
  "maskColor": "#9f8776",
  "foreheadBridgeColor": "#bca490",
  "flankColor": "#ac937d",
  "bellyBibColor": "#fff8ed",
  "earOuterColor": "#907566",
  "earInnerColor": "#d4aaa5",
  "tailColor": "#8d6c58",
  "tailTipColor": "#684d43",
  "tailFluffy": true,
  "eyeColorTop": "#4c6175",
  "eyeColorBottom": "#a3c1d6",
  "noseColor": "#cc9694",
  "pawColor": "#fff8ed",
  "accentColor": "#9dbed7",
  "spots": [
    { "part": "head", "x": -0.15, "y": -0.73, "rx": 2, "ry": 8, "rotation": -0.28, "color": "#6e5547", "opacity": 0.85 }
  ]
}
```

- 必填字段为 `id`、`name`、`furColor`。建议设置 `eyeColorTop` 和 `eyeColorBottom`。ID 最长 36 位，只用小写字母、数字、下划线和连字符，首尾不能是连字符。避开内置 ID `black`、`ragdoll`、`orange-tabby`、`calico`、`tuxedo`、`siamese`、`dafeiyu`。名字为 1–40 个可显示字符。
- 颜色优先用 `#RRGGBB`，便于引擎判断亮度。导入也接受带逗号的 `rgb(20, 30, 40)`、`rgba(20, 30, 40, 0.7)` 以及 3、4、8 位十六进制颜色。纯参数皮肤直接使用单对象。
- `pattern` 可选 `solid`（纯色）、`bicolor`（倒 V 脸纹，使用 `maskColor`、`foreheadBridgeColor`）、`lynx-bicolor`（原版布偶模型加窄白鼻梁和额纹）、`tuxedo`（深底白胸，使用 `bellyBibColor`）、`tabby`（额纹和身侧条纹，使用 `stripeColor`）、`calico`（三花，使用 `maskColor` 和 `calicoPatchColor`）、`siamese`（重点色脸罩，使用 `maskColor`）。
- 其他常用颜色包括 `outlineColor`、`legLineColor`、`earTipColor`、`earTuftColor`、`pupilColor`、`eyeRimColor`、`squintColor`、`squintGlowColor`、`mouthColor`、`blushColor`、`whiskerColor`、`armColor`、`pawOutlineColor`、`armCreaseColor` 和 `accentSideColor`。布尔值包括 `tailFluffy`、`tailStripes` 和 `eyeCatchlight`。
- `spots` 最多 64 个。允许的 `part` 为 `head`、`body`、`leftArm`、`rightArm`。头部和躯干的 `x`、`y` 为 -1 到 1，负数分别偏左和偏上。前臂的 `x` 为从肩到爪的 0 到 1，`y` 为横向像素偏移。长度 `rx`、`ry` 为正数，单位是渲染坐标像素。可选旋转角 `rotation` 以弧度为单位，可选 `opacity` 为 0 到 1。
