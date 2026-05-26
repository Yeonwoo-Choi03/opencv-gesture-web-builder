import { useCallback, useEffect, useRef, useState } from 'react';
import { CAMERA_HEIGHT, CAMERA_WIDTH, HAND_DETECTION, OPENCV_SCRIPT_URL } from '../constants/gesture';
import { clamp } from '../utils/geometry';
import type { CursorPoint } from '../types/builder';

type CameraStatus = 'idle' | 'loading-opencv' | 'camera-on' | 'camera-error';
type TrackingPhase = 'loading' | 'tracking' | 'lost';
type MarkerName = 'red' | 'green';

interface MarkerDetection {
  center: CursorPoint;
  area: number;
  rect: { x: number; y: number; width: number; height: number };
}

interface CvRuntime {
  mat: any;
  rgb: any;
  hsv: any;
  markerMask: any;
  combinedMask: any;
  hierarchy: any;
  contours: any;
  kernel: any;
  cap: any;
}

export interface HandTrackingState {
  cameraStatus: CameraStatus;
  cameraError: string;
  phase: TrackingPhase;
  phaseCountdownMs: number;
  registrationBox: { x: number; y: number; width: number; height: number };
  registeredHand: boolean;
  handDetected: boolean;
  handCount: number;
  handPoints: CursorPoint[];
  contourDetected: boolean;
  fingertipEstimated: boolean;
  cursor: CursorPoint | null;
  lastSeenAt: number;
  resizeDistance: number | null;
}

export interface SkinThresholdConfig {
  crMin: number;
  crMax: number;
  cbMin: number;
  cbMax: number;
  hueMax: number;
  saturationMin: number;
}

export const DEFAULT_SKIN_THRESHOLDS: SkinThresholdConfig = {
  crMin: HAND_DETECTION.yCrCbLower[1],
  crMax: HAND_DETECTION.yCrCbUpper[1],
  cbMin: HAND_DETECTION.yCrCbLower[2],
  cbMax: HAND_DETECTION.yCrCbUpper[2],
  hueMax: HAND_DETECTION.hsvUpper[0],
  saturationMin: HAND_DETECTION.hsvLower[1],
};

const MARKER = {
  minArea: 18,
  maxArea: 2200,
  resizeMinDistance: 36,
  smoothingWindow: 12,
  cursorDeadzone: 10,
  noMarkerGraceMs: 850,
  redRanges: [
    { lower: [0, 135, 105, 0], upper: [8, 255, 255, 255] },
    { lower: [172, 135, 105, 0], upper: [179, 255, 255, 255] },
  ],
  greenRanges: [{ lower: [48, 105, 80, 0], upper: [82, 255, 255, 255] }],
} as const;

function loadOpenCv() {
  if (window.cv?.Mat) {
    return Promise.resolve();
  }

  return new Promise<void>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>('script[data-opencv]');
    if (existing) {
      window.onOpenCvReady = () => resolve();
      return;
    }

    const script = document.createElement('script');
    script.src = OPENCV_SCRIPT_URL;
    script.async = true;
    script.dataset.opencv = 'true';
    script.onload = () => {
      if (window.cv?.Mat) {
        resolve();
        return;
      }
      window.cv = window.cv || {};
      window.cv.onRuntimeInitialized = () => resolve();
    };
    script.onerror = () => reject(new Error('OpenCV.js failed to load.'));
    document.body.appendChild(script);
  });
}

function average(points: CursorPoint[]) {
  const sum = points.reduce(
    (acc, point) => ({ x: acc.x + point.x, y: acc.y + point.y }),
    { x: 0, y: 0 },
  );
  return { x: sum.x / points.length, y: sum.y / points.length };
}

function cameraPointToViewport(point: CursorPoint) {
  return {
    x: clamp((point.x / CAMERA_WIDTH) * window.innerWidth, 0, window.innerWidth),
    y: clamp((point.y / CAMERA_HEIGHT) * window.innerHeight, 0, window.innerHeight),
  };
}

function emptyRegistrationBox() {
  return { x: 0, y: 0, width: 0, height: 0 };
}

