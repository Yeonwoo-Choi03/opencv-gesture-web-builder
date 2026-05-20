import { useCallback, useEffect, useRef, useState } from 'react';
import { CAMERA_HEIGHT, CAMERA_WIDTH, HAND_DETECTION, OPENCV_SCRIPT_URL } from '../constants/gesture';
import { clamp } from '../utils/geometry';
import type { CursorPoint } from '../types/builder';

type CameraStatus = 'idle' | 'loading-opencv' | 'camera-on' | 'camera-error';

export interface HandTrackingState {
  cameraStatus: CameraStatus;
  cameraError: string;
  handDetected: boolean;
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

function average(points: CursorPoint[]) {
  const sum = points.reduce(
    (acc, point) => ({ x: acc.x + point.x, y: acc.y + point.y }),
    { x: 0, y: 0 },
  );
  return { x: sum.x / points.length, y: sum.y / points.length };
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
  const lastHandCameraRef = useRef<CursorPoint | null>(null);
  const lastSeenAtRef = useRef(0);

  const [state, setState] = useState<HandTrackingState>({
    cameraStatus: 'idle',
    cameraError: '',
    handDetected: false,
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

    let bestContour: any = null;
    let bestScore = Number.NEGATIVE_INFINITY;
    let bestCenter: CursorPoint | null = null;
    for (let i = 0; i < runtime.contours.size(); i += 1) {
      const contour = runtime.contours.get(i);
      const area = cv.contourArea(contour);
      if (area < HAND_DETECTION.minContourArea || area > HAND_DETECTION.maxContourArea) {
        contour.delete();
        continue;
      }

      const rect = cv.boundingRect(contour);
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
      if (score > bestScore) {
        if (bestContour) bestContour.delete();
        bestScore = score;
        bestCenter = center;
        bestContour = contour;
      } else {
        contour.delete();
      }
    }

    const debug = cv.Mat.zeros(CAMERA_HEIGHT, CAMERA_WIDTH, cv.CV_8UC4);
    let cursor: CursorPoint | null = null;
    let fingertipEstimated = false;
    let contourDetected = false;

    if (bestContour) {
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
          x: clamp((tipX / CAMERA_WIDTH) * window.innerWidth, 0, window.innerWidth),
          y: clamp((tipY / CAMERA_HEIGHT) * window.innerHeight, 0, window.innerHeight),
        };

        smoothedPointsRef.current = [...smoothedPointsRef.current, viewportPoint].slice(
          -HAND_DETECTION.smoothingWindow,
        );
        cursor = average(smoothedPointsRef.current);
        lastCursorRef.current = cursor;
        lastHandCameraRef.current = bestCenter;
        lastSeenAtRef.current = performance.now();
      }

      hull.delete();
      hullList.delete();
      contourList.delete();
    }

    if (bestContour) bestContour.delete();

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

  return {
    videoRef,
    maskCanvasRef,
    contourCanvasRef,
    state,
  };
}
