import type { CatPhoto, CatSkinConfig, PhotoRect } from './catSkins';
import { drawCatRig, getPhotoRestingFoot, getPhotoShoulder, type CatRigPose, type ForelegPose } from './catRig';

const PIXEL_SCALE = 2;

interface PawMaterials {
  context: CanvasRenderingContext2D;
  arm: CanvasPattern | null;
  paw: CanvasPattern | null;
  sleeve?: CanvasPattern | null;
  mitten?: HTMLCanvasElement;
}

export class PhotoCatRenderer {
  private photo?: CatPhoto;
  private sprite?: HTMLImageElement;
  private pixelContext?: CanvasRenderingContext2D;
  private eyelidPatches?: HTMLCanvasElement[];
  private pawMaterials?: PawMaterials;
  private tailColor?: string;
  private tailTipColor?: string;
  private tailTexture?: HTMLCanvasElement;
  private bodyTexture?: HTMLCanvasElement;

  get ready(): boolean {
    return Boolean(this.sprite?.complete && this.sprite.naturalWidth);
  }

  get hasRig(): boolean {
    return Boolean(this.photo?.rig);
  }

  get usesOriginalPaws(): boolean {
    return Boolean(this.photo?.rig?.originalPaws);
  }

  get usesContinuousPawMotion(): boolean {
    return this.hasRig && !(this.usesOriginalPaws && this.photo?.rig?.classicPawMotion);
  }

  setPhoto(photo?: CatPhoto, skin?: Pick<CatSkinConfig, 'tailColor' | 'tailTipColor'> | null): void {
    if (photo?.rig !== this.photo?.rig || photo?.png !== this.photo?.png) {
      this.pawMaterials = undefined;
    }
    if (photo?.rig?.head !== this.photo?.rig?.head || photo?.eyes !== this.photo?.eyes || photo?.png !== this.photo?.png) {
      this.eyelidPatches = undefined;
    }
    if (
      photo?.rig?.tail !== this.photo?.rig?.tail || photo?.rig?.tailRootRight !== this.photo?.rig?.tailRootRight ||
      photo?.rig?.frontTail !== this.photo?.rig?.frontTail || photo?.png !== this.photo?.png ||
      skin?.tailColor !== this.tailColor || skin?.tailTipColor !== this.tailTipColor
    ) {
      this.tailTexture = undefined;
    }
    if (photo?.rig?.body !== this.photo?.rig?.body || photo?.png !== this.photo?.png) {
      this.bodyTexture = undefined;
    }
    this.tailColor = skin?.tailColor;
    this.tailTipColor = skin?.tailTipColor;
    if (photo?.png !== this.photo?.png) {
      this.sprite = undefined;
      if (photo) {
        const sprite = new Image();
        sprite.src = `data:image/png;base64,${photo.png}`;
        this.sprite = sprite;
      }
    }
    this.photo = photo;
  }

  draw(
    ctx: CanvasRenderingContext2D,
    x: number,
    baseY: number,
    height: number,
    tilt: number,
    closedness: number,
  ): void {
    const { photo, sprite } = this;
    if (!photo || !sprite?.naturalWidth || !sprite.complete) return;

    const spriteWidth = sprite.naturalWidth;
    const spriteHeight = sprite.naturalHeight;
    // Keep proportions for both tall and round seated cats.
    const scale = Math.min(height / spriteHeight, 205 / spriteWidth);
    const w = spriteWidth * scale;
    const h = spriteHeight * scale;
    ctx.save();
    ctx.translate(x, baseY);
    ctx.rotate(tilt);
    ctx.translate(-w / 2, -h);
    ctx.drawImage(sprite, 0, 0, w, h);
    this.drawEyes(ctx, sprite, photo.eyes, [0, 0, spriteWidth, spriteHeight], w, h, closedness);
    ctx.restore();
  }

