import type { BuilderElement } from '../types/builder';
import type { HandTrackingState, SkinThresholdConfig } from '../hooks/useOpenCvHandTracking';

interface StatusPanelProps {
  selectedElement: BuilderElement | undefined;
  tracking: HandTrackingState;
  gestureState: string;
  dwellProgress: number;
  dragging: boolean;
  resizeMode: boolean;
  thresholds: SkinThresholdConfig;
  onThresholdChange: (thresholds: SkinThresholdConfig) => void;
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
          <dt>Phase</dt>
          <dd>{tracking.phase}</dd>
        </div>
        <div>
          <dt>Registered</dt>
          <dd>{tracking.registeredHand ? 'Yes' : 'No'}</dd>
        </div>
        <div>
          <dt>Markers</dt>
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
          <dt>Red Cursor</dt>
          <dd>{tracking.fingertipEstimated ? 'Detected' : 'Not detected'}</dd>
        </div>
        <div>
          <dt>Blue Click</dt>
          <dd>{tracking.markerClickActive ? 'Active' : 'Inactive'}</dd>
        </div>
        <div>
          <dt>Green Resize</dt>
          <dd>{tracking.resizeDistance ? `${Math.round(tracking.resizeDistance)} px` : 'Inactive'}</dd>
        </div>
      </dl>

      <div className="marker-guide">
        <div className="threshold-heading">
          <h3>Marker Roles</h3>
        </div>
        <p><span className="marker-dot red" /> Red: cursor</p>
        <p><span className="marker-dot blue" /> Blue near red: click</p>
        <p><span className="marker-dot green" /> Green distance: resize</p>
      </div>
    </section>
  );
}
