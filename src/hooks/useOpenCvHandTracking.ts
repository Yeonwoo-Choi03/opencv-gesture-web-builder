import { useCallback, useEffect, useRef, useState } from 'react';
import {
  CAMERA_HEIGHT,
  CAMERA_WIDTH,
  FACE_CASCADE_FILE,
  FACE_CASCADE_URL,
  HAND_DETECTION,
  OPENCV_SCRIPT_URL,
} from '../constants/gesture';
import { clamp } from '../utils/geometry';
import type { CursorPoint } from '../types/builder';

type CameraStatus = 'idle' | 'loading-opencv' | 'camera-on' | 'camera-error';

export interface HandTrackingState {
  cameraStatus: CameraStatus;
  cameraError: string;
  handDetected: boolean;
  handCount: number;
  handPoints: CursorPoint[];
  faceDetected: boolean;
  contourDetected: boolean;
  fingertipEstimated: boolean;
  cursor: CursorPoint | null;
  lastSeenAt: number;
}

interface CvRuntime {
  mat: any;
  rgb: any;
  gray: any;
  prevGray: any;
  frameDelta: any;
  hsv: any;
  ycrcb: any;
  hsvMask: any;
  skinMask: any;
  motionMask: any;
  movingSkinMask: any;
  cleanedMask: any;
  hierarchy: any;
  contours: any;
  faces: any;
  kernel: any;
  cap: any;
}

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

