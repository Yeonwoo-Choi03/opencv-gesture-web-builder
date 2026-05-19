import type { CursorPoint } from '../types/builder';

export function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

export function distance(a: CursorPoint, b: CursorPoint) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export function pointInRect(point: CursorPoint, rect: DOMRect) {
  return (
    point.x >= rect.left &&
    point.x <= rect.right &&
    point.y >= rect.top &&
    point.y <= rect.bottom
  );
}

export function viewportToLocal(point: CursorPoint, rect: DOMRect) {
  return {
    x: clamp(point.x - rect.left, 0, rect.width),
    y: clamp(point.y - rect.top, 0, rect.height),
  };
}