  drawRig(ctx: CanvasRenderingContext2D, basePose: CatRigPose, closedness: number, headset?: (ctx: CanvasRenderingContext2D, front: boolean) => void): void {
    const { photo, sprite } = this;
    const rig = photo?.rig;
    if (!photo || !rig || !sprite || !this.ready) return;
    const headDrop = Math.min(24, Math.max(0, rig.headDrop ?? 0));
    const pose = headDrop > 0
      ? { ...basePose, head: { ...basePose.head, y: basePose.head.y + headDrop } }
      : basePose;
    const originalPaws = Boolean(rig.originalPaws);
    const pixels = photo.pixelArt && !photo.smoothEdges
      ? this.getPixelContext(originalPaws ? 540 : 396, originalPaws ? 456 : 372)
      : undefined;
    const target = pixels ?? ctx;
    const left = originalPaws ? 0 : Math.floor((pose.hips.x - 198) / PIXEL_SCALE) * PIXEL_SCALE;
    const top = originalPaws ? 0 : Math.floor((pose.hips.y - 270) / PIXEL_SCALE) * PIXEL_SCALE;
    if (pixels) {
      pixels.setTransform(1, 0, 0, 1, 0, 0);
      pixels.clearRect(0, 0, pixels.canvas.width, pixels.canvas.height);
      const scale = 1 / PIXEL_SCALE;
      pixels.setTransform(scale, 0, 0, scale, -left * scale, -top * scale);
    }
    target.save();
    if (photo.smoothEdges) {
      // Filter the original texels at the final moving coordinates.
      target.imageSmoothingEnabled = true;
      target.imageSmoothingQuality = 'medium';
    }
    const showRest = originalPaws && Boolean(rig.showRestingForelegs);
    const drawOriginalPaws = originalPaws ? (paint: CanvasRenderingContext2D) => {
      for (const leg of pose.forelegs) {
        const rest = leg.restWeight;
        const planted = showRest
          ? getPhotoRestingFoot(rig, pose, leg.side)
          : { x: pose.hips.x + leg.side * 24, y: pose.hips.y - 3 };
        const target = {
          x: leg.target.x + (planted.x - leg.target.x) * rest,
          y: leg.target.y + (planted.y - leg.target.y) * rest,
        };
        const shoulder = getPhotoShoulder(rig, pose, leg.side, showRest ? rest : 0);
        this.drawOriginalForeleg(paint, shoulder, { ...leg, target }, showRest);
      }
    } : undefined;
    drawCatRig(target, sprite, rig, pose, (w, h) => {
      this.drawEyes(target, sprite, photo.eyes, rig.head, w, h, closedness);
    }, drawOriginalPaws, {
      headset,
      body: showRest ? this.getSeatedBody(sprite, rig.body) : undefined,
      tail: this.getTailTexture(sprite, rig.tail),
    });
    target.restore();
    if (pixels) {
      ctx.save();
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(
        pixels.canvas, left, top,
        pixels.canvas.width * PIXEL_SCALE, pixels.canvas.height * PIXEL_SCALE,
      );
      ctx.restore();
    }
  }

