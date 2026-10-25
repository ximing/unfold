import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { register } from '@rabjs/react';
import { BrowserRouter, Route, Routes } from 'react-router';
import { PasteBench } from './paste-bench.js';
import { SessionService } from './services/session.service.js';
import { CollectionPage } from './pages/collection.js';
import { HomePage } from './pages/home.js';
import { LibraryPage } from './pages/library.js';
import { LoginPage } from './pages/login.js';
import { Shell } from './pages/shell.js';
import './workspace.css';
import 'katex/dist/katex.min.css';

register(SessionService);

const root = document.getElementById('root');
if (!root) throw new Error('missing root');

createRoot(root).render(
  <StrictMode>
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/login" element={<LoginPage />} />
        <Route path="/paste-bench" element={<PasteBench />} />
        <Route element={<Shell />}>
          <Route path="/library" element={<LibraryPage />} />
          <Route path="/c/:id" element={<CollectionPage />} />
        </Route>
      </Routes>
    </BrowserRouter>
  </StrictMode>,
);
