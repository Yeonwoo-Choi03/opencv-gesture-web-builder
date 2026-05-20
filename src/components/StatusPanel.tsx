import type { BuilderElement } from '../types/builder';
import type { HandTrackingState } from '../hooks/useOpenCvHandTracking';

interface StatusPanelProps {
  selectedElement: BuilderElement | undefined;
  tracking: HandTrackingState;
  gestureState: string;
  dwellProgress: number;
  dragging: boolean;
  resizeMode: boolean;
}

export function StatusPanel({
  selectedElement,
  tracking,
  gestureState,
  dwellProgress,
  dragging,
  resizeMode,
}: StatusPanelProps) {
  return (
    <section className="panel status-panel">
      <div className="panel-heading">
        <h2>Status</h2>
        <span className={tracking.cameraStatus === 'camera-on' ? 'status-pill good' : 'status-pill'}>
          {tracking.cameraStatus === 'camera-on' ? 'Camera On' : tracking.cameraStatus}
        </span>
      </div>

      <dl className="status-list">
        <div>
          <dt>Selected</dt>
          <dd>{selectedElement ? `${selectedElement.type} / ${selectedElement.id}` : 'None'}</dd>
        </div>
        <div>
          <dt>Gesture</dt>
          <dd>{gestureState}</dd>
        </div>
        <div>
          <dt>Hands</dt>
          <dd>{tracking.handCount}</dd>
        </div>
        <div>
          <dt>Dragging</dt>
          <dd>{dragging ? 'Active' : 'Inactive'}</dd>
        </div>
        <div>
          <dt>Resize Mode</dt>
          <dd>{resizeMode ? 'On' : 'Off'}</dd>
        </div>
        <div>
          <dt>Dwell</dt>
          <dd>{Math.round(dwellProgress * 100)}%</dd>
        </div>
        <div>
          <dt>Skin Mask</dt>
          <dd>{tracking.cameraStatus === 'camera-on' ? 'Skin + motion' : 'Waiting'}</dd>
        </div>
        <div>
          <dt>Contour</dt>
          <dd>{tracking.contourDetected ? 'Detected' : 'Not detected'}</dd>
        </div>
        <div>
          <dt>Fingertip</dt>
          <dd>{tracking.fingertipEstimated ? 'Estimated' : 'Not estimated'}</dd>
        </div>
      </dl>
    </section>
  );
}
