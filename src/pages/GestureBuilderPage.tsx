import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react';
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

const MIN_ELEMENT_WIDTH = 60;
const MIN_ELEMENT_HEIGHT = 36;

interface FileSystemFileHandle {
  getFile: () => Promise<File>;
}

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
  if (phase === 'lost') {
    return {
      title: 'Marker tracking lost',
      body: 'Show the red marker to move the cursor. Hold it over a target for 0.6 seconds to click.',
    };
  }

  return null;

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
  const {
    videoRef,
    maskCanvasRef,
    contourCanvasRef,
    state: tracking,
    thresholds,
    setThresholds,
  } = useOpenCvHandTracking();
  const canvasRef = useRef<HTMLDivElement | null>(null);
  const imageInputRef = useRef<HTMLInputElement | null>(null);
  const [elements, setElements] = useState<BuilderElement[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [typingId, setTypingId] = useState<string | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [resizingId, setResizingId] = useState<string | null>(null);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  const [resizeOffset, setResizeOffset] = useState({ x: 0, y: 0 });
  const [resizeMode, setResizeMode] = useState(false);
  const [finalMode, setFinalMode] = useState(false);
  const [dwellProgress, setDwellProgress] = useState(0);
  const [gestureState, setGestureState] = useState('Waiting');
  const hoverRef = useRef<{ target: string; point: CursorPoint; startedAt: number } | null>(null);
  const lastClickAtRef = useRef(0);
  const markerScaleRef = useRef<{
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

  const bringElementToFront = useCallback((elementId: string) => {
    setElements((current) => {
      const element = current.find((item) => item.id === elementId);
      if (!element) return current;
      return [...current.filter((item) => item.id !== elementId), element];
    });
  }, []);

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
    if (key === 'Done') {
      setTypingId(null);
      setGestureState('Typing done');
      return;
    }

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

  const updateSelectedText = useCallback((text: string) => {
    setElements((current) =>
      current.map((element) => (element.id === selectedId && element.type === 'text' ? { ...element, text } : element)),
    );
    setGestureState('Typing');
  }, [selectedId]);

  const loadImageFile = useCallback((file: File) => {
    if (!selectedId) return;

    const reader = new FileReader();
    reader.onload = () => {
      const imageSrc = typeof reader.result === 'string' ? reader.result : '';
      if (!imageSrc) return;
      setElements((current) =>
        current.map((element) =>
          element.id === selectedId && element.type === 'image'
            ? { ...element, imageSrc, text: file.name.replace(/\.[^.]+$/, '') || 'Image' }
            : element,
        ),
      );
      setGestureState('Image loaded');
    };
    reader.readAsDataURL(file);
  }, [selectedId]);

  const openImagePicker = useCallback(async () => {
    if (selectedElement?.type !== 'image') {
      setGestureState('Select an image first');
      return;
    }

    try {
      const picker = (window as typeof window & {
        showOpenFilePicker?: (options?: object) => Promise<FileSystemFileHandle[]>;
      }).showOpenFilePicker;

      if (picker) {
        const [handle] = await picker({
          multiple: false,
          types: [
            {
              description: 'Images',
              accept: { 'image/*': ['.png', '.jpg', '.jpeg', '.gif', '.webp'] },
            },
          ],
        });
        const file = await handle.getFile();
        loadImageFile(file);
        return;
      }
    } catch {
      setGestureState('Image picker blocked');
    }

    imageInputRef.current?.click();
  }, [loadImageFile, selectedElement?.type]);

  const handleImageFileChange = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    loadImageFile(file);
    event.target.value = '';
  }, [loadImageFile]);

  const runAction = useCallback(
    (target: GestureTarget, cursor: CursorPoint | null) => {
      if (target.kind === 'tool') {
        if (target.value === 'done') {
          setFinalMode(true);
          setSelectedId(null);
          setDraggingId(null);
          setResizingId(null);
          setResizeMode(false);
          setDwellProgress(0);
          setGestureState('Final view');
          markerScaleRef.current = null;
          return;
        }
        if (target.value.startsWith('add:')) {
          addElement(target.value.replace('add:', '') as BuilderElementType, cursor);
          setResizeMode(false);
          setResizingId(null);
          markerScaleRef.current = null;
          return;
        }
        if (target.value === 'resize') {
          if (selectedId) {
            setDraggingId(null);
            setResizingId(null);
            markerScaleRef.current = null;
            setResizeMode((current) => {
              const next = !current;
              setGestureState(next ? 'Resize mode on / grab corner handle' : 'Resize mode off');
              return next;
            });
          } else {
            setGestureState('Select an element first');
          }
          return;
        }
        if (target.value === 'upload-image') {
          openImagePicker();
          return;
        }
        if (target.value === 'delete') {
          if (selectedId) {
            setElements((current) => current.filter((element) => element.id !== selectedId));
            setDraggingId(null);
            setResizeMode(false);
            setResizingId(null);
            markerScaleRef.current = null;
            setSelectedId(null);
            setGestureState('Deleted');
          }
          return;
        }
        if (target.value === 'clear') {
          setElements([]);
          setSelectedId(null);
          setDraggingId(null);
          setResizingId(null);
          setResizeMode(false);
          markerScaleRef.current = null;
          setGestureState('Canvas cleared');
        }
        return;
      }

      if (target.kind === 'resize-handle') {
        if (resizingId === target.value) {
          setResizingId(null);
          setGestureState('Resize placed');
          markerScaleRef.current = null;
          return;
        }

        const canvasRect = canvasRef.current?.getBoundingClientRect();
        const element = elements.find((item) => item.id === target.value);
        if (!canvasRect || !element || !cursor) return;
        const local = viewportToLocal(cursor, canvasRect);
        setSelectedId(element.id);
        bringElementToFront(element.id);
        setDraggingId(null);
        setResizingId(element.id);
        setResizeMode(true);
        markerScaleRef.current = null;
        setResizeOffset({
          x: local.x - (element.x + element.width),
          y: local.y - (element.y + element.height),
        });
        setGestureState('Resizing / hold handle 0.6s to place');
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
        bringElementToFront(element.id);
        setTypingId(element.type === 'text' ? element.id : null);
        if (resizeMode) {
          setDraggingId(null);
          setResizingId(null);
          markerScaleRef.current = null;
          setGestureState('Resize mode / grab corner handle');
          return;
        }
        setDraggingId(element.id);
        setResizeMode(false);
        setResizingId(null);
        markerScaleRef.current = null;
        setDragOffset({ x: local.x - element.x, y: local.y - element.y });
        setGestureState(element.type === 'text' ? 'Selected / Typing' : 'Dragging / hold 0.6s to place');
        return;
      }

      if (target.kind === 'key') {
        updateText(target.value);
      }
    },
    [addElement, bringElementToFront, draggingId, elements, openImagePicker, resizeMode, resizingId, selectedId, updateText],
  );

  useEffect(() => {
    const cursor = tracking.cursor;

    if (!cursor) {
      hoverRef.current = null;
      setDwellProgress(0);
      setGestureState(tracking.cameraStatus === 'camera-on' ? 'No Hand' : 'Waiting');
      return;
    }

    if (resizeMode && selectedElement && tracking.resizeDistance && !resizingId) {
      const canvasRect = canvasRef.current?.getBoundingClientRect();

      if (canvasRect) {
        setDraggingId(null);
        hoverRef.current = null;
        setDwellProgress(0);

        if (!markerScaleRef.current || markerScaleRef.current.elementId !== selectedElement.id) {
          markerScaleRef.current = {
            elementId: selectedElement.id,
            startDistance: tracking.resizeDistance,
            startWidth: selectedElement.width,
            startHeight: selectedElement.height,
            centerX: selectedElement.x + selectedElement.width / 2,
            centerY: selectedElement.y + selectedElement.height / 2,
          };
        }

        const scale = clamp(tracking.resizeDistance / markerScaleRef.current.startDistance, 0.45, 2.5);
        const nextWidth = clamp(markerScaleRef.current.startWidth * scale, MIN_ELEMENT_WIDTH, canvasRect.width - 8);
        const nextHeight = clamp(markerScaleRef.current.startHeight * scale, MIN_ELEMENT_HEIGHT, canvasRect.height - 8);

        setElements((current) =>
          current.map((element) =>
            element.id === selectedElement.id
              ? {
                  ...element,
                  width: nextWidth,
                  height: nextHeight,
                  x: clamp(markerScaleRef.current!.centerX - nextWidth / 2, 4, canvasRect.width - nextWidth - 4),
                  y: clamp(markerScaleRef.current!.centerY - nextHeight / 2, 4, canvasRect.height - nextHeight - 4),
                }
              : element,
          ),
        );
        setGestureState('Marker resize / red-green distance');
        return;
      }
    } else if (!tracking.resizeDistance) {
      markerScaleRef.current = null;
    }

    if (resizingId) {
      const canvasRect = canvasRef.current?.getBoundingClientRect();
      const resizingElement = elements.find((element) => element.id === resizingId);
      if (canvasRect && resizingElement) {
        const local = viewportToLocal(cursor, canvasRect);
        setElements((current) =>
          current.map((element) => {
            if (element.id !== resizingId) return element;
            const nextWidth = clamp(
              local.x - resizeOffset.x - element.x,
              MIN_ELEMENT_WIDTH,
              canvasRect.width - element.x - 4,
            );
            const nextHeight = clamp(
              local.y - resizeOffset.y - element.y,
              MIN_ELEMENT_HEIGHT,
              canvasRect.height - element.y - 4,
            );
            return { ...element, width: nextWidth, height: nextHeight };
          }),
        );
      }
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
      setGestureState(
        resizingId
          ? 'Resizing / hold handle 0.6s to place'
          : draggingId
            ? 'Dragging / hold 0.6s to place'
            : 'Tracking',
      );
      return;
    }

    if (!hover || hover.target !== targetKey || distance(hover.point, cursor) > DWELL.hoverResetDistance) {
      hoverRef.current = { target: targetKey, point: cursor, startedAt: now };
      setDwellProgress(0);
      setGestureState(
        resizingId
          ? 'Resizing / hold handle 0.6s to place'
          : draggingId
            ? 'Dragging / hold 0.6s to place'
            : 'Hover',
      );
      return;
    }

    const progress = clamp((now - hover.startedAt) / DWELL.clickMs, 0, 1);
    setDwellProgress(progress);
      setGestureState(
        progress >= 1
          ? resizingId
            ? 'Resize placed'
            : draggingId
            ? 'Placed'
            : 'Dwell Click'
          : resizingId
            ? 'Resizing / hold handle 0.6s to place'
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
    resizeOffset.x,
    resizeOffset.y,
    resizingId,
    resizeMode,
    runAction,
    selectedElement,
    tracking.cameraStatus,
    tracking.cursor,
    tracking.handPoints,
    tracking.resizeDistance,
  ]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setDraggingId(null);
        setResizingId(null);
        setResizeMode(false);
        markerScaleRef.current = null;
        setGestureState('Dropped');
      }
      if (selectedElement?.type === 'text' && event.target === document.body) {
        if (event.key === 'Backspace') {
          event.preventDefault();
          updateText('Backspace');
          return;
        }
        if (event.key === 'Enter') {
          event.preventDefault();
          updateText('Enter');
          return;
        }
        if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
          event.preventDefault();
          updateText(event.key);
          return;
        }
      }
      if (event.key === 'Delete' && selectedId && event.target === document.body) {
        setElements((current) => current.filter((element) => element.id !== selectedId));
        setSelectedId(null);
        setDraggingId(null);
        setResizingId(null);
        setResizeMode(false);
        markerScaleRef.current = null;
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [selectedElement?.type, selectedId, updateText]);

  return (
    <main className={`gesture-builder ${finalMode ? 'final-mode' : ''}`}>
      <header className="app-header">
        <div>
          <p>OpenCV.js Computer Vision Team Project</p>
          <h1>Hand Gesture Web Builder</h1>
        </div>
      </header>

      <div className={finalMode ? 'final-layout' : 'builder-layout'}>
        {!finalMode && (
        <Toolbar canUploadImage={selectedElement?.type === 'image'} onUploadImage={openImagePicker} />
        )}

        <section className="workspace">
          <div
            className="web-canvas"
            ref={canvasRef}
            data-gesture-kind="canvas"
            data-gesture-value="canvas"
          >
            <div className="canvas-title">White Web Page Canvas</div>
            {!finalMode && (
              <button
                type="button"
                className="done-button canvas-done-button"
                data-gesture-kind="tool"
                data-gesture-value="done"
                onClick={() => {
                  setFinalMode(true);
                  setSelectedId(null);
                  setDraggingId(null);
                  setResizingId(null);
                  setResizeMode(false);
                  markerScaleRef.current = null;
                  setGestureState('Final view');
                }}
              >
                Done
              </button>
            )}
            {elements.map((element) => (
              <CanvasElement
                key={element.id}
                element={element}
                selected={!finalMode && element.id === selectedId}
                dragging={!finalMode && element.id === draggingId}
                resizeHandleActive={!finalMode && resizeMode && element.id === selectedId}
                interactive={!finalMode}
              />
            ))}
            {elements.length === 0 && (
              <div className="empty-canvas">
                손가락 커서를 도구 버튼 위에 0.6초 머물러 요소를 추가하세요.
              </div>
            )}
            {false && (
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
            <VirtualKeyboard
              visible={!finalMode && selectedElement?.type === 'text' && typingId === selectedElement.id}
              value={selectedElement?.type === 'text' ? selectedElement.text : ''}
            />
          </div>

          {!finalMode && selectedElement?.type === 'text' && (
            <label className="text-editor-bar">
              <span>Text input</span>
              <textarea
                value={selectedElement.text}
                onChange={(event) => updateSelectedText(event.target.value)}
                rows={2}
              />
            </label>
          )}
        </section>

        {!finalMode && (
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
            thresholds={thresholds}
            onThresholdChange={setThresholds}
          />
        </aside>
        )}
      </div>

      {!finalMode && <GestureCursor cursor={tracking.cursor} progress={dwellProgress} active={tracking.handDetected} />}
      <input
        ref={imageInputRef}
        type="file"
        accept="image/*"
        className="hidden-file-input"
        onChange={handleImageFileChange}
      />
      {calibrationMessage && (
        <div className="calibration-overlay">
          <div className="calibration-card">
            <span className="status-pill good">
              Red marker: cursor
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
