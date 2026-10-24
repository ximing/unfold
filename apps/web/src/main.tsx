import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { register } from '@rabjs/react';
import { BrowserRouter, Route, Routes } from 'react-router';
import { PasteBench } from './paste-bench.js';
import { SessionService } from './services/session.service.js';
import { HomePage } from './pages/home.js';
import { LoginPage } from './pages/login.js';
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
        <Route path="/today" element={<TodayPage />} />
        <Route path="/paste-bench" element={<PasteBench />} />
      </Routes>
    </BrowserRouter>
  </StrictMode>,
);
