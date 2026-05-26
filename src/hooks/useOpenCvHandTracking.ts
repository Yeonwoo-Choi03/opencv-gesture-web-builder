import { useCallback, useEffect, useRef, useState } from 'react';
import {
  CAMERA_HEIGHT,
  CAMERA_WIDTH,
  HAND_DETECTION,
  OPENCV_SCRIPT_URL,
} from '../constants/gesture';
import { clamp } from '../utils/geometry';
import type { CursorPoint } from '../types/builder';

type CameraStatus = 'idle' | 'loading-opencv' | 'camera-on' | 'camera-error';
type TrackingPhase = 'loading' | 'background-calibration' | 'hand-registration' | 'tracking' | 'lost';

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
}

interface CvRuntime {
  mat: any;
  rgb: any;
  lab: any;
  labChannels: any;
  equalizedRgb: any;
  gray: any;
  prevGray: any;
  backgroundGray: any;
  backgroundSkinMask: any;
  backgroundSkinInverseMask: any;
  backgroundDelta: any;
  foregroundMask: any;
  foregroundSkinMask: any;
  frameDelta: any;
  hsv: any;
  ycrcb: any;
  hsvMask: any;
  skinMask: any;
  motionMask: any;
  movingSkinMask: any;
  cleanedMask: any;
  candidateMask: any;
  hierarchy: any;
  contours: any;
  kernel: any;
  cap: any;
}

