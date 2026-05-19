import type { BuilderElement, BuilderElementType } from '../types/builder';

let nextId = 1;

const defaults: Record<BuilderElementType, Omit<BuilderElement, 'id' | 'type' | 'x' | 'y'>> = {
  header: {
    width: 620,
    height: 78,
    text: 'Website Header',
    style: {},
  },
  text: {
    width: 280,
    height: 58,
    text: 'Edit text',
    style: {},
  },
  button: {
    width: 150,
    height: 48,
    text: 'Button',
    style: {},
  },
  card: {
    width: 260,
    height: 170,
    text: 'Card Title\nShort description',
    style: {},
  },
  image: {
    width: 260,
    height: 160,
    text: 'Image',
    style: {},
  },
  section: {
    width: 600,
    height: 140,
    text: 'Rectangle Section',
    style: {},
  },
};

export function createBuilderElement(type: BuilderElementType, x: number, y: number): BuilderElement {
  const base = defaults[type];

  return {
    id: `element-${nextId++}`,
    type,
    x: Math.max(10, x - base.width / 2),
    y: Math.max(10, y - base.height / 2),
    ...base,
  };
}
