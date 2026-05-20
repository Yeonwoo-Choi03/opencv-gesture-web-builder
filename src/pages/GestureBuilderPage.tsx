import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CameraDebugPanel } from '../components/CameraDebugPanel';
import { CanvasElement } from '../components/CanvasElement';
import { GestureCursor } from '../components/GestureCursor';
import { StatusPanel } from '../components/StatusPanel';
import { Toolbar } from '../components/Toolbar';
import { VirtualKeyboard } from '../components/VirtualKeyboard';
import { DWELL } from '../constants/gesture';
import { useOpenCvHandTracking } from '../hooks/useOpenCvHandTracking';
import type { BuilderElement, BuilderElementType, CursorPoint, GestureTarget } from '../types/builder';
import { createBuilderElement } from '../utils/elements';
import { clamp, distance, pointInRect, viewportToLocal } from '../utils/geometry';

function readGestureTarget(cursor: CursorPoint): GestureTarget | null {
  const nodes = document.elementsFromPoint(cursor.x, cursor.y) as HTMLElement[];
  const node = nodes.find((element) => element.dataset?.gestureKind && element.dataset?.gestureValue);
  if (!node) return null;
  return {
    kind: node.dataset.gestureKind as GestureTarget['kind'],
    value: node.dataset.gestureValue ?? '',
  };
}