interface RegisteredHandProfile {
  area: number;
  width: number;
  height: number;
  aspectRatio: number;
  extent: number;
  solidity: number;
  cr: number;
  cb: number;
  hue: number;
  saturation: number;
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

function getRegistrationBox() {
  const box = HAND_DETECTION.registrationBox;

  return {
    x: Math.round(CAMERA_WIDTH * box.xRatio),
    y: Math.round(CAMERA_HEIGHT * box.yRatio),
    width: Math.round(CAMERA_WIDTH * box.widthRatio),
    height: Math.round(CAMERA_HEIGHT * box.heightRatio),
  };
}

function rectCenter(rect: { x: number; y: number; width: number; height: number }) {
  return {
    x: rect.x + rect.width / 2,
    y: rect.y + rect.height / 2,
  };
}

function pointInCameraRect(point: CursorPoint, rect: { x: number; y: number; width: number; height: number }) {
  return point.x >= rect.x && point.x <= rect.x + rect.width && point.y >= rect.y && point.y <= rect.y + rect.height;
}

function keepOnlyRegistrationBox(cv: any, mask: any, box: { x: number; y: number; width: number; height: number }) {
  const boxedMask = cv.Mat.zeros(CAMERA_HEIGHT, CAMERA_WIDTH, cv.CV_8UC1);
  const rect = new cv.Rect(box.x, box.y, box.width, box.height);
  const sourceRoi = mask.roi(rect);
  const targetRoi = boxedMask.roi(rect);
  sourceRoi.copyTo(targetRoi);
  boxedMask.copyTo(mask);
  sourceRoi.delete();
  targetRoi.delete();
  boxedMask.delete();
}

function profileSimilarity(profile: RegisteredHandProfile | null, candidate: RegisteredHandProfile) {
  if (!profile) return 0;

  const areaRatio = Math.min(profile.area, candidate.area) / Math.max(profile.area, candidate.area, 1);
  const aspectDiff = Math.abs(profile.aspectRatio - candidate.aspectRatio);
  const extentDiff = Math.abs(profile.extent - candidate.extent);
  const solidityDiff = Math.abs(profile.solidity - candidate.solidity);
  const crDiff = Math.abs(profile.cr - candidate.cr) / 40;
  const cbDiff = Math.abs(profile.cb - candidate.cb) / 35;
  const hueDiff = Math.abs(profile.hue - candidate.hue) / 24;
  const saturationDiff = Math.abs(profile.saturation - candidate.saturation) / 120;
  const colorDiff = crDiff + cbDiff + hueDiff + saturationDiff;

  return clamp(areaRatio * 2 - aspectDiff - extentDiff * 1.5 - solidityDiff - colorDiff * 0.9, -2.5, 2.5);
}

function getContourProfile(
  cv: any,
  contour: any,
  area: number,
  rect: any,
  ycrcb?: any,
  hsv?: any,
): RegisteredHandProfile {
  const hull = new cv.Mat();
  cv.convexHull(contour, hull, false, true);
  const hullArea = cv.contourArea(hull);
  hull.delete();
  let cr = 0;
  let cb = 0;
  let hue = 0;
  let saturation = 0;

  if (ycrcb && hsv) {
    const contourMask = cv.Mat.zeros(CAMERA_HEIGHT, CAMERA_WIDTH, cv.CV_8UC1);
    const contourList = new cv.MatVector();
    contourList.push_back(contour);
    cv.drawContours(contourMask, contourList, 0, new cv.Scalar(255, 255, 255, 255), -1);
    const ycrcbMean = cv.mean(ycrcb, contourMask);
    const hsvMean = cv.mean(hsv, contourMask);
    cr = ycrcbMean[1] ?? 0;
    cb = ycrcbMean[2] ?? 0;
    hue = hsvMean[0] ?? 0;
    saturation = hsvMean[1] ?? 0;
    contourMask.delete();
    contourList.delete();
  }

  return {
    area,
    width: rect.width,
    height: rect.height,
    aspectRatio: rect.width / Math.max(1, rect.height),
    extent: area / Math.max(1, rect.width * rect.height),
    solidity: area / Math.max(1, hullArea),
    cr,
    cb,
    hue,
    saturation,
  };
}

function estimateFingertipFromUpperContour(contour: any, center: CursorPoint) {
  let tipX = 0;
  let tipY = Number.POSITIVE_INFINITY;
  let bestDistance = Number.NEGATIVE_INFINITY;
  let fallbackX = 0;
  let fallbackY = Number.POSITIVE_INFINITY;

  for (let i = 0; i < contour.data32S.length; i += 2) {
    const x = contour.data32S[i];
    const y = contour.data32S[i + 1];

    if (y < fallbackY) {
      fallbackX = x;
      fallbackY = y;
    }

    if (y > center.y) continue;

    const distanceFromCenter = Math.hypot(x - center.x, y - center.y);
    if (distanceFromCenter > bestDistance) {
      bestDistance = distanceFromCenter;
      tipX = x;
      tipY = y;
    }
  }

  if (!Number.isFinite(tipY)) {
    tipX = fallbackX;
    tipY = fallbackY;
  }

  return Number.isFinite(tipY) ? { x: tipX, y: tipY } : null;
}

function isHeadLikeContour(cv: any, contour: any, area: number, rect: any) {
  const profile = getContourProfile(cv, contour, area, rect);
  const aspectRatio = profile.aspectRatio;
  const extent = profile.extent;
  const solidity = profile.solidity;
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

function getHeadPenalty(cv: any, contour: any, area: number, rect: any, registeredHand: RegisteredHandProfile | null) {
  const profile = getContourProfile(cv, contour, area, rect);
  const centerY = rect.y + rect.height / 2;
  const areaRatioToHand = registeredHand ? area / Math.max(1, registeredHand.area) : 1;
  const isUpperFrame = centerY <= CAMERA_HEIGHT * HAND_DETECTION.headReject.upperFrameRatio;
  const isCompactBlob = profile.solidity >= HAND_DETECTION.headReject.minSolidity && profile.extent >= 0.5;
  const isLargeComparedToHand = registeredHand ? areaRatioToHand >= 1.45 : area >= HAND_DETECTION.headReject.minArea;

  if (!isUpperFrame || !isCompactBlob || !isLargeComparedToHand) return 0;

  // Faces are usually compact upper-frame blobs; hands with fingers are less solid and more irregular.
  return 9000 + Math.min(8000, areaRatioToHand * 2500);
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
  const phaseRef = useRef<TrackingPhase>('loading');
  const phaseStartedAtRef = useRef(performance.now());
  const registeredHandRef = useRef<RegisteredHandProfile | null>(null);
  const backgroundReadyRef = useRef(false);
  const registrationSamplesRef = useRef<RegisteredHandProfile[]>([]);
  const handRegistrationStartedAtRef = useRef<number | null>(null);
  const [thresholds, setThresholdState] = useState<SkinThresholdConfig>(DEFAULT_SKIN_THRESHOLDS);
  const thresholdsRef = useRef<SkinThresholdConfig>(DEFAULT_SKIN_THRESHOLDS);

  const setThresholds = useCallback((nextThresholds: SkinThresholdConfig) => {
    thresholdsRef.current = nextThresholds;
    setThresholdState(nextThresholds);
  }, []);

  const [state, setState] = useState<HandTrackingState>({
    cameraStatus: 'idle',
    cameraError: '',
    phase: 'loading',
    phaseCountdownMs: 0,
    registrationBox: getRegistrationBox(),
    registeredHand: false,
    handDetected: false,
    handCount: 0,
    handPoints: [],
    contourDetected: false,
    fingertipEstimated: false,
    cursor: null,
    lastSeenAt: 0,
  });

  const resetTrackingMemory = useCallback(() => {
    smoothedPointsRef.current = [];
    lastCursorRef.current = null;
    lastHandCameraRef.current = null;
    lastSeenAtRef.current = 0;
  }, []);

  const enterPhase = useCallback((phase: TrackingPhase) => {
    phaseRef.current = phase;
    phaseStartedAtRef.current = performance.now();
    if (phase === 'background-calibration') {
      backgroundReadyRef.current = false;
      registeredHandRef.current = null;
      registrationSamplesRef.current = [];
      handRegistrationStartedAtRef.current = null;
    }
    if (phase === 'hand-registration') {
      registeredHandRef.current = null;
      registrationSamplesRef.current = [];
      handRegistrationStartedAtRef.current = null;
    }
    resetTrackingMemory();
  }, [resetTrackingMemory]);

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
      lab: new cv.Mat(),
      labChannels: new cv.MatVector(),
      equalizedRgb: new cv.Mat(),
      gray: new cv.Mat(),
      prevGray: new cv.Mat(),
      backgroundGray: new cv.Mat(),
      backgroundSkinMask: new cv.Mat(CAMERA_HEIGHT, CAMERA_WIDTH, cv.CV_8UC1),
      backgroundSkinInverseMask: new cv.Mat(CAMERA_HEIGHT, CAMERA_WIDTH, cv.CV_8UC1),
      backgroundDelta: new cv.Mat(),
      foregroundMask: new cv.Mat(CAMERA_HEIGHT, CAMERA_WIDTH, cv.CV_8UC1),
      foregroundSkinMask: new cv.Mat(CAMERA_HEIGHT, CAMERA_WIDTH, cv.CV_8UC1),
      frameDelta: new cv.Mat(),
      hsv: new cv.Mat(),
      ycrcb: new cv.Mat(),
      hsvMask: new cv.Mat(),
      skinMask: new cv.Mat(),
      motionMask: new cv.Mat(CAMERA_HEIGHT, CAMERA_WIDTH, cv.CV_8UC1),
      movingSkinMask: new cv.Mat(CAMERA_HEIGHT, CAMERA_WIDTH, cv.CV_8UC1),
      cleanedMask: new cv.Mat(),
      candidateMask: new cv.Mat(CAMERA_HEIGHT, CAMERA_WIDTH, cv.CV_8UC1),
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
    const registrationBox = getRegistrationBox();
    const phase = phaseRef.current;
    const phaseElapsed = performance.now() - phaseStartedAtRef.current;
    const activeThresholds = thresholdsRef.current;
    runtime.cap.read(runtime.mat);
    cv.flip(runtime.mat, runtime.mat, 1);

    // CLAHE reduces harsh lighting and shadow differences before skin segmentation.
    cv.cvtColor(runtime.mat, runtime.rgb, cv.COLOR_RGBA2RGB);
    if (cv.CLAHE && typeof runtime.labChannels.set === 'function') {
      cv.cvtColor(runtime.rgb, runtime.lab, cv.COLOR_RGB2Lab);
      if (runtime.labChannels.size() > 0) runtime.labChannels.delete();
      runtime.labChannels = new cv.MatVector();
      cv.split(runtime.lab, runtime.labChannels);
      const clahe = new cv.CLAHE(2.0, new cv.Size(8, 8));
      const lightness = runtime.labChannels.get(0);
      clahe.apply(lightness, lightness);
      runtime.labChannels.set(0, lightness);
      cv.merge(runtime.labChannels, runtime.lab);
      cv.cvtColor(runtime.lab, runtime.equalizedRgb, cv.COLOR_Lab2RGB);
      lightness.delete();
      clahe.delete();
    } else {
      runtime.rgb.copyTo(runtime.equalizedRgb);
    }

    // HSV/YCrCb color conversion for skin segmentation.
    cv.cvtColor(runtime.equalizedRgb, runtime.gray, cv.COLOR_RGB2GRAY);
    cv.GaussianBlur(runtime.gray, runtime.gray, new cv.Size(7, 7), 0);
    cv.cvtColor(runtime.equalizedRgb, runtime.hsv, cv.COLOR_RGB2HSV);
    cv.cvtColor(runtime.equalizedRgb, runtime.ycrcb, cv.COLOR_RGB2YCrCb);

    const hsvLower = new cv.Mat(runtime.hsv.rows, runtime.hsv.cols, runtime.hsv.type(), [
      HAND_DETECTION.hsvLower[0],
      activeThresholds.saturationMin,
      HAND_DETECTION.hsvLower[2],
      0,
    ]);
    const hsvUpper = new cv.Mat(runtime.hsv.rows, runtime.hsv.cols, runtime.hsv.type(), [
      activeThresholds.hueMax,
      HAND_DETECTION.hsvUpper[1],
      HAND_DETECTION.hsvUpper[2],
      255,
    ]);
    const skinLower = new cv.Mat(runtime.ycrcb.rows, runtime.ycrcb.cols, runtime.ycrcb.type(), [
      0,
      activeThresholds.crMin,
      activeThresholds.cbMin,
      0,
    ]);
    const skinUpper = new cv.Mat(runtime.ycrcb.rows, runtime.ycrcb.cols, runtime.ycrcb.type(), [
      255,
      activeThresholds.crMax,
      activeThresholds.cbMax,
      255,
    ]);

    cv.inRange(runtime.hsv, hsvLower, hsvUpper, runtime.hsvMask);
    cv.inRange(runtime.ycrcb, skinLower, skinUpper, runtime.skinMask);
    cv.bitwise_and(runtime.hsvMask, runtime.skinMask, runtime.cleanedMask);
    cv.GaussianBlur(runtime.cleanedMask, runtime.cleanedMask, new cv.Size(5, 5), 0);
    // Morphology opening/closing removes small noise and fills the skin region.
    cv.morphologyEx(runtime.cleanedMask, runtime.cleanedMask, cv.MORPH_OPEN, runtime.kernel);
    cv.morphologyEx(runtime.cleanedMask, runtime.cleanedMask, cv.MORPH_CLOSE, runtime.kernel);

    if (phase === 'background-calibration') {
      const remainingMs = Math.max(0, HAND_DETECTION.backgroundCalibrationMs - phaseElapsed);
      if (phaseElapsed >= HAND_DETECTION.backgroundCalibrationMs) {
        runtime.gray.copyTo(runtime.backgroundGray);
        runtime.cleanedMask.copyTo(runtime.backgroundSkinMask);
        cv.dilate(runtime.backgroundSkinMask, runtime.backgroundSkinMask, runtime.kernel);
        backgroundReadyRef.current = true;
        enterPhase('hand-registration');
      }

      runtime.cleanedMask.setTo(new cv.Scalar(0, 0, 0, 0));
      cv.imshow(maskCanvas, runtime.cleanedMask);
      const debug = cv.Mat.zeros(CAMERA_HEIGHT, CAMERA_WIDTH, cv.CV_8UC4);
      cv.imshow(contourCanvas, debug);
      debug.delete();
      hsvLower.delete();
      hsvUpper.delete();
      skinLower.delete();
      skinUpper.delete();
      runtime.gray.copyTo(runtime.prevGray);
      setState({
        cameraStatus: 'camera-on',
        cameraError: '',
        phase: 'background-calibration',
        phaseCountdownMs: remainingMs,
        registrationBox,
        registeredHand: false,
        handDetected: false,
        handCount: 0,
        handPoints: [],
        contourDetected: false,
        fingertipEstimated: false,
        cursor: null,
        lastSeenAt: 0,
      });
      animationRef.current = requestAnimationFrame(processFrame);
      return;
    }

    if (backgroundReadyRef.current && runtime.backgroundGray.rows > 0) {
      cv.absdiff(runtime.gray, runtime.backgroundGray, runtime.backgroundDelta);
      cv.threshold(
        runtime.backgroundDelta,
        runtime.foregroundMask,
        HAND_DETECTION.backgroundDiffThreshold,
        255,
        cv.THRESH_BINARY,
      );
      cv.morphologyEx(runtime.foregroundMask, runtime.foregroundMask, cv.MORPH_OPEN, runtime.kernel);
      cv.dilate(runtime.foregroundMask, runtime.foregroundMask, runtime.kernel);
      cv.bitwise_and(runtime.cleanedMask, runtime.foregroundMask, runtime.foregroundSkinMask);
      if (registeredHandRef.current && runtime.backgroundSkinMask.rows > 0) {
        cv.bitwise_not(runtime.backgroundSkinMask, runtime.backgroundSkinInverseMask);
        cv.bitwise_and(runtime.foregroundSkinMask, runtime.backgroundSkinInverseMask, runtime.foregroundSkinMask);
      }
    } else {
      runtime.cleanedMask.copyTo(runtime.foregroundSkinMask);
    }

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

    if (phase === 'hand-registration') {
      runtime.foregroundSkinMask.copyTo(runtime.candidateMask);
      keepOnlyRegistrationBox(cv, runtime.candidateMask, registrationBox);
    } else if (registeredHandRef.current) {
      runtime.foregroundSkinMask.copyTo(runtime.candidateMask);
    } else {
      runtime.foregroundSkinMask.copyTo(runtime.candidateMask);
    }

    cv.findContours(runtime.candidateMask, runtime.contours, runtime.hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);

    const candidates: Array<{ contour: any; score: number; center: CursorPoint; area: number }> = [];
    for (let i = 0; i < runtime.contours.size(); i += 1) {
      const contour = runtime.contours.get(i);
      const area = cv.contourArea(contour);
      if (area < HAND_DETECTION.minContourArea || area > HAND_DETECTION.maxContourArea) {
        contour.delete();
        continue;
      }

      const rect = cv.boundingRect(contour);
      const profile = getContourProfile(cv, contour, area, rect, runtime.ycrcb, runtime.hsv);
      const registrationScore = profileSimilarity(registeredHandRef.current, profile);
      const headPenalty = getHeadPenalty(cv, contour, area, rect, registeredHandRef.current);
      const registeredHand = registeredHandRef.current;
      const isOversizedRegisteredCandidate = Boolean(
        phase === 'tracking' &&
          registeredHand &&
          (area > registeredHand.area * HAND_DETECTION.maxRegisteredAreaRatio ||
            rect.width > registeredHand.width * HAND_DETECTION.maxRegisteredBoxRatio ||
            rect.height > registeredHand.height * HAND_DETECTION.maxRegisteredBoxRatio),
      );
      if (
        phase === 'tracking' &&
        isHeadLikeContour(cv, contour, area, rect) &&
        (!registeredHandRef.current || registrationScore < 0.1)
      ) {
        contour.delete();
        continue;
      }

      if (isOversizedRegisteredCandidate && registrationScore < 1.15) {
        contour.delete();
        continue;
      }

      const center = { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
      const motionRoi = runtime.movingSkinMask.roi(rect);
      const motionRatio = cv.countNonZero(motionRoi) / Math.max(1, rect.width * rect.height);
      motionRoi.delete();
      const foregroundRoi = runtime.foregroundSkinMask.roi(rect);
      const foregroundRatio = cv.countNonZero(foregroundRoi) / Math.max(1, rect.width * rect.height);
      foregroundRoi.delete();

      const lastHand = lastHandCameraRef.current;
      const distFromLast = lastHand ? Math.hypot(center.x - lastHand.x, center.y - lastHand.y) : 0;
      const hasMotion = motionRatio >= HAND_DETECTION.minMotionRatio;
      const nearLastHand = Boolean(lastHand && distFromLast <= HAND_DETECTION.trackingMaxDistance);
      const lockedToLastHand = Boolean(
        phase === 'tracking' &&
          registeredHandRef.current &&
          lastHand &&
          performance.now() - lastSeenAtRef.current <= HAND_DETECTION.noHandGraceMs,
      );

      if (phase === 'hand-registration' && !pointInCameraRect(center, registrationBox)) {
        contour.delete();
        continue;
      }

      if (phase === 'tracking' && !registeredHandRef.current && !hasMotion && !nearLastHand) {
        contour.delete();
        continue;
      }

      if (
        phase === 'tracking' &&
        registeredHandRef.current &&
        !nearLastHand &&
        foregroundRatio < 0.003 &&
        registrationScore < -0.25
      ) {
        contour.delete();
        continue;
      }

      if (
        lockedToLastHand &&
        distFromLast > HAND_DETECTION.lockMaxDistance &&
        (registrationScore < 0.85 || motionRatio < HAND_DETECTION.minMotionRatio * 1.5)
      ) {
        contour.delete();
        continue;
      }

      const boxCenter = rectCenter(registrationBox);
      const registrationBoxScore =
        phase === 'hand-registration' ? -Math.hypot(center.x - boxCenter.x, center.y - boxCenter.y) * 8 : 0;
      const score =
        motionRatio * 9000 +
        foregroundRatio * 7000 +
        registrationScore * 2500 +
        Math.min(area, HAND_DETECTION.maxContourArea * 0.55) * 0.02 +
        registrationBoxScore -
        (lastHand ? distFromLast * (lockedToLastHand ? 18 : 8) : 0) -
        headPenalty;
      candidates.push({ contour, score, center, area });
    }

    candidates.sort((a, b) => b.score - a.score);
    const selectedCandidates = candidates.slice(0, 2);
    const bestCandidate = selectedCandidates[0];
    const handPoints = selectedCandidates.map((candidate) => cameraPointToViewport(candidate.center));

    const debug = cv.Mat.zeros(CAMERA_HEIGHT, CAMERA_WIDTH, cv.CV_8UC4);
    if (phase === 'hand-registration') {
      cv.rectangle(
        debug,
        new cv.Point(registrationBox.x, registrationBox.y),
        new cv.Point(registrationBox.x + registrationBox.width, registrationBox.y + registrationBox.height),
        new cv.Scalar(34, 197, 94, 255),
        2,
      );
    }
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

    if (bestCandidate && phase === 'hand-registration') {
      if (handRegistrationStartedAtRef.current === null) {
        handRegistrationStartedAtRef.current = performance.now();
        registrationSamplesRef.current = [];
      }

      const rect = cv.boundingRect(bestCandidate.contour);
      registrationSamplesRef.current.push(
        getContourProfile(cv, bestCandidate.contour, bestCandidate.area, rect, runtime.ycrcb, runtime.hsv),
      );
      const registrationElapsed = performance.now() - handRegistrationStartedAtRef.current;
      const remainingMs = Math.max(0, HAND_DETECTION.handRegistrationMs - registrationElapsed);
      if (registrationElapsed >= HAND_DETECTION.handRegistrationMs && registrationSamplesRef.current.length > 5) {
        const samples = registrationSamplesRef.current;
        registeredHandRef.current = {
          area: samples.reduce((sum, sample) => sum + sample.area, 0) / samples.length,
          width: samples.reduce((sum, sample) => sum + sample.width, 0) / samples.length,
          height: samples.reduce((sum, sample) => sum + sample.height, 0) / samples.length,
          aspectRatio: samples.reduce((sum, sample) => sum + sample.aspectRatio, 0) / samples.length,
          extent: samples.reduce((sum, sample) => sum + sample.extent, 0) / samples.length,
          solidity: samples.reduce((sum, sample) => sum + sample.solidity, 0) / samples.length,
          cr: samples.reduce((sum, sample) => sum + sample.cr, 0) / samples.length,
          cb: samples.reduce((sum, sample) => sum + sample.cb, 0) / samples.length,
          hue: samples.reduce((sum, sample) => sum + sample.hue, 0) / samples.length,
          saturation: samples.reduce((sum, sample) => sum + sample.saturation, 0) / samples.length,
        };
        phaseRef.current = 'tracking';
        phaseStartedAtRef.current = performance.now();
        lastHandCameraRef.current = bestCandidate.center;
        lastCursorRef.current = cameraPointToViewport(bestCandidate.center);
        lastSeenAtRef.current = performance.now();
      }
      cv.imshow(maskCanvas, runtime.candidateMask);
      cv.imshow(contourCanvas, debug);
      debug.delete();
      candidates.forEach((candidate) => candidate.contour.delete());
      runtime.gray.copyTo(runtime.prevGray);
      setState({
        cameraStatus: 'camera-on',
        cameraError: '',
        phase: 'hand-registration',
        phaseCountdownMs: remainingMs,
        registrationBox,
        registeredHand: Boolean(registeredHandRef.current),
        handDetected: true,
        handCount: 1,
        handPoints,
        contourDetected: true,
        fingertipEstimated: false,
        cursor: null,
        lastSeenAt: lastSeenAtRef.current,
      });
      animationRef.current = requestAnimationFrame(processFrame);
      return;
    }

    if (phase === 'hand-registration') {
      handRegistrationStartedAtRef.current = null;
      registrationSamplesRef.current = [];
      const remainingMs = HAND_DETECTION.handRegistrationMs;
      cv.imshow(maskCanvas, runtime.candidateMask);
      cv.imshow(contourCanvas, debug);
      debug.delete();
      candidates.forEach((candidate) => candidate.contour.delete());
      runtime.gray.copyTo(runtime.prevGray);
      setState({
        cameraStatus: 'camera-on',
        cameraError: '',
        phase: 'hand-registration',
        phaseCountdownMs: remainingMs,
        registrationBox,
        registeredHand: false,
        handDetected: false,
        handCount: 0,
        handPoints: [],
        contourDetected: false,
        fingertipEstimated: false,
        cursor: null,
        lastSeenAt: 0,
      });
      animationRef.current = requestAnimationFrame(processFrame);
      return;
    }

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

      // Use the farthest point in the upper half of the hand contour as the fingertip candidate.
      const fingertip = estimateFingertipFromUpperContour(bestContour, bestCandidate.center);

      if (fingertip) {
        fingertipEstimated = true;
        cv.circle(debug, new cv.Point(fingertip.x, fingertip.y), 7, new cv.Scalar(239, 68, 68, 255), -1);

        // Convert camera coordinates to viewport coordinates for the virtual cursor.
        const viewportPoint = cameraPointToViewport(fingertip);

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

    cv.imshow(maskCanvas, runtime.candidateMask);
    cv.imshow(contourCanvas, debug);
    debug.delete();

    setState({
      cameraStatus: 'camera-on',
      cameraError: '',
      phase: contourDetected || withinGrace ? 'tracking' : 'lost',
      phaseCountdownMs: 0,
      registrationBox,
      registeredHand: Boolean(registeredHandRef.current),
      handDetected: contourDetected || withinGrace,
      handCount: handPoints.length,
      handPoints,
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
      enterPhase('background-calibration');
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
      enterPhase(event.shiftKey ? 'background-calibration' : 'hand-registration');
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [enterPhase]);

  return {
    videoRef,
    maskCanvasRef,
    contourCanvasRef,
    state,
    thresholds,
    setThresholds,
  };
}
