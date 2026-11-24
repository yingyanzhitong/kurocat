import {
  DEFAULT_TAIL_KEY_IDS,
  KuroCatEngine,
  type KeyboardOrientation,
  type TailKeyMode,
} from './catEngine';
import { catAudio } from './audio';
import { DEFAULT_BUILTIN_CATS, type CatSkinConfig } from './catSkins';
import type { KeyboardLayoutId } from './keyboardLayout';

type ObsHeadphoneMode = 'auto' | 'on' | 'off';

interface ObsAppSettings {
  scale?: number;
  showKeyBubbles?: boolean;
  catBreed?: string;
  keyboardLayout?: KeyboardLayoutId;
  keyboardOrientation?: KeyboardOrientation;
  tailKeyMode?: TailKeyMode;
  tailKeyIds?: string[];
  headphoneMode?: ObsHeadphoneMode;
}

type InputEvent =
  | { kind: 'keyDown'; vk: number; scan: number; repeat: boolean }
  | { kind: 'keyUp'; vk: number; scan: number }
  | { kind: 'mouseDown'; button: string }
  | { kind: 'mouseUp'; button: string }
  | { kind: 'mouseWheel'; delta: number }
  | { kind: 'mouseMove'; x: number; y: number; nx: number; ny: number }
  | { kind: 'privacyTyping' };

interface ObsStateSnapshot {
  settings?: ObsAppSettings;
  cats?: CatSkinConfig[];
  privacy?: boolean;
  gameActive?: boolean;
}

const canvas = document.getElementById('obs-canvas') as HTMLCanvasElement;
const engine = new KuroCatEngine(canvas);

let privacyActive = false;
let gameActive = false;

// Mute audio inside OBS Browser Source so purring never double-plays on stream
catAudio.setEnabled(false);

const params = new URLSearchParams(window.location.search);
const overrideBreed = params.get('breed')?.trim() || null;
const overrideHeadphoneRaw = params.get('headphones')?.trim().toLowerCase() || null;
const overrideHeadphones: ObsHeadphoneMode | null =
  overrideHeadphoneRaw === 'auto' || overrideHeadphoneRaw === 'on' || overrideHeadphoneRaw === 'off'
    ? overrideHeadphoneRaw
    : null;
const overrideOrient = params.get('orient') === 'viewer' ? 'viewer' : params.get('orient') === 'cat' ? 'cat' : null;
const overrideBubbles = params.has('bubbles') ? params.get('bubbles') !== '0' && params.get('bubbles') !== 'false' : null;
const rawScaleParam = params.get('scale');
const overrideScale =
  rawScaleParam !== null && Number.isFinite(Number(rawScaleParam))
    ? Math.max(0.2, Math.min(2.0, Number(rawScaleParam)))
    : null;

let catList: CatSkinConfig[] = [...DEFAULT_BUILTIN_CATS];
let currentSettings: ObsAppSettings = {
  scale: 0.6,
  showKeyBubbles: true,
  catBreed: 'photo-uu',
  keyboardLayout: '65',
  keyboardOrientation: 'cat',
  tailKeyMode: 'smart',
  tailKeyIds: [...DEFAULT_TAIL_KEY_IDS],
  headphoneMode: 'off',
};

function computeObsHeadphonesOn(activeCat: CatSkinConfig | undefined): boolean {
  const hm: ObsHeadphoneMode =
    overrideHeadphones ||
    (currentSettings.headphoneMode === 'auto' || currentSettings.headphoneMode === 'on'
      ? currentSettings.headphoneMode
      : 'off');
  if (hm === 'on') return true;
  if (hm === 'off') return false;
  return gameActive;
}


function applyState(): void {
  const breedId = overrideBreed || currentSettings.catBreed || 'black';
  const activeCat = catList.find((c) => c.id === breedId) ?? catList[0];
  const layout: KeyboardLayoutId = '65';
  const orient: KeyboardOrientation =
    overrideOrient || (currentSettings.keyboardOrientation === 'viewer' ? 'viewer' : 'cat');
  const tailMode: TailKeyMode =
    currentSettings.tailKeyMode === 'custom' ||
    currentSettings.tailKeyMode === 'edge' ||
    currentSettings.tailKeyMode === 'off'
      ? currentSettings.tailKeyMode
      : 'smart';
  const tailIds = Array.isArray(currentSettings.tailKeyIds)
    ? currentSettings.tailKeyIds
    : [...DEFAULT_TAIL_KEY_IDS];
  const showBubbles =
    overrideBubbles !== null ? overrideBubbles : currentSettings.showKeyBubbles !== false;

  engine.showKeyBubbles = showBubbles;
  engine.setCatAppearance(activeCat?.id || 'black', activeCat);
  engine.setHeadphones(computeObsHeadphonesOn(activeCat));
  engine.setKeyboardConfig(layout, orient);
  engine.setTailKeyConfig(tailMode, tailIds);
  engine.setRenderScale(overrideScale ?? 1.0);
}

function handleInput(p: InputEvent): void {
  switch (p.kind) {
    case 'keyDown':
      engine.onKeyDown(p.vk, p.repeat);
      break;
    case 'keyUp':
      engine.onKeyUp(p.vk);
      break;
    case 'mouseMove':
        engine.onGlobalMouseMove(p.nx, p.ny);
        engine.onWindowCursor(p.nx, p.ny, false);
      break;
    case 'mouseDown':
      engine.onMouseDown(p.button);
      break;
    case 'mouseUp':
      engine.onMouseUp(p.button);
      break;
    case 'mouseWheel':
      engine.onMouseWheel();
      break;
    case 'privacyTyping':
      engine.onPrivacyTyping();
      break;
  }
}

function connectStream(): void {
  const es = new EventSource('/obs/events');

  es.addEventListener('state', (ev) => {
    try {
      const snap = JSON.parse((ev as MessageEvent).data) as ObsStateSnapshot;
      if (Array.isArray(snap.cats) && snap.cats.length > 0) {
        catList = snap.cats;
      }
      if (snap.settings) {
        currentSettings = { ...currentSettings, ...snap.settings };
      }
      if (typeof snap.privacy === 'boolean') {
        privacyActive = snap.privacy;
        engine.setPrivacyMode(privacyActive);
      }
      if (typeof snap.gameActive === 'boolean') {
        gameActive = snap.gameActive;
      }
      applyState();
    } catch {}
  });

  es.addEventListener('settings', (ev) => {
    try {
      const next = JSON.parse((ev as MessageEvent).data) as ObsAppSettings;
      currentSettings = { ...currentSettings, ...next };
      applyState();
    } catch {}
  });

  es.addEventListener('cats', (ev) => {
    try {
      const next = JSON.parse((ev as MessageEvent).data) as CatSkinConfig[];
      if (Array.isArray(next) && next.length > 0) {
        catList = next;
        applyState();
      }
    } catch {}
  });

  es.addEventListener('privacy', (ev) => {
    try {
      const active = JSON.parse((ev as MessageEvent).data) === true;
      privacyActive = active;
      engine.setPrivacyMode(active);
    } catch {}
  });

  es.addEventListener('gameActive', (ev) => {
    try {
      const parsed = JSON.parse((ev as MessageEvent).data) as boolean | { active?: boolean };
      gameActive = typeof parsed === 'boolean' ? parsed : Boolean(parsed?.active);
      applyState();
    } catch {}
  });

  es.addEventListener('input', (ev) => {
    try {
      const payload = JSON.parse((ev as MessageEvent).data) as InputEvent;
      handleInput(payload);
    } catch {}
  });
}

applyState();
engine.start();
connectStream();