function findLargestMarker(cv: any, runtime: CvRuntime, ranges: readonly { lower: readonly number[]; upper: readonly number[] }[]) {
  runtime.markerMask.setTo(new cv.Scalar(0, 0, 0, 0));

  ranges.forEach((range) => {
    const lower = new cv.Mat(runtime.hsv.rows, runtime.hsv.cols, runtime.hsv.type(), range.lower);
    const upper = new cv.Mat(runtime.hsv.rows, runtime.hsv.cols, runtime.hsv.type(), range.upper);
    const partial = new cv.Mat();
    cv.inRange(runtime.hsv, lower, upper, partial);
    cv.bitwise_or(runtime.markerMask, partial, runtime.markerMask);
    lower.delete();
    upper.delete();
    partial.delete();
  });

  cv.GaussianBlur(runtime.markerMask, runtime.markerMask, new cv.Size(5, 5), 0);
  cv.morphologyEx(runtime.markerMask, runtime.markerMask, cv.MORPH_CLOSE, runtime.kernel);
  cv.dilate(runtime.markerMask, runtime.markerMask, runtime.kernel);
  cv.morphologyEx(runtime.markerMask, runtime.markerMask, cv.MORPH_OPEN, runtime.kernel);
  cv.bitwise_or(runtime.combinedMask, runtime.markerMask, runtime.combinedMask);

  runtime.contours.delete();
  runtime.hierarchy.delete();
  runtime.contours = new cv.MatVector();
  runtime.hierarchy = new cv.Mat();
  cv.findContours(runtime.markerMask, runtime.contours, runtime.hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);

  let best: MarkerDetection | null = null;
  for (let i = 0; i < runtime.contours.size(); i += 1) {
    const contour = runtime.contours.get(i);
    const area = cv.contourArea(contour);
    if (area >= MARKER.minArea && area <= MARKER.maxArea && (!best || area > best.area)) {
      const rect = cv.boundingRect(contour);
      best = {
        area,
        rect,
        center: { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 },
      };
    }
    contour.delete();
  }

  return best;
}

function drawMarker(cv: any, debug: any, marker: MarkerDetection | null, name: MarkerName) {
  if (!marker) return;

  const color =
    name === 'red'
      ? new cv.Scalar(239, 68, 68, 255)
      : new cv.Scalar(34, 197, 94, 255);

  cv.rectangle(
    debug,
    new cv.Point(marker.rect.x, marker.rect.y),
    new cv.Point(marker.rect.x + marker.rect.width, marker.rect.y + marker.rect.height),
    color,
    2,
  );
  cv.circle(debug, new cv.Point(marker.center.x, marker.center.y), 6, color, -1);
}