  private getSeatedBody(sprite: HTMLImageElement, rect: PhotoRect): HTMLCanvasElement | undefined {
    if (this.bodyTexture) return this.bodyTexture;
    const [x, y, width, height] = rect;
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    const patch = document.createElement('canvas');
    patch.width = Math.max(1, Math.round(width * 0.30));
    patch.height = Math.max(1, Math.round(height * 0.23));
    const fur = patch.getContext('2d');
    if (!ctx || !fur) return undefined;
    ctx.drawImage(sprite, ...rect, 0, 0, width, height);
    ctx.globalCompositeOperation = 'source-atop';

    // Cover the two painted-in paws with nearby flank fur. The articulated paws
    // can then occupy those positions at rest and leave them when they lift.
    for (const side of [-1, 1]) {
      fur.clearRect(0, 0, patch.width, patch.height);
      fur.save();
      const flankX = x + width * (0.42 + side * 0.26);
      fur.drawImage(sprite, flankX, y + height * 0.70, width * 0.16, height * 0.16,
        0, 0, patch.width, patch.height);
      fur.setTransform(patch.width / 2, 0, 0, patch.height / 2, patch.width / 2, patch.height / 2);
      const mask = fur.createRadialGradient(0, 0, 0.7, 0, 0, 1);
      mask.addColorStop(0, '#000');
      mask.addColorStop(1, '#0000');
      fur.globalCompositeOperation = 'destination-in';
      fur.fillStyle = mask;
      fur.fillRect(-1, -1, 2, 2);
      fur.restore();
      ctx.drawImage(patch, width * (0.5 + side * (24 / 146)) - patch.width / 2, height * 0.90 - patch.height / 2);
    }
    // Tuck the original seated toes into the haunches. Keep the surrounding
    // coat in the patch so the ankle disappears gradually into the long fur.
    for (const side of [-1, 1]) {
      fur.clearRect(0, 0, patch.width, patch.height);
      const sourceCenter = width * (0.5 + side * 0.17);
      fur.drawImage(sprite, x + sourceCenter - patch.width / 2, y + height * 0.75,
        patch.width, patch.height, 0, 0, patch.width, patch.height);
      fur.save();
      fur.scale(patch.width, patch.height);
      const edge = fur.createRadialGradient(0.5, 0.64, 0.29, 0.5, 0.64, 0.50);
      edge.addColorStop(0, '#000');
      edge.addColorStop(1, '#0000');
      fur.globalCompositeOperation = 'destination-in';
      fur.fillStyle = edge;
      fur.fillRect(0, 0, 1, 1);
      fur.restore();

      ctx.save();
      ctx.translate(width * (0.5 + side * 0.325), height * 0.886);
      ctx.rotate(-side * 0.24);
      ctx.globalAlpha = 0.93;
      ctx.drawImage(patch, -patch.width * 0.44, -patch.height * 0.48,
        patch.width * 0.88, patch.height * 0.74);
      ctx.restore();
    }
    this.bodyTexture = canvas;
    return canvas;
  }

