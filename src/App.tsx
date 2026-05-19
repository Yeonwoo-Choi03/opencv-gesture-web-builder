import { GestureBuilderPage } from './pages/GestureBuilderPage';

export default function App() {
  const path = window.location.pathname;

  if (path === '/gesture-builder' || path === '/') {
    return <GestureBuilderPage />;
  }

  return (
    <main className="route-fallback">
      <h1>OpenCV Gesture Web Builder</h1>
      <p>사용 가능한 페이지: /gesture-builder</p>
      <a href="/gesture-builder">Gesture Builder 열기</a>
    </main>
  );
}
