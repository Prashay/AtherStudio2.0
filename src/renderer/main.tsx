import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './app/App'
import './app/theme.css'

const root = document.getElementById('root')
if (!root) throw new Error('Missing renderer root')
createRoot(root).render(<StrictMode><App /></StrictMode>)
