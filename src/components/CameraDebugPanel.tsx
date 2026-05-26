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
          {tracking.handDetected ? 'Marker Detected' : 'No Marker'}
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
          <figcaption>Combined red / blue / green marker mask</figcaption>
        </figure>
        <figure className="wide-debug">
          <canvas ref={contourCanvasRef} width={CAMERA_WIDTH} height={CAMERA_HEIGHT} />
          <figcaption>Marker bounding boxes and gesture links</figcaption>
        </figure>
      </div>

      {tracking.cameraStatus === 'camera-error' && (
        <p className="camera-error">Camera or OpenCV failed to start: {tracking.cameraError}</p>
      )}
      {tracking.cameraStatus === 'loading-opencv' && <p className="camera-note">Loading OpenCV.js...</p>}
      {tracking.cameraStatus === 'camera-on' && !tracking.handDetected && (
        <p className="camera-note">Show the red marker to move the cursor. Bring blue near red to click.</p>
      )}
    </section>
  );
}
