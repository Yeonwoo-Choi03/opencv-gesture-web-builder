const rows = ['QWERTYUIOP', 'ASDFGHJKL', 'ZXCVBNM'];

interface VirtualKeyboardProps {
  visible: boolean;
  value?: string;
}

export function VirtualKeyboard({ visible, value = '' }: VirtualKeyboardProps) {
  if (!visible) return null;

  return (
    <section className="keyboard-panel canvas-keyboard">
      <div className="keyboard-heading">
        <h2>Virtual Keyboard</h2>
        <span className="status-pill good">Typing</span>
      </div>
      <div className="keyboard-preview">{value || 'Text will appear here'}</div>
      <div className="keyboard">
        {rows.map((row) => (
          <div className="keyboard-row" key={row}>
            {[...row].map((key) => (
              <button
                type="button"
                className="key-button"
                key={key}
                data-gesture-kind="key"
                data-gesture-value={key}
              >
                {key}
              </button>
            ))}
          </div>
        ))}
        <div className="keyboard-row">
          <button type="button" className="key-button wide" data-gesture-kind="key" data-gesture-value="Space">
            Space
          </button>
          <button type="button" className="key-button wide" data-gesture-kind="key" data-gesture-value="Backspace">
            Backspace
          </button>
          <button type="button" className="key-button wide" data-gesture-kind="key" data-gesture-value="Enter">
            Enter
          </button>
          <button type="button" className="key-button wide done-key" data-gesture-kind="key" data-gesture-value="Done">
            Done
          </button>
        </div>
      </div>
    </section>
  );
}