  private getTailTexture(sprite: HTMLImageElement, rect: PhotoRect): HTMLCanvasElement | undefined {
    const { tailColor, tailTipColor } = this;
    if (!tailColor || !tailTipColor || !CSS.supports('color', tailColor) || !CSS.supports('color', tailTipColor)) {
      return undefined;
    }
    if (this.tailTexture) return this.tailTexture;

    const canvas = document.createElement('canvas');
    const [, , width, height] = rect;
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return undefined;
    const plume = this.photo?.rig?.tailRootRight && !this.photo.rig.frontTail;
    const sections: { centre: number; radius: number }[] = [];
    if (plume) {
      // Let the base sit low, then lift the plume and level out before the rounded tip.
      // The source tapers sharply, so measure the fur bounds before resampling it.
      ctx.drawImage(sprite, ...rect, 0, 0, width, height);
      const pixels = ctx.getImageData(0, 0, width, height).data;
      ctx.clearRect(0, 0, width, height);
      for (let x = 0; x < width; x++) {
        const t = 1 - (x + 0.5) / width; // root to tip
        const sampleX = Math.round((0.12 + (1 - t) * 0.76) * (width - 1));
        let top = 0;
        let bottom = height - 1;
        while (top < height && pixels[(top * width + sampleX) * 4 + 3] < 40) top++;
        while (bottom >= top && pixels[(bottom * width + sampleX) * 4 + 3] < 40) bottom--;
        if (top > bottom) continue;
        const lift = Math.max(0, Math.min(1, (t - 0.24) / 0.62));
        const sweep = lift * lift * (3 - 2 * lift);
        const centre = height * (0.80 + 0.028 * Math.sin(Math.PI * t) - 0.50 * sweep);
        const cap = Math.max(0, (t - 0.85) / 0.15);
        const radius = height * (0.16 + 0.055 * sweep) * Math.sqrt(1 - cap * cap);
        sections[x] = { centre, radius };
        ctx.drawImage(sprite, rect[0] + sampleX, rect[1] + top, 1, bottom - top + 1,
          x, centre - radius, 1, 2 * radius);
      }
    } else {
      ctx.drawImage(sprite, ...rect, 0, 0, width, height);
    }

    // Tint only the tail silhouette. The original fur's light and shade remain visible.
    const rootRight = this.photo?.rig?.tailRootRight;
    const coat = ctx.createLinearGradient(rootRight ? width : 0, height * 0.8, rootRight ? 0 : width, height * 0.2);
    coat.addColorStop(plume ? 0.46 : 0.08, tailColor);
    coat.addColorStop(0.95, tailTipColor);
    ctx.globalCompositeOperation = 'source-atop';
    ctx.globalAlpha = plume ? 0.78 : 0.56;
    ctx.fillStyle = coat;
    ctx.fillRect(0, 0, width, height);
    if (plume) {
      // The upper guard hairs catch the light, above a darker layer underneath.
      const shade = ctx.createLinearGradient(0, 0, 0, 1);
      shade.addColorStop(0, tailTipColor);
      shade.addColorStop(0.38, tailColor);
      shade.addColorStop(0.62, tailColor);
      shade.addColorStop(1, tailTipColor);
      sections.forEach(({ centre, radius }, x) => {
        ctx.save();
        ctx.translate(x, centre - radius);
        ctx.scale(1, 2 * radius);
        ctx.fillStyle = shade;
        ctx.globalAlpha = 0.28 + 0.26 * x / width;
        ctx.fillRect(0, 0, 1, 1);
        ctx.restore();
      });
      // Lay tapered locks along the existing spine. The silhouette clips every
      // stroke, including at the tip, and this material is cached between frames.
      for (let i = 0; i < 85; i++) {
        const x = (i * 37 + 17) % width;
        const endX = Math.max(0, x - Math.round(width * (0.10 + (i % 7) * 0.018)));
        const midX = Math.round((x + endX) / 2);
        const start = sections[x], mid = sections[midX], end = sections[endX];
        if (!start || !mid || !end || x === endX) continue;
        const band = ((i * 29) % 47) / 23 - 1;
        const middleY = mid.centre + mid.radius * (band - 0.08);
        ctx.fillStyle = i % 3 === 0 ? tailTipColor : tailColor;
        ctx.globalAlpha = (i % 3 === 0 ? 0.24 : 0.43) * (0.25 + 0.75 * x / width);
        ctx.beginPath();
        ctx.moveTo(x, start.centre + start.radius * band);
        ctx.quadraticCurveTo(midX, middleY - 1.6, endX, end.centre + end.radius * (band + 0.12));
        ctx.quadraticCurveTo(midX, middleY + 1.6, x, start.centre + start.radius * band);
        ctx.fill();
      }
    }
    this.tailTexture = canvas;
    return canvas;
  }

