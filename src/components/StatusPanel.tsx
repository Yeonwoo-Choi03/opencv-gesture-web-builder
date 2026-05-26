import type { BuilderElement } from '../types/builder';
import { DEFAULT_SKIN_THRESHOLDS, type HandTrackingState, type SkinThresholdConfig } from '../hooks/useOpenCvHandTracking';

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
  thresholds,
  onThresholdChange,
}: StatusPanelProps) {
  const updateThreshold = (key: keyof SkinThresholdConfig, value: number) => {
    onThresholdChange({ ...thresholds, [key]: value });
  };

  const resetThresholds = () => {
    onThresholdChange(DEFAULT_SKIN_THRESHOLDS);
  };

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

      <div className="threshold-controls">
        <div className="threshold-heading">
          <h3>Skin Threshold</h3>
          <button type="button" onClick={resetThresholds}>Reset</button>
        </div>
        {[
          ['crMin', 'Cr Min', 100, 170],
          ['crMax', 'Cr Max', 140, 210],
          ['cbMin', 'Cb Min', 60, 120],
          ['cbMax', 'Cb Max', 100, 160],
          ['hueMax', 'Hue Max', 15, 55],
          ['saturationMin', 'Sat Min', 5, 90],
        ].map(([key, label, min, max]) => (
          <label className="threshold-row" key={key}>
            <span>{label}</span>
            <input
              type="range"
              min={min}
              max={max}
              value={thresholds[key as keyof SkinThresholdConfig]}
              onChange={(event) => updateThreshold(key as keyof SkinThresholdConfig, Number(event.target.value))}
            />
            <strong>{thresholds[key as keyof SkinThresholdConfig]}</strong>
          </label>
        ))}
      </div>
    </section>
  );
}