async function loadFaceCascade() {
  const cv = window.cv;
  const response = await fetch(FACE_CASCADE_URL);
  if (!response.ok) {
    throw new Error('Face cascade file failed to load.');
  }

  const data = new Uint8Array(await response.arrayBuffer());
  try {
    cv.FS_unlink(`/${FACE_CASCADE_FILE}`);
  } catch {
    // The file may not exist on first load.
  }
  cv.FS_createDataFile('/', FACE_CASCADE_FILE, data, true, false, false);

  const classifier = new cv.CascadeClassifier();
  if (!classifier.load(FACE_CASCADE_FILE)) {
    classifier.delete();
    throw new Error('Face cascade could not be initialized.');
  }
  return classifier;
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

function isHeadLikeContour(cv: any, contour: any, area: number, rect: any) {
  const hull = new cv.Mat();
  cv.convexHull(contour, hull, false, true);
  const hullArea = cv.contourArea(hull);
  hull.delete();

  const aspectRatio = rect.width / Math.max(1, rect.height);
  const extent = area / Math.max(1, rect.width * rect.height);
  const solidity = area / Math.max(1, hullArea);
  const centerY = rect.y + rect.height / 2;
  const head = HAND_DETECTION.headReject;

  // A face/head skin blob tends to be a large, compact oval in the upper frame.
  return (
    area >= head.minArea &&
    centerY <= CAMERA_HEIGHT * head.upperFrameRatio &&
    aspectRatio >= head.minAspectRatio &&
    aspectRatio <= head.maxAspectRatio &&
    solidity >= head.minSolidity &&
    extent >= head.minExtent
  );
}

function eraseFaceRegions(cv: any, mask: any, faces: any) {
  const faceRects: Array<{ x: number; y: number; width: number; height: number }> = [];
  for (let i = 0; i < faces.size(); i += 1) {
    const face = faces.get(i);
    const padding = HAND_DETECTION.facePadding;
    const x = clamp(face.x - padding, 0, CAMERA_WIDTH - 1);
    const y = clamp(face.y - padding, 0, CAMERA_HEIGHT - 1);
    const right = clamp(face.x + face.width + padding, 0, CAMERA_WIDTH);
    const bottom = clamp(face.y + face.height + padding, 0, CAMERA_HEIGHT);
    const width = Math.max(0, right - x);
    const height = Math.max(0, bottom - y);

    if (width > 0 && height > 0) {
      cv.rectangle(mask, new cv.Point(x, y), new cv.Point(x + width, y + height), new cv.Scalar(0, 0, 0, 0), -1);
      faceRects.push({ x, y, width, height });
    }
  }
  return faceRects;
}

export function useOpenCvHandTracking() {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const maskCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const contourCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const runtimeRef = useRef<CvRuntime | null>(null);
  const faceClassifierRef = useRef<any | null>(null);
  const animationRef = useRef<number | null>(null);
  const smoothedPointsRef = useRef<CursorPoint[]>([]);
  const lastCursorRef = useRef<CursorPoint | null>(null);
  const lastHandCameraRef = useRef<CursorPoint | null>(null);
  const lastSeenAtRef = useRef(0);

  const [state, setState] = useState<HandTrackingState>({
    cameraStatus: 'idle',
    cameraError: '',
    handDetected: false,
    handCount: 0,
    handPoints: [],
    faceDetected: false,
    contourDetected: false,
    fingertipEstimated: false,
    cursor: null,
    lastSeenAt: 0,
  });

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
      gray: new cv.Mat(),
      prevGray: new cv.Mat(),
      frameDelta: new cv.Mat(),
      hsv: new cv.Mat(),
      ycrcb: new cv.Mat(),
      hsvMask: new cv.Mat(),
      skinMask: new cv.Mat(),
      motionMask: new cv.Mat(CAMERA_HEIGHT, CAMERA_WIDTH, cv.CV_8UC1),
      movingSkinMask: new cv.Mat(CAMERA_HEIGHT, CAMERA_WIDTH, cv.CV_8UC1),
      cleanedMask: new cv.Mat(),
      hierarchy: new cv.Mat(),
      contours: new cv.MatVector(),
      faces: new cv.RectVector(),
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

    // HSV/YCrCb color conversion for skin segmentation.
    cv.cvtColor(runtime.mat, runtime.rgb, cv.COLOR_RGBA2RGB);
    cv.cvtColor(runtime.rgb, runtime.gray, cv.COLOR_RGB2GRAY);
    cv.GaussianBlur(runtime.gray, runtime.gray, new cv.Size(7, 7), 0);
    cv.cvtColor(runtime.rgb, runtime.hsv, cv.COLOR_RGB2HSV);
    cv.cvtColor(runtime.rgb, runtime.ycrcb, cv.COLOR_RGB2YCrCb);

    runtime.faces.delete();
    runtime.faces = new cv.RectVector();
    const faceClassifier = faceClassifierRef.current;
    if (faceClassifier && (typeof faceClassifier.empty !== 'function' || !faceClassifier.empty())) {
      faceClassifier.detectMultiScale(
        runtime.gray,
        runtime.faces,
        1.12,
        4,
        0,
        new cv.Size(46, 46),
        new cv.Size(180, 180),
      );
    }

    const hsvLower = new cv.Mat(runtime.hsv.rows, runtime.hsv.cols, runtime.hsv.type(), HAND_DETECTION.hsvLower);
    const hsvUpper = new cv.Mat(runtime.hsv.rows, runtime.hsv.cols, runtime.hsv.type(), HAND_DETECTION.hsvUpper);
    const skinLower = new cv.Mat(runtime.ycrcb.rows, runtime.ycrcb.cols, runtime.ycrcb.type(), HAND_DETECTION.yCrCbLower);
    const skinUpper = new cv.Mat(runtime.ycrcb.rows, runtime.ycrcb.cols, runtime.ycrcb.type(), HAND_DETECTION.yCrCbUpper);

    cv.inRange(runtime.hsv, hsvLower, hsvUpper, runtime.hsvMask);
    cv.inRange(runtime.ycrcb, skinLower, skinUpper, runtime.skinMask);
    cv.bitwise_and(runtime.hsvMask, runtime.skinMask, runtime.cleanedMask);
    cv.GaussianBlur(runtime.cleanedMask, runtime.cleanedMask, new cv.Size(5, 5), 0);
    // Morphology opening/closing removes small noise and fills the skin region.
    cv.morphologyEx(runtime.cleanedMask, runtime.cleanedMask, cv.MORPH_OPEN, runtime.kernel);
    cv.morphologyEx(runtime.cleanedMask, runtime.cleanedMask, cv.MORPH_CLOSE, runtime.kernel);
    // OpenCV Haar Cascade detects face boxes first; those skin regions are removed before hand contour search.
    const faceRects = eraseFaceRegions(cv, runtime.cleanedMask, runtime.faces);

    // Frame differencing is used as a selection hint, not as the final mask.
    // This keeps dwell click working while the hand is held still.
    if (runtime.prevGray.rows > 0) {
      cv.absdiff(runtime.gray, runtime.prevGray, runtime.frameDelta);
      cv.threshold(
        runtime.frameDelta,
        runtime.motionMask,
        HAND_DETECTION.motionThreshold,
        255,
        cv.THRESH_BINARY,
      );
      cv.morphologyEx(runtime.motionMask, runtime.motionMask, cv.MORPH_OPEN, runtime.kernel);
      cv.dilate(runtime.motionMask, runtime.motionMask, runtime.kernel);
      cv.bitwise_and(runtime.cleanedMask, runtime.motionMask, runtime.movingSkinMask);
    } else {
      runtime.movingSkinMask.setTo(new cv.Scalar(0, 0, 0, 0));
    }
    runtime.gray.copyTo(runtime.prevGray);

    hsvLower.delete();
    hsvUpper.delete();
    skinLower.delete();
    skinUpper.delete();

    runtime.contours.delete();
    runtime.hierarchy.delete();
    runtime.contours = new cv.MatVector();
    runtime.hierarchy = new cv.Mat();

    cv.findContours(runtime.cleanedMask, runtime.contours, runtime.hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);

    const candidates: Array<{ contour: any; score: number; center: CursorPoint; area: number }> = [];
    for (let i = 0; i < runtime.contours.size(); i += 1) {
      const contour = runtime.contours.get(i);
      const area = cv.contourArea(contour);
      if (area < HAND_DETECTION.minContourArea || area > HAND_DETECTION.maxContourArea) {
        contour.delete();
        continue;
      }

      const rect = cv.boundingRect(contour);
      if (isHeadLikeContour(cv, contour, area, rect)) {
        contour.delete();
        continue;
      }

      const center = { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
      const motionRoi = runtime.movingSkinMask.roi(rect);
      const motionRatio = cv.countNonZero(motionRoi) / Math.max(1, rect.width * rect.height);
      motionRoi.delete();

      const lastHand = lastHandCameraRef.current;
      const distFromLast = lastHand ? Math.hypot(center.x - lastHand.x, center.y - lastHand.y) : 0;
      const hasMotion = motionRatio >= HAND_DETECTION.minMotionRatio;
      const nearLastHand = Boolean(lastHand && distFromLast <= HAND_DETECTION.trackingMaxDistance);

      if (!hasMotion && !nearLastHand) {
        contour.delete();
        continue;
      }

      const score = motionRatio * 10000 + area * 0.02 - (lastHand ? distFromLast * 8 : 0);
      candidates.push({ contour, score, center, area });
    }

    candidates.sort((a, b) => b.score - a.score);
    const selectedCandidates = candidates.slice(0, 2);
    const bestCandidate = selectedCandidates[0];
    const handPoints = selectedCandidates.map((candidate) => cameraPointToViewport(candidate.center));

    const debug = cv.Mat.zeros(CAMERA_HEIGHT, CAMERA_WIDTH, cv.CV_8UC4);
    faceRects.forEach((face) => {
      cv.rectangle(
        debug,
        new cv.Point(face.x, face.y),
        new cv.Point(face.x + face.width, face.y + face.height),
        new cv.Scalar(239, 68, 68, 255),
        2,
      );
    });
    let cursor: CursorPoint | null = null;
    let fingertipEstimated = false;
    let contourDetected = false;

    selectedCandidates.forEach((candidate, index) => {
      const point = new cv.Point(candidate.center.x, candidate.center.y);
      cv.circle(
        debug,
        point,
        6,
        index === 0 ? new cv.Scalar(14, 165, 233, 255) : new cv.Scalar(168, 85, 247, 255),
        -1,
      );
    });

    if (bestCandidate) {
      const bestContour = bestCandidate.contour;
      contourDetected = true;
      const contourList = new cv.MatVector();
      contourList.push_back(bestContour);
      cv.drawContours(debug, contourList, 0, new cv.Scalar(44, 123, 229, 255), 2);

      const hull = new cv.Mat();
      cv.convexHull(bestContour, hull, false, true);
      const hullList = new cv.MatVector();
      hullList.push_back(hull);
      cv.drawContours(debug, hullList, 0, new cv.Scalar(22, 163, 74, 255), 1);

      // With the index finger raised, the topmost contour point is used as the fingertip candidate.
      let tipX = 0;
      let tipY = Number.POSITIVE_INFINITY;
      for (let i = 0; i < bestContour.data32S.length; i += 2) {
        const x = bestContour.data32S[i];
        const y = bestContour.data32S[i + 1];
        if (y < tipY) {
          tipX = x;
          tipY = y;
        }
      }

      if (Number.isFinite(tipY)) {
        fingertipEstimated = true;
        cv.circle(debug, new cv.Point(tipX, tipY), 7, new cv.Scalar(239, 68, 68, 255), -1);

        // Convert camera coordinates to viewport coordinates for the virtual cursor.
        const viewportPoint = {
          x: cameraPointToViewport({ x: tipX, y: tipY }).x,
          y: cameraPointToViewport({ x: tipX, y: tipY }).y,
        };

        smoothedPointsRef.current = [...smoothedPointsRef.current, viewportPoint].slice(
          -HAND_DETECTION.smoothingWindow,
        );
        cursor = average(smoothedPointsRef.current);
        lastCursorRef.current = cursor;
        lastHandCameraRef.current = bestCandidate.center;
        lastSeenAtRef.current = performance.now();
      }

      hull.delete();
      hullList.delete();
      contourList.delete();
    }

    candidates.forEach((candidate) => candidate.contour.delete());

    const now = performance.now();
    const withinGrace = now - lastSeenAtRef.current <= HAND_DETECTION.noHandGraceMs;
    if (!cursor && withinGrace) {
      cursor = lastCursorRef.current;
    }
    if (!withinGrace) {
      smoothedPointsRef.current = [];
      lastCursorRef.current = null;
      lastHandCameraRef.current = null;
    }

    cv.imshow(maskCanvas, runtime.movingSkinMask);
    cv.imshow(contourCanvas, debug);
    debug.delete();

    setState({
      cameraStatus: 'camera-on',
      cameraError: '',
      handDetected: contourDetected || withinGrace,
      handCount: handPoints.length,
      handPoints,
      faceDetected: faceRects.length > 0,
      contourDetected,
      fingertipEstimated,
      cursor,
      lastSeenAt: lastSeenAtRef.current,
    });

    animationRef.current = requestAnimationFrame(processFrame);
  }, [ensureRuntime]);

  const start = useCallback(async () => {
    try {
      setState((current) => ({ ...current, cameraStatus: 'loading-opencv', cameraError: '' }));
      await loadOpenCv();
      faceClassifierRef.current = await loadFaceCascade();
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
      faceClassifierRef.current?.delete();
      faceClassifierRef.current = null;
      disposeRuntime();
    };
  }, [disposeRuntime, start]);

  return {
    videoRef,
    maskCanvasRef,
    contourCanvasRef,
    state,
  };
}
