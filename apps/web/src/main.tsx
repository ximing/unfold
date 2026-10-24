import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { register } from '@rabjs/react';
import { BrowserRouter, Route, Routes } from 'react-router';
import { PasteBench } from './paste-bench.js';
import { SessionService } from './services/session.service.js';
import { CreateObjectPage } from './pages/create-object.js';
import { FocusPage } from './pages/focus.js';
import { FreePage } from './pages/free.js';
import { HomePage } from './pages/home.js';
import { LoginPage } from './pages/login.js';
import { Shell } from './pages/shell.js';
import { TodayPage } from './pages/today.js';
import './app.css';

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
          <Route path="/today" element={<TodayPage />} />
          <Route path="/new" element={<CreateObjectPage />} />
          <Route path="/free/:domainId" element={<FreePage />} />
          <Route path="/o/:id" element={<FocusPage />} />
        </Route>
      </Routes>
    </BrowserRouter>
  </StrictMode>,
);
