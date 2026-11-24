use base64::Engine as _;
use serde::{Deserialize, Serialize};
use std::fs::{self, File, OpenOptions};
use std::io::Cursor;
use std::path::PathBuf;

const MAX_PARAMETER_SKIN_BYTES: usize = 64 * 1024;
const MAX_SKIN_BYTES: usize = 1024 * 1024;
const MAX_PHOTO_BYTES: usize = 512 * 1024;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct PhotoEye {
    // Bounds in proportions of the full sprite, including its transparent margin.
    pub x: f64,
    pub y: f64,
    pub rx: f64,
    pub ry: f64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct CatPhoto {
    pub png: String,
    pub eyes: [PhotoEye; 2],
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub rig: Option<PhotoRig>,
    #[serde(default, rename = "pixelArt", skip_serializing_if = "is_false")]
    pub pixel_art: bool,
    #[serde(default, rename = "smoothEdges", skip_serializing_if = "is_false")]
    pub smooth_edges: bool,
}

fn is_false(value: &bool) -> bool {
    !value
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PhotoRig {
    head: [u32; 4],
    body: [u32; 4],
    tail: [u32; 4],
    upper_leg: [u32; 4],
    foreleg: [u32; 4],
    #[serde(default, skip_serializing_if = "Option::is_none")]
    collar: Option<[u32; 4]>,
    #[serde(default, skip_serializing_if = "is_false")]
    classic_pose: bool,
    #[serde(default, skip_serializing_if = "is_false")]
    tuck_paws: bool,
    #[serde(default, skip_serializing_if = "is_false")]
    joined_neck: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    head_drop: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    tail_scale: Option<f64>,
    #[serde(default, skip_serializing_if = "is_false")]
    tail_root_right: bool,
    #[serde(default, skip_serializing_if = "is_false")]
    front_tail: bool,
    #[serde(default, skip_serializing_if = "is_false")]
    original_paws: bool,
    #[serde(default, skip_serializing_if = "is_false")]
    show_resting_forelegs: bool,
    #[serde(default, skip_serializing_if = "is_false")]
    round_paws: bool,
    #[serde(default, skip_serializing_if = "is_false")]
    classic_paw_motion: bool,
    #[serde(default, skip_serializing_if = "is_false")]
    two_tone_forelegs: bool,
}

impl CatPhoto {
    fn validate(&self) -> Result<(), String> {
        if self.pixel_art && self.rig.is_none() {
            return Err("像素画皮肤需要部件贴图和关节坐标。".into());
        }
        if self.smooth_edges && !self.pixel_art {
            return Err("像素边缘平滑需要开启像素画渲染。".into());
        }
        if self.png.len() > MAX_PHOTO_BYTES.div_ceil(3) * 4 {
            return Err("透明 PNG 不能超过 512 KB。".into());
        }
        let bytes = base64::engine::general_purpose::STANDARD
            .decode(&self.png)
            .map_err(|_| "皮肤中的 PNG 编码无效。")?;
        if bytes.len() > MAX_PHOTO_BYTES {
            return Err("透明 PNG 不能超过 512 KB。".into());
        }
        let mut reader = png::Decoder::new(Cursor::new(bytes))
            .read_info()
            .map_err(|_| "皮肤中的 PNG 无效。")?;
        let info = reader.info();
        if info.width > 768 || info.height > 768 {
            return Err("照片皮肤的图片宽高均不能超过 768 像素。".into());
        }
        if let Some(rig) = &self.rig {
            if rig.head_drop.is_some_and(|drop| !(0.0..=24.0).contains(&drop)) {
                return Err("关节皮肤的头部下移量须在 0 到 24 像素之间。".into());
            }
            if rig.tail_scale.is_some_and(|scale| !(1.0..=2.0).contains(&scale)) {
                return Err("尾巴的厚度倍率须在 1 到 2 之间。".into());
            }
            let parts = [rig.head, rig.body, rig.tail, rig.upper_leg, rig.foreleg];
            if parts.iter().chain(rig.collar.iter()).any(|[x, y, w, h]| {
                *w < 8
                    || *h < 8
                    || x.saturating_add(*w) > info.width
                    || y.saturating_add(*h) > info.height
            }) {
                return Err("猫咪模型有部件超出贴图边界，或部件太小。".into());
            }
        }
        let has_alpha = matches!(
            info.color_type,
            png::ColorType::Rgba | png::ColorType::GrayscaleAlpha
        );
        if info.animation_control.is_some() || (!has_alpha && info.trns.is_none()) {
            return Err("请使用带有透明通道的静态 PNG。".into());
        }
        let size = reader.output_buffer_size().ok_or("PNG 图片尺寸无效。")?;
        reader
            .next_frame(&mut vec![0; size])
            .map_err(|_| "皮肤中的 PNG 无法解码。")?;
        if self.eyes.iter().any(|eye| {
            !(0.005..=0.15).contains(&eye.rx)
                || !(0.005..=0.15).contains(&eye.ry)
                || !(eye.rx..=1.0 - eye.rx).contains(&eye.x)
                || !(eye.ry..=1.0 - eye.ry).contains(&eye.y)
        }) || self.eyes[0].x >= self.eyes[1].x
        {
            return Err("照片皮肤的眼睛坐标无效，请按画面从左到右填写。".into());
        }
        Ok(())
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CatSpot {
    /// "head" | "body" | "leftArm" | "rightArm"
    pub part: String,
    /// Normalized offset (-1..1 for head/body; 0..1 along arm from shoulder to paw)
    pub x: f64,
    /// Normalized vertical offset (-1..1 for head/body; lateral px for arm)
    pub y: f64,
    pub rx: f64,
    pub ry: f64,
    #[serde(default)]
    pub rotation: f64,
    pub color: String,
    #[serde(default = "default_opacity")]
    pub opacity: f64,
}

fn default_opacity() -> f64 {
    0.85
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CatPortrait {
    eye_gap: f64,
    eyes: [PortraitEye; 2],
    cheek_scale: f64,
    muzzle_drop: f64,
    #[serde(default)]
    chest_ruff: bool,
    #[serde(default)]
    front_tail: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PortraitEye {
    rx: f64,
    ry: f64,
    y: f64,
    tilt: f64,
    #[serde(default)]
    iris_shade: f64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CatSkinConfig {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub emoji: Option<String>,
    #[serde(default)]
    pub builtin: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub photo: Option<CatPhoto>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub portrait: Option<CatPortrait>,

    // Core fur & outline
    pub fur_color: String,
    #[serde(default)]
    pub fur_secondary_color: Option<String>,
    #[serde(default)]
    pub outline_color: Option<String>,
    #[serde(default)]
    pub leg_line_color: Option<String>,

    // Pattern preset
    #[serde(default)]
    pub pattern: Option<String>,
    #[serde(default)]
    pub mask_color: Option<String>,
    #[serde(default)]
    pub forehead_bridge_color: Option<String>,
    #[serde(default)]
    pub flank_color: Option<String>,
    #[serde(default)]
    pub belly_bib_color: Option<String>,
    #[serde(default)]
    pub stripe_color: Option<String>,
    #[serde(default)]
    pub calico_patch_color: Option<String>,

    // Ears
    #[serde(default)]
    pub ear_outer_color: Option<String>,
    #[serde(default)]
    pub ear_tip_color: Option<String>,
    #[serde(default)]
    pub ear_inner_color: Option<String>,
    #[serde(default)]
    pub ear_tuft_color: Option<String>,

    // Tail
    #[serde(default)]
    pub tail_color: Option<String>,
    #[serde(default)]
    pub tail_tip_color: Option<String>,
    #[serde(default)]
    pub tail_fluffy: Option<bool>,
    #[serde(default)]
    pub tail_stripes: Option<bool>,

    // Eyes & face
    #[serde(default = "default_eye_top")]
    pub eye_color_top: String,
    #[serde(default)]
    pub eye_color_bottom: Option<String>,
    #[serde(default)]
    pub pupil_color: Option<String>,
    #[serde(default)]
    pub eye_catchlight: Option<bool>,
    #[serde(default)]
    pub eye_rim_color: Option<String>,
    #[serde(default)]
    pub squint_color: Option<String>,
    #[serde(default)]
    pub squint_glow_color: Option<String>,
    #[serde(default)]
    pub nose_color: Option<String>,
    #[serde(default)]
    pub mouth_color: Option<String>,
    #[serde(default)]
    pub blush_color: Option<String>,
    #[serde(default)]
    pub whisker_color: Option<String>,

    // Arms & paws
    #[serde(default)]
    pub arm_color: Option<String>,
    #[serde(default)]
    pub paw_color: Option<String>,
    #[serde(default)]
    pub paw_outline_color: Option<String>,
    #[serde(default)]
    pub arm_crease_color: Option<String>,

    // Keyboard & mouse accent theme
    #[serde(default)]
    pub accent_color: Option<String>,
    #[serde(default)]
    pub accent_side_color: Option<String>,

    // Unique pet birthmarks / patches
    #[serde(default)]
    pub spots: Vec<CatSpot>,
}

fn default_eye_top() -> String {
    "#d4f044".to_string()
}

pub fn cats_path() -> PathBuf {
    crate::config::app_data_dir().join("cats.json")
}

pub fn sanitize_cat_id(raw: &str) -> String {
    let cleaned: String = raw
        .trim()
        .to_lowercase()
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '-' || c == '_' {
                c
            } else {
                '-'
            }
        })
        .collect();
    let trimmed = cleaned.trim_matches('-').to_string();
    if trimmed.is_empty() {
        "custom-cat".to_string()
    } else {
        trimmed.chars().take(36).collect()
    }
}

pub fn load_custom_cats() -> Vec<CatSkinConfig> {
    read_custom_cats().unwrap_or_default()
}

fn read_custom_cats() -> Result<Vec<CatSkinConfig>, String> {
    let content = match fs::read_to_string(cats_path()) {
        Ok(content) => content,
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => return Ok(vec![]),
        Err(err) => return Err(format!("无法读取猫咪皮肤：{err}")),
    };
    let mut cats: Vec<CatSkinConfig> =
        serde_json::from_str(&content).map_err(|err| format!("猫咪皮肤存档损坏：{err}"))?;
    for cat in &mut cats {
        cat.id = sanitize_cat_id(&cat.id);
        cat.builtin = false;
    }
    Ok(cats)
}

// The desktop and stdio MCP can write from separate processes.
fn lock_custom_cats() -> Result<File, String> {
    let dir = crate::config::app_data_dir();
    fs::create_dir_all(&dir).map_err(|err| err.to_string())?;
    let lock = OpenOptions::new()
        .read(true)
        .write(true)
        .create(true)
        .truncate(false)
        .open(dir.join("cats.lock"))
        .map_err(|err| err.to_string())?;
    lock.lock().map_err(|err| err.to_string())?;
    Ok(lock)
}

fn save_custom_cats(cats: &[CatSkinConfig]) -> Result<(), String> {
    let path = cats_path();
    let temporary = path.with_extension("json.tmp");
    let json = serde_json::to_vec_pretty(cats).map_err(|err| err.to_string())?;
    fs::write(&temporary, json)
        .and_then(|()| fs::rename(&temporary, &path))
        .map_err(|err| format!("无法保存猫咪皮肤：{err}"))
}

fn valid_skin_color(value: &str) -> bool {
    let value = value.trim();
    if let Some(hex) = value.strip_prefix('#') {
        return matches!(hex.len(), 3 | 4 | 6 | 8) && hex.bytes().all(|c| c.is_ascii_hexdigit());
    }
    // Use the comma-separated RGB syntax supported by the oldest target WebViews.
    let Some((function, channels)) = value.split_once('(') else {
        return false;
    };
    let Some(channels) = channels.strip_suffix(')') else {
        return false;
    };
    let channels: Vec<_> = channels.split(',').map(str::trim).collect();
    let has_alpha = match (function, channels.len()) {
        ("rgb", 3) => false,
        ("rgba", 4) => true,
        _ => return false,
    };
    channels[..3].iter().all(|channel| {
        !channel.is_empty()
            && channel.bytes().all(|c| c.is_ascii_digit())
            && channel.parse::<u8>().is_ok()
    }) && (!has_alpha
        || (!channels[3].is_empty()
            && channels[3].bytes().all(|c| c.is_ascii_digit() || c == b'.')
            && channels[3]
                .parse::<f64>()
                .is_ok_and(|alpha| (0.0..=1.0).contains(&alpha))))
}

fn parse_imported_skin(json: &str) -> Result<CatSkinConfig, String> {
    if json.len() > MAX_SKIN_BYTES {
        return Err("猫咪皮肤文件不能超过 1 MB。".into());
    }
    let mut cat: CatSkinConfig = serde_json::from_str(json.trim_start_matches('\u{feff}'))
        .map_err(|err| format!("猫咪皮肤 JSON 无效：{err}"))?;
    validate_portrait(&cat)?;
    let photo = cat.photo.take();
    if let Some(photo) = &photo {
        photo.validate()?;
    } else if json.len() > MAX_PARAMETER_SKIN_BYTES {
        return Err("纯参数皮肤文件不能超过 64 KB。".into());
    }
    if cat.id != sanitize_cat_id(&cat.id) {
        return Err(
            "皮肤 ID 须为 1–36 位小写字母、数字、连字符或下划线，且不能以连字符开头或结尾。".into(),
        );
    }
    cat.name = cat.name.trim().to_owned();
    if !(1..=40).contains(&cat.name.chars().count()) || cat.name.chars().any(char::is_control) {
        return Err("猫咪名字须为 1–40 个可显示字符。".into());
    }
    if let Some(pattern) = &cat.pattern {
        if !matches!(
            pattern.as_str(),
            "solid" | "bicolor" | "lynx-bicolor" | "tuxedo" | "tabby" | "calico" | "siamese"
        ) {
            return Err(format!("不支持的花纹：{pattern}"));
        }
    }
    let serialized = serde_json::to_value(&cat).map_err(|err| err.to_string())?;
    if let Some(fields) = serialized.as_object() {
        for (key, value) in fields {
            if key.ends_with("Color")
                && value.as_str().is_some_and(|color| !valid_skin_color(color))
            {
                return Err(format!(
                    "颜色格式无效：{key}。请使用十六进制或 RGB / RGBA 颜色。"
                ));
            }
        }
    }
    if cat.spots.len() > 64 {
        return Err("一套猫咪皮肤最多支持 64 个斑纹。".into());
    }
    for (index, spot) in cat.spots.iter().enumerate() {
        let valid_position = match spot.part.as_str() {
            "head" | "body" => (-1.0..=1.0).contains(&spot.x) && (-1.0..=1.0).contains(&spot.y),
            "leftArm" | "rightArm" => (0.0..=1.0).contains(&spot.x),
            _ => false,
        };
        if !valid_position
            || spot.rx <= 0.0
            || spot.ry <= 0.0
            || !(0.0..=1.0).contains(&spot.opacity)
            || !valid_skin_color(&spot.color)
        {
            return Err(format!(
                "第 {} 个斑纹的部位、位置、半径、不透明度或颜色无效。",
                index + 1
            ));
        }
    }
    cat.builtin = false;
    cat.photo = photo;
    Ok(cat)
}

fn validate_portrait(cat: &CatSkinConfig) -> Result<(), String> {
    let Some(portrait) = &cat.portrait else {
        return Ok(());
    };
    if cat.photo.is_some() || cat.pattern.as_deref() != Some("lynx-bicolor") {
        return Err("照片特征参数仅适用于 lynx-bicolor 的 Canvas 皮肤。".into());
    }
    if !(26.0..=54.0).contains(&portrait.eye_gap)
        || !(0.9..=1.22).contains(&portrait.cheek_scale)
        || !(0.0..=12.0).contains(&portrait.muzzle_drop)
        || portrait.eyes.iter().any(|eye| {
            !(7.0..=18.0).contains(&eye.rx)
                || !(5.0..=16.0).contains(&eye.ry)
                || !(-9.0..=6.0).contains(&eye.y)
                || !(-0.45..=0.45).contains(&eye.tilt)
                || !(0.0..=0.4).contains(&eye.iris_shade)
        })
    {
        return Err("照片特征参数中的眼形、眼距、脸颊或口鼻位置超出范围。".into());
    }
    Ok(())
}

pub fn import_custom_cat(json: &str) -> Result<CatSkinConfig, String> {
    let cat = parse_imported_skin(json)?;
    if cat.id == "dafeiyu" {
        return Err(format!(
            "「{}」是已停用的皮肤 ID，请换一个 ID 后再导入。",
            cat.id
        ));
    }
    let _lock = lock_custom_cats()?;
    let mut custom = read_custom_cats()?;
    if let Some(existing) = custom.iter().find(|existing| existing.id == cat.id) {
        return if existing == &cat {
            Ok(cat)
        } else {
            Err(format!(
                "皮肤 ID「{}」已存在，请换一个 ID 后再导入。",
                cat.id
            ))
        };
    }
    custom.push(cat.clone());
    save_custom_cats(&custom)?;
    Ok(cat)
}

pub fn all_cats() -> Vec<CatSkinConfig> {
    let mut list: Vec<CatSkinConfig> = Vec::new();
    for json in [include_str!("../../website/public/skins/UU.json"), include_str!("../../website/public/skins/mimi.json")] {
        list.push(serde_json::from_str(json).expect("valid packaged cat skin"));
    }
    let custom = load_custom_cats();
    for c in custom.into_iter().filter(|cat| cat.id != "dafeiyu") {
        if let Some(existing) = list.iter_mut().find(|x| x.id == c.id) {
            // Allow user to customize even built-in look while preserving id
            let was_builtin = existing.builtin;
            *existing = c;
            existing.builtin = was_builtin;
        } else {
            list.push(c);
        }
    }
    list
}

pub fn upsert_custom_cat(mut cat: CatSkinConfig) -> Result<CatSkinConfig, String> {
    cat.id = sanitize_cat_id(&cat.id);
    if cat.id == "dafeiyu" {
        return Err("该皮肤 ID 已停用。".into());
    }
    if cat.name.trim().is_empty() {
        cat.name = cat.id.clone();
    }
    cat.builtin = false;
    validate_portrait(&cat)?;
    if let Some(photo) = &cat.photo {
        photo.validate()?;
    }

    let _lock = lock_custom_cats()?;
    let mut custom = read_custom_cats()?;
    if let Some(existing) = custom.iter_mut().find(|c| c.id == cat.id) {
        *existing = cat.clone();
    } else {
        custom.push(cat.clone());
    }
    save_custom_cats(&custom)?;
    Ok(cat)
}

pub fn delete_custom_cat(id: &str) -> Result<bool, String> {
    let clean_id = sanitize_cat_id(id);
    let _lock = lock_custom_cats()?;
    let mut custom = read_custom_cats()?;
    let before = custom.len();
    custom.retain(|c| c.id != clean_id);
    if custom.len() == before {
        return Ok(false);
    }
    save_custom_cats(&custom)?;
    Ok(true)
}

pub fn cat_exists(id: &str) -> bool {
    let clean = sanitize_cat_id(id);
    all_cats().iter().any(|c| c.id == clean)
}

pub fn cat_schema_guide() -> serde_json::Value {
    serde_json::json!({
        "description": "KuroCat Custom Cat Skin Schema. Pass any custom cat JSON to upsert_cat (with activate: true) to immediately add and render it live on the user's desktop!",
        "patterns": {
            "solid": "Single coat color (e.g., British Shorthair blue, white Persian, golden chinchilla, black cat)",
            "bicolor": "Ragdoll / bicolor inverted-V face mask (uses maskColor, foreheadBridgeColor, flankColor)",
            "lynx-bicolor": "Built-in Ragdoll drawing with a narrow blaze, forehead stripes, and customizable head spots and eye colors",
            "tuxedo": "Black/dark hood & back with clean white chin/chest bib and white mittens (uses furColor + bellyBibColor + pawColor)",
            "tabby": "Forehead M stripes, cheek stripes, back/flank stripes, and ringed tail (uses furColor + stripeColor + bellyBibColor + tailStripes: true)",
            "calico": "Creamy white base with asymmetric warm orange & dark espresso patches (uses furColor + maskColor + calicoPatchColor)",
            "siamese": "Creamy body with dark seal/chocolate face mask, dark ears, dark paws, dark tail, sapphire eyes"
        },
        "spotsGuide": "Optional array of unique pet markings (spots) on 'head', 'body', 'leftArm', or 'rightArm'. For head/body: x and y are normalized (-1..1). For leftArm/rightArm: x is 0..1 from shoulder to paw, y is lateral offset in px.",
        "portraitGuide": "Optional for lynx-bicolor without photo. Set eyeGap (26..54 px), eyes ([left, right], each rx 7..18 px, ry 5..16 px, y -9..6 px, tilt -0.45..0.45 rad, optional irisShade 0..0.4), cheekScale (0.9..1.22), muzzleDrop (0..12 px), optional chestRuff and frontTail booleans.",
        "examples": {
            "orangeTabby": {
                "id": "orange-tabby",
                "name": "大橘猫",
                "emoji": "🍊",
                "pattern": "tabby",
                "furColor": "#f2a452",
                "furSecondaryColor": "#e38c38",
                "outlineColor": "#6b4322",
                "bellyBibColor": "#fdf6e8",
                "stripeColor": "#b85d19",
                "earOuterColor": "#e38c38",
                "earInnerColor": "#f3b9b5",
                "tailColor": "#eb9640",
                "tailTipColor": "#b85d19",
                "tailStripes": true,
                "eyeColorTop": "#b86b14",
                "eyeColorBottom": "#ffd369",
                "eyeCatchlight": true,
                "noseColor": "#ee8d98",
                "blushColor": "#f596a2",
                "armColor": "#f2a452",
                "pawColor": "#fdf6e8",
                "accentColor": "#ffb347",
                "accentSideColor": "#cc7a16"
            },
            "calico": {
                "id": "calico",
                "name": "三花猫",
                "emoji": "🌸",
                "pattern": "calico",
                "furColor": "#fcfaf5",
                "outlineColor": "#4f4640",
                "maskColor": "#ea9446",
                "calicoPatchColor": "#3c3634",
                "earOuterColor": "#3c3634",
                "earInnerColor": "#f2bfc4",
                "tailColor": "#3c3634",
                "tailTipColor": "#ea9446",
                "eyeColorTop": "#5a8f3d",
                "eyeColorBottom": "#c9e87c",
                "eyeCatchlight": true,
                "noseColor": "#ef95a2",
                "blushColor": "#f498a8",
                "pawColor": "#fcfaf5",
                "accentColor": "#ffa6c1",
                "accentSideColor": "#cc6c8b"
            },
            "tuxedo": {
                "id": "tuxedo",
                "name": "奶牛猫",
                "emoji": "🐄",
                "pattern": "tuxedo",
                "furColor": "#1d1f24",
                "outlineColor": "#141519",
                "bellyBibColor": "#faf9f5",
                "earInnerColor": "#dfb6bc",
                "tailColor": "#1d1f24",
                "tailTipColor": "#faf9f5",
                "eyeColorTop": "#6db840",
                "eyeColorBottom": "#d8f568",
                "eyeCatchlight": true,
                "noseColor": "#ee9aa6",
                "armColor": "#1d1f24",
                "pawColor": "#faf9f5",
                "pawOutlineColor": "#2c2f38",
                "accentColor": "#7ee8a6",
                "accentSideColor": "#3aa666"
            },
            "siamese": {
                "id": "siamese",
                "name": "暹罗猫",
                "emoji": "🤎",
                "pattern": "siamese",
                "furColor": "#f3eadb",
                "furSecondaryColor": "#e2d4be",
                "outlineColor": "#4c3b30",
                "maskColor": "#4a382c",
                "earOuterColor": "#3e2e24",
                "earTipColor": "#2c2018",
                "tailColor": "#4a382c",
                "tailTipColor": "#2c2018",
                "eyeColorTop": "#245ab8",
                "eyeColorBottom": "#8ad4ff",
                "eyeCatchlight": true,
                "noseColor": "#3c2b22",
                "armColor": "#5a4638",
                "pawColor": "#3c2c22",
                "accentColor": "#72c4ff",
                "accentSideColor": "#3a84c8"
            }
        }
    })
}
