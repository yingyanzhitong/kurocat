import type { PhotoRect, PhotoRig } from './catSkins';

interface Point {
  x: number;
  y: number;
}

export interface ForelegPose {
  shoulder: Point;
  target: Point;
  side: -1 | 1;
  restWeight: number;
  curl?: number;
  squash?: number;
}

function bodyDeformation(rig: PhotoRig, pose: CatRigPose): Point {
  const { hips, chest, head, headTilt } = pose;
  if (!rig.joinedNeck) return { x: (hips.x - chest.x) / 150, y: 1 };
  const neckX = head.x - Math.sin(headTilt) * 28;
  const neckY = head.y + Math.cos(headTilt) * 28;
  return { x: (hips.x - neckX) / 137, y: (hips.y - neckY) / 137 };
}

function bodyPoint(rig: PhotoRig, pose: CatRigPose, x: number, y: number): Point {
  const deformation = bodyDeformation(rig, pose);
  return {
    x: pose.hips.x + x + y * deformation.x,
    y: pose.hips.y + y * deformation.y,
  };
}

export function getPhotoShoulder(rig: PhotoRig, pose: CatRigPose, side: -1 | 1, rest = 0): Point {
  return bodyPoint(rig, pose, side * (35 - 7 * rest), -83 + 10 * rest);
}

export function getPhotoRestingFoot(rig: PhotoRig, pose: CatRigPose, side: -1 | 1): Point {
  return bodyPoint(rig, pose, side * 24, -14);
}

export interface CatRigPose {
  hips: Point;
  chest: Point;
  head: Point;
  headTilt: number;
  tailSwing: number;
  forelegs: [ForelegPose, ForelegPose];
}

export function drawRigPart(
  ctx: CanvasRenderingContext2D, atlas: CanvasImageSource, part: PhotoRect,
  x: number, y: number, width: number, height: number,
): void {
  ctx.drawImage(atlas, ...part, x, y, width, height);
}

function drawSegment(
  ctx: CanvasRenderingContext2D, atlas: HTMLImageElement, part: PhotoRect,
  start: Point, finish: Point, width: number, proximal: number, distal: number,
): void {
  const dx = finish.x - start.x;
  const dy = finish.y - start.y;
  const height = Math.hypot(dx, dy) / (distal - proximal);
  ctx.save();
  ctx.translate(start.x, start.y);
  ctx.rotate(Math.atan2(-dx, dy));
  drawRigPart(ctx, atlas, part, -width / 2, -height * proximal, width, height);
  ctx.restore();
}

function drawForeleg(
  ctx: CanvasRenderingContext2D, atlas: HTMLImageElement, rig: PhotoRig, pose: ForelegPose,
): void {
  const { shoulder, target, side } = pose;
  const dx = target.x - shoulder.x;
  const dy = target.y - shoulder.y;
  const distance = Math.hypot(dx, dy);
  if (distance < 1) return;

  // The projected leg shortens toward the chest, with a fixed reach limit.
  const reach = rig.classicPose ? Math.max(72, distance + 8) : Math.min(138, Math.max(52, distance + 8));
  const length = Math.min(distance, reach - 1);
  const ux = dx / distance;
  const uy = dy / distance;
  const along = length / 2;
  const tuckPaws = rig.classicPose || rig.tuckPaws;
  const restWeight = tuckPaws ? pose.restWeight : 0;
  const outside = Math.sqrt(reach * reach / 4 - along * along) * (1 - restWeight * 0.88);
  const elbow = {
    x: shoulder.x + ux * along + side * uy * outside,
    y: shoulder.y + uy * along - side * ux * outside,
  };
  const wrist = { x: shoulder.x + ux * length, y: shoulder.y + uy * length };
  ctx.save();
  ctx.globalAlpha *= 1 - restWeight * (rig.classicPose ? 0.18 : 0.6);
  drawSegment(ctx, atlas, rig.upperLeg, shoulder, elbow, 27 - restWeight * 4, 0.10, tuckPaws ? 0.82 : 0.86);
  ctx.restore();
  drawSegment(ctx, atlas, rig.foreleg, elbow, wrist, rig.classicPose ? 29 : 24, tuckPaws ? 0.17 : 0.12, 0.91);
}

