import type { BuilderElement } from '../types/builder';
import type { CSSProperties } from 'react';

interface CanvasElementProps {
  element: BuilderElement;
  selected: boolean;
  dragging: boolean;
  resizeHandleActive?: boolean;
  interactive?: boolean;
}

export function CanvasElement({
  element,
  selected,
  dragging,
  resizeHandleActive = false,
  interactive = true,
}: CanvasElementProps) {
  const style = {
    left: element.x,
    top: element.y,
    width: element.width,
    height: element.height,
    ...(element.imageSrc
      ? {
          backgroundImage: `url(${element.imageSrc})`,
          backgroundSize: 'cover',
          backgroundPosition: 'center',
        }
      : {}),
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
      ) : element.type === 'image' && element.imageSrc ? (
        <span className="image-label">{element.text}</span>
      ) : (
        <span>{element.text}</span>
      )}
      {selected && resizeHandleActive && (
        <span
          className="resize-handle"
          data-gesture-kind="resize-handle"
          data-gesture-value={element.id}
          aria-hidden="true"
        />
      )}
    </div>
  );
}
