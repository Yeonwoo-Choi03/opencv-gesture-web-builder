import { CAMERA_HEIGHT, CAMERA_WIDTH } from '../constants/gesture';
import type { HandTrackingState } from '../hooks/useOpenCvHandTracking';
import type { RefObject } from 'react';

interface CameraDebugPanelProps {
  videoRef: RefObject<HTMLVideoElement | null>;
  maskCanvasRef: RefObject<HTMLCanvasElement | null>;
  contourCanvasRef: RefObject<HTMLCanvasElement | null>;
  tracking: HandTrackingState;
}

export function CameraDebugPanel({
  videoRef,
  maskCanvasRef,
  contourCanvasRef,
  tracking,
}: CameraDebugPanelProps) {
  return (
    <section className="panel camera-panel">
      <div className="panel-heading">
        <h2>OpenCV Debug</h2>
        <span className={tracking.handDetected ? 'status-pill good' : 'status-pill'}>
          {tracking.handDetected ? 'Hand Detected' : 'No Hand'}
        </span>
      </div>

      <div className="debug-grid">
        <figure>
          <video
            ref={videoRef}
            width={CAMERA_WIDTH}
            height={CAMERA_HEIGHT}
            muted
            playsInline
            className="camera-video"
          />
          <figcaption>Original mirrored camera</figcaption>
        </figure>
        <figure>
          <canvas ref={maskCanvasRef} width={CAMERA_WIDTH} height={CAMERA_HEIGHT} />
          <figcaption>Skin + motion mask</figcaption>
        </figure>
        <figure className="wide-debug">
          <canvas ref={contourCanvasRef} width={CAMERA_WIDTH} height={CAMERA_HEIGHT} />
          <figcaption>Contour, convex hull, fingertip</figcaption>
        </figure>
      </div>

      {tracking.cameraStatus === 'camera-error' && (
        <p className="camera-error">카메라 권한 또는 OpenCV 로딩을 확인해주세요: {tracking.cameraError}</p>
      )}
      {tracking.cameraStatus === 'loading-opencv' && <p className="camera-note">OpenCV.js 로딩 중...</p>}
      {tracking.cameraStatus === 'camera-on' && !tracking.handDetected && (
        <p className="camera-note">손을 카메라 앞에 보여주세요. 밝은 배경과 피부색 threshold에 영향을 받습니다.</p>
      )}
    </section>
  );
}
