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

function getCalibrationMessage(phase: string) {
  if (phase === 'background-calibration') {
    return {
      title: '배경 캘리브레이션 중',
      body: '손을 화면 밖으로 빼고 얼굴과 몸을 최대한 움직이지 마세요.',
    };
  }

  if (phase === 'hand-registration') {
    return {
      title: '손을 등록합니다',
      body: '초록색 박스 안에 손을 2초 동안 넣어주세요.',
    };
  }

  if (phase === 'lost') {
    return {
      title: '손 추적이 끊겼습니다',
      body: '손을 다시 움직이거나 R 키로 손만 다시 등록하세요.',
    };
  }

  return null;
}

export function GestureBuilderPage() {
  const { videoRef, maskCanvasRef, contourCanvasRef, state: tracking } = useOpenCvHandTracking();
  const canvasRef = useRef<HTMLDivElement | null>(null);
  const [elements, setElements] = useState<BuilderElement[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  const [resizeMode, setResizeMode] = useState(false);
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
  const calibrationMessage = getCalibrationMessage(tracking.phase);
  const countdownSeconds = Math.ceil(tracking.phaseCountdownMs / 1000);

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
          setResizeMode(false);
          scaleRef.current = null;
          return;
        }
        if (target.value === 'resize') {
          if (selectedId) {
            setDraggingId(null);
            scaleRef.current = null;
            setResizeMode((current) => {
              const next = !current;
              setGestureState(next ? 'Resize mode on' : 'Resize mode off');
              return next;
            });
          } else {
            setGestureState('Select an element first');
          }
          return;
        }
        if (target.value === 'delete') {
          if (selectedId) {
            setElements((current) => current.filter((element) => element.id !== selectedId));
            setDraggingId(null);
            setResizeMode(false);
            scaleRef.current = null;
            setSelectedId(null);
            setGestureState('Deleted');
          }
          return;
        }
        if (target.value === 'clear') {
          setElements([]);
          setSelectedId(null);
          setDraggingId(null);
          setResizeMode(false);
          scaleRef.current = null;
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
        setResizeMode(false);
        scaleRef.current = null;
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

    if (resizeMode && selectedElement && tracking.handPoints.length >= 2) {
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
        setResizeMode(false);
        scaleRef.current = null;
        setGestureState('Dropped');
      }
      if ((event.key === 'Delete' || event.key === 'Backspace') && selectedId && event.target === document.body) {
        setElements((current) => current.filter((element) => element.id !== selectedId));
        setSelectedId(null);
        setDraggingId(null);
        setResizeMode(false);
        scaleRef.current = null;
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
            {tracking.phase === 'hand-registration' && (
              <div
                className="registration-box"
                style={{
                  left: `${(tracking.registrationBox.x / 320) * 100}%`,
                  top: `${(tracking.registrationBox.y / 240) * 100}%`,
                  width: `${(tracking.registrationBox.width / 320) * 100}%`,
                  height: `${(tracking.registrationBox.height / 240) * 100}%`,
                }}
              />
            )}
          </div>

          <VirtualKeyboard visible={selectedElement?.type === 'text'} />
        </section>

        <aside className="right-rail">
          <CameraDebugPanel
            videoRef={videoRef}
            maskCanvasRef={maskCanvasRef}
            contourCanvasRef={contourCanvasRef}
            tracking={tracking}
          />
          <StatusPanel
            selectedElement={selectedElement}
            tracking={tracking}
            gestureState={gestureState}
            dwellProgress={dwellProgress}
            dragging={Boolean(draggingId)}
            resizeMode={resizeMode}
          />
        </aside>
      </div>

      <GestureCursor cursor={tracking.cursor} progress={dwellProgress} active={tracking.handDetected} />
      {calibrationMessage && (
        <div className="calibration-overlay">
          <div className="calibration-card">
            <span className="status-pill good">
              {tracking.phase === 'background-calibration' ? 'Shift + R: full reset' : 'R: hand registration'}
            </span>
            <h2>{calibrationMessage.title}</h2>
            <p>{calibrationMessage.body}</p>
            {tracking.phaseCountdownMs > 0 && <strong>{countdownSeconds}</strong>}
            <small>R: 손만 다시 등록 / Shift + R: 배경부터 다시 캘리브레이션</small>
          </div>
        </div>
      )}
    </main>
  );
}