  private drawOriginalForeleg(
    ctx: CanvasRenderingContext2D, shoulder: ForelegPose['shoulder'], leg: ForelegPose, showRest: boolean,
  ): void {
    const rest = showRest ? leg.restWeight : 0;
    const opacity = showRest ? 1 - rest * 0.22 : 1 - leg.restWeight;
    const { x: sx, y: sy } = shoulder;
    const { x: px, y: py } = leg.target;
    const dx = px - sx;
    const dy = py - sy;
    const length = Math.hypot(dx, dy);
    if (opacity < 0.02 || length < 1) return;

    const curl = leg.curl ?? 0;
    const squash = leg.squash ?? 0;
    const ux = dx / length;
    const uy = dy / length;
    const materials = this.getOriginalPawMaterials(ctx);
    const mitten = materials?.mitten;
    const rootWidth = (mitten ? 14.5 : 11) - curl * 2;
    const wristWidth = 7 + rest * 1.2;
    const pawWidth = 10.5 + squash * 1.5;
    const pawLength = 10 - squash;
    const bend = leg.side * (Math.min(6, length * 0.04) + curl * 19);
    const wrist = Math.max(0, length - 8);
    const coat = materials?.sleeve;
    if (!coat) return;

    const shape = new Path2D();
    shape.moveTo(-rootWidth, 0);
    if (mitten) {
      // The upper arm rounds over the elbow, then narrows into the wrist.
      // The textured toes sit on the same contact point as the original input target.
      const elbow = bend - leg.side * Math.min(16, length * 0.14) * (1 - rest * 0.85);
      const elbowWidth = 11.5 - rest * 1.2;
      const elbowY = length * 0.5;
      const wristY = Math.max(elbowY, length - 3);
      shape.bezierCurveTo(-rootWidth - 3, length * 0.23, elbow - elbowWidth, length * 0.36, elbow - elbowWidth, elbowY);
      shape.quadraticCurveTo(elbow - wristWidth, length * 0.69, -wristWidth, wristY);
      shape.quadraticCurveTo(0, wristY + 4, wristWidth, wristY);
      shape.quadraticCurveTo(elbow + wristWidth, length * 0.69, elbow + elbowWidth, elbowY);
      shape.bezierCurveTo(elbow + elbowWidth, length * 0.36, rootWidth + 3, length * 0.23, rootWidth, 0);
    } else {
      shape.quadraticCurveTo(bend - rootWidth, length * 0.52, -wristWidth, wrist);
      shape.bezierCurveTo(-pawWidth - 1, length, -pawWidth, length + pawLength, 0, length + pawLength);
      shape.bezierCurveTo(pawWidth, length + pawLength, pawWidth + 1, length, wristWidth, wrist);
      shape.quadraticCurveTo(bend + rootWidth, length * 0.52, rootWidth, 0);
    }
    shape.closePath();

    ctx.save();
    ctx.globalAlpha *= showRest ? opacity : Math.min(1, opacity * 1.4);
    ctx.translate(sx, sy);
    const angle = Math.atan2(-ux, uy);
    ctx.rotate(angle);
    // The material follows the same local coordinates as the silhouette.
    const coatScale = Math.max(length / 64, pawLength / 31);
    coat.setTransform(new DOMMatrix([1, 0, 0, coatScale, -16, length - 96 * coatScale]));
    ctx.fillStyle = coat;
    ctx.fill(shape);
    const edge = ctx.createLinearGradient(0, 0, 0, length);
    edge.addColorStop(0.15, 'rgba(83, 61, 54, 0)');
    edge.addColorStop(1, 'rgba(83, 61, 54, 0.46)');
    ctx.strokeStyle = edge;
    ctx.lineWidth = 1.15;
    ctx.stroke(shape);
    if (mitten) {
      const width = 37 - rest * 8 + squash * 2;
      const height = 24 - rest * 4 - squash * 1.8;
      ctx.translate(0, length);
      // Let the paw flatten against the desk as the foreleg reaches across it.
      ctx.rotate(-angle * 0.62 * (1 - rest));
      ctx.drawImage(mitten, -width / 2, -height * 0.58, width, height);
    } else if (rest > 0.02) {
      ctx.globalAlpha *= rest;
      ctx.strokeStyle = 'rgba(104, 73, 57, 0.42)';
      ctx.lineWidth = 0.9;
      ctx.lineCap = 'round';
      ctx.beginPath();
      for (const toeX of [-2.6, 2.6]) {
        ctx.moveTo(toeX, length + pawLength * 0.38);
        ctx.lineTo(toeX, length + pawLength * 0.75);
      }
      ctx.stroke();
    }
    ctx.restore();
  }

