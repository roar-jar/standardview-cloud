import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import { installStaticApi } from './staticApi.js'
import './index.css'

// 정적 배포에서는 /api/* 호출을 스냅샷 JSON으로 응답하도록 fetch를 가로챈다.
installStaticApi()

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