export function GestureBuilderPage() {
  const { videoRef, maskCanvasRef, contourCanvasRef, state: tracking } = useOpenCvHandTracking();
  const canvasRef = useRef<HTMLDivElement | null>(null);
  const [elements, setElements] = useState<BuilderElement[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  const [dwellProgress, setDwellProgress] = useState(0);
  const [gestureState, setGestureState] = useState('Waiting');
  const hoverRef = useRef<{ target: string; point: CursorPoint; startedAt: number } | null>(null);
  const lastClickAtRef = useRef(0);
  const scaleRef = useRef<{
    elementId: string;
    startDistance: number;
    startWidth: number;
    startHeight: number;
    centerX: number;
    centerY: number;
  } | null>(null);

  const selectedElement = useMemo(
    () => elements.find((element) => element.id === selectedId),
    [elements, selectedId],
  );

  const addElement = useCallback((type: BuilderElementType, cursor: CursorPoint | null) => {
    const canvasRect = canvasRef.current?.getBoundingClientRect();
    if (!canvasRect) return;

    const basePoint =
      cursor && pointInRect(cursor, canvasRect)
        ? viewportToLocal(cursor, canvasRect)
        : { x: canvasRect.width / 2, y: 120 + Math.min(280, elements.length * 22) };

    const element = createBuilderElement(type, basePoint.x, basePoint.y);
    element.x = clamp(element.x, 8, Math.max(8, canvasRect.width - element.width - 8));
    element.y = clamp(element.y, 8, Math.max(8, canvasRect.height - element.height - 8));

    setElements((current) => [...current, element]);
    setSelectedId(element.id);
    setGestureState(`Added ${type}`);
  }, [elements.length]);

  const updateText = useCallback((key: string) => {
    setElements((current) =>
      current.map((element) => {
        if (element.id !== selectedId || element.type !== 'text') return element;
        if (key === 'Backspace') return { ...element, text: element.text.slice(0, -1) };
        if (key === 'Space') return { ...element, text: `${element.text} ` };
        if (key === 'Enter') return { ...element, text: `${element.text}\n` };
        return { ...element, text: element.text === 'Edit text' ? key : `${element.text}${key}` };
      }),
    );
    setGestureState('Typing');
  }, [selectedId]);

  const runAction = useCallback(
    (target: GestureTarget, cursor: CursorPoint | null) => {
      if (target.kind === 'tool') {
        if (target.value.startsWith('add:')) {
          addElement(target.value.replace('add:', '') as BuilderElementType, cursor);
          return;
        }
        if (target.value === 'delete') {
          if (selectedId) {
            setElements((current) => current.filter((element) => element.id !== selectedId));
            setDraggingId(null);
            setSelectedId(null);
            setGestureState('Deleted');
          }
          return;
        }
        if (target.value === 'clear') {
          setElements([]);
          setSelectedId(null);
          setDraggingId(null);
          setGestureState('Canvas cleared');
        }
        return;
      }

      if (target.kind === 'element') {
        if (draggingId === target.value) {
          setDraggingId(null);
          setGestureState('Dropped');
          return;
        }

        const canvasRect = canvasRef.current?.getBoundingClientRect();
        const element = elements.find((item) => item.id === target.value);
        if (!canvasRect || !element || !cursor) return;
        const local = viewportToLocal(cursor, canvasRect);
        setSelectedId(element.id);
        setDraggingId(element.id);
        setDragOffset({ x: local.x - element.x, y: local.y - element.y });
        setGestureState(element.type === 'text' ? 'Selected / Typing' : 'Dragging / hold 0.6s to place');
        return;
      }

      if (target.kind === 'key') {
        updateText(target.value);
      }
    },
    [addElement, draggingId, elements, selectedId, updateText],
  );

  useEffect(() => {
    const cursor = tracking.cursor;

    if (selectedElement && tracking.handPoints.length >= 2) {
      const canvasRect = canvasRef.current?.getBoundingClientRect();
      const currentDistance = distance(tracking.handPoints[0], tracking.handPoints[1]);

      if (canvasRect && currentDistance > 40) {
        setDraggingId(null);
        hoverRef.current = null;
        setDwellProgress(0);

        if (!scaleRef.current || scaleRef.current.elementId !== selectedElement.id) {
          scaleRef.current = {
            elementId: selectedElement.id,
            startDistance: currentDistance,
            startWidth: selectedElement.width,
            startHeight: selectedElement.height,
            centerX: selectedElement.x + selectedElement.width / 2,
            centerY: selectedElement.y + selectedElement.height / 2,
          };
        }

        const scale = clamp(currentDistance / scaleRef.current.startDistance, 0.45, 2.4);
        const nextWidth = clamp(scaleRef.current.startWidth * scale, 60, canvasRect.width - 8);
        const nextHeight = clamp(scaleRef.current.startHeight * scale, 36, canvasRect.height - 8);

        setElements((current) =>
          current.map((element) =>
            element.id === selectedElement.id
              ? {
                  ...element,
                  width: nextWidth,
                  height: nextHeight,
                  x: clamp(scaleRef.current!.centerX - nextWidth / 2, 4, canvasRect.width - nextWidth - 4),
                  y: clamp(scaleRef.current!.centerY - nextHeight / 2, 4, canvasRect.height - nextHeight - 4),
                }
              : element,
          ),
        );
        setGestureState('Scaling / spread or pinch hands');
        return;
      }
    } else {
      scaleRef.current = null;
    }

    if (!cursor) {
      hoverRef.current = null;
      setDwellProgress(0);
      setGestureState(tracking.cameraStatus === 'camera-on' ? 'No Hand' : 'Waiting');
      return;
    }

    if (draggingId) {
      const canvasRect = canvasRef.current?.getBoundingClientRect();
      const draggingElement = elements.find((element) => element.id === draggingId);
      if (canvasRect && draggingElement) {
        const local = viewportToLocal(cursor, canvasRect);
        setElements((current) =>
          current.map((element) =>
            element.id === draggingId
              ? {
                  ...element,
                  x: clamp(local.x - dragOffset.x, 4, canvasRect.width - element.width - 4),
                  y: clamp(local.y - dragOffset.y, 4, canvasRect.height - element.height - 4),
                }
              : element,
          ),
        );
      }
    }

    const target = readGestureTarget(cursor);
    const targetKey = target ? `${target.kind}:${target.value}` : 'none';
    const now = performance.now();
    const hover = hoverRef.current;

    if (!target) {
      hoverRef.current = null;
      setDwellProgress(0);
      setGestureState(draggingId ? 'Dragging / hold 0.6s to place' : 'Tracking');
      return;
    }

    if (!hover || hover.target !== targetKey || distance(hover.point, cursor) > DWELL.hoverResetDistance) {
      hoverRef.current = { target: targetKey, point: cursor, startedAt: now };
      setDwellProgress(0);
      setGestureState(draggingId ? 'Dragging / hold 0.6s to place' : 'Hover');
      return;
    }

    const progress = clamp((now - hover.startedAt) / DWELL.clickMs, 0, 1);
    setDwellProgress(progress);
      setGestureState(
        progress >= 1
          ? draggingId
            ? 'Placed'
            : 'Dwell Click'
          : draggingId
            ? 'Dragging / hold 0.6s to place'
            : 'Dwell Clicking',
      );

    if (progress >= 1 && now - lastClickAtRef.current > DWELL.cooldownMs) {
      lastClickAtRef.current = now;
      hoverRef.current = { target: targetKey, point: cursor, startedAt: now + DWELL.cooldownMs };
      setDwellProgress(0);
      runAction(target, cursor);
    }
  }, [
    dragOffset.x,
    dragOffset.y,
    draggingId,
    elements,
    runAction,
    selectedElement,
    tracking.cameraStatus,
    tracking.cursor,
    tracking.handPoints,
  ]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setDraggingId(null);
        setGestureState('Dropped');
      }
      if ((event.key === 'Delete' || event.key === 'Backspace') && selectedId && event.target === document.body) {
        setElements((current) => current.filter((element) => element.id !== selectedId));
        setSelectedId(null);
        setDraggingId(null);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [selectedId]);

  return (
    <main className="gesture-builder">
      <header className="app-header">
        <div>
          <p>OpenCV.js Computer Vision Team Project</p>
          <h1>Hand Gesture Web Builder</h1>
        </div>
        <a className="preview-link" href="#preview">Preview</a>
      </header>

      <div className="builder-layout">
        <Toolbar />

        <section className="workspace">
          <div
            className="web-canvas"
            ref={canvasRef}
            data-gesture-kind="canvas"
            data-gesture-value="canvas"
          >
            <div className="canvas-title">White Web Page Canvas</div>
            {elements.map((element) => (
              <CanvasElement
                key={element.id}
                element={element}
                selected={element.id === selectedId}
                dragging={element.id === draggingId}
              />
            ))}
            {elements.length === 0 && (
              <div className="empty-canvas">
                손가락 커서를 도구 버튼 위에 0.6초 머물러 요소를 추가하세요.
              </div>
            )}
          </div>

          <VirtualKeyboard visible={selectedElement?.type === 'text'} />

          <section className="panel preview-panel" id="preview">
            <div className="panel-heading">
              <h2>Page Preview</h2>
              <span className="status-pill">{elements.length} elements</span>
            </div>
            <div className="preview-surface">
              {elements.map((element) => (
                <CanvasElement
                  key={`preview-${element.id}`}
                  element={{ ...element, x: element.x * 0.42, y: element.y * 0.42, width: element.width * 0.42, height: element.height * 0.42 }}
                  selected={false}
                  dragging={false}
                  interactive={false}
                />
              ))}
            </div>
          </section>
        </section>

        <aside className="right-rail">
          <StatusPanel
            selectedElement={selectedElement}
            tracking={tracking}
            gestureState={gestureState}
            dwellProgress={dwellProgress}
            dragging={Boolean(draggingId)}
          />
          <CameraDebugPanel
            videoRef={videoRef}
            maskCanvasRef={maskCanvasRef}
            contourCanvasRef={contourCanvasRef}
            tracking={tracking}
          />
        </aside>
      </div>

      <GestureCursor cursor={tracking.cursor} progress={dwellProgress} active={tracking.handDetected} />
    </main>
  );
}