export function useOpenCvHandTracking() {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const maskCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const contourCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const runtimeRef = useRef<CvRuntime | null>(null);
  const animationRef = useRef<number | null>(null);
  const smoothedPointsRef = useRef<CursorPoint[]>([]);
  const lastCursorRef = useRef<CursorPoint | null>(null);
  const lastSeenAtRef = useRef(0);
  const [thresholds, setThresholds] = useState<SkinThresholdConfig>(DEFAULT_SKIN_THRESHOLDS);

  const [state, setState] = useState<HandTrackingState>({
    cameraStatus: 'idle',
    cameraError: '',
    phase: 'loading',
    phaseCountdownMs: 0,
    registrationBox: emptyRegistrationBox(),
    registeredHand: true,
    handDetected: false,
    handCount: 0,
    handPoints: [],
    contourDetected: false,
    fingertipEstimated: false,
    cursor: null,
    lastSeenAt: 0,
    resizeDistance: null,
  });

  const resetTrackingMemory = useCallback(() => {
    smoothedPointsRef.current = [];
    lastCursorRef.current = null;
    lastSeenAtRef.current = 0;
  }, []);

  const disposeRuntime = useCallback(() => {
    const runtime = runtimeRef.current;
    if (!runtime) return;

    Object.values(runtime).forEach((value) => {
      if (value?.delete) value.delete();
    });
    runtimeRef.current = null;
  }, []);

  const ensureRuntime = useCallback(() => {
    if (runtimeRef.current) return runtimeRef.current;
    const cv = window.cv;
    const runtime: CvRuntime = {
      mat: new cv.Mat(CAMERA_HEIGHT, CAMERA_WIDTH, cv.CV_8UC4),
      rgb: new cv.Mat(),
      hsv: new cv.Mat(),
      markerMask: new cv.Mat(CAMERA_HEIGHT, CAMERA_WIDTH, cv.CV_8UC1),
      combinedMask: new cv.Mat(CAMERA_HEIGHT, CAMERA_WIDTH, cv.CV_8UC1),
      hierarchy: new cv.Mat(),
      contours: new cv.MatVector(),
      kernel: cv.Mat.ones(5, 5, cv.CV_8U),
      cap: new cv.VideoCapture(videoRef.current),
    };
    runtimeRef.current = runtime;
    return runtime;
  }, []);

  const processFrame = useCallback(() => {
    const cv = window.cv;
    const video = videoRef.current;
    const maskCanvas = maskCanvasRef.current;
    const contourCanvas = contourCanvasRef.current;

    if (!cv?.Mat || !video || video.readyState < 2 || !maskCanvas || !contourCanvas) {
      animationRef.current = requestAnimationFrame(processFrame);
      return;
    }

    const runtime = ensureRuntime();
    runtime.cap.read(runtime.mat);
    cv.flip(runtime.mat, runtime.mat, 1);
    cv.cvtColor(runtime.mat, runtime.rgb, cv.COLOR_RGBA2RGB);
    cv.cvtColor(runtime.rgb, runtime.hsv, cv.COLOR_RGB2HSV);
    runtime.combinedMask.setTo(new cv.Scalar(0, 0, 0, 0));

    // HSV marker segmentation: red is cursor, green controls resize distance.
    const red = findLargestMarker(cv, runtime, MARKER.redRanges);
    const green = findLargestMarker(cv, runtime, MARKER.greenRanges);

    const debug = cv.Mat.zeros(CAMERA_HEIGHT, CAMERA_WIDTH, cv.CV_8UC4);
    drawMarker(cv, debug, red, 'red');
    drawMarker(cv, debug, green, 'green');

    let cursor: CursorPoint | null = null;
    let resizeDistance: number | null = null;
    const handPoints: CursorPoint[] = [];

    if (red) {
      const redViewport = cameraPointToViewport(red.center);
      handPoints.push(redViewport);
      smoothedPointsRef.current = [...smoothedPointsRef.current, redViewport].slice(-MARKER.smoothingWindow);
      cursor = average(smoothedPointsRef.current);
      if (lastCursorRef.current && Math.hypot(cursor.x - lastCursorRef.current.x, cursor.y - lastCursorRef.current.y) < MARKER.cursorDeadzone) {
        cursor = lastCursorRef.current;
      }
      lastCursorRef.current = cursor;
      lastSeenAtRef.current = performance.now();
    }

    if (red && green) {
      const greenViewport = cameraPointToViewport(green.center);
      handPoints.push(greenViewport);
      resizeDistance = Math.hypot(red.center.x - green.center.x, red.center.y - green.center.y);
      cv.line(
        debug,
        new cv.Point(red.center.x, red.center.y),
        new cv.Point(green.center.x, green.center.y),
        new cv.Scalar(34, 197, 94, 255),
        2,
      );
    }

    const now = performance.now();
    const withinGrace = now - lastSeenAtRef.current <= MARKER.noMarkerGraceMs;
    if (!cursor && withinGrace) {
      cursor = lastCursorRef.current;
    }
    if (!withinGrace) {
      resetTrackingMemory();
    }

    cv.imshow(maskCanvas, runtime.combinedMask);
    cv.imshow(contourCanvas, debug);
    debug.delete();

    const markerCount = [red, green].filter(Boolean).length;
    setState({
      cameraStatus: 'camera-on',
      cameraError: '',
      phase: cursor || withinGrace ? 'tracking' : 'lost',
      phaseCountdownMs: 0,
      registrationBox: emptyRegistrationBox(),
      registeredHand: true,
      handDetected: Boolean(cursor || withinGrace),
      handCount: markerCount,
      handPoints,
      contourDetected: Boolean(red || green),
      fingertipEstimated: Boolean(red),
      cursor,
      lastSeenAt: lastSeenAtRef.current,
      resizeDistance: resizeDistance && resizeDistance >= MARKER.resizeMinDistance ? resizeDistance : null,
    });

    animationRef.current = requestAnimationFrame(processFrame);
  }, [ensureRuntime, resetTrackingMemory]);

  const start = useCallback(async () => {
    try {
      setState((current) => ({ ...current, cameraStatus: 'loading-opencv', cameraError: '' }));
      await loadOpenCv();
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: CAMERA_WIDTH, height: CAMERA_HEIGHT, facingMode: 'user' },
        audio: false,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      animationRef.current = requestAnimationFrame(processFrame);
    } catch (error) {
      setState((current) => ({
        ...current,
        cameraStatus: 'camera-error',
        cameraError: error instanceof Error ? error.message : 'Camera could not start.',
      }));
    }
  }, [processFrame]);

  useEffect(() => {
    void start();
    return () => {
      if (animationRef.current) cancelAnimationFrame(animationRef.current);
      streamRef.current?.getTracks().forEach((track) => track.stop());
      disposeRuntime();
    };
  }, [disposeRuntime, start]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() !== 'r') return;
      resetTrackingMemory();
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [resetTrackingMemory]);

  return {
    videoRef,
    maskCanvasRef,
    contourCanvasRef,
    state,
    thresholds,
    setThresholds,
  };
}
