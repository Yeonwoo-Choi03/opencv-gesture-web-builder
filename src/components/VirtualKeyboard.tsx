const rows = ['QWERTYUIOP', 'ASDFGHJKL', 'ZXCVBNM'];

export function VirtualKeyboard({ visible }: { visible: boolean }) {
  if (!visible) return null;

  return (
    <section className="panel keyboard-panel">
      <div className="panel-heading">
        <h2>Virtual Keyboard</h2>
        <span className="status-pill good">Typing</span>
      </div>
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
        </div>
      </div>
    </section>
  );
}
