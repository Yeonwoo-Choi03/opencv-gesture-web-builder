export const OPENCV_SCRIPT_URL = 'https://docs.opencv.org/4.10.0/opencv.js';

export const CAMERA_WIDTH = 320;
export const CAMERA_HEIGHT = 240;

export const HAND_DETECTION = {
  backgroundCalibrationMs: 5000,
  handRegistrationMs: 2000,
  minContourArea: 1800,
  maxContourArea: 22000,
  noHandGraceMs: 450,
  smoothingWindow: 6,
  motionThreshold: 16,
  minMotionRatio: 0.012,
  trackingMaxDistance: 120,
  registrationBox: {
    xRatio: 0.32,
    yRatio: 0.22,
    widthRatio: 0.36,
    heightRatio: 0.48,
  },
  backgroundDiffThreshold: 24,
  headReject: {
    minArea: 4200,
    minAspectRatio: 0.52,
    maxAspectRatio: 1.45,
    minSolidity: 0.86,
    minExtent: 0.56,
    upperFrameRatio: 0.58,
  },
  // YCrCb skin threshold. Adjust Cr/Cb ranges for the room lighting.
  yCrCbLower: [0, 133, 77, 0],
  yCrCbUpper: [255, 173, 127, 255],
  // HSV threshold is intersected with YCrCb to reduce bright background noise.
  hsvLower: [0, 20, 40, 0],
  hsvUpper: [35, 255, 255, 255],
} as const;

export const DWELL = {
  clickMs: 600,
  cooldownMs: 650,
  hoverResetDistance: 34,
} as const;
