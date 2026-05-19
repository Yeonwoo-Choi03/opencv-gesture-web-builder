export const OPENCV_SCRIPT_URL = 'https://docs.opencv.org/4.10.0/opencv.js';

export const CAMERA_WIDTH = 320;
export const CAMERA_HEIGHT = 240;

export const HAND_DETECTION = {
  minContourArea: 2600,
  noHandGraceMs: 450,
  smoothingWindow: 6,
  // YCrCb skin threshold. 조명에 따라 Cr/Cb 범위를 조정하면 인식률이 달라진다.
  yCrCbLower: [0, 133, 77],
  yCrCbUpper: [255, 173, 127],
  // HSV threshold is intersected with YCrCb to reduce bright background noise.
  hsvLower: [0, 20, 40],
  hsvUpper: [35, 255, 255],
} as const;

export const DWELL = {
  clickMs: 600,
  cooldownMs: 650,
  hoverResetDistance: 34,
} as const;
