import type { CursorPoint } from '../types/builder';

interface GestureCursorProps {
  cursor: CursorPoint | null;
  progress: number;
  active: boolean;
}

export function GestureCursor({ cursor, progress, active }: GestureCursorProps) {
  if (!cursor) return null;

  const degree = Math.round(progress * 360);

  return (
    <div
      className={`gesture-cursor ${active ? 'active' : ''}`}
      style={{
        transform: `translate(${cursor.x}px, ${cursor.y}px)`,
        background: `conic-gradient(#2563eb ${degree}deg, rgba(37, 99, 235, 0.14) ${degree}deg)`,
      }}
    >
      <span />
    </div>
  );
}
