import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { PasteBench } from './paste-bench.js';
import './styles.css';

const root = document.getElementById('root');
if (!root) throw new Error('missing root');
createRoot(root).render(
  <StrictMode>
    <PasteBench />
  </StrictMode>,
);