  private getOriginalPawMaterials(ctx: CanvasRenderingContext2D): PawMaterials | undefined {
    const rig = this.photo?.rig;
    const sprite = this.sprite;
    if (!rig?.originalPaws || !sprite || !this.ready) return undefined;
    if (this.pawMaterials?.context === ctx) return this.pawMaterials;

    const tile = ([x, y, w, h]: PhotoRect, verticalStart: number, verticalSize: number) => {
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(w * 0.24));
      canvas.height = Math.max(1, Math.round(h * verticalSize));
      const tileCtx = canvas.getContext('2d');
      if (!tileCtx) return null;
      tileCtx.fillStyle = '#ead8c9';
      tileCtx.fillRect(0, 0, canvas.width, canvas.height);
      tileCtx.drawImage(
        sprite, Math.round(x + (w - canvas.width) / 2), Math.round(y + h * verticalStart),
        canvas.width, canvas.height, 0, 0, canvas.width, canvas.height,
      );
      return ctx.createPattern(canvas, 'repeat');
    };
    const arm = tile(rig.upperLeg, 0.28, 0.21);
    const paw = tile(rig.foreleg, 0.79, 0.11);
    this.pawMaterials = { context: ctx, arm, paw };
    if (rig.roundPaws) {
      this.pawMaterials.mitten = this.createMittenTexture(sprite, rig.foreleg);
    }
    if (arm && paw) {
      const strip = document.createElement('canvas');
      strip.width = 32;
      strip.height = 128;
      const brush = strip.getContext('2d');
      if (brush) {
        brush.fillStyle = arm;
        brush.fillRect(0, 0, 32, 128);
        brush.fillStyle = paw;
        const center = rig.twoToneForelegs ? 63 : 88;
        // Feather the color transition and the shoulder where it overlaps the chest.
        for (let x = 0; x < 32; x++) {
          const boundary = center + 1.7 * Math.cos(x * Math.PI / 8) + Math.sin(x * Math.PI / 4);
          for (let y = Math.floor(boundary); y < center + 6; y++) {
            brush.globalAlpha = Math.min(1, Math.max(0, (y - boundary + 1) / 4));
            brush.fillRect(x, y, 1, 1);
          }
        }
        brush.globalAlpha = 1;
        brush.fillRect(0, center + 6, 32, 128 - center - 6);
        brush.globalCompositeOperation = 'destination-in';
        const shoulderFade = brush.createLinearGradient(0, 32, 0, 48);
        shoulderFade.addColorStop(0, '#0000');
        shoulderFade.addColorStop(1, '#000');
        brush.fillStyle = shoulderFade;
        brush.fillRect(0, 0, 32, 128);
        this.pawMaterials.sleeve = ctx.createPattern(strip, 'repeat-x');
      }
    }
    return this.pawMaterials;
  }

  private createMittenTexture(
    sprite: HTMLImageElement, [x, y, width, height]: PhotoRect,
  ): HTMLCanvasElement | undefined {
    const canvas = document.createElement('canvas');
    const top = Math.floor(height * 0.77);
    canvas.width = width;
    canvas.height = height - top;
    const ctx = canvas.getContext('2d');
    if (!ctx) return undefined;
    ctx.drawImage(sprite, x, y + top, width, canvas.height, 0, 0, width, canvas.height);
    const wristOverlap = ctx.createLinearGradient(0, 0, 0, canvas.height * 0.27);
    wristOverlap.addColorStop(0, '#0000');
    wristOverlap.addColorStop(1, '#000');
    ctx.globalCompositeOperation = 'destination-in';
    ctx.fillStyle = wristOverlap;
    ctx.fillRect(0, 0, width, canvas.height);
    return canvas;
  }

  private getPixelContext(width: number, height: number): CanvasRenderingContext2D | undefined {
    if (!this.pixelContext) {
      this.pixelContext = document.createElement('canvas').getContext('2d') ?? undefined;
    }
    const context = this.pixelContext;
    if (context && (context.canvas.width !== width / PIXEL_SCALE || context.canvas.height !== height / PIXEL_SCALE)) {
      context.canvas.width = width / PIXEL_SCALE;
      context.canvas.height = height / PIXEL_SCALE;
      context.imageSmoothingEnabled = false;
    }
    return context;
  }

  private createEyelidPatches(
    sprite: HTMLImageElement, eyes: CatPhoto['eyes'], [sourceX, sourceY, sourceWidth, sourceHeight]: PhotoRect,
  ): HTMLCanvasElement[] {
    const sampleCanvas = document.createElement('canvas');
    sampleCanvas.width = 2;
    sampleCanvas.height = 2;
    const sample = sampleCanvas.getContext('2d', { willReadFrequently: true });
    if (!sample) return [];
    return eyes.map(eye => {
      const canvas = document.createElement('canvas');
      canvas.width = 48;
      canvas.height = 32;
      const patch = canvas.getContext('2d');
      if (!patch) return canvas;

      // Average fur on either side of the lid. Stretching an image of the brow
      // preserves its dark stripes and creates a cross over the lid.
      const bands = [
        Math.max(0, eye.y - eye.ry * 1.65),
        Math.min(1 - 1 / sourceHeight, eye.y + eye.ry * 1.04),
      ];
      const sampleWidth = eye.rx * 0.56;
      sample.clearRect(0, 0, 2, 2);
      for (const [index, side] of [-1, 1].entries()) {
        const x = Math.max(0, Math.min(1 - sampleWidth, eye.x + eye.rx * side * 0.62 - sampleWidth / 2));
        for (const [row, y] of bands.entries()) {
          sample.drawImage(sprite, sourceX + x * sourceWidth, sourceY + y * sourceHeight,
            sampleWidth * sourceWidth, Math.min(1 - y, eye.ry * 0.55) * sourceHeight, index, row, 1, 1);
        }
      }
      const swatches = sample.getImageData(0, 0, 2, 2).data;
      const color = (offset: number): string | null => {
        const top = swatches[offset + 3] * 0.55;
        const bottom = swatches[offset + 11] * 0.45;
        if (top + bottom === 0) return null;
        const rgb = [0, 1, 2].map(channel =>
          Math.round((swatches[offset + channel] * top + swatches[offset + channel + 8] * bottom) / (top + bottom)));
        return `rgb(${rgb.join(', ')})`;
      };
      const left = color(0);
      const right = color(4);
      if (!left && !right) return canvas;
      const coat = patch.createLinearGradient(0, 0, canvas.width, 0);
      const fallback = left ?? right ?? 'transparent';
      coat.addColorStop(0, left ?? fallback);
      coat.addColorStop(1, right ?? fallback);
      patch.fillStyle = coat;
      patch.fillRect(0, 0, canvas.width, canvas.height);

      patch.setTransform(canvas.width / 2, 0, 0, canvas.height / 2, canvas.width / 2, canvas.height / 2);
      patch.globalCompositeOperation = 'destination-in';
      const mask = patch.createRadialGradient(0, 0, 0.8, 0, 0, 1);
      mask.addColorStop(0, '#000');
      mask.addColorStop(1, '#0000');
      patch.fillStyle = mask;
      patch.fillRect(-1, -1, 2, 2);
      return canvas;
    });
  }

  private drawEyes(
    ctx: CanvasRenderingContext2D, sprite: HTMLImageElement, eyes: CatPhoto['eyes'],
    source: PhotoRect, w: number, h: number, closedness: number,
  ): void {
    if (closedness <= 0.04) return;
    const patches = this.eyelidPatches ??= this.createEyelidPatches(sprite, eyes, source);
    for (const [index, eye] of eyes.entries()) {
      const cx = w * eye.x;
      const cy = h * eye.y;
      const rx = w * eye.rx;
      const ry = h * eye.ry;
      const patchRx = rx * 1.32;
      const patchRy = ry * 1.4;
      const top = cy - patchRy;
      const cover = patchRy * 2 * closedness;
      const patch = patches[index];
      if (!patch) continue;
      ctx.save();
      ctx.beginPath();
      ctx.rect(cx - patchRx, top, patchRx * 2, cover);
      ctx.clip();
      ctx.drawImage(patch, cx - patchRx, top, patchRx * 2, patchRy * 2);
      ctx.restore();
      const lidY = Math.min(cy + ry * 0.22, top + cover);
      ctx.save();
      ctx.globalAlpha *= Math.min(1, closedness * 2);
      ctx.strokeStyle = 'rgba(68, 44, 34, 0.76)';
      ctx.lineWidth = this.photo?.pixelArt ? 1.35 : Math.max(0.8, h / 210);
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(cx - rx * 0.78, lidY - ry * 0.2);
      ctx.quadraticCurveTo(cx, lidY + ry * 0.38, cx + rx * 0.78, lidY - ry * 0.2);
      ctx.stroke();
      ctx.restore();
    }
  }
}
