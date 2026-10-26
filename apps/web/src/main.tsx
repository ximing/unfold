import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { register } from '@rabjs/react';
import { BrowserRouter, Route, Routes } from 'react-router';
import { PasteBench } from './features/paste-bench/paste-bench.js';
import { SessionService } from './features/session/session.service.js';
import { CollectionPage } from './features/collection/collection-page.js';
import { HomePage } from './features/session/home-page.js';
import { LibraryPage } from './features/library/library-page.js';
import { LoginPage } from './features/session/login-page.js';
import { RegisterPage } from './features/session/register-page.js';
import { Shell } from './features/shell/shell.js';
import './foundation/base.css';
import './foundation/utilities.css';
import './foundation/motion.css';
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
        <Route path="/register" element={<RegisterPage />} />
        <Route path="/paste-bench" element={<PasteBench />} />
        <Route element={<Shell />}>
          <Route path="/library" element={<LibraryPage />} />
          <Route path="/c/:id" element={<CollectionPage />} />
        </Route>
      </Routes>
    </BrowserRouter>
  </StrictMode>,
);
