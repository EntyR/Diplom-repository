// src/main.jsx
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './FaceRecognitionApp.jsx'

createRoot(document.getElementById('root')).render(
  <StrictMode><App /></StrictMode>
)