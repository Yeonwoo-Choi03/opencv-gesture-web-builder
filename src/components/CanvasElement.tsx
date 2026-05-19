import type { BuilderElement } from '../types/builder';
import type { CSSProperties } from 'react';

interface CanvasElementProps {
  element: BuilderElement;
  selected: boolean;
  dragging: boolean;
  interactive?: boolean;
}

export function CanvasElement({ element, selected, dragging, interactive = true }: CanvasElementProps) {
  const style = {
    left: element.x,
    top: element.y,
    width: element.width,
    height: element.height,
    ...element.style,
  } as CSSProperties;

  return (
    <div
      className={`canvas-element canvas-element-${element.type} ${selected ? 'selected' : ''} ${
        dragging ? 'dragging' : ''
      }`}
      style={style}
      data-gesture-kind={interactive ? 'element' : undefined}
      data-gesture-value={interactive ? element.id : undefined}
    >
      {element.type === 'card' ? (
        <>
          <strong>{element.text.split('\n')[0]}</strong>
          <span>{element.text.split('\n').slice(1).join(' ') || 'Short description'}</span>
        </>
      ) : (
        <span>{element.text}</span>
      )}
    </div>
  );
}
