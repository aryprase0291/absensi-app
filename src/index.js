import React from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';
import App from './App';
import reportWebVitals from './reportWebVitals';
import { bersihkanSisaCacheSaatBoot } from './utils/pembaruan';

// Sisa Service Worker / Cache Storage dari rilis lama membuat "refresh"
// tetap menyajikan index.html dan bundle lama. Dibersihkan sekali di awal
// (satu kali muat ulang bila memang ada sisa) supaya sekali refresh sudah
// cukup untuk mendapatkan versi terbaru.
bersihkanSisaCacheSaatBoot();

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

// If you want to start measuring performance in your app, pass a function
// to log results (for example: reportWebVitals(console.log))
// or send to an analytics endpoint. Learn more: https://bit.ly/CRA-vitals
reportWebVitals();
