export type BuilderElementType =
  | 'header'
  | 'text'
  | 'button'
  | 'card'
  | 'image'
  | 'section';

export interface BuilderElement {
  id: string;
  type: BuilderElementType;
  x: number;
  y: number;
  width: number;
  height: number;
  text: string;
  imageSrc?: string;
  style?: Record<string, string | number>;
}

export interface CursorPoint {
  x: number;
  y: number;
}

export interface GestureTarget {
  kind: 'tool' | 'element' | 'resize-handle' | 'key' | 'canvas';
  value: string;
}
