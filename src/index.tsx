import "./index.css";
import ReactDOM from "react-dom/client";
import { App } from "./App";

const searchParams = typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : null;
const listScenario = searchParams?.get('scenario') === 'examples' ? 'examples' : 'empty';

const rootEl = document.getElementById("root");
if (rootEl) {
  ReactDOM.createRoot(rootEl).render(<App sessionList={listScenario} />);
}