export function drawCatRig(
  ctx: CanvasRenderingContext2D, atlas: HTMLImageElement, rig: PhotoRig, pose: CatRigPose,
  drawFace: (width: number, height: number) => void,
  drawOriginalPaws?: (ctx: CanvasRenderingContext2D) => void,
  textures?: { body?: HTMLCanvasElement; tail?: HTMLCanvasElement; headset?: (ctx: CanvasRenderingContext2D, front: boolean) => void },
): void {
  const { hips, head } = pose;
  const tailTexture = textures?.tail;
  const tailAtlas = tailTexture ?? atlas;
  const tailRect: PhotoRect = tailTexture ? [0, 0, tailTexture.width, tailTexture.height] : rig.tail;
  const thickness = Number.isFinite(rig.tailScale)
    ? Math.min(2, Math.max(1, rig.tailScale ?? 1))
    : 1;
  if (rig.classicPose && !rig.frontTail) {
    const root = bodyPoint(rig, pose, 40, -29);
    ctx.save();
    ctx.translate(root.x, root.y);
    ctx.rotate(pose.tailSwing);
    if (rig.tailRootRight) {
      // A shaped texture already contains the rise. The original tufted sprite
      // curves upward when pitched from its broad, right-hand root.
      if (!tailTexture) ctx.rotate(-0.58);
      ctx.scale(-1, 1);
      if (tailTexture) {
        drawRigPart(ctx, tailAtlas, tailRect, -100, -58 * thickness, 106, 72 * thickness);
      } else {
        drawRigPart(ctx, tailAtlas, tailRect, -88, -40 * thickness, 91, 58 * thickness);
      }
    } else {
      ctx.transform(1, (thickness - 1) * 0.36, 0, thickness, 0, -2 * (thickness - 1));
      drawRigPart(ctx, tailAtlas, tailRect, -8, -43, 95, 58);
    }
    ctx.restore();
  }

  ctx.save();
  const deformation = bodyDeformation(rig, pose);
  ctx.transform(1, 0, deformation.x, deformation.y, hips.x, hips.y);
  const body = textures?.body;
  const bodyRect: PhotoRect = body ? [0, 0, body.width, body.height] : rig.body;
  drawRigPart(ctx, body ?? atlas, bodyRect, -73, -148, 146, 150);
  ctx.restore();

  if (rig.frontTail) {
    // The source tip is on the left. Anchor the broad root at the right hip
    // and paint the foreground paws over the curl.
    ctx.save();
    ctx.translate(hips.x + 69, hips.y - 11);
    ctx.rotate(pose.tailSwing * 0.58);
    ctx.scale(1, thickness);
    drawRigPart(ctx, tailAtlas, tailRect, -93, -41, 99, 54);
    ctx.restore();
  } else if (!rig.classicPose) {
    ctx.save();
    ctx.translate(hips.x + 47, hips.y - 13);
    ctx.rotate(pose.tailSwing);
    ctx.scale(-1, 1);
    ctx.scale(1, thickness);
    drawRigPart(ctx, tailAtlas, tailRect, -7, -17, 103, 42);
    ctx.restore();
  }

  if (!drawOriginalPaws) {
    for (const foreleg of pose.forelegs) {
      drawForeleg(ctx, atlas, rig, foreleg);
    }
  }

  if (rig.collar) drawOriginalPaws?.(ctx);
  ctx.save();
  ctx.translate(head.x, head.y);
  ctx.rotate(pose.headTilt);
  if (rig.collar) drawRigPart(ctx, atlas, rig.collar, -75, 13, 150, 62);
  textures?.headset?.(ctx, false);
  ctx.save();
  ctx.translate(-58, -55);
  drawRigPart(ctx, atlas, rig.head, 0, 0, 116, 124);
  drawFace(116, 124);
  ctx.restore();
  textures?.headset?.(ctx, true);
  ctx.restore();
  if (!rig.collar) drawOriginalPaws?.(ctx);
}
