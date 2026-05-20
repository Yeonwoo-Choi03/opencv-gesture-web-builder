import type { BuilderElementType } from '../types/builder';

const toolButtons: Array<{ label: string; value: BuilderElementType }> = [
  { label: 'Header', value: 'header' },
  { label: 'Text Box', value: 'text' },
  { label: 'Button', value: 'button' },
  { label: 'Card', value: 'card' },
  { label: 'Image', value: 'image' },
  { label: 'Section', value: 'section' },
];

export function Toolbar() {
  return (
    <aside className="panel toolbar">
      <div className="panel-heading">
        <h2>Tools</h2>
      </div>
      <div className="tool-grid">
        {toolButtons.map((tool) => (
          <button
            key={tool.value}
            type="button"
            className="tool-button"
            data-gesture-kind="tool"
            data-gesture-value={`add:${tool.value}`}
          >
            {tool.label}
          </button>
        ))}
        <button type="button" className="tool-button action" data-gesture-kind="tool" data-gesture-value="resize">
          Resize Mode
        </button>
        <button type="button" className="tool-button danger" data-gesture-kind="tool" data-gesture-value="delete">
          Delete
        </button>
        <button type="button" className="tool-button muted" data-gesture-kind="tool" data-gesture-value="clear">
          Clear Canvas
        </button>
      </div>
    </aside>
  );
}
